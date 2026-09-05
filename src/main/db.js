// better-sqlite3 数据持久化：用户设置（阅读模式/主题/字号/工作目录）。
// 数据库文件放在 userData 目录（%APPDATA%/book-loft/settings.db），
// 主进程单例打开，渲染层经 IPC 读写。
// 注意：better-sqlite3 是原生模块，必须使用 Electron ABI 的预编译
// （安装后需执行：npx prebuild-install --runtime electron --target <electron版本>，
//  或 @electron/rebuild），且在 electron.vite.config.mjs 中标记为 external。
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { app } from 'electron'

const require = createRequire(import.meta.url)

let db = null

// 键值白名单：只允许写入这些 key，防止渲染层写入任意字段
// workDirs: 图书馆里打开过的全部工作目录（阅览室列表，数组按最近使用排序）
export const SETTING_KEYS = ['mode', 'theme', 'fontSize', 'lastWorkDir', 'workDirs']

export function initDb() {
  if (db) return db
  const Database = require('better-sqlite3')
  const file = join(app.getPath('userData'), 'settings.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      book_path  TEXT PRIMARY KEY,
      title      TEXT,
      cfi        TEXT,
      percentage REAL,
      updated_at INTEGER NOT NULL
    )
  `)
  // 标注：用户对正文的标记（高亮/划线/标注/笔记）
  // - cfi_start / cfi_end：content 文档内的 partial CFI，epub.js 可还原为 DOM Range
  // - spine_index：标注所在章节（contents.sectionIndex），用于快速定位恢复
  // - selected_text：冗余存储选中的原文，便于文字回退匹配与笔记渲染
  // - chapter_title / chapter_href：所属章节（用于笔记按章节组织的二级标题）
  // - type：'highlight' | 'underline' | 'annotation' | 'note'
  // - style：'solid'|'dashed'（划线）或 5 种高亮颜色 key（'c1'..'c5'）
  // - color：实际色值（按当前主题生成；随书保存，确保换主题后历史标注颜色稳定）
  // - content：标注纯文本 / 笔记 markdown 正文（其余类型为空）
  db.exec(`
    CREATE TABLE IF NOT EXISTS annotations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      book_path     TEXT NOT NULL,
      type          TEXT NOT NULL,
      cfi_start     TEXT NOT NULL,
      cfi_end       TEXT NOT NULL,
      spine_index   INTEGER NOT NULL,
      selected_text TEXT NOT NULL,
      chapter_title TEXT,
      chapter_href  TEXT,
      style         TEXT,
      color         TEXT,
      content       TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    )
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_annotations_book ON annotations(book_path, id)'
  )
  return db
}

// 读取全部设置：返回 { key: value }（value 为 JSON.parse 后的原始值）
export function getAllSettings() {
  if (!db) return {}
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const out = {}
  for (const { key, value } of rows) {
    try {
      out[key] = JSON.parse(value)
    } catch {
      out[key] = value
    }
  }
  return out
}

// 写入单个设置（值统一 JSON 序列化存储，数字/字符串/布尔均可）
export function setSetting(key, value) {
  if (!db || !SETTING_KEYS.includes(key)) return false
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    key,
    JSON.stringify(value)
  )
  return true
}

// ---------- 阅读记录 ----------
// 每本书一条记录（同一本书只保留最新位置），按 updated_at 排序，
// 超过 HISTORY_LIMIT 本时淘汰最久未读的。

export const HISTORY_LIMIT = 50

// 更新（或插入）某本书的阅读记录
export function upsertHistory(bookPath, title, cfi, percentage) {
  if (!db || !bookPath) return false
  const now = Date.now()
  db.prepare(`
    INSERT INTO history (book_path, title, cfi, percentage, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(book_path) DO UPDATE SET
      title = excluded.title,
      cfi = excluded.cfi,
      percentage = excluded.percentage,
      updated_at = excluded.updated_at
  `).run(
    String(bookPath),
    title ? String(title) : '',
    cfi ? String(cfi) : '',
    typeof percentage === 'number' && Number.isFinite(percentage) ? percentage : null,
    now
  )
  // 只保留最近 50 条
  db.prepare(`
    DELETE FROM history WHERE book_path NOT IN (
      SELECT book_path FROM history ORDER BY updated_at DESC LIMIT ?
    )
  `).run(HISTORY_LIMIT)
  return true
}

// 最新一条阅读记录（最近读过的书 + 上次读到的位置）
export function getLatestHistory() {
  if (!db) return null
  return (
    db.prepare(`
      SELECT book_path AS bookPath, title, cfi, percentage, updated_at AS updatedAt
      FROM history ORDER BY updated_at DESC LIMIT 1
    `).get() || null
  )
}

// 全部阅读记录（按最近阅读排序，最多 50 条；供后续"阅读历史"界面使用）
export function getHistoryList() {
  if (!db) return []
  return db.prepare(`
    SELECT book_path AS bookPath, title, cfi, percentage, updated_at AS updatedAt
    FROM history ORDER BY updated_at DESC LIMIT ?
  `).all(HISTORY_LIMIT)
}

export function closeDb() {
  if (db) {
    try {
      db.close()
    } catch {}
    db = null
  }
}

// ---------- 标注（annotations） ----------
// 列出某本书的全部标注（按 id 升序）。渲染层用于章节恢复与笔记导出。
export function listAnnotations(bookPath) {
  if (!db || !bookPath) return []
  return db
    .prepare(
      `SELECT id, book_path AS bookPath, type, cfi_start AS cfiStart, cfi_end AS cfiEnd,
              spine_index AS spineIndex, selected_text AS selectedText,
              chapter_title AS chapterTitle, chapter_href AS chapterHref,
              style, color, content,
              created_at AS createdAt, updated_at AS updatedAt
         FROM annotations
        WHERE book_path = ?
        ORDER BY id ASC`
    )
    .all(String(bookPath))
}

// 写入一条标注并返回完整记录（含新 id / 时间戳）
export function createAnnotation(data) {
  if (!db || !data) return null
  const now = Date.now()
  const info = db
    .prepare(
      `INSERT INTO annotations
        (book_path, type, cfi_start, cfi_end, spine_index, selected_text,
         chapter_title, chapter_href, style, color, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(data.bookPath || ''),
      String(data.type || ''),
      String(data.cfiStart || ''),
      String(data.cfiEnd || ''),
      Number.isFinite(data.spineIndex) ? data.spineIndex : -1,
      String(data.selectedText || ''),
      data.chapterTitle ? String(data.chapterTitle) : null,
      data.chapterHref ? String(data.chapterHref) : null,
      data.style ? String(data.style) : null,
      data.color ? String(data.color) : null,
      data.content ? String(data.content) : null,
      now,
      now
    )
  return getAnnotationById(info.lastInsertRowid)
}

export function getAnnotationById(id) {
  if (!db || !id) return null
  return (
    db
      .prepare(
        `SELECT id, book_path AS bookPath, type, cfi_start AS cfiStart, cfi_end AS cfiEnd,
                spine_index AS spineIndex, selected_text AS selectedText,
                chapter_title AS chapterTitle, chapter_href AS chapterHref,
                style, color, content,
                created_at AS createdAt, updated_at AS updatedAt
           FROM annotations WHERE id = ?`
      )
      .get(id) || null
  )
}

// 更新标注（目前仅允许改 content / color / style）
export function updateAnnotation(id, patch) {
  if (!db || !id || !patch) return false
  const fields = []
  const values = []
  if ('content' in patch) {
    fields.push('content = ?')
    values.push(patch.content ? String(patch.content) : null)
  }
  if ('color' in patch) {
    fields.push('color = ?')
    values.push(patch.color ? String(patch.color) : null)
  }
  if ('style' in patch) {
    fields.push('style = ?')
    values.push(patch.style ? String(patch.style) : null)
  }
  if (!fields.length) return false
  fields.push('updated_at = ?')
  values.push(Date.now())
  values.push(id)
  db.prepare(`UPDATE annotations SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return true
}

export function deleteAnnotation(id) {
  if (!db || !id) return false
  db.prepare('DELETE FROM annotations WHERE id = ?').run(id)
  return true
}

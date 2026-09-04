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

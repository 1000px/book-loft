import { app, BrowserWindow, ipcMain } from 'electron'
import { readFileSync, readdirSync, promises as fsPromises } from 'node:fs'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixEpubToc } from './tocFix.js'
import {
  initDb,
  getAllSettings,
  setSetting,
  closeDb,
  upsertHistory,
  getLatestHistory,
  getHistoryList,
  listAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation
} from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: false, // 隐藏系统标题栏（含 logo / 最小化 / 最大化 / 关闭），顶栏改为可拖拽
    autoHideMenuBar: true,
    title: 'BookLoft',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // epub.js 需要在 blob: iframe 中加载本地资源，
      // 开发阶段关闭 webSecurity 避免同源策略拦截 blob URL 内容
      webSecurity: !isDev,
      allowRunningInsecureContent: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 最大化状态变化时广播给渲染层（同步顶栏"最大化/恢复"按钮图标）。
  // 覆盖所有改变窗口状态的途径（按钮点击、Win+↑ 等）。
  const sendMaximized = () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('win:maximized-changed', mainWindow.isMaximized())
    }
  }
  mainWindow.on('maximize', sendMaximized)
  mainWindow.on('unmaximize', sendMaximized)

  if (isDev) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// IPC: 用户设置持久化（better-sqlite3，见 db.js）。
// 渲染层启动时 getAll 一次性取回；mode/theme/fontSize/lastWorkDir 变化时逐项 set。
ipcMain.handle('settings:getAll', () => {
  try {
    return getAllSettings()
  } catch (err) {
    console.error('[db] getAll failed:', err)
    return {}
  }
})

ipcMain.handle('settings:set', (_event, key, value) => {
  try {
    return setSetting(key, value)
  } catch (err) {
    console.error('[db] set failed:', key, err)
    return false
  }
})

// IPC: 阅读记录（better-sqlite3，见 db.js）。
// 渲染层在 relocated 时防抖写入当前位置；启动时取最新一条恢复阅读。
ipcMain.handle('history:upsert', (_event, bookPath, title, cfi, percentage) => {
  try {
    return upsertHistory(bookPath, title, cfi, percentage)
  } catch (err) {
    console.error('[db] history upsert failed:', err)
    return false
  }
})

ipcMain.handle('history:latest', () => {
  try {
    return getLatestHistory()
  } catch (err) {
    console.error('[db] history latest failed:', err)
    return null
  }
})

ipcMain.handle('history:list', () => {
  try {
    return getHistoryList()
  } catch (err) {
    console.error('[db] history list failed:', err)
    return []
  }
})

// IPC: 标注 CRUD（高亮 / 划线 / 标注 / 笔记）
ipcMain.handle('annotations:list', (_event, bookPath) => {
  try {
    return listAnnotations(bookPath)
  } catch (err) {
    console.error('[db] annotations list failed:', err)
    return []
  }
})

ipcMain.handle('annotations:create', (_event, data) => {
  try {
    return createAnnotation(data)
  } catch (err) {
    console.error('[db] annotation create failed:', err)
    return null
  }
})

ipcMain.handle('annotations:update', (_event, id, patch) => {
  try {
    return updateAnnotation(id, patch)
  } catch (err) {
    console.error('[db] annotation update failed:', err)
    return false
  }
})

ipcMain.handle('annotations:delete', (_event, id) => {
  try {
    return deleteAnnotation(id)
  } catch (err) {
    console.error('[db] annotation delete failed:', err)
    return false
  }
})

// IPC: 阅览室封面图（图书馆主页用）：在工作目录里找 bg.png（优先）或 bg.jpg，
// 找到则读取并以 data URL 返回，找不到返回 null。结果按目录缓存避免重复读盘。
const roomCoverCache = new Map()
ipcMain.handle('dir:roomCover', (_event, dir) => {
  try {
    if (!dir || typeof dir !== 'string') return null
    if (roomCoverCache.has(dir)) return roomCoverCache.get(dir)
    const entries = readdirSync(dir)
    let file = null
    // png 优先级高于 jpg（需求规定两者都有时取 png）
    for (const n of entries) {
      if (n.toLowerCase() === 'bg.png') {
        file = join(dir, n)
        break
      }
    }
    if (!file) {
      for (const n of entries) {
        const l = n.toLowerCase()
        if (l === 'bg.jpg' || l === 'bg.jpeg') {
          file = join(dir, n)
          break
        }
      }
    }
    if (!file) {
      roomCoverCache.set(dir, null)
      return null
    }
    const buf = readFileSync(file)
    const mime = /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png'
    const result = { dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
    roomCoverCache.set(dir, result)
    return result
  } catch (err) {
    console.error('[dir:roomCover] failed:', err)
    return null
  }
})

// IPC: 应用内目录选择器——浏览目录（设置 -> 打开工作目录）。
// 不再使用系统原生对话框：全屏状态下原生对话框会被 Windows 还原窗口、露出任务栏，
// 各类遮罩方案均有残余闪现。改为渲染层自绘选择界面，主进程只负责列目录。
ipcMain.handle('dir:browse', async (_event, dir) => {
  try {
    if (!dir) {
      // 根视图：Windows 列出盘符，其他平台从用户目录开始
      if (process.platform === 'win32') {
        const drives = await listWindowsDrives()
        return {
          path: '',
          name: '此电脑',
          parent: null,
          crumbs: [],
          dirs: drives.map((d) => ({ path: d, name: d }))
        }
      }
      dir = homedir()
    }
    const entries = await fsPromises.readdir(dir, { withFileTypes: true })
    const IGNORED = /^\.|^\$RECYCLE\.BIN$|^System Volume Information$/i
    const dirs = entries
      .filter((e) => e.isDirectory() && !IGNORED.test(e.name))
      .map((e) => ({ path: join(dir, e.name), name: e.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    const parent = dirname(dir)
    return {
      path: dir,
      name: basename(dir) || dir,
      parent: parent && parent !== dir ? parent : null,
      crumbs: buildCrumbs(dir),
      dirs
    }
  } catch (err) {
    return { error: '无法读取该目录: ' + (err?.message || String(err)) }
  }
})

// 拆分完整路径为可点击的面包屑段（Windows: "D:\a\b" -> [D:\, a, b]）
function buildCrumbs(dir) {
  const parts = String(dir).split(/[\\/]+/).filter(Boolean)
  const crumbs = []
  let acc = ''
  for (let i = 0; i < parts.length; i++) {
    if (i === 0) {
      acc = parts[0].endsWith(':') ? parts[0] + '\\' : parts[0]
    } else {
      acc = acc.endsWith('\\') || acc.endsWith('/') ? acc + parts[i] : acc + '\\' + parts[i]
    }
    crumbs.push({ path: acc, name: i === 0 && parts[0].endsWith(':') ? acc : parts[i] })
  }
  return crumbs
}

// 列出 Windows 就绪的盘符（PowerShell DriveInfo，避免逐个试探不存在的盘）
function listWindowsDrives() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.IsReady } | ForEach-Object { $_.Name }'
      ],
      { timeout: 5000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(['C:\\'])
        const drives = stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
        resolve(drives.length ? drives : ['C:\\'])
      }
    )
  })
}


// IPC: 扫描工作目录，生成书库树：
//   一级 = 工作目录名；二级 = 其直接子文件夹 / 直接 epub；三级 = 子文件夹内的 epub。
//   子文件夹只展开一层收集 epub，更深层级的文件夹忽略（不递归）。
ipcMain.handle('library:scan', async (_event, dir) => {
  if (!dir) return null
  try {
    return buildLibraryTree(dir)
  } catch (err) {
    console.error('Failed to scan library:', err)
    return null
  }
})

// 去掉 .epub 后缀得到文件名主干
function epubBaseName(name) {
  return name.slice(0, -5)
}

// 单个 epub 文件的信息：isFixed 表示是否为 -toc 修复版；base 为去 -toc、去 .epub 的展示主干
function epubMeta(name, path) {
  let base = epubBaseName(name)
  let isFixed = false
  if (base.toLowerCase().endsWith('-toc')) {
    base = base.slice(0, -4)
    isFixed = true
  }
  return { name, path, type: 'epub', isFixed, base }
}

// 从一组 epub 中解析出"优先打开的文件"：带 -toc 的修复版优先，否则取第一个原版
function resolvePreferred(epubs) {
  if (!epubs || epubs.length === 0) return null
  return epubs.find((e) => e.isFixed) || epubs[0]
}

// 把工作目录整理成两级/三级的书籍树。
// 一级 = 工作目录名；二级 = 直接子文件夹 / 直接 epub；三级 = 子文件夹内的 epub。
// 子文件夹只展开一层收集 epub，更深层级的文件夹忽略（不递归）。
// 说明：这里不再做"同名只留 -toc"的过滤，而是把所有文件都带上 isFixed/base 元数据
// 返回，展示去重与"优先 -toc"的解析交由渲染层完成（这样原版作为兜底仍保留在数据里）。
function buildLibraryTree(dir) {
  const isEpub = (name) => name.toLowerCase().endsWith('.epub')
  const children = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      const sub = []
      try {
        const subEntries = readdirSync(full, { withFileTypes: true })
        for (const se of subEntries) {
          if (!se.isDirectory() && isEpub(se.name)) {
            sub.push(epubMeta(se.name, join(full, se.name)))
          }
        }
      } catch (_) {
        // 无权限等：跳过该文件夹
      }
      const preferred = resolvePreferred(sub)
      children.push({
        name: e.name,
        path: full,
        type: 'folder',
        children: sub,
        preferredPath: preferred ? preferred.path : null
      })
    } else if (isEpub(e.name)) {
      children.push(epubMeta(e.name, full))
    }
  }
  return { name: basename(dir), path: dir, type: 'root', children }
}

// IPC: 目录更正 —— 按"目录 label 匹配正文标题实际所在文件"重写 toc.ncx，
//      生成一份新的 【原名】-toc.epub，原文件不做任何修改。
ipcMain.handle('epub:fixToc', async (_event, filePath) => {
  if (!filePath) return { ok: false, message: '未指定电子书' }
  try {
    return await fixEpubToc(filePath)
  } catch (err) {
    console.error('Failed to fix toc:', err)
    return { ok: false, message: '目录更正失败: ' + (err?.message || String(err)) }
  }
})

// IPC: 窗口系统全屏切换（沉浸式阅读 进入=true / 退出=false）。
// 渲染层同时隐藏顶栏/目录栏，实现"整屏正文"的沉浸效果。
ipcMain.on('app:setFullscreen', (_event, flag) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(!!flag)
  }
})

// IPC: 界面全屏（切换）——只把窗口铺满整个屏幕，界面结构不变。
// 返回切换后是否处于全屏。
ipcMain.handle('app:toggleFullscreen', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  const next = !mainWindow.isFullScreen()
  mainWindow.setFullScreen(next)
  return next
})

// IPC: 自绘标题栏窗口控制（最小化 / 最大化-恢复；关闭走 app:quit）。
ipcMain.on('win:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize()
  }
})

ipcMain.handle('win:toggleMaximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
    return false
  }
  mainWindow.maximize()
  return true
})

ipcMain.handle('win:isMaximized', () => {
  return !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized())
})

// IPC: 退出应用（设置菜单 -> 退出）。
// 先强制销毁主窗口确保彻底关闭，再 quit；避免某些环境下 app.quit() 不生效。
ipcMain.on('app:quit', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy()
  }
  app.quit()
})

// IPC: read epub file as ArrayBuffer (avoid CORS / file protocol issues with epub.js)
ipcMain.handle('file:readEpubBuffer', async (_event, filePath) => {
  if (!filePath) return null
  try {
    const buffer = readFileSync(filePath)
    // Convert Node Buffer to ArrayBuffer for IPC transfer
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    )
    return arrayBuffer
  } catch (err) {
    console.error('Failed to read epub file:', err)
    return null
  }
})

app.whenReady().then(() => {
  // 初始化 SQLite 设置库（失败不阻断启动，设置功能自动降级为默认值）
  try {
    initDb()
  } catch (err) {
    console.error('[db] init failed:', err)
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  closeDb()
})

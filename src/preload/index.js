import { contextBridge, ipcRenderer } from 'electron'

// Expose a minimal, safe API surface to the renderer process
contextBridge.exposeInMainWorld('bookloftAPI', {
  // 浏览目录（应用内目录选择器）：dir 为空返回根视图（Windows 盘符列表）
  // 返回 { path, name, parent, crumbs, dirs } 或 { error }
  browseDirectory: (dir) => ipcRenderer.invoke('dir:browse', dir),
  // 阅览室封面图（图书馆主页）：在工作目录里找 bg.png/bg.jpg，返回 { dataUrl } 或 null
  getRoomCover: (dir) => ipcRenderer.invoke('dir:roomCover', dir),
  // Scan a working directory into a library tree (folders + epubs), returns tree or null
  scanLibrary: (dir) => ipcRenderer.invoke('library:scan', dir),
  // 目录更正：按"目录 label 匹配正文标题实际所在文件"重写 toc.ncx，生成 【原名】-toc.epub
  fixToc: (filePath) => ipcRenderer.invoke('epub:fixToc', filePath),
  // Read an epub file (by path) into an ArrayBuffer for epub.js to consume
  readEpubBuffer: (filePath) => ipcRenderer.invoke('file:readEpubBuffer', filePath),
  // Quit the whole application (settings menu -> 退出)
  quitApp: () => ipcRenderer.send('app:quit'),
  // 切换窗口系统全屏（沉浸式阅读）：true 进入，false 退出
  setFullscreen: (flag) => ipcRenderer.send('app:setFullscreen', flag),
  // 界面全屏：仅把窗口铺满整个屏幕（界面结构不变），返回切换后是否全屏
  toggleFullscreen: () => ipcRenderer.invoke('app:toggleFullscreen'),
  // 用户设置持久化（better-sqlite3）：启动时 getAll 一次性取回，变化时逐项 set
  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  // 阅读记录：relocated 防抖写入（bookPath, title, cfi, percentage），最多保留 50 条
  upsertHistory: (bookPath, title, cfi, percentage) =>
    ipcRenderer.invoke('history:upsert', bookPath, title, cfi, percentage),
  // 最新一条阅读记录（最近读的书 + 上次位置），无记录返回 null
  getLatestHistory: () => ipcRenderer.invoke('history:latest'),
  // 全部阅读记录列表（按最近阅读排序）
  getHistoryList: () => ipcRenderer.invoke('history:list')
})

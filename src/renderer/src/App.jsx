import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Reader from './components/Reader.jsx'
import Toolbar from './components/Toolbar.jsx'
import TOC from './components/TOC.jsx'
import DirPicker from './components/DirPicker.jsx'
import LibraryHome from './components/LibraryHome.jsx'
import NotesDrawer from './components/NotesDrawer.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_STEP
} from './config'

// 归一化 href：去掉锚点(#)与开头的 "./"，便于目录项与当前位置互相匹配
function normalizeHref(href) {
  if (!href) return ''
  return String(href).split('#')[0].replace(/^\.\//, '')
}

// ---- 设置持久化的取值校验（防止数据库里出现过期/非法值导致界面异常） ----
const THEMES = ['light', 'green', 'dark', 'ink']

function normalizeMode(v, fallback = 'scrolled-doc') {
  return v === 'paginated' || v === 'scrolled-doc' ? v : fallback
}

function normalizeTheme(v, fallback = 'light') {
  return THEMES.includes(v) ? v : fallback
}

function normalizeFontSize(v, fallback = FONT_SIZE_DEFAULT) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n))
}

// 根据当前阅读位置 href，在目录树里找到对应的章节名（取匹配最长的一项）
function findChapterLabel(href, toc) {
  if (!href || !toc || !toc.length) return ''
  const target = normalizeHref(href).toLowerCase()
  if (!target) return ''
  let best = ''
  let bestLen = -1
  for (const item of toc) {
    const h = normalizeHref(item.href).toLowerCase()
    if (!h) continue
    if (target === h || target.endsWith('/' + h) || target.endsWith(h)) {
      if (h.length > bestLen) {
        best = item.label
        bestLen = h.length
      }
    }
  }
  return best
}

// 去掉 .epub 后缀用于展示
function stripEpub(name) {
  return name.toLowerCase().endsWith('.epub') ? name.slice(0, -5) : name
}

// 从完整路径取末级目录名（阅览室展示名）："D:/Books/历史" -> "历史"
function dirNameOf(dir) {
  if (!dir) return ''
  return String(dir).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir
}

// 阅览室二级展示名：去 -toc 修复版标记、再去 .epub 后缀
function cleanBookName(name) {
  let base = stripEpub(name)
  if (base.toLowerCase().endsWith('-toc')) base = base.slice(0, -4)
  return base
}

// 根据当前打开的文件路径，在书库(library)里找到对应的"目录栏节点名"。
// 逻辑与阅览室两级展示保持一致：
//   - 文件在某个子文件夹内 → 返回该文件夹名（目录栏那一行显示的名字）
//   - 文件直接放在工作目录根 → 返回去掉 -toc/.epub 的干净书名
// 找不到匹配（未从书库打开、或书库未加载）时返回空，交由上层回退到 epub 元数据书名。
function findLibraryTitle(library, filePath) {
  if (!library || !filePath) return ''
  const children = library.children
  if (!Array.isArray(children)) return ''
  let directBook = ''
  for (const c of children) {
    if (c.type === 'folder') {
      const epubs = (c.children || []).filter((x) => x.type === 'epub')
      if (epubs.some((e) => e.path === filePath)) return c.name
    } else if (c.type === 'epub' && c.path === filePath) {
      directBook = cleanBookName(c.name)
    }
  }
  return directBook
}

// ⚠️ 测试用：硬编码一个本地 epub 路径，便于首次启动直接验证。
//    留空时打开应用只会显示空阅读区，需要点击"打开文件"选择 epub。
//    替换为你机器上任意一本 epub 的绝对路径，例如：
//    'D:/Books/sample.epub'
const TEST_EPUB_PATH = 'D:/WorkSpace/ebooks/历史的拼图/钢铁王国/钢铁王国.epub'

export default function App() {
  const [filePath, setFilePath] = useState(TEST_EPUB_PATH || '')
  const [mode, setMode] = useState('scrolled-doc') // 'paginated' | 'scrolled-doc'，默认连续
  const [tocOpen, setTocOpen] = useState(true)
  const [fontSize, setFontSize] = useState(FONT_SIZE_DEFAULT)
  // 阅读主题：'light' | 'green' | 'dark' | 'ink'
  const [theme, setTheme] = useState('light')
  const [toc, setToc] = useState([])
  const [location, setLocation] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // 目录更正成功的临时提示
  const [notice, setNotice] = useState('')
  const [bookTitle, setBookTitle] = useState('')
  // 书库（阅览室）相关状态
  const [workingDir, setWorkingDir] = useState('')
  const [library, setLibrary] = useState(null)
  const [sidebarMode, setSidebarMode] = useState('current') // 'current' | 'reading-room'
  // 图书馆主页：打开过的全部工作目录（阅览室列表，按最近使用排序，持久化）
  const [workDirs, setWorkDirs] = useState([])
  // 阅览室封面图（目录内 bg.png/bg.jpg 转 data URL），key 为目录路径
  const [coverMap, setCoverMap] = useState({})
  // 图书馆主页视图：隐藏目录栏与正文区，居中展示阅览室列表
  const [homeOpen, setHomeOpen] = useState(false)
  // 用户最近点击的目录条目（完整 href，含 #锚点）：
  // epub.js 的 location.href 不含锚点，需靠它区分同一文件内的多个章节
  const [selectedHref, setSelectedHref] = useState('')
  // 目录更正是否进行中（菜单项禁用，避免重复触发）
  const [fixing, setFixing] = useState(false)
  // 沉浸式全屏阅读：隐藏顶栏/目录栏 + 窗口系统全屏 + 强制连续滚动模式
  const [immersive, setImmersive] = useState(false)
  // 窗口是否处于系统全屏（界面全屏/沉浸模式共用）：决定设置菜单显示"界面全屏"还是"退出全屏"
  const [windowFullscreen, setWindowFullscreen] = useState(false)
  // 窗口是否最大化（自绘窗口控制按钮的"最大化/恢复"图标切换）：
  // 启动时查询一次，之后监听主进程广播，保证与真实窗口状态始终同步
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    const api = window.bookloftAPI
    if (typeof api?.isMaximized === 'function') {
      api.isMaximized().then((v) => setMaximized(!!v)).catch(() => {})
    }
    if (typeof api?.onMaximizedChanged === 'function') {
      return api.onMaximizedChanged((v) => setMaximized(!!v))
    }
  }, [])
  // 进入沉浸模式前的阅读模式，退出时恢复（保证普通模式体验不变）
  const prevModeRef = useRef('scrolled-doc')

  // 设置是否已从数据库加载完成（better-sqlite3 持久化）。
  // 加载完成前不渲染主界面，保证首屏即按上次的模式/主题/字号/工作目录初始化。
  const [booted, setBooted] = useState(false)
  // 启动时从阅读记录恢复的阅读位置（最新一条记录的 CFI），仅对新打开的这本人参生效
  const [initialCfi, setInitialCfi] = useState('')
  // 标注（高亮/划线/标注/笔记）：随 filePath 变化从 DB 加载
  const [annotations, setAnnotations] = useState([])
  // 笔记管理抽屉：true=已从右侧滑出显示（collapsed 子状态由 NotesDrawer 内部控制）
  const [notesOpen, setNotesOpen] = useState(false)

  // —— 自定义确认框状态（替代原生 confirm / alert）——
  // confirmState: null=关闭；否则为 { message, detail, confirmText, cancelText, alertOnly }
  // confirmResolveRef 保存当前 pending 的 Promise resolve，用户点击后兑现。
  const [confirmState, setConfirmState] = useState(null)
  const confirmResolveRef = useRef(null)

  // 弹出确认框，await 返回 true=确认 / false=取消。用法等同 window.confirm。
  const requestConfirm = useCallback(
    ({ message, detail, confirmText, cancelText, alertOnly = false }) =>
      new Promise((resolve) => {
        // 若已有弹框在等待，先兑现旧的（避免 resolve 泄漏导致调用方永久挂起）
        confirmResolveRef.current?.(false)
        confirmResolveRef.current = resolve
        setConfirmState({
          message: message || '确认执行该操作？',
          detail: detail || '',
          confirmText: confirmText || '确认删除',
          cancelText: cancelText || '取消',
          alertOnly
        })
      }),
    []
  )

  // 单按钮提示（替代原生 alert）。await 只是等用户关闭。
  const showAlert = useCallback(
    (message, detail) =>
      requestConfirm({ message, detail, alertOnly: true }),
    [requestConfirm]
  )

  // 用户点击确认 / 取消：兑现 Promise 并关闭弹框
  const settleConfirm = useCallback((ok) => {
    const resolve = confirmResolveRef.current
    confirmResolveRef.current = null
    setConfirmState(null)
    resolve?.(ok)
  }, [])

  // 保存 rendition 引用以便工具栏翻页 / 目录跳转
  const renditionRef = useRef(null)

  // 持久化单个设置项（接口未就绪或数据库失败时静默降级）
  const saveSetting = useCallback((key, value) => {
    const api = window.bookloftAPI
    if (api && typeof api.setSetting === 'function') {
      api.setSetting(key, value).catch(() => {})
    }
  }, [])

  // 启动引导：一次性读回全部持久化设置并初始化界面状态
  useEffect(() => {
    let cancelled = false
    const api = window.bookloftAPI
    async function boot() {
      let saved = {}
      try {
        if (api && typeof api.getSettings === 'function') {
          saved = (await api.getSettings()) || {}
        }
      } catch (err) {
        console.warn('[App] 读取持久化设置失败，使用默认值:', err)
      }
      if (cancelled) return
      setMode(normalizeMode(saved.mode))
      setTheme(normalizeTheme(saved.theme))
      setFontSize(normalizeFontSize(saved.fontSize))
      // 恢复图书馆（打开过的全部工作目录）：lastWorkDir 兜底并入列表首尾
      const savedDirs = Array.isArray(saved.workDirs)
        ? saved.workDirs.filter((d) => typeof d === 'string' && d)
        : []
      const lastDir = typeof saved.lastWorkDir === 'string' ? saved.lastWorkDir : ''
      const dirs = lastDir && !savedDirs.includes(lastDir)
        ? [lastDir, ...savedDirs]
        : savedDirs
      setWorkDirs(dirs)
      // 恢复上一次的工作目录：重新扫描成书库树并切到阅览室视图
      if (lastDir && typeof api?.scanLibrary === 'function') {
        try {
          const tree = await api.scanLibrary(lastDir)
          if (!cancelled && tree) {
            setWorkingDir(lastDir)
            setLibrary(tree)
            setSidebarMode('reading-room')
          }
        } catch (err) {
          console.warn('[App] 恢复工作目录失败:', err)
        }
      }
      // 恢复最新一条阅读记录：打开最近读的那本书并定位到上次读到的位置
      try {
        if (!cancelled && typeof api?.getLatestHistory === 'function') {
          const last = await api.getLatestHistory()
          if (last && last.bookPath) {
            setFilePath(last.bookPath)
            if (last.cfi) setInitialCfi(String(last.cfi))
          }
        }
      } catch (err) {
        console.warn('[App] 恢复阅读记录失败:', err)
      }
      if (!cancelled) setBooted(true)
    }
    boot()
    return () => {
      cancelled = true
    }
  }, [])

  // 打开新书时拉取该书全部标注（失败静默降级为空数组）
  useEffect(() => {
    if (!booted || !filePath) {
      setAnnotations([])
      return
    }
    // 切书瞬间先清空 state，避免抽屉里短暂闪现上一本书的标注（抽屉按 filePath remount，
    // 但 React state 更新异步，DB 回灌要一拍，这一步把"上一本残留窗口期"堵死）。
    setAnnotations([])
    let cancelled = false
    const api = window.bookloftAPI
    if (typeof api?.listAnnotations !== 'function') return
    api
      .listAnnotations(filePath)
      .then((list) => {
        if (!cancelled) setAnnotations(Array.isArray(list) ? list : [])
      })
      .catch((err) => console.warn('[App] 加载标注失败:', err))
    return () => {
      cancelled = true
    }
  }, [filePath, booted])

  // 新增标注：调主进程写入，并把返回的完整记录合并进本地 state
  const handleCreateAnnotation = useCallback(
    async (payload) => {
      const api = window.bookloftAPI
      if (typeof api?.createAnnotation !== 'function') return null
      try {
        const anno = await api.createAnnotation(payload)
        if (anno) setAnnotations((prev) => [...prev, anno])
        return anno
      } catch (err) {
        console.error('[App] 创建标注失败:', err)
        return null
      }
    },
    []
  )

  // 删除标注：先弹自定义确认框（ConfirmDialog，非原生 confirm），避免误触；
  // 通过后再调 IPC + 更新本地 state。
  // 任何类型（高亮 / 划线 / 标注 / 笔记）的标注都可被删除——确认提示统一文案。
  // 返回值：true=真删，false=取消 / 删除失败——Reader 据此决定是否同步关闭弹框。
  const handleDeleteAnnotation = useCallback(
    async ({ id, type }) => {
      if (id == null) return false
      const api = window.bookloftAPI
      if (typeof api?.deleteAnnotation !== 'function') return false
      const typeLabel =
        type === 'note'
          ? '笔记'
          : type === 'annotation'
          ? '批注'
          : type === 'underline'
          ? '划线'
          : type === 'highlight'
          ? '高亮'
          : '标注'
      // 自定义确认框：await 直到用户点确认 / 取消
      const ok = await requestConfirm({
        message: `确认删除这条${typeLabel}？`,
        detail: '删除后无法恢复，该标记也会从正文中一并移除。',
        confirmText: '确认删除'
      })
      if (!ok) return false
      try {
        await api.deleteAnnotation(id)
        setAnnotations((prev) => prev.filter((a) => String(a.id) !== String(id)))
        return true
      } catch (err) {
        console.error('[App] 删除标注失败:', err)
        showAlert('删除失败，请稍后重试。', err?.message || String(err))
        return false
      }
    },
    [requestConfirm, showAlert]
  )

  // 批量删除（笔记管理抽屉专用）：一次确认 + 一次 IPC，删完即从 state 过滤。
  // ids 是 id 数组（已转字符串）；成功后通知 drawer 清空选中状态。
  const handleBulkDeleteAnnotations = useCallback(
    async (ids, onDone) => {
      if (!Array.isArray(ids) || ids.length === 0) return
      const api = window.bookloftAPI
      if (typeof api?.deleteAnnotations !== 'function') {
        // 缺批量接口时退化为逐个删除（防止依赖未就绪）
        for (const id of ids) {
          try {
            await api.deleteAnnotation(id)
          } catch (_) {}
        }
      } else {
        const ok = await requestConfirm({
          message: `确认删除选中的 ${ids.length} 项标记？`,
          detail: '包含高亮、划线、批注与笔记，删除后无法恢复。',
          confirmText: `删除 ${ids.length} 项`
        })
        if (!ok) return
        try {
          await api.deleteAnnotations(ids)
        } catch (err) {
          console.error('[App] 批量删除失败:', err)
          showAlert('批量删除失败，请稍后重试。', err?.message || String(err))
          return
        }
      }
      const idSet = new Set(ids.map((x) => String(x)))
      setAnnotations((prev) => prev.filter((a) => !idSet.has(String(a.id))))
      onDone?.()
    },
    [requestConfirm, showAlert]
  )

  // 从笔记管理抽屉跳到某条标注所在正文位置。
  //
  // 真正的"safe jump"逻辑全部在 Reader.jsx 里实现，挂在 rendition
  // 上的 `rendition.jumpToAnnoSafe(anno)`。App 层只是调用方，不重复实现。
  //
  // 该函数（Reader.jsx 内）解决根本性 bug：
  // epub.js 的 DefaultViewManager.display() 在 `add(section).then(view.locationOf(target))`
  // 同步抛 DOMException（如 `Range.setEnd: no child at offset N`）时，
  // displayed promise 既不 resolve 也不 reject（错误回调只在 add reject 时
  // 触发，对 success 回调里的异常不生效），DOMException 作为 unhandled
  // rejection 冒到控制台，relocated 永不触发。
  //
  // 修复策略：完全绕开 DefaultViewManager 的 CFI target 路径——
  //   1. 用 `rendition.display(chapterHref)` 加载章节（epub.js 内部会把
  //      `target === section.href` 转为 undefined target，不走 locationOf）。
  //   2. 等 relocated 事件后，章节 DOM 已挂载，单独用 `new EpubCFI(cfi).toRange(doc)`
  //      在 try/catch 里解析 CFI + scrollIntoView 滚到标记位置。
  //   3. Reader.jsx 顶部加全局 unhandledrejection 监听，
  //      兜底吞掉任何残留的 epub.js DOMException（防止控制台噪音）。
  const handleJumpToAnnotation = useCallback(async (anno) => {
    const rendition = renditionRef.current
    if (!rendition || !anno) return
    try {
      const result =
        (typeof rendition.jumpToAnnoSafe === 'function'
          ? await rendition.jumpToAnnoSafe(anno)
          : null)
      if (result && result.ok && anno.chapterHref) {
        setSelectedHref(String(anno.chapterHref))
      }
    } catch (err) {
      console.error('[App.jump] jumpToAnnoSafe threw:', err)
    }
  }, [])

  // 笔记管理抽屉切换（设置菜单 -> 笔记管理）：无书时禁用并提示。
  // 抽屉是 position:fixed 浮层，不挤压正文区。
  // 二次进入依靠设置菜单的笔记管理按钮（toggle 行为）。
  const handleToggleNotes = useCallback(() => {
    if (!filePath) {
      setError('笔记管理：请先打开一本电子书。')
      return
    }
    setNotesOpen((v) => !v)
  }, [filePath])

  // 以下为设置变化的持久化（booted 之前不写，避免用默认值覆盖数据库里的旧值）
  useEffect(() => {
    if (booted) saveSetting('mode', mode)
  }, [mode, booted, saveSetting])

  useEffect(() => {
    if (booted) saveSetting('theme', theme)
  }, [theme, booted, saveSetting])

  useEffect(() => {
    if (booted) saveSetting('fontSize', fontSize)
  }, [fontSize, booted, saveSetting])

  // 阅览室列表（图书馆）变化时持久化
  useEffect(() => {
    if (booted) saveSetting('workDirs', workDirs)
  }, [workDirs, booted, saveSetting])

  // 应用内目录选择器开关（替代系统原生对话框，全屏下零闪现）
  const [dirPickerOpen, setDirPickerOpen] = useState(false)

  // 设置 -> 打开工作目录：打开应用内目录选择器
  const handleOpenWorkingDir = useCallback(() => {
    setDirPickerOpen(true)
  }, [])

  // 目录选择器确认：扫描成书库树，切到阅览室视图
  const handleDirPicked = useCallback(async (dir) => {
    setDirPickerOpen(false)
    setError('')
    const api = window.bookloftAPI
    if (typeof api?.scanLibrary !== 'function') {
      setError('打开工作目录失败：接口未就绪，请完全退出并重新启动应用（preload 需要随进程重新加载）。')
      return
    }
    try {
      const tree = await api.scanLibrary(dir)
      if (!tree) throw new Error('无法读取该目录')
      setWorkingDir(dir)
      setLibrary(tree)
      setSidebarMode('reading-room')
      saveSetting('lastWorkDir', dir)
      // 新目录加入图书馆（去重，最近使用的排最前）
      setWorkDirs((prev) => [dir, ...prev.filter((d) => d !== dir)])
    } catch (err) {
      setError('打开工作目录失败: ' + (err?.message || String(err)))
    }
  }, [saveSetting])

  // 图书馆主页：点击某个阅览室卡片进入。若就是当前工作目录则直接回到阅读视图；
  // 否则扫描该目录成书库树并切换（工作目录/lastWorkDir 随之更新）。
  const handleOpenRoom = useCallback(
    async (dir) => {
      setHomeOpen(false)
      if (dir === workingDir) return
      const api = window.bookloftAPI
      if (typeof api?.scanLibrary !== 'function') return
      try {
        const tree = await api.scanLibrary(dir)
        if (!tree) throw new Error('无法读取该目录')
        setWorkingDir(dir)
        setLibrary(tree)
        setSidebarMode('reading-room')
        saveSetting('lastWorkDir', dir)
        setWorkDirs((prev) => [dir, ...prev.filter((d) => d !== dir)])
      } catch (err) {
        setError('打开阅览室失败: ' + (err?.message || String(err)))
      }
    },
    [workingDir, saveSetting]
  )

  // 从阅览室点击某本书：加载该书（右侧正文/顶部书名随之更新）
  const handleSelectBook = useCallback((path) => {
    if (path) {
      setSelectedHref('') // 换书后旧的目录高亮项已失效
      setInitialCfi('') // 换书不继承上一本书的恢复定位
      setFilePath(path)
    }
  }, [])

  // 目录更正：针对当前阅读的书籍，重写 toc.ncx 生成修复版 epub。
  // 成功且生成路径存在时，立即切换正文到修复版；若该书在工作目录书库里则刷新列表。
  const handleFixToc = useCallback(async () => {
    const api = window.bookloftAPI
    if (typeof api?.fixToc !== 'function') {
      setError('目录更正：接口未就绪，请完全退出并重新启动应用（preload 需随进程重新加载）。')
      return
    }
    if (!filePath) {
      setError('目录更正：请先打开一本电子书。')
      return
    }
    setFixing(true)
    setError('')
    try {
      const result = await api.fixToc(filePath)
      if (!result?.ok) {
        setError('目录更正失败：' + (result?.message || '未知错误'))
        return
      }
      const fixedPath = result.path
      if (fixedPath) {
        setSelectedHref('')
        setInitialCfi('') // 修复版是重新生成的文件，旧定位不可靠
        setFilePath(fixedPath)
      }
      // 若该书位于已打开的工作目录下，重新扫描以展示新的 -toc 版本（并隐藏原版）
      if (workingDir) {
        try {
          const tree = await api.scanLibrary(workingDir)
          if (tree) setLibrary(tree)
        } catch (_) {}
      }
      // 给用户一条可感知的反馈（非致命，不弹阻断）
      console.log('[App] 目录更正完成:', result.message)
      setNotice(result.message || '目录更正完成')
      setError('') // 无报错
    } catch (err) {
      setError('目录更正失败：' + (err?.message || String(err)))
    } finally {
      setFixing(false)
    }
  }, [filePath, workingDir])

  const handleReady = useCallback(({ rendition, toc: tocList, book }) => {
    renditionRef.current = rendition
    setToc(tocList || [])
    // 书名来自 epub.js 解析出的元数据
    let title = ''
    try {
      title = book?.packaging?.metadata?.title || ''
    } catch (_) {}
    if (title && typeof title !== 'string') title = String(title)
    setBookTitle(title)
  }, [])

  const handleRelocated = useCallback((loc) => {
    setLocation(loc)
  }, [])

  const handlePrev = useCallback(() => {
    console.log('[App] prev clicked, rendition exists:', !!renditionRef.current)
    if (renditionRef.current) {
      renditionRef.current.prev().catch((err) => console.error('[App] prev failed:', err))
    }
  }, [])

  const handleNext = useCallback(() => {
    console.log('[App] next clicked, rendition exists:', !!renditionRef.current)
    if (renditionRef.current) {
      renditionRef.current.next().catch((err) => console.error('[App] next failed:', err))
    }
  }, [])

  // 退出程序（设置菜单 -> 退出，经 preload 调主进程销毁窗口并 quit）
  const handleQuit = useCallback(() => {
    const api = window.bookloftAPI
    if (api && typeof api.quitApp === 'function') api.quitApp()
  }, [])

  // 自绘窗口控制：最小化 / 最大化(恢复)。关闭直接复用 handleQuit。
  const handleMinimize = useCallback(() => {
    window.bookloftAPI?.minimizeWindow?.()
  }, [])

  const handleToggleMaximize = useCallback(() => {
    window.bookloftAPI?.toggleMaximize?.().catch(() => {})
  }, [])

  const handleNavigate = useCallback(async (target) => {
    console.log('[App] navigate to:', target)
    // 记下用户点击的确切条目（含锚点）。epub.js 的 location.href 只到文件级，
    // 同一文件内的多个章节仅靠 href 无法区分，靠它才能唯一定位高亮项。
    setSelectedHref(typeof target === 'string' ? target : '')

    const rendition = renditionRef.current
    if (!rendition) return

    const href = typeof target === 'string' ? target : ''
    const hashIdx = href.indexOf('#')

    // 没有锚点：直接跳章节即可（点击目录章节只跳转正文，不收起目录栏）
    if (hashIdx === -1) {
      rendition.display(target)
      return
    }

    // 带锚点（同一文件内多个章节，如《欧洲之门》part0003.html 下有 3 条）：
    // 把 "文件#锚点" 直接交给 epub.js display 时，若当前已停留在该文件内，
    // 定位会停在文件开头而跳不到锚点 —— 表现为"高亮对了但正文没动"。
    // 改为两步：先切到该章节，再按锚点元素换算成 CFI 精确跳转。
    const base = href.slice(0, hashIdx)
    const id = href.slice(hashIdx + 1)
    try {
      await rendition.display(base)
      const section = rendition.book?.spine?.get(base)
      if (!section || typeof section.cfiFromElement !== 'function') return
      const contents = rendition.getContents?.() || []
      for (const c of contents) {
        const el = c?.document?.getElementById(id)
        if (!el) continue
        const cfi = section.cfiFromElement(el)
        if (cfi) {
          await rendition.display(cfi)
          return
        }
      }
      console.warn('[App] 锚点未在已渲染内容中找到:', id)
    } catch (err) {
      console.error('[App] navigate to anchor failed:', err)
    }
  }, [])

  const handleError = useCallback((msg) => {
    setError(msg)
  }, [])

  // 字体放大/缩小（步进，带上下限）
  const handleFontIncrease = useCallback(() => {
    setFontSize((s) => Math.min(FONT_SIZE_MAX, s + FONT_SIZE_STEP))
  }, [])

  const handleFontDecrease = useCallback(() => {
    setFontSize((s) => Math.max(FONT_SIZE_MIN, s - FONT_SIZE_STEP))
  }, [])

  // 恢复默认字号
  const handleFontReset = useCallback(() => {
    setFontSize(FONT_SIZE_DEFAULT)
  }, [])

  // 主题切换（设置菜单里直接选择具体主题）
  const handleThemeChange = useCallback((next) => {
    setTheme(next)
  }, [])

  // 主题落到 <html data-theme>，CSS 变量随之切换（styles.css 四套主题）
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // 目录更正的临时提示自动消失
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 3000)
    return () => clearTimeout(t)
  }, [notice])

  // 当前章节名：由 relocated 给到的当前位置 href，在目录树里匹配 label
  const chapterTitle = useMemo(
    () => findChapterLabel(location?.href, toc),
    [location?.href, toc]
  )

  // 书名：优先取目录栏（书库）里当前文件对应的节点名；
  // 若未从书库打开（或书库未加载），回退到 epub 元数据里的书名。
  const displayBookTitle = useMemo(
    () => findLibraryTitle(library, filePath) || bookTitle,
    [library, filePath, bookTitle]
  )

  // ---------- 阅读记录持久化（better-sqlite3，最多 50 条） ----------
  // relocated 触发频繁（连续滚动尤甚），800ms 防抖后写库；
  // 最新待写数据放在 ref 里，组件卸载/页面关闭前立即补写，退出不丢进度。
  const pendingHistoryRef = useRef(null)
  const historyTimerRef = useRef(null)
  const flushHistory = useCallback(() => {
    if (historyTimerRef.current) {
      clearTimeout(historyTimerRef.current)
      historyTimerRef.current = null
    }
    const p = pendingHistoryRef.current
    if (!p) return
    pendingHistoryRef.current = null
    window.bookloftAPI?.upsertHistory?.(p.bookPath, p.title, p.cfi, p.percentage)
  }, [])

  useEffect(() => {
    if (!booted || !location?.cfi || !filePath) return
    pendingHistoryRef.current = {
      bookPath: filePath,
      title: displayBookTitle || '',
      cfi: location.cfi,
      percentage:
        typeof location.percentage === 'number' ? location.percentage : null
    }
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current)
    historyTimerRef.current = setTimeout(flushHistory, 800)
  }, [location, booted, filePath, displayBookTitle, flushHistory])

  // 组件卸载（换书/关窗）时把未落盘的位置立即写入
  useEffect(() => () => flushHistory(), [flushHistory])

  // 键盘左右方向键翻页（仅在分页模式生效，且避免在输入框内拦截）
  useEffect(() => {
    function onKey(e) {
      if (mode !== 'paginated') return
      const tag = (e.target && e.target.tagName) || ''
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        renditionRef.current?.prev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        renditionRef.current?.next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  // 阅览室卡片数据：目录路径 + 展示名 + 封面图（有则图，无则首字回退）
  const rooms = useMemo(
    () =>
      workDirs.map((dir) => ({
        path: dir,
        name: dirNameOf(dir),
        cover: coverMap[dir] || null
      })),
    [workDirs, coverMap]
  )

  // 加载阅览室封面图（主进程读 bg.png/bg.jpg 转 data URL，带缓存）
  useEffect(() => {
    let cancelled = false
    const api = window.bookloftAPI
    if (typeof api?.getRoomCover !== 'function') return
    async function load() {
      const out = {}
      for (const dir of workDirs) {
        try {
          const r = await api.getRoomCover(dir)
          if (r?.dataUrl) out[dir] = r.dataUrl
        } catch (_) {}
      }
      if (!cancelled && Object.keys(out).length) {
        setCoverMap((prev) => ({ ...prev, ...out }))
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [workDirs])

  // 进入沉浸式全屏阅读：记住当前模式 → 强制连续滚动（滚轮阅读）→
  // 隐藏顶栏/目录栏（.app.immersive）→ 窗口系统全屏。
  // 阅读进度由 Reader 内部 currentCfiRef 在模式切换重建 rendition 时自动恢复。
  const handleEnterImmersive = useCallback(() => {
    prevModeRef.current = mode
    setMode('scrolled-doc')
    setImmersive(true)
    setWindowFullscreen(true)
    const api = window.bookloftAPI
    if (api && typeof api.setFullscreen === 'function') api.setFullscreen(true)
  }, [mode])

  // 退出沉浸式全屏（ESC 或后续入口）：恢复进入前的阅读模式 + 退出系统全屏
  const handleExitImmersive = useCallback(() => {
    setImmersive(false)
    setMode(prevModeRef.current || 'paginated')
    setWindowFullscreen(false)
    const api = window.bookloftAPI
    if (api && typeof api.setFullscreen === 'function') api.setFullscreen(false)
  }, [])

  // 沉浸模式下按 ESC 退出（窗口系统全屏时 Electron 不会自动处理 ESC）
  useEffect(() => {
    if (!immersive) return
    function onKey(e) {
      if (e.key === 'Escape') handleExitImmersive()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [immersive, handleExitImmersive])

  // 界面全屏：仅把窗口铺满整个屏幕（结构不变），再次点击还原。
  // 主进程按当前窗口状态自行取反并返回切换后的状态，渲染层同步记录，
  // 供设置菜单在"界面全屏 / 退出全屏"之间切换文案。
  const handleToggleWindowFullscreen = useCallback(async () => {
    const api = window.bookloftAPI
    if (api && typeof api.toggleFullscreen === 'function') {
      try {
        const next = await api.toggleFullscreen()
        setWindowFullscreen(!!next)
      } catch (_) {}
    }
  }, [])

  // 设置尚未从数据库加载完成时不渲染，避免首屏先闪默认主题再切换
  if (!booted) return null

  return (
    <div className={immersive ? 'app immersive' : homeOpen ? 'app home-view' : 'app'}>
      <Toolbar
        tocOpen={tocOpen}
        onToggleToc={() => setTocOpen((v) => !v)}
        homeOpen={homeOpen}
        onToggleHome={() => setHomeOpen((v) => !v)}
        theme={theme}
        onThemeChange={handleThemeChange}
        fontSize={fontSize}
        onFontIncrease={handleFontIncrease}
        onFontDecrease={handleFontDecrease}
        onFontReset={handleFontReset}
        mode={mode}
        onModeChange={setMode}
        onPrev={handlePrev}
        onNext={handleNext}
        onOpenWorkingDir={handleOpenWorkingDir}
        onFixToc={handleFixToc}
        onToggleNotes={handleToggleNotes}
        notesOpen={notesOpen}
        onFullscreen={handleEnterImmersive}
        onToggleWindowFullscreen={handleToggleWindowFullscreen}
        windowFullscreen={windowFullscreen}
        onQuit={handleQuit}
        onMinimize={handleMinimize}
        onToggleMaximize={handleToggleMaximize}
        maximized={maximized}
        fixing={fixing}
        location={location}
        loading={loading}
        bookTitle={displayBookTitle}
        chapterTitle={chapterTitle}
      />
      <div className="body">
        <TOC
          open={tocOpen}
          toc={toc}
          location={location}
          onNavigate={handleNavigate}
          mode={sidebarMode}
          onModeChange={setSidebarMode}
          workingDir={workingDir}
          library={library}
          currentBookPath={filePath}
          onSelectBook={handleSelectBook}
          selectedHref={selectedHref}
        />
        <main className="main">
          <Reader
            filePath={filePath}
            mode={mode}
            tocOpen={tocOpen}
            immersive={immersive}
            fontSize={fontSize}
            theme={theme}
            initialCfi={initialCfi}
            annotations={annotations}
            onCreateAnnotation={handleCreateAnnotation}
            onDeleteAnnotation={handleDeleteAnnotation}
            onReady={handleReady}
            onRelocated={handleRelocated}
            onLoadingChange={setLoading}
            onError={handleError}
            onEscape={handleExitImmersive}
            windowFullscreen={windowFullscreen}
            maximized={maximized}
          />
          {error && <div className="error-banner">{error}</div>}
          {notice && !error && <div className="notice-banner">{notice}</div>}
          {!filePath && !error && (
            <div className="hint">
              点击左侧设置图标 → “打开工作目录”，选择一本 EPUB 开始阅读。
            </div>
          )}
        </main>
      </div>

      {/* 图书馆主页：目录栏与正文区隐藏（.app.home-view .body display:none），
          正文组件保留挂载，阅读进度与 rendition 状态不丢失 */}
      {homeOpen && (
        <LibraryHome rooms={rooms} activeDir={workingDir} onOpenRoom={handleOpenRoom} />
      )}

      {/* 应用内目录选择器（替代系统原生对话框）；打开时定位到当前工作目录 */}
      <DirPicker
        open={dirPickerOpen}
        initialDir={workingDir}
        onCancel={() => setDirPickerOpen(false)}
        onPick={handleDirPicked}
      />

      {/* 笔记管理抽屉：右侧滑出浮层，position:fixed 不挤压正文区。
          缩起 = 整体收起（无侧边窄条），再次进入走设置菜单的笔记管理按钮。
          当文件路径变化时自动收起（旧书标注列表失去意义）——避免误以为是当前书的标注。 */}
      <NotesDrawer
        key={filePath || 'no-book'}
        open={notesOpen}
        bookTitle={displayBookTitle}
        annotations={annotations}
        onJump={handleJumpToAnnotation}
        onBulkDelete={handleBulkDeleteAnnotations}
        onClose={() => setNotesOpen(false)}
      />

      {/* 全局自定义确认框（替代原生 confirm / alert）。
          由 requestConfirm / showAlert 驱动，await 返回用户选择。
          z-index 高于标注浮层，删除标注时不会被浮层盖住。 */}
      <ConfirmDialog
        open={!!confirmState}
        message={confirmState?.message}
        detail={confirmState?.detail}
        confirmText={confirmState?.confirmText}
        cancelText={confirmState?.cancelText}
        alertOnly={confirmState?.alertOnly}
        onConfirm={() => settleConfirm(true)}
        onCancel={() => settleConfirm(false)}
      />
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import ePub from 'epubjs'
import { FONT_SIZE_DEFAULT } from '../config'
import { looksLikeCover, applyCoverFit } from '../cover'
import { getAnnotationPalette } from '../annotationColors'
import {
  applyAnnoStyle,
  wrapRange,
  findTextRange,
  clearAllAnnoSpans,
  clearAnnoSpansById,
  attachAnnoHoverDelete
} from '../annotationWrap'
import SelectionBar from './annotation/SelectionBar.jsx'
import HighlightPicker from './annotation/HighlightPicker.jsx'
import UnderlinePicker from './annotation/UnderlinePicker.jsx'
import AnnotationEditor from './annotation/AnnotationEditor.jsx'
import NoteEditor from './annotation/NoteEditor.jsx'
import AnnoViewer from './annotation/AnnoViewer.jsx'
// 递归扁平化目录树，保留层级信息便于渲染与高亮匹配
function flattenToc(items, depth = 0, acc = []) {
  if (!items) return acc
  for (const item of items) {
    acc.push({
      id: item.id,
      href: item.href,
      label: (item.label || '').trim(),
      depth,
      subitems: item.subitems
    })
  }
  return acc
}

// 正文（iframe 内）随主题切换的文字/背景色。bg 需与主窗口 --bg-content 一致
const READER_CONTENT_THEME = {
  light: { color: '#333a46', bg: '#ffffff' },
  // 护眼：底色更"轻"（极淡豆沙绿），文字更深，反差更强
  green: { color: '#22382b', bg: '#eaf6ec' },
  dark: { color: '#ccd2d9', bg: '#1d2026' },
  // 水墨：宣纸米黄 + 墨色文字（不用纯黑，接近纸质印刷）
  ink: { color: '#332e27', bg: '#f7f3e8' }
}

// 宣纸纹理：极淡噪点铺在正文底上模拟纸张纤维（仅水墨主题使用）
const PAPER_TEXTURE =
  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'160\' height=\'160\'%3E%3Cfilter id=\'p\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3CfeColorMatrix type=\'saturate\' values=\'0\'/%3E%3C/filter%3E%3Crect width=\'160\' height=\'160\' filter=\'url(%23p)\' opacity=\'0.05\'/%3E%3C/svg%3E")'

// 各主题在正文（iframe 内）的额外排版规则
const EXTRA_THEME_CSS = {
  // 水墨：纸纹底 + 衬线标题（宋体质感）+ 略松字距，强化纸质书观感
  ink: [
    `html,body{background-image:${PAPER_TEXTURE};background-repeat:repeat;}`,
    'body{letter-spacing:0.01em;}',
    'h1,h2,h3,h4,h5,h6{font-family:"Songti SC","STSong","SimSun","Source Han Serif SC",' +
      '"Noto Serif CJK SC",serif !important;font-weight:600 !important;}'
  ].join('')
}

// 章尾区块与正文细节元素（链接、代码块、引注）用到的主题配色，
// 以 :root 变量块注入 iframe 文档，主题切换时刷新变量即可整体换色
const IFRAME_THEME_VARS = {
  light: {
    mark: '#c3c9d4',
    btnBg: '#ffffff',
    btnText: '#5b6472',
    btnBorder: '#dcdfe6',
    btnHover: '#f0f3f8',
    link: '#3f5fe0',
    blockBg: '#f2f5f9'
  },
  green: {
    mark: '#93b39a',
    btnBg: '#f3faf4',
    btnText: '#3d5c48',
    btnBorder: '#bcdcc1',
    btnHover: '#e2f2e5',
    link: '#2c6b43',
    blockBg: '#dbeedf'
  },
  dark: {
    mark: '#545b66',
    btnBg: '#2a2f37',
    btnText: '#a3aab5',
    btnBorder: '#3b414c',
    btnHover: '#333943',
    link: '#8fa5ff',
    blockBg: '#262b33'
  },
  ink: {
    mark: '#b3a894',
    btnBg: '#fbf8f0',
    btnText: '#564d42',
    btnBorder: '#ddd6c4',
    btnHover: '#ece6d7',
    link: '#8a6a45',
    blockBg: '#ece6d6'
  }
}

// 正文主题样式：主题变量 + 强制配色规则。
// 很多 epub 在书内 CSS 里给标题/段落硬编码了颜色（如 h1{color:#000}），
// 仅靠 body 上的 override 无法覆盖（子元素显式声明优先于继承），
// 深色主题下就会出现"黑标题看不见"。这里对所有元素强制 color，
// 并让 background-color 透明以透出主题底（代码块/引注保留主题块底色）。
function themeStyleCss(theme) {
  const v = IFRAME_THEME_VARS[theme] || IFRAME_THEME_VARS.light
  const c = READER_CONTENT_THEME[theme] || READER_CONTENT_THEME.light
  return [
    ':root{',
    `--br-mark-color:${v.mark};`,
    `--br-btn-bg:${v.btnBg};`,
    `--br-btn-text:${v.btnText};`,
    `--br-btn-border:${v.btnBorder};`,
    `--br-btn-hover:${v.btnHover};`,
    '}',
    'html,body,body *:not(img):not(svg):not(svg *){',
    `color:${c.color} !important;`,
    'background-color:transparent !important;',
    '}',
    // 段落行距放大到 1.8：书内 CSS 常给 p/div 等显式声明更小 line-height，
    // 仅靠 body 继承会被覆盖。这里对常见正文块统一强制 1.8（!important），
    // 使整本书的行距观感一致、更疏朗。
    'html,body,p,div,li,blockquote,h1,h2,h3,h4,h5,h6,dd,dt,section,article{',
    'line-height:1.8 !important;',
    '}',
    'html,body{',
    `background-color:${c.bg} !important;`,
    '}',
    'pre,code,blockquote,table{',
    `background-color:${v.blockBg} !important;`,
    '}',
    'a,a *{',
    `color:${v.link} !important;`,
    '}',
    EXTRA_THEME_CSS[theme] || ''
  ].join('')
}

// 在 iframe 文档中注入/刷新主题样式块（幂等；主题切换时重新生成即可整体换色）
function applyThemeStyleToDoc(doc, theme) {
  if (!doc || !doc.head) return
  let el = doc.getElementById('bookloft-theme-style')
  if (!el) {
    el = doc.createElement('style')
    el.id = 'bookloft-theme-style'
    doc.head.appendChild(el)
  }
  el.textContent = themeStyleCss(theme)
}

// 中文显示友好的字体栈，确保正文编码/字形正常
const CJK_FONT_STACK =
  '"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Noto Sans CJK SC","Source Han Sans SC",sans-serif'

// 连续滚动模式：章尾 320px 空白区域（水印字 + 下一章按钮）的样式。
// 注入到 epub.js 的 iframe 文档内，外部 CSS 不可达，需随内容一起注入。
const CHAPTER_END_CSS = `
  .bookloft-chapter-end {
    height: 320px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 28px;
  }
  /* 注意：下方主题样式对 body * 强制 color/background（!important），
     这里必须同样用 !important —— 选择器特异性更高者优先 */
  .bookloft-chapter-end .bookloft-mark {
    color: var(--br-mark-color, #c3c9d4) !important;
    font-size: 15px;
    letter-spacing: 6px;
    user-select: none;
  }
  .bookloft-chapter-end .bookloft-next-btn {
    padding: 6px 18px;
    border: 1px solid var(--br-btn-border, #dcdfe6) !important;
    border-radius: 8px;
    background: var(--br-btn-bg, #fff) !important;
    color: var(--br-btn-text, #5b6472) !important;
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  .bookloft-chapter-end .bookloft-next-btn:hover {
    background: var(--br-btn-hover, #f0f3f8) !important;
  }
  /* 正文随主题平滑过渡 */
  body {
    transition: background-color 0.25s ease, color 0.25s ease;
  }
`

// 在 book.navigation.toc 里按 href 找到最长前缀匹配的章节（用于标注记录章节名/锚点）
function findChapterByHref(href, book) {
  if (!href || !book?.navigation?.toc) return { title: '', href: '' }
  const target = String(href).split('#')[0].replace(/^\.\//, '').toLowerCase()
  if (!target) return { title: '', href: '' }
  let best = { title: '', href: '' }, bestLen = -1
  function walk(items) {
    if (!Array.isArray(items)) return
    for (const it of items) {
      const h = String(it.href || '').split('#')[0].replace(/^\.\//, '').toLowerCase()
      if (h && (target === h || target.endsWith('/' + h) || target.endsWith(h))) {
        if (h.length > bestLen) {
          best = { title: (it.label || '').trim(), href: it.href || '' }
          bestLen = h.length
        }
      }
      if (it.subitems) walk(it.subitems)
    }
  }
  walk(book.navigation.toc)
  return best
}

// 把当前标注列表应用到刚渲染出来的章节内容上。
// 优先按 CFI 反查 Range（精确），失败则按 selectedText 在章节内做文本兜底匹配。
// 进入前先清掉旧包络 + marker，避免重复应用产生嵌套。
function applyAnnotationsToSection(contents, annotations, theme) {
  if (!contents || !contents.document || !Array.isArray(annotations)) return
  const idx = contents.sectionIndex
  const doc = contents.document
  try { clearAllAnnoSpans(doc) } catch (_) {}
  for (const anno of annotations) {
    if (anno.spineIndex !== idx) continue
    let range = null
    try {
      const s = anno.cfiStart ? contents.rangeFromCfi(anno.cfiStart) : null
      const e = anno.cfiEnd ? contents.rangeFromCfi(anno.cfiEnd) : null
      if (s && e) {
        range = doc.createRange()
        range.setStart(s.startContainer, s.startOffset)
        range.setEnd(e.endContainer, e.endOffset)
      }
    } catch (_) {}
    if (!range) {
      range = findTextRange(doc, anno.selectedText)
    }
    if (range) {
      try {
        const opts = (anno.type === 'annotation' || anno.type === 'note')
          ? { withMarker: true } : {}
        wrapRange(doc, range, anno, theme, opts)
      } catch (_) {}
    }
  }
}

// 从 content 文档当前选中区域提取标注目标信息：
// - 文本 / 起止 CFI / 选区结束点（视口坐标）/ 章节定位信息
// - liveRange 用于提交时立即把包络写到当前章节（不依赖 DB 回灌也能立即可见）
function captureSelectionFromContents(contents, rendition, book) {
  if (!contents || !contents.window) return null
  const win = contents.window
  const doc = contents.document
  const sel = win.getSelection && win.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (range.collapsed) return null
  const text = sel.toString()
  if (!text || !text.trim()) return null
  let cfiStart = ''
  let cfiEnd = ''
  try {
    const endRange = doc.createRange()
    endRange.setStart(range.endContainer, range.endOffset)
    endRange.setEnd(range.endContainer, range.endOffset)
    cfiStart = contents.cfiFromRange(range) || ''
    cfiEnd = contents.cfiFromRange(endRange) || ''
  } catch (_) {
    return null
  }
  if (!cfiStart || !cfiEnd) return null
  // 选区结束点（最后一个 rect 的右下角），叠加上 iframe 在主窗口的偏移
  const rects = range.getClientRects()
  const lastRect = rects[rects.length - 1] || range.getBoundingClientRect()
  const iframeEl = win.frameElement
  let offsetX = 0
  let offsetY = 0
  if (iframeEl) {
    const ir = iframeEl.getBoundingClientRect()
    offsetX = ir.left
    offsetY = ir.top
  }
  // 章节信息：以 rendition 当前 location 的 href 为准（多数情况下选区与当前章节一致）
  let chapterTitle = ''
  let chapterHref = ''
  try {
    const loc = rendition?.currentLocation?.()
    const href = loc?.start?.href || ''
    const ch = findChapterByHref(href, book)
    chapterTitle = ch.title
    chapterHref = ch.href
  } catch (_) {}
  return {
    text,
    cfiStart,
    cfiEnd,
    spineIndex: typeof contents.sectionIndex === 'number' ? contents.sectionIndex : -1,
    chapterTitle,
    chapterHref,
    x: offsetX + lastRect.right,
    y: offsetY + lastRect.bottom + 6,
    // 克隆 range，提交标的时把包络落到当前 DOM 上（liveRange 用一次即失效）
    liveRange: range.cloneRange()
  }
}

export default function Reader({
  filePath,
  mode,
  tocOpen,
  immersive = false,
  fontSize = FONT_SIZE_DEFAULT,
  theme = 'light',
  initialCfi = '',
  annotations = [],
  onCreateAnnotation,
  onDeleteAnnotation,
  onReady,
  onRelocated,
  onLoadingChange,
  onError,
  onEscape
}) {
  const containerRef = useRef(null)
  const bookRef = useRef(null)
  const renditionRef = useRef(null)
  const currentCfiRef = useRef(null)
  // 进行中的导航（display/next/prev）计数，用于让容器 resize 避让导航
  const navCountRef = useRef(0)
  // 当前字号（px），供事件回调与主题注册读取最新值
  const fontSizeRef = useRef(fontSize)
  fontSizeRef.current = fontSize
  // 当前主题（light/green/dark），供 rendered 补注与 hook 注入读取最新值
  const themeRef = useRef(theme)
  themeRef.current = theme
  // 章尾"下一章"按钮的点击处理（由下方 effect 填充，
  // iframe 内按钮通过此 ref 调用主窗口的跳章逻辑）
  const goNextRef = useRef(null)
  // ESC 退出沉浸模式的回调（iframe 内按键经 content hook 转发到这里）
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape
  // 标注删除回调（iframe 内 hover 删除按钮点击 → 跨 iframe 事件 → 这里）
  const onDeleteAnnotationRef = useRef(onDeleteAnnotation)
  onDeleteAnnotationRef.current = onDeleteAnnotation
  // 标注：当前最新标注列表镜像（避免 content hook 闭包陈旧）；
  // pickState 描述当前浮现的标注工具条（null=隐藏）
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations
  const [pickState, setPickState] = useState(null)
  // pickState 镜像：内容 hook 内的选择回调读取最新值（不依赖闭包重渲）
  const pickStateRef = useRef(null)
  pickStateRef.current = pickState
  // 当前 rendition 引用：popover 提交标的时立即包络正文（不依赖 DB 回灌）
  const renditionForAnnoRef = useRef(null)
  const [bookReady, setBookReady] = useState(false)
  const [loading, setLoading] = useState(false)
  // 右下角进度小字的数据：{ current, total, percentage }；
  // 无书或 locations 未就绪时为 null，不渲染
  const [progress, setProgress] = useState(null)

  // Effect A: 仅在 filePath 变化时重新加载整本书
  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!filePath) return
      setBookReady(false)
      setProgress(null)
      setLoading(true)
      onLoadingChange?.(true)

      try {
        // 清理上一本
        if (renditionRef.current) {
          renditionRef.current.destroy()
          renditionRef.current = null
        }
        if (bookRef.current) {
          bookRef.current.destroy?.()
          bookRef.current = null
        }
        currentCfiRef.current = null

        // 关键点：通过 IPC 让主进程把 epub 读为 ArrayBuffer，
        // 规避 epub.js 直接 fetch 本地 file:// 的 CORS/协议问题
        const arrayBuffer = await window.bookloftAPI.readEpubBuffer(filePath)
        if (!arrayBuffer) throw new Error('无法读取 EPUB 文件')
        if (cancelled) return

        // epub.js 直接接收 ArrayBuffer，内部用 JSZip 解析，无需网络请求
        const book = ePub(arrayBuffer)
        bookRef.current = book

        // 关键：等待 book.opened 而非 book.ready！
        // book.ready 只等 opf/spine/navigation 解析完成，
        // 但资源 URL 替换（生成 blob URL 注入到章节 HTML）是异步的，
        // 只有 book.opened resolve 后 serialize hook 才注册好，
        // 否则章节 HTML 里的相对 URL 不会被替换，CSS/图片加载失败，
        // 表现为前几页（纯文本）能显示，到含 CSS/图片的章节就空白或翻不动。
        await book.opened
        if (cancelled) return
        console.log('[Reader] book opened, spine length:', book.spine.length, 'toc:', book.navigation.toc.length)

        // 预生成 locations，用于进度百分比与总页数；不阻塞渲染
        book.locations.generate(1600).catch(() => {})

        setBookReady(true)
      } catch (err) {
        console.error('[Reader] load epub failed:', err)
        onError?.(err?.message || String(err))
      } finally {
        setLoading(false)
        onLoadingChange?.(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [filePath])

  // Effect B: bookReady 或 mode 变化时创建/重建 rendition
  useEffect(() => {
    if (!bookReady || !containerRef.current) return
    const book = bookRef.current
    let rendition
    let cancelled = false

    async function setup() {
      // 销毁旧 rendition
      if (renditionRef.current) {
        renditionRef.current.destroy()
        renditionRef.current = null
      }
      // 重建时导航计数清零（destroy 可能导致旧导航 promise 永不 settle）
      navCountRef.current = 0

      // 关键：等待容器拿到非零尺寸再创建 rendition。
      // 若容器宽度为 0（首次挂载/切模式瞬间），layout.calculate 会用 0
      // 算出 columnWidth=0/delta=0，导致翻页 scrollBy(0) 不动，
      // 然后走 fallback 跳到 section.next()——表现为页码剧变（如 73→90）。
      const el = containerRef.current
      let waits = 0
      while (
        el.clientWidth === 0 ||
        el.clientHeight === 0
      ) {
        if (cancelled || waits++ > 50) return
        await new Promise((r) => requestAnimationFrame(r))
      }
      const width = el.clientWidth
      const height = el.clientHeight
      console.log('[Reader] container size:', width, height)

      rendition = book.renderTo(el, {
        width,
        height,
        flow: mode, // 'paginated' | 'scrolled-doc'
        spread: 'none',
        allowScriptedContent: true, // 部分 epub 依赖脚本进行布局/字体加载
        manager: 'default',
        method: 'blobUrl' // Electron 下 blobUrl 比 srcdoc 更稳定，避免 CSP 拦截内联脚本
      })
      renditionRef.current = rendition

      // 包装导航方法，追踪"导航进行中"状态：
      // rendition.resize() 内部会 clear() 视图并按"当前 location"重新 display，
      // 若在 display(target) 进行中调用，会用旧位置与新导航竞争，
      // 表现为跳转后回跳/卡死（此前 ResizeObserver 方案踩过的坑）。
      // 因此容器尺寸自适应必须能感知导航是否进行中（见下方 attemptResize）。
      for (const fn of ['display', 'next', 'prev']) {
        const orig = rendition[fn].bind(rendition)
        rendition[fn] = (...args) => {
          navCountRef.current += 1
          return orig(...args).finally(() => {
            navCountRef.current = Math.max(0, navCountRef.current - 1)
          })
        }
      }

      // 应用中文字体主题（字号基准取当前设置；运行时字号变化由
      // themes.fontSize 的 body inline style 覆盖，见下方 fontSize effect）
      // body::after 在每章正文末尾插入空白占位，避免章节结束文字紧贴底部；
      // 同时不影响翻页/目录跳转，因为 epub.js 的 Range mapping 不会算上 ::after。
      // 连续滚动模式的章尾空白由下方 content hook 注入的 .bookloft-chapter-end
      // 承担（320px，含水印字与下一章按钮），::after 置空避免叠加。
      rendition.themes.register('cjk', {
        body: {
          'font-family': CJK_FONT_STACK,
          'font-size': `${fontSizeRef.current}px`,
          'line-height': '1.8'
        },
        'body::after':
          mode === 'scrolled-doc'
            ? { content: 'none' }
            : { content: '""', display: 'block', height: '200px' }
      })
      rendition.themes.select('cjk')

      // 连续滚动模式：每章末尾注入 320px 空白区域（浅色"本章完"水印字 +
      // 【下一章】按钮），替代滚到底自动跳章——用户点击按钮才进入下一章。
      // 分页模式不注入，保持原有翻页体验。
      rendition.hooks.content.register((contents) => {
        if (mode !== 'scrolled-doc') return
        const doc = contents.document
        const body = doc && doc.body
        if (!body || body.querySelector('.bookloft-chapter-end')) return
        // 封面页（开篇整图页）不注入"本章完"区块：封面 CSS 会把 body 变成
        // 固定高度居中容器，章尾块会被裁切/挤坏封面布局
        // （epub.js 的 Contents 上是 sectionIndex 数字，没有 .section 对象）
        if (contents.sectionIndex === 0 && looksLikeCover(doc)) return

        // 样式通过 <style> 注入 iframe 文档，保证 :hover 等伪类可用；
        // 颜色引用主题变量并加 !important —— 主题样式对 body * 强制配色，
        // 章尾区块选择器特异性更高，故能压过它。
        const style = doc.createElement('style')
        style.textContent = CHAPTER_END_CSS
        doc.head.appendChild(style)
        applyThemeStyleToDoc(doc, themeRef.current)

        const endBlock = doc.createElement('div')
        endBlock.className = 'bookloft-chapter-end'

        const mark = doc.createElement('span')
        mark.className = 'bookloft-mark'
        mark.textContent = '本章完'

        const btn = doc.createElement('button')
        btn.className = 'bookloft-next-btn'
        btn.textContent = '下一章 ›'
        // 最后一章没有下一章，隐藏按钮（Contents 上只有 sectionIndex 数字）
        const isLast =
          bookRef.current &&
          typeof contents.sectionIndex === 'number' &&
          contents.sectionIndex >= bookRef.current.spine.length - 1
        if (isLast) btn.style.display = 'none'
        // iframe 与主窗口同源（blob: URL），点击回调直接桥接到主窗口逻辑
        btn.addEventListener('click', () => {
          if (goNextRef.current) goNextRef.current()
        })

        endBlock.appendChild(mark)
        endBlock.appendChild(btn)
        body.appendChild(endBlock)
      })

      // 封面整图适配：开篇封面页（spine 第一项且含整页大图）在保留长宽比的
      // 前提下，于当前可视区域完整展示（fit-contain、居中、不再跨栏裁切）。
      // 两种阅读模式均生效；正文章节不受影响（按 index===0 + 封面特征双门槛命中）。
      // 盒子尺寸在每次命中时实时读取容器（目录折叠/窗口缩放后尺寸已变，
      // 不能复用 setup 时刻的旧值）。
      rendition.hooks.content.register((contents) => {
        try {
          const doc = contents && contents.document
          if (!doc || contents.sectionIndex !== 0) return
          if (!looksLikeCover(doc)) return
          const el = containerRef.current
          const bw = el ? el.clientWidth : width
          const bh = el ? el.clientHeight : height
          if (!bw || !bh) return
          applyCoverFit(contents, rendition, mode, { width: bw, height: bh })
        } catch (e) {
          console.warn('[Reader] cover fit failed:', e)
        }
      })

      // 沉浸模式 ESC 退出：按键发生在正文 iframe 文档内，不会冒泡到主窗口，
      // 主窗口的 keydown 收不到。这里在每个章节文档上挂 keydown，
      // 把 ESC 经 onEscapeRef 转发给主窗口的退出逻辑。
      rendition.hooks.content.register((contents) => {
        try {
          const doc = contents && contents.document
          if (!doc) return
          doc.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') onEscapeRef.current?.()
          })
        } catch (_) {}
      })

      // 标注 marker 点击：marker 在 iframe 内 dispatch 一个 CustomEvent，
      // 这里把它翻译成主窗口坐标 + 在 pickState 里开一个 'viewAnno' 阶段。
      rendition.hooks.content.register((contents) => {
        try {
          const win = contents && contents.window
          if (!win) return
          win.addEventListener('bookloft:anno-click', (e) => {
            const detail = e && e.detail
            if (!detail || !detail.id) return
            const id = String(detail.id)
            const anno = annotationsRef.current.find((a) => String(a.id) === id)
            if (!anno) return
            // iframe 内坐标 → 主窗口坐标
            const iframeEl = win.frameElement
            let offX = 0
            let offY = 0
            if (iframeEl) {
              const ir = iframeEl.getBoundingClientRect()
              offX = ir.left
              offY = ir.top
            }
            const x = offX + (detail.x || 0) + 12
            const y = offY + (detail.y || 0) + 14
            // 同一个 marker 再点一次 → 关闭
            const cur = pickStateRef.current
            if (cur && cur.stage === 'viewAnno' && String(cur.anno?.id) === id) {
              setPickState(null)
              return
            }
            setPickState({ stage: 'viewAnno', anno, x, y })
          })
        } catch (_) {}
      })

      // 标注 hover 删除按钮：在每个章节文档上挂一个共享的红色叉叉按钮，
      // 鼠标进入 span[data-bookloft-anno-id] 时显示在文字左上角外侧，点击 →
      // 通过 CustomEvent 转发到主窗口（避免 iframe 内确认 dialog / IPC）。
      rendition.hooks.content.register((contents) => {
        try {
          const doc = contents && contents.document
          if (!doc) return
          const detach = attachAnnoHoverDelete(doc, (detail) => {
            const win = doc.defaultView
            if (!win) return
            try {
              win.dispatchEvent(
                new CustomEvent('bookloft:anno-delete-click', {
                  detail: { id: String(detail.id || '') },
                  bubbles: false
                })
              )
            } catch (_) {}
          })
          // 章节销毁时清理（destroy 不会逐 contents 回调，所以挂到 contents 上兜底）
          contents.__bookloftAnnoDeleteDetach = detach
        } catch (_) {}
      })

      // 标注删除事件：把 iframe 内发来的删除请求转交给主窗口的回调
      // （App.jsx 负责弹确认 dialog + 调 IPC + 更新 state）。
      rendition.hooks.content.register((contents) => {
        try {
          const win = contents && contents.window
          if (!win) return
          win.addEventListener('bookloft:anno-delete-click', (e) => {
            const detail = e && e.detail
            if (!detail || !detail.id) return
            const id = String(detail.id)
            const anno = annotationsRef.current.find((a) => String(a.id) === id)
            const type = anno ? anno.type : ''
            onDeleteAnnotationRef.current?.({ id, type })
          })
        } catch (_) {}
      })

      // 标注应用：每章节渲染完成后，把当前书对应章节的标注全部包络到正文。
      // - 已存在的标注由后端恢复或前端保存后注入
      // - 优先用 CFI 反查 Range，失败则用 selectedText 在文档里做文本兜底匹配
      // - 包络后给 span 加 data-bookloft-anno-id，便于按 id 清除
      rendition.hooks.content.register((contents) => {
        try {
          applyAnnotationsToSection(contents, annotationsRef.current, themeRef.current)
        } catch (_) {}
      })

      // 文本选中捕获：在每个章节文档上挂 mouseup，捕获有效选区后
      // 把 pickState 切换为 stage='choose'（再次选区也会刷新位置/章节）。
      // 选区在 iframe 内，位置需叠加 iframe 主窗口偏移；cross-iframe 选区
      // 由浏览器自然约束在单 iframe 内，避免拼接复杂性。
      rendition.hooks.content.register((contents) => {
        try {
          const doc = contents && contents.document
          if (!doc) return
          // 用 mouseup 而非 click：选区在 mouseup 时才最终稳定
          doc.addEventListener('mouseup', () => {
            // 给浏览器一点时间把选区写到 selection（避免极端时序问题）
            setTimeout(() => {
              try {
                const capture = captureSelectionFromContents(
                  contents,
                  renditionRef.current,
                  book
                )
                if (!capture) {
                  // 选区为空（点击空白处）：收起浮层
                  if (pickStateRef.current) setPickState(null)
                  return
                }
                setPickState({ stage: 'choose', ...capture })
              } catch (_) {}
            }, 0)
          })
        } catch (_) {}
      })

      // 暴露 rendition 引用供 popover 提交时使用（不靠闭包，时效更稳定）
      renditionForAnnoRef.current = rendition

      // 正文颜色/背景随主题（body inline + !important，压过书内默认样式）；
      // cjk 主题规则不再含颜色，全部由 override 管理（可更新、可切章补注）
      const contentTheme = READER_CONTENT_THEME[themeRef.current] || READER_CONTENT_THEME.light
      rendition.themes.override('color', contentTheme.color, true)
      rendition.themes.override('background', contentTheme.bg, true)

      // epub.js 的 Themes.override（themes.fontSize/颜色 override 的底层）只对调用时刻
      // 已渲染的章节生效，不会自动注入到后续新渲染的章节（上游行为），
      // 切章后 inline 字号/颜色会丢失。这里在每个章节渲染完成后补注。
      rendition.on('rendered', () => {
        const t = READER_CONTENT_THEME[themeRef.current] || READER_CONTENT_THEME.light
        rendition.themes.fontSize(`${fontSizeRef.current}px`)
        rendition.themes.override('color', t.color, true)
        rendition.themes.override('background', t.bg, true)
        // 同时向新章节 iframe 注入主题样式块（含 1.8 行距规则），
        // 确保分页模式下翻到后续章节时行距/配色依然一致。
        const contents = rendition.getContents ? rendition.getContents() : []
        contents.forEach((c) => {
          if (c && c.document) applyThemeStyleToDoc(c.document, themeRef.current)
        })
      })

      // relocated：更新当前位置与进度
      rendition.on('relocated', (location) => {
        if (!location?.start) return
        currentCfiRef.current = location.start.cfi
        let percentage = null
        try {
          percentage = location.start.percentage
        } catch (_) {}
        // 进度小字：current/total 基于 epub.js 的 locations（1600px 切分），
        // 与整体百分比互补；locations 异步生成完成前 total 为 0，
        // 此时仅显示百分比。current 取 1-based 索引更贴近阅读直觉。
        let current = null
        let total = null
        try {
          const locs = book.locations
          total = locs.length()
          if (total && location.start.cfi) {
            const idx = locs.locationFromCfi(location.start.cfi)
            if (idx >= 0) current = idx + 1
          }
        } catch (_) {}
        setProgress({
          current,
          total,
          percentage: percentage == null ? null : Math.round(percentage * 100)
        })
        console.log('[Reader] relocated:', {
          atStart: location.atStart,
          atEnd: location.atEnd,
          href: location.start.href,
          percentage,
          total: book.locations.length()
        })
        onRelocated?.({
          atStart: location.atStart,
          atEnd: location.atEnd,
          percentage,
          cfi: location.start.cfi,
          href: location.start.href,
          total: book.locations.length()
        })
      })

      // 初始显示：优先恢复上次阅读位置（模式切换的 currentCfiRef，
      // 或启动时从阅读记录带入的 initialCfi），都没有则从头开始。
      // 注意：foreign CFI（其他书的记录）display 会失败，catch 里回退到首页。
      const target = currentCfiRef.current || initialCfi || undefined
      console.log('[Reader] calling display with target:', target)
      rendition
        .display(target)
        .catch((err) => {
          if (cancelled) return
          if (target) {
            // 记录位置失效（如书籍被重新生成）：回退到书首
            console.warn('[Reader] display target failed, fallback to start:', err)
            currentCfiRef.current = null
            return rendition.display()
          }
          throw err
        })
        .then(() => {
          if (cancelled) return
          console.log('[Reader] display succeeded, calling onReady')
          // 渲染完成后再回调 onReady，确保工具栏/目录拿到可用 rendition
          const toc = flattenToc(book.navigation.toc)
          onReady?.({ book, rendition, toc })
        })
        .catch((err) => {
          if (cancelled) return
          console.error('[Reader] display failed:', err)
          onError?.(err?.message || String(err))
        })
    }

    setup()

    return () => {
      cancelled = true
      if (rendition) {
        rendition.destroy()
      }
    }
  }, [bookReady, mode])

  // 章尾【下一章】按钮的跳章处理（iframe 内按钮经 goNextRef 调用）。
  // 滚动自动跳章（向下到底跳下一章 / 向上到顶退上一章）均已移除：
  // 章尾改为 320px 空白 + "本章完"水印 + 按钮，章节切换完全由用户
  // 点击按钮或目录/工具栏控制。
  // 连点防抖复用 navCountRef（next 走包装方法会计数，进行中则忽略新点击）。
  useEffect(() => {
    if (!bookReady || mode !== 'scrolled-doc') return
    goNextRef.current = () => {
      if (navCountRef.current > 0) return
      const rendition = renditionRef.current
      if (!rendition) return
      console.log('[Reader] next chapter button clicked')
      rendition.next()
        .catch((e) => console.error('[Reader] manual next failed:', e))
        .finally(() => {
          // 新章节从头开始显示（兜底：epub.js 切章后滚动位置可能保留）
          const scroller = containerRef.current?.querySelector('.epub-container')
          if (scroller) scroller.scrollTop = 0
        })
    }
    return () => {
      goNextRef.current = null
    }
  }, [bookReady, mode])

  // 容器尺寸变化的自适应。
  // - tocOpen 变化：目录面板折叠是 CSS 布局变化（260px ↔ 0，带 0.2s 过渡），
  //   不触发 window resize，epub.js 感知不到 → iframe 停留在旧宽度，
  //   正文贴左、不居中也不充满。必须显式把最终尺寸同步给 rendition。
  // - window resize：拖拽窗口时兜底同步一次。
  // 注意：rendition.resize() 内部会 clear() 视图并按"当前 location"重新
  // display；与进行中的导航竞争会导致回跳。因此统一走 attemptResize，
  // 导航进行中自动延后重试。
  useEffect(() => {
    if (!bookReady) return

    const NAV_RETRY_INTERVAL = 300
    const NAV_RETRY_MAX = 20

    function attemptResize(retries) {
      const rendition = renditionRef.current
      if (!rendition) return
      // 导航（display/next/prev）进行中：此刻 rendition 内部 location 还是
      // 旧位置，resize 会触发对旧位置的重新 display，与导航竞争。
      // 延后到导航完成后再同步尺寸。
      if (navCountRef.current > 0) {
        if (retries > 0) {
          setTimeout(() => attemptResize(retries - 1), NAV_RETRY_INTERVAL)
        } else {
          console.warn('[Reader] resize skipped: navigation still in progress')
        }
        return
      }
      const el = containerRef.current
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
      const w = el.clientWidth
      const h = el.clientHeight
      // 尺寸没变就不打扰 epub.js：rendition.resize 即使尺寸相同也会
      // 无条件重新 display 当前位置，造成不必要的重排闪烁
      const stageSize = rendition.manager && rendition.manager._stageSize
      if (stageSize && stageSize.width === w && stageSize.height === h) return
      console.log('[Reader] resizing rendition to', w, h)
      rendition.resize(w, h)
    }

    // tocOpen 切换：等 0.2s 的 CSS 宽度过渡结束后读取最终容器尺寸
    let tocTimer = null
    if (tocOpen !== undefined) {
      tocTimer = setTimeout(() => attemptResize(NAV_RETRY_MAX), 260)
    }

    // 窗口拖拽（防抖）
    let winTimer = null
    function onWindowResize() {
      if (winTimer) clearTimeout(winTimer)
      winTimer = setTimeout(() => attemptResize(NAV_RETRY_MAX), 200)
    }
    window.addEventListener('resize', onWindowResize)

    return () => {
      if (tocTimer) clearTimeout(tocTimer)
      if (winTimer) clearTimeout(winTimer)
      window.removeEventListener('resize', onWindowResize)
    }
  }, [bookReady, tocOpen, immersive])

  // 字号变化：应用主题 override 并重新定位到当前阅读位置。
  // 字号变化会改变分页列数/滚动高度，必须用当前 CFI 重新 mapping，
  // 否则分页模式下当前页会出现内容重复/缺失，
  // 连续滚动模式下阅读位置会漂移。
  // 注意：epub.js 的 override 不会自动作用于后续新渲染章节，
  // 切章后的字号由上方 setup() 里的 'rendered' 补注保障。
  // appliedFontSizeRef 跳过初始挂载（主题注册时已含当前字号），
  // 也跳过 mode 切换重建 rendition 时的重复应用。
  const appliedFontSizeRef = useRef(fontSize)
  useEffect(() => {
    if (appliedFontSizeRef.current === fontSize) return
    appliedFontSizeRef.current = fontSize
    const rendition = renditionRef.current
    if (!rendition) return
    rendition.themes.fontSize(`${fontSize}px`)
    const cfi = currentCfiRef.current
    if (cfi) {
      console.log('[Reader] font size changed to', fontSize, 're-locating')
      rendition
        .display(cfi)
        .catch((e) => console.error('[Reader] re-display after font size change failed:', e))
    }
  }, [fontSize])

  // 主题切换：更新正文颜色/背景（iframe 内），并刷新已渲染章节里的
  // 章尾区块主题变量（水印字与按钮颜色随之整体换色）
  useEffect(() => {
    if (!bookReady) return
    const rendition = renditionRef.current
    if (!rendition) return
    const t = READER_CONTENT_THEME[theme] || READER_CONTENT_THEME.light
    rendition.themes.override('color', t.color, true)
    rendition.themes.override('background', t.bg, true)
    const contents = rendition.getContents ? rendition.getContents() : []
    contents.forEach((c) => {
      if (c && c.document) applyThemeStyleToDoc(c.document, theme)
    })
  }, [theme, bookReady])

  // 主题切换时：刷新已渲染章节里的全部标注包络样式（色值随主题变化）。
  // 做法：先清掉所有包络 span，再按当前主题重新包络。等价于"重新渲染标注"。
  useEffect(() => {
    if (!bookReady) return
    const rendition = renditionRef.current
    if (!rendition) return
    const contents = rendition.getContents ? rendition.getContents() : []
    contents.forEach((c) => {
      if (!c || !c.document) return
      try { clearAllAnnoSpans(c.document) } catch (_) {}
      try {
        applyAnnotationsToSection(c, annotationsRef.current, theme)
      } catch (_) {}
    })
  }, [theme, annotations, bookReady])

  // 删除标注：增量同步 DOM（只清理消失的 id，不全清全包，避免其他标注闪烁）。
  // 主题切换的全清全包走上方 effect；这里的 effect 只负责"被删的 id"。
  // 首次挂载或 bookReady 变化时把 prev 复位，不做清理（annotations 已通过 theme effect 应用）。
  const prevAnnoIdsRef = useRef(null)
  useEffect(() => {
    if (!bookReady) {
      prevAnnoIdsRef.current = null
      return
    }
    const currentIds = new Set(
      (annotations || []).map((a) => (a && a.id != null ? String(a.id) : null)).filter(Boolean)
    )
    const prev = prevAnnoIdsRef.current
    if (prev) {
      const removed = []
      for (const id of prev) {
        if (!currentIds.has(id)) removed.push(id)
      }
      if (removed.length > 0) {
        const rendition = renditionRef.current
        const contents = rendition?.getContents ? rendition.getContents() : []
        contents.forEach((c) => {
          if (!c || !c.document) return
          removed.forEach((id) => {
            try { clearAnnoSpansById(c.document, id) } catch (_) {}
          })
        })
      }
    }
    prevAnnoIdsRef.current = currentIds
  }, [annotations, bookReady])

  // 全局交互：点击 popover 外部或按 ESC，收起标注浮层
  // 注意：React 17+ 的合成 stopPropagation 不会阻止原生事件继续冒泡，
  // 不能依赖 popover 自身的 stopPropagation。这里用 closest('.bookloft-popover')
  // 直接检查点击目标是否落在 popover 内，简单可靠。
  useEffect(() => {
    if (!pickState) return
    // 判断点击目标是否为输入控件（textarea/input/select/contenteditable 等）。
    // 输入框是标注/笔记编辑的核心，点击它们时绝不能收起浮层——
    // 否则会出现"点进去输入框就消失、光标进不去"的问题。
    function isEditable(target) {
      if (!target) return false
      const tag = target.tagName ? target.tagName.toLowerCase() : ''
      if (tag === 'textarea' || tag === 'input' || tag === 'select') return true
      // contenteditable 元素（有的笔记编辑器将来会用）
      if (target.isContentEditable) return true
      // 落在 .bookloft-pop-textarea 内也算输入区（兜底，防止 textarea 内层节点漏判）
      if (target.closest && target.closest('.bookloft-pop-textarea')) return true
      return false
    }
    function onMouseDown(e) {
      const target = e.target
      if (target && target.closest && target.closest('.bookloft-popover')) return
      if (isEditable(target)) return
      setPickState(null)
    }
    function onKey(e) {
      if (e.key === 'Escape') setPickState(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [pickState])

  // popover 操作：阶段切换 / 提交标的 / 取消
  const setStage = (stage) => setPickState((s) => (s ? { ...s, stage } : s))
  const closePopover = () => setPickState(null)

  const submitAnno = async (payload) => {
    const cur = pickStateRef.current
    if (!cur) return
    const wantsMarker = payload.type === 'annotation' || payload.type === 'note'
    // 立即把包络写到当前正文（不等 DB 回灌）
    try {
      const rendition = renditionForAnnoRef.current
      const contents = rendition?.getContents ? rendition.getContents() : []
      const target = contents.find((c) => c && c.sectionIndex === cur.spineIndex)
      if (target && target.document) {
        // 用临时 id 写入 span（DB 回灌后用真实 id 重写 dataset，避免 DOM 重排）
        const tempAnno = { id: 'tmp-' + Date.now(), ...payload }
        wrapRange(
          target.document,
          cur.liveRange,
          tempAnno,
          themeRef.current,
          { withMarker: wantsMarker }
        )
      }
    } catch (_) {}
    closePopover()
    if (typeof onCreateAnnotation === 'function') {
      const result = await onCreateAnnotation({
        bookPath: filePath,
        type: payload.type,
        cfiStart: cur.cfiStart,
        cfiEnd: cur.cfiEnd,
        spineIndex: cur.spineIndex,
        selectedText: cur.text,
        chapterTitle: cur.chapterTitle,
        chapterHref: cur.chapterHref,
        style: payload.style || null,
        color: payload.color || null,
        content: payload.content || null
      })
      // 提交成功后用真实 id 重写临时 span + marker 的 dataset，避免重排导致闪烁
      if (result && result.id) {
        try {
          const rendition = renditionForAnnoRef.current
          const contents = rendition?.getContents ? rendition.getContents() : []
          const target = contents.find((c) => c && c.sectionIndex === cur.spineIndex)
          if (target && target.document) {
            const realId = String(result.id)
            const tmpSpans = target.document.querySelectorAll(
              'span[data-bookloft-anno-id^="tmp-"]'
            )
            tmpSpans.forEach((sp) => {
              sp.dataset.bookloftAnnoId = realId
              const next = sp.nextSibling
              if (
                next &&
                next.classList &&
                next.classList.contains('bookloft-anno-marker') &&
                String(next.dataset.bookloftAnnoMarker || '').startsWith('tmp-')
              ) {
                next.dataset.bookloftAnnoMarker = realId
              }
            })
          }
        } catch (_) {}
      }
    }
  }

  return (
    <div className="reader">
      <div ref={containerRef} className="reader-area" />
      {loading && <div className="loading-overlay">加载中…</div>}
      {progress && (progress.current != null || progress.percentage != null) && (
        <div className="progress-indicator" title="阅读进度">
          {progress.current != null && progress.total != null
            ? `${progress.current} / ${progress.total} · `
            : ''}
          {progress.percentage != null ? `${progress.percentage}%` : ''}
        </div>
      )}

      {/* 标注浮层：根据 pickState.stage 渲染不同 popover */}
      {pickState && pickState.stage === 'choose' && (
        <SelectionBar
          x={pickState.x}
          y={pickState.y}
          onPick={(type) => setStage(type)}
        />
      )}
      {pickState && pickState.stage === 'highlight' && (
        <HighlightPicker
          x={pickState.x}
          y={pickState.y + 44}
          theme={theme}
          onPick={(c) =>
            submitAnno({
              type: 'highlight',
              style: c.key,
              color: c.bg
            })
          }
          onCancel={closePopover}
        />
      )}
      {pickState && pickState.stage === 'underline' && (
        <UnderlinePicker
          x={pickState.x}
          y={pickState.y + 44}
          theme={theme}
          onPick={(style) =>
            submitAnno({
              type: 'underline',
              style,
              color: style === 'dashed' ? getAnnotationPalette(theme).underlineDashed : getAnnotationPalette(theme).underlineSolid
            })
          }
          onCancel={closePopover}
        />
      )}
      {pickState && pickState.stage === 'annotation' && (
        <AnnotationEditor
          x={Math.min(window.innerWidth - 320, pickState.x)}
          y={pickState.y + 44}
          onSave={(text) => submitAnno({ type: 'annotation', content: text })}
          onCancel={closePopover}
        />
      )}
      {pickState && pickState.stage === 'note' && (
        <NoteEditor
          x={Math.min(window.innerWidth - 380, pickState.x)}
          y={pickState.y + 44}
          onSave={(md) => submitAnno({ type: 'note', content: md })}
          onCancel={closePopover}
        />
      )}
      {/* 点击正文里 marker → 展示已写入的标注 / 笔记内容 */}
      {pickState && pickState.stage === 'viewAnno' && (
        <AnnoViewer
          x={Math.min(window.innerWidth - 380, pickState.x)}
          y={Math.min(window.innerHeight - 280, pickState.y)}
          anno={pickState.anno}
          theme={theme}
          onClose={closePopover}
          onDelete={typeof onDeleteAnnotationRef.current === 'function' ? async () => {
            const a = pickStateRef.current?.anno
            if (!a) return
            // 等待 handleDeleteAnnotation 异步处理（confirm + IPC + setAnnotations），
            // 返回 true 表示真删，false 表示用户在 confirm 里取消了（或失败）。
            // 只有真删成功才同步关闭弹框——避免用户取消后弹框莫名消失。
            const ok = await onDeleteAnnotationRef.current({ id: a.id, type: a.type })
            if (ok !== false && pickStateRef.current?.stage === 'viewAnno') {
              setPickState(null)
            }
          } : undefined}
        />
      )}
    </div>
  )
}

// 标注包络与恢复：在 epub.js 的内容文档（iframe）内操作 DOM Range，
// 把选中的文本节点切片并用 <span class="bookloft-anno ..."> 包起来。
//
// 标注 / 笔记 还会在选区最后一行末尾光标的"正上方"追加一个浮动小图标 marker。
// marker 脱离文本流（position: fixed 相对 iframe 视口，挂到 doc.body 上），
// 用户点击图标 → 在 doc.defaultView 上派发 'bookloft:anno-click'，
// 主窗口 Reader.jsx 监听该事件后弹出内容查看浮层。
//
// 注意：所有操作都限定在传入的 doc（即 iframe 文档）里，避免与外部 React 树混淆。

import { getAnnotationPalette, getAnnotationMarkerColors } from './annotationColors'

// 标注 / 笔记 marker 图标：Lucide `NotepadText`（带装订线的便签 + 三条文字横线）。
// 用白色 data-URI SVG 作为按钮的 background-image 绘制，而不是内联 <svg>——
// 许多书会在书内 CSS 里强杀 svg/path（width/height=0、stroke:none，表现为"圆有、图标没字形"），
// 而背景图层不受 DOM 的 svg/path 规则影响，天然免疫。
const ICON_NOTE_DATA =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M8 2v4"/>' +
      '<path d="M12 2v4"/>' +
      '<path d="M16 2v4"/>' +
      '<rect width="16" height="18" x="4" y="4" rx="2"/>' +
      '<path d="M8 10h6"/>' +
      '<path d="M8 14h8"/>' +
      '<path d="M8 18h5"/>' +
      '</svg>'
  )

// 取选区"最后一行末尾光标"的客户端矩形。
// 多行选区时 range.getClientRects() 会按行返回多个 rect，取最后一项。
// range 必须在 iframe 文档里调用。
export function getSelectionEndRect(range) {
  if (!range) return null
  let rects = null
  try {
    rects = range.getClientRects ? range.getClientRects() : null
  } catch (_) {
    rects = null
  }
  if (rects && rects.length > 0) return rects[rects.length - 1]
  try {
    return range.getBoundingClientRect ? range.getBoundingClientRect() : null
  } catch (_) {
    return null
  }
}

// 依据主题与标注类型/样式，给包络 span 设置内联样式。
// 注意：iframe 文档中的主题样式块给所有元素加了
// `body * { background-color: transparent !important; color: ... !important; }`，
// CSS 规范 !important 始终胜过普通内联 style（与 specificity 无关）。
// 这里必须用 setProperty 第三个参数 'important' 才能压住。
export function applyAnnoStyle(span, anno, theme) {
  const palette = getAnnotationPalette(theme)
  const markerColors = getAnnotationMarkerColors(theme)
  const t = anno.type
  if (t === 'highlight') {
    // 高亮：纯文字底色，不画下划线之类的额外装饰
    const c = lookupHighlightColor(palette, anno.color, anno.style)
    span.style.setProperty('background-color', c.bg, 'important')
    span.style.setProperty('color', c.fg, 'important')
  } else if (t === 'underline') {
    const color = anno.style === 'dashed'
      ? palette.underlineDashed
      : palette.underlineSolid
    span.style.setProperty(
      'text-decoration',
      `underline ${anno.style === 'dashed' ? 'dashed' : 'solid'} ${color}`,
      'important'
    )
    span.style.setProperty('text-decoration-thickness', '2px', 'important')
    span.style.setProperty('text-underline-offset', '3px', 'important')
  } else if (t === 'annotation') {
    // 标注：紧贴文字底部的实线下划线（与划线同样的位置/厚度）
    span.style.setProperty(
      'text-decoration',
      `underline solid ${markerColors.annotation}`,
      'important'
    )
    span.style.setProperty('text-decoration-thickness', '2px', 'important')
    span.style.setProperty('text-underline-offset', '3px', 'important')
  } else if (t === 'note') {
    // 笔记：同位置的实线下划线（蓝色，与标注区分）
    span.style.setProperty(
      'text-decoration',
      `underline solid ${markerColors.note}`,
      'important'
    )
    span.style.setProperty('text-decoration-thickness', '2px', 'important')
    span.style.setProperty('text-underline-offset', '3px', 'important')
  }
  span.classList.add(`bookloft-anno-${t}`)
  if (anno.style) span.classList.add(`bookloft-anno-style-${anno.style}`)
}

function lookupHighlightColor(palette, colorKey, styleKey) {
  // 优先按 key 查表（兼容存量的 colorKey）
  const byKey = palette.highlights.find((h) => h.key === styleKey)
  if (byKey) return byKey
  // 兼容旧字段名：把 color 字段也当 key
  const byColor = palette.highlights.find((h) => h.key === colorKey)
  if (byColor) return byColor
  // 兜底：返回首色
  return palette.highlights[0]
}

// 收集 range 覆盖的所有文本节点（按文档顺序）
function collectIntersectingTextNodes(doc, range) {
  const root = range.commonAncestorContainer
  const scanRoot = root && root.nodeType === 3 /* TEXT_NODE */ ? root.parentNode : root
  if (!scanRoot) return []
  const walker = doc.createTreeWalker(scanRoot, NodeFilter.SHOW_TEXT, null)
  const out = []
  let n
  while ((n = walker.nextNode())) {
    if (!n.nodeValue) continue
    if (range.intersectsNode(n)) out.push(n)
  }
  return out
}

// 创建一个浮动 marker 小图标，定位到"选区最后一行末尾光标的正上方"。
// rect 必须是 iframe 视口坐标系下的客户端矩形（lastRect）。
// marker 用 position: fixed 相对 iframe 视口定位，挂在 doc.body 上，
// 不占正文文本流，避免跟文字挤在同一行。
// 把一段属性以 !important 内联到元素上。封装成小函数统一处理，避免到处 try/catch。
function setInlineImportant(el, prop, val) {
  try {
    el.style.setProperty(prop, val, 'important')
  } catch (_) {}
}

function createMarker(doc, anno, theme, rect) {
  const markerColors = getAnnotationMarkerColors(theme)
  // 标注 / 笔记 用不同背景色区分：
  //   annotation（标注）→ markerColors.annotation（琥珀系）
  //   note（笔记）     → markerColors.note（蓝色系）
  const bgColor =
    anno.type === 'annotation' ? markerColors.annotation : markerColors.note
  const m = doc.createElement('span')
  m.className = 'bookloft-anno-marker'
  m.dataset.bookloftAnnoMarker = String(anno.id)
  m.dataset.bookloftAnnoMarkerType = String(anno.type)
  m.setAttribute('contenteditable', 'false')

  // 关键定位：图标中心对齐 lastRect.right（光标 x 位置），
  // 整体位于 lastRect.top 上方（gap 像素），脱离文字行。
  // icon 直径 22px, gap -3 → 图标底边在 rect.top + 3，即圆形最下 3px 弧线压在
  // 文字顶线弧度内，让圆形"卡"在文字上（肉眼明显贴住）。白色便签字形在按钮中央
  // 14px 区域（距按钮边各 4px），字形下沿 ≈ rect.top - 1，所以不会盖住文字字符。
  const iconSize = 22
  const gap = -3
  const x = rect.right - iconSize / 2
  const y = rect.top - iconSize - gap

  // ===== 真实根因 =====
  // epub.js 把正文渲染在 iframe 里，而 styles.css（含 .bookloft-anno-marker /
  // .bookloft-anno-icon 的定义）只存在于主窗口，iframe 文档里根本没有这两条规则。
  // 同时不少书会 reset button（appearance:none / border-radius:0 / 自定义 padding），
  // 于是 marker 按钮只能按浏览器默认 <button> 渲染成"扁平的彩色矩形"，SVG 图标也被
  // 挤成一团——这就是之前反复看到的"糊块 / 深色小方块"。
  // 修复：把 marker 的全部外观样式用 setProperty(..., 'important') 内联到元素上，
  // 既不依赖 iframe 里不存在的类，也不会被书内任何规则（含 !important）覆盖。
  setInlineImportant(m, 'position', 'fixed')
  setInlineImportant(m, 'left', x + 'px')
  setInlineImportant(m, 'top', y + 'px')
  setInlineImportant(m, 'z-index', '999')
  setInlineImportant(m, 'display', 'inline-flex')
  setInlineImportant(m, 'align-items', 'center')
  setInlineImportant(m, 'justify-content', 'center')
  setInlineImportant(m, 'pointer-events', 'none')
  setInlineImportant(m, 'user-select', 'none')
  setInlineImportant(m, '-webkit-user-select', 'none')
  setInlineImportant(m, 'line-height', '1')

  const btn = doc.createElement('button')
  btn.type = 'button'
  btn.className = 'bookloft-anno-icon'
  btn.title = anno.type === 'note' ? '查看笔记' : '查看标注'
  btn.setAttribute('aria-label', btn.title)
  // 蓝色圆形便签的完整外观，全部内联 + important（无视书内 button reset 与主题样式）。
  setInlineImportant(btn, 'display', 'inline-flex')
  setInlineImportant(btn, 'align-items', 'center')
  setInlineImportant(btn, 'justify-content', 'center')
  setInlineImportant(btn, 'width', iconSize + 'px')
  setInlineImportant(btn, 'height', iconSize + 'px')
  setInlineImportant(btn, 'border-radius', '50%')
  setInlineImportant(btn, 'border', 'none')
  setInlineImportant(btn, 'padding', '0')
  setInlineImportant(btn, 'margin', '0')
  setInlineImportant(btn, 'flex', '0 0 auto')
  setInlineImportant(btn, 'background-color', bgColor)
  setInlineImportant(btn, 'color', '#ffffff')
  // 默认 0.35：与"删除按钮"一致——平时略透、仅在 hover 时显形（克制式风格）
  setInlineImportant(btn, 'opacity', '0.35')
  setInlineImportant(btn, 'box-shadow', '0 1px 3px rgba(0, 0, 0, 0.18)')
  setInlineImportant(btn, 'cursor', 'pointer')
  setInlineImportant(btn, 'pointer-events', 'auto')
  // 图标：白色便签 data-URI 背景，居中 14px → 免疫书内 svg/path 的 CSS 强杀
  setInlineImportant(btn, 'background-image', `url("${ICON_NOTE_DATA}")`)
  setInlineImportant(btn, 'background-size', '14px 14px')
  setInlineImportant(btn, 'background-repeat', 'no-repeat')
  setInlineImportant(btn, 'background-position', 'center')

  // hover 显形：iframe 里拿不到主窗口的 styles.css，
  // 必须用 mouseenter/mouseleave 直接 setProperty(..., 'important')。
  setInlineImportant(btn, 'transition', 'opacity 0.14s ease, transform 0.14s ease, box-shadow 0.14s ease')
  btn.addEventListener('mouseenter', () => {
    setInlineImportant(btn, 'opacity', '1')
    setInlineImportant(btn, 'transform', 'scale(1.15)')
    setInlineImportant(btn, 'box-shadow', '0 3px 8px rgba(0, 0, 0, 0.28)')
  })
  btn.addEventListener('mouseleave', () => {
    setInlineImportant(btn, 'opacity', '0.35')
    setInlineImportant(btn, 'transform', 'scale(1)')
    setInlineImportant(btn, 'box-shadow', '0 1px 3px rgba(0, 0, 0, 0.18)')
  })

  // mousedown 阻止默认：避免在图标上按下时正文开始选区
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const win = doc.defaultView
    if (!win) return
    try {
      win.dispatchEvent(
        new CustomEvent('bookloft:anno-click', {
          detail: {
            id: String(anno.id),
            x: e.clientX,
            y: e.clientY,
            type: anno.type
          },
          bubbles: false
        })
      )
    } catch (_) {}
  })

  m.appendChild(btn)
  return m
}

// 把 range 覆盖的文本切成多段，每段用一个 span 包起来。
// opts.withMarker = true 时（仅 annotation/note），在选区最后一行末尾光标的
// 正上方追加一个浮动小图标，便于查看已写内容。
// 返回插入的包络 span 元素列表。
export function wrapRange(doc, range, anno, theme, opts = {}) {
  const { withMarker = false } = opts
  const nodes = collectIntersectingTextNodes(doc, range)
  if (!nodes.length) return []
  const inserted = []
  for (const node of nodes) {
    let start = 0
    let end = node.nodeValue.length
    if (node === range.startContainer) start = range.startOffset
    if (node === range.endContainer) end = range.endOffset
    if (end <= start) continue
    let middle = node
    if (end < middle.nodeValue.length) {
      middle.splitText(end)
    }
    if (start > 0) {
      middle = middle.splitText(start)
    }
    const span = doc.createElement('span')
    span.dataset.bookloftAnnoId = String(anno.id)
    span.dataset.bookloftAnnoType = String(anno.type)
    if (anno.style != null) span.dataset.bookloftAnnoStyle = String(anno.style)
    if (anno.color != null) span.dataset.bookloftAnnoColor = String(anno.color)
    applyAnnoStyle(span, anno, theme)
    middle.parentNode.insertBefore(span, middle)
    span.appendChild(middle)
    inserted.push(span)
  }
  if (
    withMarker &&
    inserted.length > 0 &&
    (anno.type === 'annotation' || anno.type === 'note')
  ) {
    // marker 用 fixed 浮在选区最后一行末尾光标的正上方（脱离文本流），
    // 挂在 doc.body 上。位置取"最后一个已包络 span"的最后一个 client rect：
    //   - 跨多行选区时，最后一个包络就是最后一行末尾的文本，getClientRects()
    //     返回的 rect 正好对应"最后一行末尾光标"的客户端矩形。
    //   - 用已包络 span 而不是原 range，是因为 wrapRange 内做了 splitText，
    //     原 range 引用的节点会被切走，再调 getClientRects() 会拿到空 rect，
    //     marker 就完全看不见了——这是上一次图标消失的根因。
    const lastSpan = inserted[inserted.length - 1]
    let lastRect = null
    try {
      const rects = lastSpan.getClientRects ? lastSpan.getClientRects() : null
      if (rects && rects.length > 0) lastRect = rects[rects.length - 1]
      if (!lastRect) lastRect = lastSpan.getBoundingClientRect()
    } catch (_) {}
    if (lastRect && doc.body) {
      const marker = createMarker(doc, anno, theme, lastRect)
      doc.body.appendChild(marker)
    }
  }
  return inserted
}

// 文本兜底匹配：在文档里查找与 selectedText 子串匹配的 range（按文本节点逐个比）
// 用于 epub.js 的 CFI→Range 在某些版本/章节失效时的退化路径。
export function findTextRange(doc, text) {
  if (!text || !doc || !doc.body) return null
  const target = text.replace(/\s+/g, ' ').trim()
  if (!target) return null
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null)
  let n
  while ((n = walker.nextNode())) {
    const v = n.nodeValue || ''
    if (!v.trim()) continue
    const idx = v.replace(/\s+/g, ' ').indexOf(target)
    if (idx < 0) continue
    const start = Math.max(0, Math.min(v.length, idx))
    const end = Math.min(v.length, start + target.length)
    const r = doc.createRange()
    try {
      r.setStart(n, start)
      r.setEnd(n, end)
    } catch (_) {
      continue
    }
    return r
  }
  return null
}

// 清除文档里全部由本系统注入的标注包络（恢复原始 DOM）。
// 同时清除对应的 marker。切换书 / 重置状态 / 重新应用时调用。
export function clearAllAnnoSpans(doc) {
  if (!doc) return
  // 先移除全部 marker（避免清完 span 后变成孤儿节点）
  const markers = doc.querySelectorAll('span.bookloft-anno-marker')
  markers.forEach((m) => {
    if (m.parentNode) m.parentNode.removeChild(m)
  })
  const spans = doc.querySelectorAll('span[data-bookloft-anno-id]')
  spans.forEach((s) => {
    const parent = s.parentNode
    if (!parent) return
    while (s.firstChild) parent.insertBefore(s.firstChild, s)
    parent.removeChild(s)
    // 合并相邻文本节点
    parent.normalize?.()
  })
}

// 清除指定 id 的标注包络与对应 marker。删除单条标注时同步 UI 用。
export function clearAnnoSpansById(doc, annoId) {
  if (!doc || annoId == null) return
  const sid = String(annoId)
  // 先移除 marker
  const markers = doc.querySelectorAll(
    `span.bookloft-anno-marker[data-bookloft-anno-marker="${CSS.escape(sid)}"]`
  )
  markers.forEach((m) => {
    if (m.parentNode) m.parentNode.removeChild(m)
  })
  // 再清 span
  const spans = doc.querySelectorAll(
    `span[data-bookloft-anno-id="${CSS.escape(sid)}"]`
  )
  spans.forEach((s) => {
    const parent = s.parentNode
    if (!parent) return
    while (s.firstChild) parent.insertBefore(s.firstChild, s)
    parent.removeChild(s)
    parent.normalize?.()
  })
}

// 白色叉叉（X）data-URI SVG：用 background-image 而非内联 <svg>，
// 免疫书内 CSS 对 svg/path 的强杀（与 marker 同一经验）。
const ICON_DEL_DATA =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M18 6 6 18"/>' +
      '<path d="m6 6 12 12"/>' +
      '</svg>'
  )

// 在 epub 内容文档（iframe）里为指定类型的标注 span 挂上 hover 删除按钮：
//   - 鼠标进入 span[data-bookloft-anno-id]（且类型在 types 列表内）：
//     在 span 第一行的"右上角外侧"显示一颗 22×22 红圆按钮（白叉图标）。
//   - 鼠标离开该 span（且未进入按钮）：按钮隐藏。
//   - 点击按钮：调 onRequest({ id, type })，由 Reader 把事件转发给主窗口。
//
// 返回清理函数，章节切换或组件卸载时调用以避免重复挂监听 / DOM 泄漏。
//
// 设计要点（与 marker 一致经验）：
//   - 按钮用 position:fixed 相对 iframe 视口定位，外观全部 setProperty(..., 'important')
//     内联，免疫 iframe 缺类 + 书内 button reset / svg 强杀。
//   - 图标走白色 data-URI background-image，不依赖内联 <svg>。
//   - 位置 = "文字第一行右上角外侧"（与 marker 完全相同的坐标算法）——
//     默认不显示（opacity 0.35），鼠标移上去才显形（opacity 1 + scale 1.15），
//     与回显按钮的"克制式"风格一致。
//
// opts.types：限定哪些 anno.type 触发本按钮；缺省 ['highlight','underline']，
// 因为标注/笔记的回显弹框自带删除按钮，不再需要这一颗。
export function attachAnnoHoverDelete(doc, onRequest, opts = {}) {
  if (!doc || !doc.body || typeof onRequest !== 'function') return () => {}

  const types = Array.isArray(opts.types) && opts.types.length > 0
    ? opts.types
    : ['highlight', 'underline']
  const allowedTypes = new Set(types.map((t) => String(t)))

  // 共享一颗按钮 DOM：跨 span 共用，避免每次 hover 重建造成闪烁 / 抖动。
  const btn = doc.createElement('button')
  btn.type = 'button'
  btn.className = 'bookloft-anno-del'
  btn.title = '删除'
  btn.setAttribute('aria-label', '删除标注')
  btn.style.setProperty('position', 'fixed', 'important')
  btn.style.setProperty('z-index', '1000', 'important')  // 比 marker(999) 更高，避免被 marker 遮
  btn.style.setProperty('display', 'none', 'important')
  btn.style.setProperty('width', '22px', 'important')
  btn.style.setProperty('height', '22px', 'important')
  btn.style.setProperty('padding', '0', 'important')
  btn.style.setProperty('margin', '0', 'important')
  btn.style.setProperty('border', 'none', 'important')
  btn.style.setProperty('border-radius', '50%', 'important')
  btn.style.setProperty('background-color', '#dc2626', 'important')  // 红色：删除语义
  btn.style.setProperty('color', '#ffffff', 'important')
  // 默认 0.35：与回显 marker 同一透明度风格，hover 时显形（保持克制）
  btn.style.setProperty('opacity', '0.35', 'important')
  btn.style.setProperty('box-shadow', '0 1px 3px rgba(0, 0, 0, 0.22)', 'important')
  btn.style.setProperty('cursor', 'pointer', 'important')
  btn.style.setProperty('pointer-events', 'auto', 'important')
  btn.style.setProperty('user-select', 'none', 'important')
  btn.style.setProperty('-webkit-user-select', 'none', 'important')
  btn.style.setProperty('line-height', '1', 'important')
  btn.style.setProperty('transform', 'scale(1)', 'important')
  btn.style.setProperty('transition', 'transform 0.14s ease, opacity 0.14s ease, box-shadow 0.14s ease', 'important')
  // 白色叉图标（14px 居中）
  btn.style.setProperty('background-image', `url("${ICON_DEL_DATA}")`, 'important')
  btn.style.setProperty('background-size', '14px 14px', 'important')
  btn.style.setProperty('background-repeat', 'no-repeat', 'important')
  btn.style.setProperty('background-position', 'center', 'important')
  doc.body.appendChild(btn)

  // hover 显形（红更亮 + 放大 + 阴影加深），mouseenter/mouseleave 直接 setProperty，
  // 不依赖 styles.css（styles.css 在主窗口，iframe 拿不到）。
  btn.addEventListener('mouseenter', () => {
    btn.style.setProperty('opacity', '1', 'important')
    btn.style.setProperty('transform', 'scale(1.15)', 'important')
    btn.style.setProperty('box-shadow', '0 3px 8px rgba(0, 0, 0, 0.28)', 'important')
  })
  btn.addEventListener('mouseleave', () => {
    btn.style.setProperty('opacity', '0.35', 'important')
    btn.style.setProperty('transform', 'scale(1)', 'important')
    btn.style.setProperty('box-shadow', '0 1px 3px rgba(0, 0, 0, 0.22)', 'important')
  })
  // 按下瞬间缩小
  btn.addEventListener('mousedown', () => {
    btn.style.setProperty('transform', 'scale(0.92)', 'important')
  })

  let currentSpan = null
  let currentId = ''
  let hideTimer = 0  // 延时隐藏：给鼠标从文字移到按钮留缓冲，避免被 mouseout 立即藏掉
  const HIDE_DELAY = 120  // ms

  function findAnnoSpan(el) {
    while (el && el !== doc.body && el.nodeType !== 9 /* DOCUMENT */) {
      if (el.nodeType === 1 && el.dataset && el.dataset.bookloftAnnoId != null) {
        return el
      }
      el = el.parentNode
    }
    return null
  }

  function getFirstRect(span) {
    let r = null
    try {
      const rects = span.getClientRects ? span.getClientRects() : null
      if (rects && rects.length > 0) r = rects[0]
      if (!r) r = span.getBoundingClientRect ? span.getBoundingClientRect() : null
    } catch (_) {}
    return r
  }

  function showAt(span) {
    // 过滤：仅允许的 anno.type 显示本按钮（标注/笔记靠弹框内的删除按钮处理）
    const spanType = span && span.dataset ? String(span.dataset.bookloftAnnoType || '') : ''
    if (!allowedTypes.has(spanType)) return
    const r = getFirstRect(span)
    if (!r) return
    const iconSize = 22
    // 位置：与回显 marker 完全相同的坐标算法——
    //   圆形中心 ≈ rect.right  （圆形最右部分压在文字最右字符的右边缘上）
    //   圆形底边 = rect.top + 3（gap=-3 让底边嵌入文字顶线 3px，与 marker 一致）
    // 视觉上"删按钮"和"回显 marker"在同一位置：平时半透，
    // 用户 hover 高亮/划线时，按钮显形、点删除；hover 标注/笔记时由弹框处理。
    const gap = -3
    const x = r.right - iconSize / 2
    const y = r.top - iconSize - gap
    btn.style.setProperty('left', x + 'px', 'important')
    btn.style.setProperty('top', y + 'px', 'important')
    btn.style.setProperty('display', 'inline-flex', 'important')
    const id = span.dataset.bookloftAnnoId
    if (id != null) {
      currentId = String(id)
      btn.dataset.bookloftAnnoDel = currentId
      btn.dataset.bookloftAnnoDelType = spanType
    }
    currentSpan = span
  }

  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = 0
    }
  }
  function scheduleHide() {
    cancelHide()
    hideTimer = setTimeout(() => {
      hideTimer = 0
      // 兜底：隐藏前再用鼠标坐标查一次落在哪个元素，避免 e.relatedTarget 不可靠的边界漏判
      const view = doc.defaultView
      const x = view && typeof view.__mouseX === 'number' ? view.__mouseX : -1
      const y = view && typeof view.__mouseY === 'number' ? view.__mouseY : -1
      if (x >= 0 && y >= 0) {
        const el = doc.elementFromPoint ? doc.elementFromPoint(x, y) : null
        if (el === btn || (el && btn.contains && btn.contains(el))) return
        const sp = el ? findAnnoSpan(el) : null
        if (sp && sp === currentSpan) return
      }
      hide()
    }, HIDE_DELAY)
  }

  function hide() {
    cancelHide()
    btn.style.setProperty('display', 'none', 'important')
    currentSpan = null
    currentId = ''
  }

  function onMouseOver(e) {
    // 鼠标进入按钮本体：取消隐藏、保持显示
    if (e.target === btn || (e.target && btn.contains && btn.contains(e.target))) {
      cancelHide()
      return
    }
    const span = findAnnoSpan(e.target)
    if (!span) return
    cancelHide()
    // 类型不在允许列表：清掉旧状态（如果显示着）的兜底，避免错位
    const spanType = String(span.dataset?.bookloftAnnoType || '')
    if (!allowedTypes.has(spanType)) {
      scheduleHide()
      return
    }
    if (span !== currentSpan) showAt(span)
  }

  function onMouseOut(e) {
    // 鼠标离开按钮 / 当前 span / 移出文档：统一走延时隐藏
    scheduleHide()
  }

  function onBtnClick(e) {
    e.preventDefault()
    e.stopPropagation()
    const id = currentId || (btn.dataset && btn.dataset.bookloftAnnoDel) || ''
    if (!id) return
    const spanType = (btn.dataset && btn.dataset.bookloftAnnoDelType) || ''
    // 立即隐藏按钮，避免状态切换前用户看到删除后还残留
    hide()
    try {
      onRequest({ id: String(id), type: spanType })
    } catch (_) {}
  }

  doc.addEventListener('mouseover', onMouseOver)
  doc.addEventListener('mouseout', onMouseOut)
  btn.addEventListener('click', onBtnClick)
  // 鼠标按下时阻止默认行为，避免在按钮上按下导致正文开始选区
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })

  // 兜底：iframe 内部实时记下鼠标坐标，scheduleHide 触发时用 elementFromPoint 二次校验
  function onMouseMove(e) {
    const view = doc.defaultView
    if (!view) return
    view.__mouseX = e.clientX
    view.__mouseY = e.clientY
  }
  doc.addEventListener('mousemove', onMouseMove)

  return function detach() {
    cancelHide()
    doc.removeEventListener('mouseover', onMouseOver)
    doc.removeEventListener('mouseout', onMouseOut)
    doc.removeEventListener('mousemove', onMouseMove)
    btn.removeEventListener('click', onBtnClick)
    if (btn.parentNode) btn.parentNode.removeChild(btn)
  }
}
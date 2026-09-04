// 封面"整图适配"逻辑（fit-contain）：在保留图片长宽比的前提下，
// 让书籍开篇的封面图在当前可视区域内完整展示。
//
// 背景：epub.js 在 reflowable+paginated 下把正文放进等高的 CSS 分栏
// （column-width=视口宽、height=视口高、column-fill:auto）。封面常是
// 一张高于一栏的竖版整图（calibre 用 <svg viewBox="0 0 600 800"> +
// preserveAspectRatio="none"），于是浏览器把超出一栏高度的部分推到
// 第二栏，封面被裁切/跨栏，比例也被压扁。scrolled-doc 下则整张图竖直
// 排开、需滚动才能看全。
//
// 方案：把"封面章节"单独拎出来，临时取消其分栏并把文档约束为恰好一个
// 视口盒子；随后把封面图按其真实宽高比缩放到能放进该盒子的最大尺寸
// （contain），居中展示。封面识别以"首个 spine 且文档含整页大图"为准，
// 命中后才注入，不影响后续正文章节。

// 封面章节判定：仅当 section.index === 0 且文档含疑似封面大图时成立。
// 判据（满足其一即视为封面）：
//   - 含 <svg><image>（calibre 生成的经典封面结构）
//   - 含 meta[name=calibre:cover] 或 <title>Cover</title>
//   - 正文只有一张铺满的 <img>（无其他文本）
export function looksLikeCover(doc) {
  if (!doc || !doc.body) return false
  if (doc.querySelector('svg image, svg image[href], svg image[xlink\\:href]')) return true
  if (doc.querySelector('meta[name="calibre:cover"]')) return true
  // 一张 <img> 且 body 几乎没有文字 → 视为封面大图
  const imgs = doc.querySelectorAll('img')
  if (imgs.length === 1) {
    const textLen = (doc.body.innerText || doc.body.textContent || '').replace(/\s/g, '').length
    if (textLen < 20) return true
  }
  return false
}

// 提取封面图真实宽高比。返回 { el, w, h }；el 为应被缩放的顶层元素（svg 或 img）。
// 找不到明确比例时返回 null（调用方跳过，保持 epub 默认行为）。
export function findCoverTarget(doc) {
  if (!doc) return null
  const svg = doc.querySelector('svg image') && doc.querySelector('svg')
  if (svg) {
    // 优先 viewBox="minX minY w h"，其次 svg width/height 属性
    const vb = (svg.getAttribute('viewBox') || '').trim().split(/\s+/)
    let w = 0
    let h = 0
    if (vb.length === 4) {
      w = parseFloat(vb[2])
      h = parseFloat(vb[3])
    }
    if (!w || !h) {
      const img = svg.querySelector('image')
      w = parseFloat((img && img.getAttribute('width')) || svg.getAttribute('width') || '0')
      h = parseFloat((img && img.getAttribute('height')) || svg.getAttribute('height') || '0')
    }
    if (w > 0 && h > 0) return { el: svg, w, h }
  }
  // <img>：取自然尺寸或 width/height 属性
  const img = doc.querySelector('img')
  if (img) {
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    if (nw > 0 && nh > 0) return { el: img, w: nw, h: nh }
    const aw = parseFloat(img.getAttribute('width') || '0')
    const ah = parseFloat(img.getAttribute('height') || '0')
    if (aw > 0 && ah > 0) return { el: img, w: aw, h: ah }
  }
  return null
}

// 计算 contain：把 (w,h) 的图放进 (W,H) 盒内的最大等比尺寸
function contain(w, h, W, H) {
  if (w <= 0 || h <= 0 || W <= 0 || H <= 0) return { cw: 0, ch: 0 }
  const s = Math.min(W / w, H / h)
  return { cw: w * s, ch: h * s }
}

// 生成封面整图适配的样式串（纯函数，便于单测/静态复现）
// target: findCoverTarget 的返回值 { w, h }；boxW/boxH：可视盒尺寸
export function buildCoverStyle(target, boxW, boxH) {
  const { cw, ch } = contain(target.w, target.h, boxW, boxH)
  if (!cw || !ch) return ''
  return [
    'html{width:' + boxW + 'px !important;}',
    'html,body{' +
      'width:' + boxW + 'px !important;' +
      'height:' + boxH + 'px !important;' +
      'margin:0 !important;padding:0 !important;' +
      'overflow:hidden !important;' +
      'column-count:1 !important;column-width:auto !important;column-fill:auto !important;' +
      'column-gap:0 !important;' +
      'box-sizing:border-box;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'text-align:center;' +
      '}',
    // 中性化中间嵌套块，避免其自带 margin/width 干扰居中
    'body > *{max-width:' + boxW + 'px !important;margin:0 auto !important;padding:0 !important;}' +
      'body div,body p{max-width:100% !important;}',
    // 封面图本身缩放到 contain 尺寸并居中（覆盖书内/主题对 img/svg 的一切约束）
    'body svg,body img{' +
      'width:' + cw + 'px !important;' +
      'height:' + ch + 'px !important;' +
      'max-width:' + boxW + 'px !important;' +
      'max-height:' + boxH + 'px !important;' +
      'min-width:0 !important;min-height:0 !important;' +
      'object-fit:contain;' +
      'margin:0 auto !important;' +
      'display:block;' +
      '}',
    // svg 内 image 铺满 svg 盒子（svg 已是等比 contain 盒子，铺满即不畸变）
    'svg image,svg > image{width:100% !important;height:100% !important;}',
    // 去除 epub.js adjustImages / 书内对 svg 的高度限制
    'svg{max-height:' + boxH + 'px !important;max-width:' + boxW + 'px !important;}'
  ].join('\n')
}

const STYLE_ID = 'bookloft-cover-style'

// 核心：对封面文档注入"取消分栏 + contain 居中"样式。
// contents: epub.js Contents（live document）；rend: rendition；mode: 阅读模式
// box: 可选 { width, height } 显式可视盒尺寸（推荐，来自 renderTo 时的容器尺寸，
//      比 rendition 内部 layout 字段更可靠）；缺省时回退读 rendition 内部值。
export function applyCoverFit(contents, rend, mode, box) {
  const doc = contents && contents.document
  let target = findCoverTarget(doc)
  // <img> 型封面可能尚未加载完（naturalWidth=0 又无属性）拿不到比例，
  // 监听一次 load 后重试（仅封面文档，且带 doc 标记避免重复绑定）
  if (!target && doc && doc.querySelector('img') && !doc.getElementById(STYLE_ID)) {
    const im = doc.querySelector('img')
    const retry = () => {
      const t = findCoverTarget(doc)
      if (t) applyCoverFit(contents, rend, mode, box)
    }
    im.addEventListener('load', retry, { once: true })
    return
  }
  if (!target) return

  // 读取可视区域（stage）尺寸：显式 box 优先，其次 rendition 内部 layout/stage
  const layout = rend && rend._layout
  const mgr = rend && rend.manager
  const stage = mgr && mgr._stageSize
  const W = box && box.width > 0 ? box.width : (layout ? layout.width : (stage && stage.width))
  const H = box && box.height > 0 ? box.height : (layout ? layout.height : (stage && stage.height))
  // scrolled-doc 下 layout.width 可能为 0，兜底用 stage
  const boxW = W && W > 0 ? W : (stage && stage.width)
  const boxH = H && H > 0 ? H : (stage && stage.height)
  if (!boxW || !boxH) return

  const css = buildCoverStyle(target, boxW, boxH)
  if (!css) return

  // 注入样式（幂等）
  let style = doc.getElementById(STYLE_ID)
  if (!style) {
    style = doc.createElement('style')
    style.id = STYLE_ID
    doc.head.appendChild(style)
  }
  style.textContent = css

  // 若是 paginated：把该章节的 iframe/epub-view 收缩为恰好一个视口盒子，
  // 避免 epub.js 因封面超高而把 iframe 撑成多页宽度、出现空白页/横向溢出。
  if (mode !== 'scrolled-doc') {
    shrinkViewToBox(contents, boxW, boxH, rend)
  }
}

// 把封面章节的 .epub-view / iframe 缩成可视盒大小，并拦截该视图后续的
// expand（epub.js 会在内容 RESIZE/setLayout 时按内容测量重新撑大 iframe，
// 导致封面重新变回多页宽出现空白列）
function shrinkViewToBox(contents, boxW, boxH, rend) {
  try {
    const frame = contents.document && contents.document.defaultView && contents.document.defaultView.frameElement
    const viewEl = frame && frame.parentElement
    if (!viewEl) return
    viewEl.style.width = boxW + 'px'
    viewEl.style.height = boxH + 'px'
    frame.style.width = boxW + 'px'
    frame.style.height = boxH + 'px'
    // 找到对应 view，冻结其 expand，避免被 epub.js 重新撑开
    const views = rend && rend.manager && rend.manager.views
    const list = views && (views.all ? views.all() : views)
    if (Array.isArray(list)) {
      const view = list.find((v) => v && v.element === viewEl)
      if (view && typeof view.expand === 'function') {
        view.expand = function () {} // 封面章节固定单页，不再按内容扩张
      }
    }
  } catch (_) {}
}

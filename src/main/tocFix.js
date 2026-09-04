import JSZip from 'jszip'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, basename, extname } from 'node:path'

/**
 * 目录更正（TOC Fix）
 *
 * 背景：部分 epub（如 Calibre 转换产物）的 toc.ncx 与正文实际排布错位，
 * 表现为"点第 N 章却跳到第 N-1 章"。本模块不信任原有 href，改为按
 * "目录 label → 正文标题实际所在 spine 文件" 重新定位每一条目录，
 * 重写 toc.ncx，并输出一份新的 epub（原文件不做任何修改）。
 */

/* ---------------- 基础工具 ---------------- */

// 解码 XML/HTML 实体
function decodeEntities(s = '') {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

// 归一化：解码实体 + 折叠空白，便于与正文纯文本比对
function norm(s = '') {
  return decodeEntities(s).replace(/\s+/g, ' ').trim()
}

// posix 路径归一化（去 ./ .. 与空段）
function normalizePath(p = '') {
  const out = []
  for (const part of String(p).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

// 把相对 href 按 opf 所在目录解析成 zip 内路径
function resolveHref(opfDir, href) {
  const h = decodeEntities(href).split('#')[0]
  return normalizePath(opfDir ? `${opfDir}/${h}` : h)
}

/**
 * 去标签得到纯文本，同时记录"纯文本每个字符在 HTML 中的下标"。
 * 空白折叠为单个空格，与 norm() 的结果可直接比对。
 */
function toPlainWithMap(html) {
  let out = ''
  const map = []
  const n = html.length
  let i = 0
  while (i < n) {
    if (html[i] === '<') {
      if (html.startsWith('<!--', i)) {
        const e = html.indexOf('-->', i)
        i = e === -1 ? n : e + 3
        continue
      }
      const lower = html.slice(i, i + 8).toLowerCase()
      if (lower.startsWith('<script')) {
        const e = html.toLowerCase().indexOf('</script>', i)
        i = e === -1 ? n : e + 9
        continue
      }
      if (lower.startsWith('<style')) {
        const e = html.toLowerCase().indexOf('</style>', i)
        i = e === -1 ? n : e + 8
        continue
      }
      const e = html.indexOf('>', i)
      i = e === -1 ? n : e + 1
      continue
    }
    const ch = html[i]
    if (/\s/.test(ch)) {
      if (out.length && out[out.length - 1] !== ' ') {
        out += ' '
        map.push(i)
      }
    } else {
      out += ch
      map.push(i)
    }
    i += 1
  }
  return { text: out, map }
}

// 从 htmlIdx 往前找最近的一个 id="..."，用作锚点
function findIdBefore(html, htmlIdx) {
  const start = Math.max(0, htmlIdx - 4000)
  const re = /id\s*=\s*"([^"]+)"/g
  let best = null
  let m
  while ((m = re.exec(html)) !== null) {
    if (m.index > htmlIdx) break
    if (m.index >= start) best = m[1]
  }
  return best
}

/* ---------------- OPF / NCX 解析 ---------------- */

// 注意：JSZip 3.0 移除了 asText()，统一用 async('string')
async function findOpfPath(zip) {
  const container = zip.file('META-INF/container.xml')
  if (container) {
    const xml = await container.async('string')
    const m = xml.match(/full-path\s*=\s*"([^"]+)"/)
    if (m) return normalizePath(decodeEntities(m[1]))
  }
  return Object.keys(zip.files).find((n) => n.toLowerCase().endsWith('.opf')) || null
}

// 解析 manifest：id -> { href, mediaType }
function parseManifest(opfXml) {
  const manifest = {}
  const re = /<item\b([^>]*)>/g
  let m
  while ((m = re.exec(opfXml)) !== null) {
    const attrs = m[1]
    const id = (attrs.match(/\bid\s*=\s*"([^"]+)"/) || [])[1]
    const href = (attrs.match(/href\s*=\s*"([^"]+)"/) || [])[1]
    const mediaType = (attrs.match(/media-type\s*=\s*"([^"]+)"/) || [])[1]
    if (id && href) manifest[decodeEntities(id)] = { href: decodeEntities(href), mediaType }
  }
  return manifest
}

// 解析 spine，返回按阅读顺序排列的 href 列表 + toc 的 manifest id
function parseSpine(opfXml) {
  const block = opfXml.match(/<spine\b([^>]*)>([\s\S]*?)<\/spine>/)
  if (!block) return { idrefs: [], tocId: null }
  const tocId = (block[1].match(/\btoc\s*=\s*"([^"]+)"/) || [])[1] || null
  const idrefs = []
  const re = /<itemref\b([^>]*?)\/?>/g
  let m
  while ((m = re.exec(block[2])) !== null) {
    const idref = (m[1].match(/idref\s*=\s*"([^"]+)"/) || [])[1]
    if (idref) idrefs.push(decodeEntities(idref))
  }
  return { idrefs, tocId }
}

/**
 * 解析 NCX 的 navPoint 树，返回按文档顺序（前序 DFS）排列的条目。
 * 每个条目记录 label / src / depth。
 */
function parseNavPoints(ncxXml) {
  const out = []
  const stack = []
  const re = /<navPoint\b[^>]*>|<\/navPoint>|<navLabel>[\s\S]*?<\/navLabel>|<content\b[^>]*>/g
  let m
  while ((m = re.exec(ncxXml)) !== null) {
    const tok = m[0]
    if (tok.startsWith('<navPoint')) {
      const entry = { label: '', src: '', depth: stack.length }
      stack.push(entry)
      out.push(entry)
    } else if (tok.startsWith('</navPoint')) {
      stack.pop()
    } else if (tok.startsWith('<navLabel')) {
      const t = tok.match(/<text>([\s\S]*?)<\/text>/)
      if (t && stack.length) stack[stack.length - 1].label = norm(t[1])
    } else if (tok.startsWith('<content')) {
      const s = tok.match(/src\s*=\s*"([^"]*)"/)
      if (s && stack.length) stack[stack.length - 1].src = decodeEntities(s[1])
    }
  }
  return out
}

/* ---------------- 主流程 ---------------- */

/**
 * 修正一本书的目录，生成修复版 epub。
 * @param {string} filePath 原 epub 绝对路径（不会被修改）
 * @returns {Promise<{ok:boolean, path?:string, message?:string, total?:number, changed?:number}>}
 */
export async function fixEpubToc(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return { ok: false, message: '文件不存在' }
  }

  let zip
  try {
    zip = await JSZip.loadAsync(readFileSync(filePath))
  } catch (err) {
    return { ok: false, message: '无法读取该 epub（不是有效的 zip）: ' + err.message }
  }

  // --- OPF ---
  const opfPath = await findOpfPath(zip)
  if (!opfPath) return { ok: false, message: '找不到 OPF 文件' }
  const opfFile = zip.file(opfPath)
  if (!opfFile) return { ok: false, message: '找不到 OPF 文件: ' + opfPath }
  const opfXml = await opfFile.async('string')
  const opfDir = normalizePath(dirname(opfPath).replace(/\\/g, '/'))
  const opfDirRel = opfDir === '.' ? '' : opfDir

  const manifest = parseManifest(opfXml)
  const { idrefs, tocId } = parseSpine(opfXml)

  // spine 文件（按阅读顺序），保留 manifest 中的原始 href 用于回写
  const spine = []
  for (const idref of idrefs) {
    const item = manifest[idref]
    if (!item || !item.href) continue
    if (item.mediaType && !/xhtml|html|xml/.test(item.mediaType)) continue
    spine.push({ href: item.href, path: resolveHref(opfDirRel, item.href) })
  }
  if (spine.length === 0) return { ok: false, message: 'spine 为空，无法定位章节' }

  // --- NCX ---
  let ncxPath = null
  if (tocId && manifest[tocId]) ncxPath = resolveHref(opfDirRel, manifest[tocId].href)
  if (!ncxPath || !zip.file(ncxPath)) {
    ncxPath = Object.keys(zip.files).find((n) => n.toLowerCase().endsWith('.ncx')) || null
  }
  if (!ncxPath || !zip.file(ncxPath)) {
    return { ok: false, message: '该文件没有 toc.ncx（可能是纯 EPUB3 nav），暂不支持更正' }
  }
  const ncxXml = await zip.file(ncxPath).async('string')
  const entries = parseNavPoints(ncxXml)
  if (entries.length === 0) return { ok: false, message: 'toc.ncx 中未解析到目录条目' }

  // --- 各 spine 文件的正文 ---
  const docs = []
  for (const s of spine) {
    const f = zip.file(s.path)
    if (!f) {
      docs.push({ text: '', map: [], html: '' })
      continue
    }
    const html = await f.async('string')
    const { text, map } = toPlainWithMap(html)
    docs.push({ text, map, html })
  }

  // --- 识别"目录页/索引页"：包含大量目录标题的文件，不能当作章节正文 ---
  const labels = entries.map((e) => e.label).filter(Boolean)
  const navLike = docs.map((d) => {
    if (!d.text) return true
    let c = 0
    for (const l of labels) if (d.text.includes(l)) c += 1
    return c >= 3 // 命中 3 个以上标题 → 判定为目录/索引页
  })

  // --- 逐条重新定位：单调不回退，优先取非目录页、且标题位置最靠前的 spine 文件 ---
  const assigned = new Array(entries.length).fill(null)
  let lastIdx = 0
  for (let k = 0; k < entries.length; k++) {
    const label = entries[k].label
    if (!label) continue

    let best = null
    for (let pass = 0; pass < 2 && !best; pass++) {
      for (let i = lastIdx; i < spine.length; i++) {
        if (pass === 0 && navLike[i]) continue // 第一轮跳过目录页
        const pos = docs[i].text.indexOf(label)
        if (pos === -1) continue
        if (!best || i < best.i || (i === best.i && pos < best.pos)) best = { i, pos }
      }
    }
    if (!best) continue // 正文中找不到该标题：保留原 href 不动

    assigned[k] = best
    lastIdx = best.i
  }

  // --- 同一文件内的后续条目：尝试补锚点，避免多条目录全落在文件开头 ---
  const byFile = new Map()
  assigned.forEach((a, k) => {
    if (!a) return
    if (!byFile.has(a.i)) byFile.set(a.i, [])
    byFile.get(a.i).push(k)
  })
  for (const [i, keys] of byFile) {
    keys.forEach((k, order) => {
      if (!assigned[k]) return
      if (order === 0) {
        assigned[k].anchor = null // 该文件第一条：指向文件开头
        return
      }
      const htmlIdx = docs[i].map[assigned[k].pos] ?? 0
      assigned[k].anchor = findIdBefore(docs[i].html, htmlIdx)
    })
  }

  // --- 重写 NCX：第 N 个 <content src> 对应第 N 个目录条目 ---
  const newSrcs = entries.map((e, k) => {
    const a = assigned[k]
    if (!a) return null // 表示保留原样
    const base = spine[a.i].href
    return a.anchor ? `${base}#${a.anchor}` : base
  })

  let contentIdx = 0
  let changed = 0
  const fixedNcx = ncxXml.replace(/<content\b([^>]*?)\/?>/g, (whole) => {
    const idx = contentIdx
    contentIdx += 1
    const replacement = newSrcs[idx]
    const srcMatch = whole.match(/src\s*=\s*"([^"]*)"/)
    if (replacement === null || !srcMatch) return whole
    const old = decodeEntities(srcMatch[1])
    if (normalizePath(old.split('#')[0]) === normalizePath(replacement.split('#')[0])) {
      return whole // 文件级已正确，不动
    }
    changed += 1
    return whole.replace(/src\s*=\s*"([^"]*)"/, () => `src="${replacement.replace(/&/g, '&amp;')}"`)
  })

  // --- 输出修复版 epub（不改动原文件） ---
  const dir = dirname(filePath)
  const ext = extname(filePath)
  const baseName = basename(filePath, ext)
  const outPath = join(dir, `${baseName}-toc${ext || '.epub'}`)

  const out = new JSZip()
  const mimetypeFile = zip.file('mimetype')
  const mimetype = mimetypeFile ? await mimetypeFile.async('string') : 'application/epub+zip'
  out.file('mimetype', mimetype, { compression: 'STORE' }) // 规范要求：首个且不压缩

  for (const name of Object.keys(zip.files)) {
    if (name === 'mimetype') continue
    const entry = zip.files[name]
    if (entry.dir) {
      out.folder(name.replace(/\/$/, ''))
      continue
    }
    const data = name === ncxPath ? Buffer.from(fixedNcx, 'utf8') : await entry.async('nodebuffer')
    out.file(name, data, { compression: 'DEFLATE' })
  }

  const buf = await out.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    mimeType: 'application/epub+zip'
  })
  writeFileSync(outPath, buf)

  return {
    ok: true,
    path: outPath,
    total: entries.length,
    changed,
    message: changed > 0 ? `已修正 ${changed} / ${entries.length} 条目录` : '目录位置无需修正'
  }
}

// 交叉核对：App.jsx 传给每个组件的 props vs 组件函数解构声明的 props
// 解析策略：从 <Name 开始逐字符扫描，跟踪 {} 深度与引号状态，
// 遇到深度 0 且不在引号/括号内的 `>` 才算标签结束（兼容箭头函数 =>）
const fs = require('fs')
const path = require('path')
const app = fs.readFileSync('src/renderer/src/App.jsx', 'utf8')
const dir = 'src/renderer/src/components'

// 从 index 处的 '<Name' 提取到标签结束的完整文本
function extractTag(start) {
  let depth = 0
  let quote = null
  for (let i = start; i < app.length; i++) {
    const c = app[i]
    if (quote) {
      if (c === quote && app[i - 1] !== '\\') quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') depth--
    else if (c === '>' && depth === 0) return app.slice(start, i + 1)
  }
  return ''
}

let bad = 0
for (const f of fs.readdirSync(dir)) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8')
  const name = f.replace('.jsx', '')
  const passed = new Set()
  const openRe = new RegExp('<' + name + '\\b', 'g')
  let m
  while ((m = openRe.exec(app))) {
    const tag = extractTag(m.index)
    for (const p of tag.matchAll(/(?:^|\s)([a-zA-Z_]\w*)=/g)) passed.add(p[1])
  }
  if (!passed.size) continue
  const sig = src.match(/export default function\s+\w+\s*\(\{([\s\S]*?)\}\)/)
  const declared = new Set(
    sig
      ? sig[1]
          .split(',')
          .map((s) => s.trim().split(/[=:]/)[0].trim())
          .filter(Boolean)
      : []
  )
  const missing = [...passed].filter((p) => !declared.has(p))
  if (missing.length) bad++
  console.log(`${name}: 传入 ${passed.size} 个 props, 缺失解构: ${missing.join(',') || '无'}`)
}
console.log(bad ? `\n发现 ${bad} 个组件存在缺失!` : '\n全部核对通过 ✓')

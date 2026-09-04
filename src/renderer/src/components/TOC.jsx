import { useMemo } from 'react'
import { Folder, FileText, BookOpen, Library } from 'lucide-react'

// 归一化 href：解码 URI、去掉 ./ 前缀，便于与 epub.js 返回的 href 比对
function normalizeHref(href) {
  if (!href) return ''
  let h = String(href).trim()
  try {
    h = decodeURIComponent(h)
  } catch (_) {
    // 非法转义序列：保持原样
  }
  if (h.startsWith('./')) h = h.slice(2)
  return h
}

// 文件级 href（去掉 #锚点）
function baseHref(href) {
  return normalizeHref(href).split('#')[0]
}

// 把嵌套目录按文档顺序扁平化，用于唯一定位高亮项
function flattenToc(items, out = []) {
  if (!Array.isArray(items)) return out
  for (const it of items) {
    out.push(it)
    if (it.subitems && it.subitems.length > 0) flattenToc(it.subitems, out)
  }
  return out
}

// 去掉 .epub 后缀用于展示
function stripEpub(name) {
  return name.toLowerCase().endsWith('.epub') ? name.slice(0, -5) : name
}

// 阅览室二级展示名：去 -toc 修复版标记、再去 .epub 后缀
function cleanBookName(name) {
  let base = stripEpub(name)
  if (base.toLowerCase().endsWith('-toc')) base = base.slice(0, -4)
  return base
}

// 把工作目录树拍平成"只读的两级"：
// 一级 = 工作目录名（root）；二级 = 每个可点开的条目，可能是书也可能是一整个子文件夹。
// 每条记录 { kind:'book'|'folder', label, openPath(优先打开的 epub), altPaths(该条关联的全部 epub 路径，供高亮) }
function buildLibraryRows(root) {
  if (!root || !Array.isArray(root.children)) return { name: '', rows: [] }

  const folderRows = []
  const bookRows = [] // 根目录直接放的 epub（需按 base 去 -toc 去重）
  const directByBase = new Map()

  for (const c of root.children) {
    if (c.type === 'folder') {
      const epubs = (c.children || []).filter((x) => x.type === 'epub')
      // 文件夹没有 epub 则不在列表里显示（点了也没书可开）
      if (epubs.length === 0) continue
      const fixed = epubs.find((e) => e.isFixed) || epubs[0]
      folderRows.push({
        kind: 'folder',
        label: c.name,
        openPath: fixed.path,
        altPaths: epubs.map((e) => e.path)
      })
    } else if (c.type === 'epub') {
      const key = (c.base || cleanBookName(c.name)).toLowerCase()
      if (!directByBase.has(key)) directByBase.set(key, [])
      directByBase.get(key).push(c)
    }
  }

  // 根目录下同名（忽略 -toc）的 epub 合并成一行，优先打开展开 -toc 修复版
  for (const group of directByBase.values()) {
    const fixed = group.find((e) => e.isFixed) || group[0]
    bookRows.push({
      kind: 'book',
      label: cleanBookName(group[0].name),
      openPath: fixed.path,
      altPaths: group.map((e) => e.path)
    })
  }

  return { name: root.name, rows: [...folderRows, ...bookRows] }
}

// 阅览室第二级节点：书 或 文件夹，点击即打开对应书籍（高亮当前读的书）
function RoomRow({ row, currentBookPath, onSelectBook }) {
  const active = row.altPaths.includes(currentBookPath)
  const isFolder = row.kind === 'folder'
  return (
    <li className="toc-item">
      <button
        className={`toc-link lib-row ${active ? 'active' : ''}`}
        style={{ paddingLeft: 14 + 1 * 16 }}
        onClick={() => onSelectBook(row.openPath)}
        title={row.label}
      >
        {isFolder ? (
          <Folder size={15} className="lib-icon" />
        ) : (
          <FileText size={15} className="lib-icon" />
        )}
        <span className="toc-label">{row.label || '(未命名)'}</span>
      </button>
    </li>
  )
}

// 当前书籍目录（原有功能）
function TocItem({ item, depth, activeHref, onNavigate }) {
  // activeHref 由父级解析成“唯一应高亮项”的完整 href，按完整 href 精确比对
  const isActive = normalizeHref(item.href) === normalizeHref(activeHref)
  const hasChildren = item.subitems && item.subitems.length > 0

  return (
    <li className="toc-item">
      <button
        className={`toc-link ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={() => onNavigate(item.href)}
        title={item.label}
      >
        <span className="toc-label">{item.label || '(未命名)'}</span>
      </button>
      {hasChildren && (
        <ul className="toc-sublist">
          {item.subitems.map((sub) => (
            <TocItem
              key={sub.id || sub.href}
              item={sub}
              depth={depth + 1}
              activeHref={activeHref}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function TOC({
  open,
  toc,
  location,
  onNavigate,
  mode,
  onModeChange,
  workingDir,
  library,
  currentBookPath,
  onSelectBook,
  selectedHref
}) {
  const activeHref = location?.href
  const isRoom = mode === 'reading-room'
  // 阅览室：拍平成只读两级（一级=工作目录名，二级=书/子文件夹）
  const room = useMemo(() => buildLibraryRows(library), [library])

  // 目录扁平化（文档顺序）
  const flatToc = useMemo(() => flattenToc(toc), [toc])

  // 唯一高亮项解析：
  // epub.js 的 location.href 只到文件级、不含 #锚点；而多个目录条目可能共用同一个
  // 文件（仅靠锚点区分，如《欧洲之门》text/part0003.html 下就有 3 条）。
  // 若按文件级比对，同文件的条目会被一起高亮 —— 这正是错乱的根因。
  // 策略：先按文件级筛出候选；若用户最近点击的条目仍在本文件内，精确命中它；
  // 否则回退到该文件内的第一个目录条目。始终只返回一项。
  const activeTocHref = useMemo(() => {
    const curBase = baseHref(activeHref)
    if (!curBase || flatToc.length === 0) return ''
    const candidates = flatToc.filter((i) => baseHref(i.href) === curBase)
    if (candidates.length === 0) return ''
    if (baseHref(selectedHref) === curBase) {
      const exact = candidates.find(
        (i) => normalizeHref(i.href) === normalizeHref(selectedHref)
      )
      if (exact) return exact.href
    }
    return candidates[0].href
  }, [flatToc, activeHref, selectedHref])

  return (
    <aside className={`toc-panel ${open ? 'open' : 'closed'}`}>
      <div className="toc-header">
        <span>{isRoom ? '阅览室' : '目录'}</span>
        {isRoom
          ? library && <span className="toc-count">{room.rows.length} 本</span>
          : toc && toc.length > 0 && <span className="toc-count">{toc.length} 章</span>}
      </div>

      <nav className="toc-nav">
        {isRoom ? (
          room.rows.length > 0 ? (
            <ul className="toc-list">
              <li className="toc-room-root">
                <span className="room-root-name">{room.name || '工作目录'}</span>
              </li>
              {room.rows.map((row, i) => (
                <RoomRow
                  key={`${row.kind}-${row.openPath}-${i}`}
                  row={row}
                  currentBookPath={currentBookPath}
                  onSelectBook={onSelectBook}
                />
              ))}
            </ul>
          ) : (
            <div className="toc-empty">
              {library ? (
                '当前目录下没有电子书'
              ) : (
                <>
                  请先在设置 → 打开工作目录
                  <br />
                  选择一本书库文件夹
                </>
              )}
            </div>
          )
        ) : toc && toc.length > 0 ? (
          <ul className="toc-list">
            {toc.map((item) => (
              <TocItem
                key={item.id || item.href}
                item={item}
                depth={0}
                activeHref={activeTocHref}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        ) : (
          <div className="toc-empty">暂无目录</div>
        )}
      </nav>

      <div className="toc-tabbar" role="tablist" aria-label="侧栏视图切换">
        <button
          className={`toc-tab ${!isRoom ? 'active' : ''}`}
          role="tab"
          aria-selected={!isRoom}
          title="当前阅读"
          onClick={() => onModeChange('current')}
        >
          <BookOpen size={18} className="toc-tab-icon" />
          <span className="toc-tab-label">当前阅读</span>
        </button>
        <button
          className={`toc-tab ${isRoom ? 'active' : ''}`}
          role="tab"
          aria-selected={isRoom}
          title="阅览室"
          onClick={() => onModeChange('reading-room')}
        >
          <Library size={18} className="toc-tab-icon" />
          <span className="toc-tab-label">阅览室</span>
        </button>
      </div>
    </aside>
  )
}

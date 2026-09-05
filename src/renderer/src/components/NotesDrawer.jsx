import { useEffect, useMemo, useState } from 'react'
import {
  Highlighter,
  Underline as UnderlineIcon,
  MessageSquareText,
  NotebookText,
  Check,
  Square,
  CornerDownRight,
  X as CloseIcon,
  BookOpen,
  Inbox
} from 'lucide-react'

// 四类标注的元数据：标签 / lucide 图标 / 主题感知色变量
// 图标会渲染到每行左侧，与 chip 标签形成"图标 + 类型"组合，更有设计感。
const TYPE_META = {
  highlight: {
    label: '高亮',
    Icon: Highlighter,
    accentVar: '--anno-type-highlight'
  },
  underline: {
    label: '划线',
    Icon: UnderlineIcon,
    accentVar: '--anno-type-underline'
  },
  annotation: {
    label: '批注',
    Icon: MessageSquareText,
    accentVar: '--anno-type-annotation'
  },
  note: {
    label: '笔记',
    Icon: NotebookText,
    accentVar: '--anno-type-note'
  }
}

// 从 chapterHref 里抽出可读的文件名（处理 ./OEBPS/part0003.html#ch3 → part0003）
function hrefLabel(href) {
  if (!href) return ''
  const noAnchor = String(href).split('#')[0].replace(/^\.\//, '')
  if (!noAnchor) return ''
  const slash = noAnchor.lastIndexOf('/')
  const tail = slash >= 0 ? noAnchor.slice(slash + 1) : noAnchor
  return tail.replace(/\.[a-z0-9]+$/i, '')
}

// 把标注按章节聚类：以 chapterHref 为分组键，缺省兜底到 chapterTitle。
// 返回 [{ key, title, items }]，key 仅用于 React 列表去重。
function groupByChapter(annotations) {
  const groups = new Map()
  for (const a of annotations || []) {
    const key = a.chapterHref || a.chapterTitle || '__none__'
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title:
          (a.chapterTitle && String(a.chapterTitle).trim()) ||
          hrefLabel(a.chapterHref) ||
          '未分类',
        items: []
      })
    }
    groups.get(key).items.push(a)
  }
  // 章节顺序按最小 spineIndex，再按最小 cfiStart。
  const list = Array.from(groups.values())
  list.sort((a, b) => {
    const sa = Math.min(...a.items.map((i) => Number(i.spineIndex) || 0))
    const sb = Math.min(...b.items.map((i) => Number(i.spineIndex) || 0))
    if (sa !== sb) return sa - sb
    return a.title.localeCompare(b.title, 'zh-CN')
  })
  for (const g of list) {
    g.items.sort((x, y) => {
      const sx = Number(x.spineIndex) || 0
      const sy = Number(y.spineIndex) || 0
      if (sx !== sy) return sx - sy
      return String(x.cfiStart || '').localeCompare(String(y.cfiStart || ''))
    })
  }
  return list
}

// 截断文本：保留换行结构，长度 > 80 加省略号
function clipPreview(text, max = 80) {
  if (!text) return ''
  const s = String(text).replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

// 单条标注行（图标 + 类型 chip + 选区/内容预览 + checkbox）
function AnnoRow({ item, isSelected, onToggleSelect, onJump }) {
  const id = String(item.id)
  const meta = TYPE_META[item.type] || {
    label: item.type,
    Icon: BookOpen,
    accentVar: '--anno-type-default'
  }
  // 笔记 / 批注 → 优先显示 content；高亮 / 划线 → 选区原文
  const isNoteLike = item.type === 'note' || item.type === 'annotation'
  const primary = isNoteLike ? item.content || '' : ''
  const secondary = item.selectedText || ''
  // 笔记 / 批注 同时显示两条：选区原文作引用（带左侧色竖线），下面跟笔记内容
  // 高亮 / 划线 只显示选区文本（chip 已表示类型，避免重复信息）
  return (
    <div
      className={`notes-row ${isSelected ? 'is-selected' : ''}`}
      data-type={item.type}
    >
      {/* 左侧类型 icon（彩色方块底） */}
      <span
        className="notes-row-icon"
        style={{ '--accent': `var(${meta.accentVar})` }}
        aria-hidden="true"
      >
        <meta.Icon size={14} strokeWidth={2.2} />
      </span>

      {/* 主区域：点击 = 定位到正文（不收起抽屉） */}
      <button
        type="button"
        className="notes-row-main"
        onClick={() => onJump?.(item)}
        title="定位到正文"
      >
        {/* 顶部小 meta 行：类型 chip + 章节尾标（仅在跨章节上下文有用，但默认隐藏避免噪音） */}
        <div className="notes-row-meta">
          <span
            className="notes-row-chip"
            style={{ '--accent': `var(${meta.accentVar})` }}
          >
            {meta.label}
          </span>
        </div>

        {isNoteLike && secondary ? (
          // 笔记 / 批注 + 选区原文：用引用样式展示（左侧色竖线 + 浅底）
          <div className="notes-row-quote">
            <span className="notes-row-quote-bar" aria-hidden="true" />
            <p className="notes-row-quote-text">{clipPreview(secondary, 90)}</p>
          </div>
        ) : null}

        {/* 主体文本 */}
        <p
          className={`notes-row-text ${isNoteLike && secondary ? 'has-quote' : ''}`}
        >
          {(isNoteLike ? primary : secondary) ? (
            clipPreview(isNoteLike ? primary : secondary, isNoteLike ? 200 : 90)
          ) : (
            <span className="notes-row-text-empty">（无文本）</span>
          )}
        </p>
      </button>

      {/* 右侧 checkbox（始终占位，未选中时半透，hover/选中时显形） */}
      <button
        type="button"
        className={`notes-row-check ${isSelected ? 'is-on' : ''}`}
        onClick={() => onToggleSelect?.(id)}
        aria-pressed={isSelected}
        aria-label={isSelected ? '取消选中' : '选中该项'}
        title={isSelected ? '取消选中' : '选中该项'}
      >
        {isSelected ? <Check size={14} strokeWidth={2.6} /> : <Square size={14} strokeWidth={1.6} />}
      </button>
    </div>
  )
}

// 章节组：标题（带左右小横线装饰）+ 列表
function ChapterSection({ group, selected, onToggleSelect, onJump }) {
  if (!group.items || group.items.length === 0) return null
  return (
    <section className="notes-chapter">
      <header className="notes-chapter-header">
        <span className="notes-chapter-line" />
        <h3 className="notes-chapter-title">{group.title}</h3>
        <span className="notes-chapter-count">{group.items.length}</span>
        <span className="notes-chapter-line" />
      </header>
      <div className="notes-chapter-items">
        {group.items.map((item) => (
          <AnnoRow
            key={String(item.id)}
            item={item}
            isSelected={selected.has(String(item.id))}
            onToggleSelect={onToggleSelect}
            onJump={onJump}
          />
        ))}
      </div>
    </section>
  )
}

// 笔记管理抽屉：右侧滑出浮层。
//
// 设计要点（按需求）：
// 1. 仅展示当前阅读书籍的标注，由 App 层按 filePath 过滤后传入。
// 2. 章节分组：第一章…第二章…无内容章节不显示（groupByChapter 已过滤）。
// 3. 类型前缀（图标 + chip）+ 多选框批量删除。
// 4. 点击行 → onJump(anno) 定位正文（抽屉不收）。
// 5. 缩起 = 关闭整个抽屉（不留窄条），再次进入走设置菜单的笔记管理按钮。
export default function NotesDrawer({
  open,
  bookTitle,
  annotations,
  onJump,
  onBulkDelete,
  onClose
}) {
  const [selected, setSelected] = useState(() => new Set())
  // 抽屉关闭时清空多选状态，避免下次打开残留旧选中
  useEffect(() => {
    if (!open) setSelected(new Set())
  }, [open])

  const groups = useMemo(() => groupByChapter(annotations), [annotations])
  const totalCount = annotations ? annotations.length : 0
  const selectedCount = selected.size

  // 全选当前可见的全部项
  const allIds = useMemo(
    () => (annotations || []).map((a) => String(a.id)),
    [annotations]
  )
  const allSelected = allIds.length > 0 && selected.size === allIds.length

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      const sid = String(id)
      if (next.has(sid)) next.delete(sid)
      else next.add(sid)
      return next
    })
  }
  function toggleAll() {
    setSelected((prev) => {
      if (allSelected) return new Set()
      return new Set(allIds)
    })
  }

  function handleBulkDelete() {
    if (selectedCount === 0) return
    const ids = Array.from(selected)
    onBulkDelete?.(ids, () => setSelected(new Set()))
  }

  return (
    <aside
      className={`notes-drawer ${open ? 'open' : 'closed'}`}
      aria-hidden={!open}
      data-open={open ? '1' : '0'}
    >
      {/* 头部：标题 + 副信息 + 关闭（缩起）按钮 */}
      <header className="notes-drawer-header">
        <div className="notes-drawer-title-wrap">
          <div className="notes-drawer-title-row">
            <span className="notes-drawer-title-dot" aria-hidden="true" />
            <h2 className="notes-drawer-title">笔记管理</h2>
          </div>
          <div className="notes-drawer-meta">
            <span className="notes-drawer-meta-count">
              {totalCount > 0 ? `${totalCount} 项标记` : '暂无'}
            </span>
            {bookTitle && (
              <>
                <span className="notes-drawer-meta-sep" aria-hidden="true">·</span>
                <span className="notes-drawer-meta-book" title={bookTitle}>
                  {bookTitle}
                </span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className="notes-drawer-close"
          onClick={onClose}
          title="收起抽屉（再次点击设置菜单里的「笔记管理」可重新打开）"
          aria-label="收起抽屉"
        >
          <CloseIcon size={15} strokeWidth={2.2} />
        </button>
      </header>

      {/* 主体：列表 */}
      <div className="notes-drawer-body">
        {totalCount === 0 ? (
          <div className="notes-drawer-empty">
            <span className="notes-drawer-empty-icon" aria-hidden="true">
              <Inbox size={28} strokeWidth={1.6} />
            </span>
            <p className="notes-drawer-empty-title">这本书还没有标记</p>
            <p className="notes-drawer-empty-hint">
              在正文中选中文字，即可添加高亮、划线、批注或笔记。
            </p>
          </div>
        ) : (
          <>
            {/* 顶部选择条 */}
            <div className="notes-drawer-toolbar">
              <button
                type="button"
                className={`notes-drawer-select-all ${allSelected ? 'is-on' : ''}`}
                onClick={toggleAll}
                aria-pressed={allSelected}
              >
                {allSelected ? (
                  <Check size={13} strokeWidth={2.6} />
                ) : (
                  <Square size={13} strokeWidth={1.6} />
                )}
                <span>{allSelected ? '取消全选' : '全选'}</span>
              </button>
              <span className="notes-drawer-selected-count">
                {selectedCount > 0 ? (
                  <>
                    已选 <strong>{selectedCount}</strong> 项
                  </>
                ) : (
                  <span className="notes-drawer-hint">
                    <CornerDownRight size={11} strokeWidth={2} />
                    点击行可定位到正文
                  </span>
                )}
              </span>
            </div>

            {/* 章节分组列表 */}
            <div className="notes-drawer-list">
              {groups.map((g) => (
                <ChapterSection
                  key={g.key}
                  group={g}
                  selected={selected}
                  onToggleSelect={toggleOne}
                  onJump={onJump}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* 底部：批量删除（仅在有选中时显示） */}
      {selectedCount > 0 && (
        <footer className="notes-drawer-footer">
          <button
            type="button"
            className="notes-drawer-bulk-delete"
            onClick={handleBulkDelete}
            title={`删除选中的 ${selectedCount} 项`}
          >
            <span className="notes-drawer-bulk-delete-pulse" aria-hidden="true" />
            <span>批量删除 {selectedCount} 项</span>
          </button>
        </footer>
      )}
    </aside>
  )
}
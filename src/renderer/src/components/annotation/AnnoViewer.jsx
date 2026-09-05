import { useEffect, useRef } from 'react'
import { getAnnotationMarkerColors } from '../../annotationColors'

// 标注 / 笔记 内容查看浮层（重新设计：美观 · 主题感知 · 结构清晰）
// - 头部：色块 + 类型（笔记/标注）+ 章节（淡色）
// - 引用：左侧带颜色的"竖线 + 浅底"，把选区原文以书法式引出
// - 正文：大字号、宽松行高，长文可滚动
// - 底部：删除按钮（危险色，hover 才显形）+ 抄录操作（占位）
// - 入场：与全局 popover 一致的 pop-in 动画
export default function AnnoViewer({ x, y, anno, onClose, onDelete, theme = 'light' }) {
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])

  const isNote = anno.type === 'note'
  const markerColors = getAnnotationMarkerColors(theme)

  // 类型主色：笔记/标注 用各自主题感知色
  const typeColor = isNote ? markerColors.note : markerColors.annotation
  // 类型中文
  const typeText = isNote ? '笔记' : '批注'
  // 类型 icon：根据类型切换
  const TypeIcon = isNote ? (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2v4" />
      <path d="M12 2v4" />
      <path d="M16 2v4" />
      <rect width="16" height="18" x="4" y="4" rx="2" />
      <path d="M8 10h6" />
      <path d="M8 14h8" />
      <path d="M8 18h5" />
    </svg>
  ) : (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="bookloft-popover bookloft-anno-viewer bookloft-anno-viewer--rich"
      data-anno-type={anno.type}
      style={{ left: x, top: y, '--anno-color': typeColor }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 顶部箭头：指向 marker（视觉上从 marker 引出浮层） */}
      <span className="bookloft-viewer-arrow" aria-hidden="true" />

      {/* 头部：色块 + 类型 chip + 章节 */}
      <header className="bookloft-viewer-header">
        <span
          className="bookloft-viewer-chip"
          style={{ backgroundColor: `${typeColor}1a`, color: typeColor, borderColor: `${typeColor}33` }}
        >
          {TypeIcon}
          <span>{typeText}</span>
        </span>
        {anno.chapterTitle && (
          <span className="bookloft-viewer-chapter" title={anno.chapterTitle}>
            {anno.chapterTitle}
          </span>
        )}
        <button
          type="button"
          className="bookloft-viewer-close"
          onClick={onClose}
          title="关闭"
          aria-label="关闭"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </header>

      {/* 引用块：左侧带颜色的竖条 + 浅底，引出选区原文 */}
      {anno.selectedText && (
        <blockquote className="bookloft-viewer-quote">
          <span className="bookloft-viewer-quote-bar" aria-hidden="true" />
          <p>{anno.selectedText}</p>
        </blockquote>
      )}

      {/* 正文：笔记 / 批注 内容。
          笔记用 <pre>（保留换行），批注用 <p>（纯文本） */}
      {anno.content && (
        <section className="bookloft-viewer-content">
          {isNote ? <pre>{anno.content}</pre> : <p>{anno.content}</p>}
        </section>
      )}

      {/* 底部：删除（仅在有 onDelete 时显示） */}
      {typeof onDelete === 'function' && (
        <footer className="bookloft-viewer-footer">
          <button
            type="button"
            className="bookloft-viewer-delete"
            onClick={onDelete}
            title="删除该标注"
            aria-label="删除该标注"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <span>删除</span>
          </button>
        </footer>
      )}
    </div>
  )
}

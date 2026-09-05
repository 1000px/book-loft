import { useEffect, useRef, useState } from 'react'

// Markdown 笔记编辑器：先用 textarea 顶上，等后续选定 markdown 编辑器再替换。
export default function NoteEditor({ x, y, onSave, onCancel }) {
  const [text, setText] = useState('')
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <div
      className="bookloft-popover bookloft-note-editor"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bookloft-pop-title">笔记（Markdown）</div>
      <textarea
        ref={ref}
        className="bookloft-pop-textarea"
        placeholder="# 标题…&#10;写下你的笔记…"
        value={text}
        rows={8}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            if (text.trim()) onSave(text.trim())
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
      <div className="bookloft-pop-actions">
        <button className="bookloft-pop-link" onClick={onCancel}>
          取消
        </button>
        <button
          className="bookloft-pop-primary"
          onClick={() => text.trim() && onSave(text.trim())}
          disabled={!text.trim()}
        >
          保存
        </button>
      </div>
      <div className="bookloft-pop-hint">Ctrl/⌘+Enter 保存</div>
    </div>
  )
}

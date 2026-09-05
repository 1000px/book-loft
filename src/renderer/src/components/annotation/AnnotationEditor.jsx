import { useEffect, useRef, useState } from 'react'

// 纯文本批注编辑器：单行/多行输入，浮在选中文本右侧。
export default function AnnotationEditor({ x, y, onSave, onCancel }) {
  const [text, setText] = useState('')
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <div
      className="bookloft-popover bookloft-annotation-editor"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <textarea
        ref={ref}
        className="bookloft-pop-textarea"
        placeholder="写下你的批注…"
        value={text}
        rows={2}
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

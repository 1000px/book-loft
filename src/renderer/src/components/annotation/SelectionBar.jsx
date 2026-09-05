import { Highlighter, Underline, MessageSquare, NotebookPen } from 'lucide-react'

// 初次选择文字后浮现的工具条：4 个图标。
// 由父组件传入位置 { x, y }（视口坐标），用 position: fixed 定位。
export default function SelectionBar({ x, y, onPick }) {
  const items = [
    { type: 'highlight',   icon: Highlighter,   label: '高亮' },
    { type: 'underline',   icon: Underline,     label: '划线' },
    { type: 'annotation',  icon: MessageSquare, label: '标注' },
    { type: 'note',        icon: NotebookPen,   label: '笔记' }
  ]
  return (
    <div
      className="bookloft-popover bookloft-selection-bar"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map(({ type, icon: Icon, label }) => (
        <button
          key={type}
          className="bookloft-pop-btn"
          onClick={() => onPick(type)}
          title={label}
          aria-label={label}
        >
          <Icon size={18} />
        </button>
      ))}
    </div>
  )
}

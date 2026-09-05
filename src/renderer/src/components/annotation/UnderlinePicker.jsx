import { getAnnotationPalette } from '../../annotationColors'

// 划线样式选择器：实线 / 虚线。两个按钮用下划线本身做图标，直观区分。
export default function UnderlinePicker({ x, y, theme, onPick, onCancel }) {
  const palette = getAnnotationPalette(theme)
  return (
    <div
      className="bookloft-popover bookloft-underline-options"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        className="bookloft-pop-btn bookloft-underline-demo"
        style={{ borderBottom: `2px solid ${palette.underlineSolid}` }}
        onClick={() => onPick('solid')}
        title="实线"
        aria-label="实线"
      >
        实线
      </button>
      <button
        className="bookloft-pop-btn bookloft-underline-demo"
        style={{ borderBottom: `2px dashed ${palette.underlineDashed}` }}
        onClick={() => onPick('dashed')}
        title="虚线"
        aria-label="虚线"
      >
        虚线
      </button>
      <button
        className="bookloft-pop-btn bookloft-pop-cancel"
        onClick={onCancel}
        title="取消"
        aria-label="取消"
      >
        ×
      </button>
    </div>
  )
}

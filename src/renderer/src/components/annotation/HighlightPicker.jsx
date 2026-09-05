import { getAnnotationPalette } from '../../annotationColors'

// 高亮颜色选择器：5 种主题色色块，悬浮在选中文本右下。
export default function HighlightPicker({ x, y, theme, onPick, onCancel }) {
  const palette = getAnnotationPalette(theme)
  return (
    <div
      className="bookloft-popover bookloft-color-swatches"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {palette.highlights.map((c) => (
        <button
          key={c.key}
          className="bookloft-swatch"
          style={{ background: c.bg, color: c.fg }}
          onClick={() => onPick(c)}
          title={`高亮 ${c.key.toUpperCase()}`}
          aria-label={`高亮 ${c.key.toUpperCase()}`}
        />
      ))}
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

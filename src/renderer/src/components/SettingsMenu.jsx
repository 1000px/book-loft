import { useEffect, useRef } from 'react'
import {
  Minus,
  Plus,
  BookOpen,
  ScrollText,
  FolderOpen,
  LogOut,
  RotateCcw,
  Wrench,
  Maximize,
  Expand,
  Shrink,
  NotebookPen
} from 'lucide-react'
import {
  THEME_ORDER,
  THEME_LABELS,
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX
} from '../config'

// 顶部设置图标的下拉菜单：主题配色 / 字体大小 / 阅读模式 / 打开文件 / 退出
export default function SettingsMenu({
  theme,
  onThemeChange,
  fontSize,
  onFontIncrease,
  onFontDecrease,
  onFontReset,
  mode,
  onModeChange,
  onOpenWorkingDir,
  onFixToc,
  onToggleNotes,
  notesOpen = false,
  onFullscreen,
  onToggleWindowFullscreen,
  windowFullscreen = false,
  onQuit,
  fixing,
  onClose
}) {
  const ref = useRef(null)

  // 点击菜单外部或按 Esc 关闭
  useEffect(() => {
    function onDocMouseDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose?.()
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const modeOptions = [
    { value: 'paginated', label: '分页', Icon: BookOpen },
    { value: 'scrolled-doc', label: '连续', Icon: ScrollText }
  ]

  return (
    <div className="settings-menu" ref={ref} role="menu">
      <div className="menu-section">
        <div className="menu-label">主题配色</div>
        <div className="theme-grid">
          {THEME_ORDER.map((t) => (
            <button
              key={t}
              className={`theme-option ${theme === t ? 'active' : ''}`}
              onClick={() => onThemeChange(t)}
              role="menuitemradio"
              aria-checked={theme === t}
            >
              <span className={`theme-swatch swatch-${t}`} aria-hidden="true" />
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="menu-section">
        <div className="menu-label">字体大小</div>
        <div className="font-row">
          <button
            className="round-btn"
            onClick={onFontDecrease}
            disabled={fontSize <= FONT_SIZE_MIN}
            title="缩小字体"
          >
            <Minus size={15} />
          </button>
          <span className="font-value">{fontSize}px</span>
          <button
            className="round-btn"
            onClick={onFontIncrease}
            disabled={fontSize >= FONT_SIZE_MAX}
            title="放大字体"
          >
            <Plus size={15} />
          </button>
          <button
            className="text-btn"
            onClick={onFontReset}
            disabled={fontSize === FONT_SIZE_DEFAULT}
            title="恢复默认字号"
          >
            <RotateCcw size={13} />
            默认
          </button>
        </div>
      </div>

      <div className="menu-section">
        <div className="menu-label">阅读模式</div>
        <div className="mode-row">
          {modeOptions.map(({ value, label, Icon }) => (
            <button
              key={value}
              className={`mode-option ${mode === value ? 'active' : ''}`}
              onClick={() => onModeChange(value)}
              role="menuitemradio"
              aria-checked={mode === value}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="menu-divider" />

      <button className="menu-item" onClick={() => { onOpenWorkingDir(); onClose?.() }} role="menuitem">
        <FolderOpen size={15} />
        打开工作目录
      </button>
      <button
        className="menu-item"
        onClick={() => { onFixToc(); onClose?.() }}
        disabled={fixing}
        role="menuitem"
        title={fixing ? '正在修正目录…' : '按正文实际标题重写目录，生成修复版'}
      >
        <Wrench size={15} />
        目录更正
      </button>
      <button
        className={`menu-item ${notesOpen ? 'active' : ''}`}
        onClick={() => { onToggleNotes?.(); onClose?.() }}
        disabled={!onToggleNotes}
        role="menuitem"
        title={onToggleNotes ? (notesOpen ? '收起笔记管理面板' : '查看当前书籍全部高亮/划线/批注/笔记，可批量删除或定位到正文') : '请先打开一本书'}
      >
        <NotebookPen size={15} />
        {notesOpen ? '收起笔记管理' : '笔记管理'}
      </button>
      <button
        className="menu-item"
        onClick={() => { onFullscreen?.(); onClose?.() }}
        role="menuitem"
        title="沉浸式阅读：隐藏顶栏与目录，整屏连续阅读（ESC 退出）"
      >
        <Maximize size={15} />
        全屏阅读
      </button>
      <button
        className="menu-item"
        onClick={() => { onToggleWindowFullscreen?.(); onClose?.() }}
        role="menuitem"
        title={windowFullscreen ? '还原为窗口模式' : '仅把窗口铺满整个屏幕，界面结构不变'}
      >
        {windowFullscreen ? <Shrink size={15} /> : <Expand size={15} />}
        {windowFullscreen ? '退出全屏' : '界面全屏'}
      </button>
      <button className="menu-item danger" onClick={() => { onQuit(); onClose?.() }} role="menuitem">
        <LogOut size={15} />
        退出
      </button>
    </div>
  )
}

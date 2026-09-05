import { useCallback, useState } from 'react'
import {
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ChevronLeft,
  ChevronRight,
  Home,
  Minus,
  Square,
  Copy,
  X
} from 'lucide-react'
import SettingsMenu from './SettingsMenu.jsx'

// 品牌区占位 logo（简笔书本图形）。TODO: 待正式设计稿完成后替换此处。
function LogoPlaceholder() {
  return (
    <svg
      className="brand-logo"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

// 顶部功能栏：左侧「logo + 应用名 + 目录切换图标 + 设置图标」，
// 右侧「上一页 / 下一页 + 书名章节 + 窗口控制（最小化/最大化/关闭）」
export default function Toolbar({
  tocOpen,
  onToggleToc,
  homeOpen,
  onToggleHome,
  theme,
  onThemeChange,
  fontSize,
  onFontIncrease,
  onFontDecrease,
  onFontReset,
  mode,
  onModeChange,
  onPrev,
  onNext,
  onOpenWorkingDir,
  onFixToc,
  onFullscreen,
  onToggleWindowFullscreen,
  windowFullscreen,
  onQuit,
  onMinimize,
  onToggleMaximize,
  maximized,
  fixing,
  location,
  loading,
  bookTitle,
  chapterTitle
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  // 仅分页模式允许前后翻页；连续滚动模式下翻页按钮无意义，直接禁用。
  // （连续滚动靠鼠标滚轮/章尾"下一章"按钮翻章，无需前后页按钮）
  const isPaginated = mode === 'paginated'
  const prevDisabled = loading || !isPaginated
  const nextDisabled = loading || !isPaginated

  // 目录展开时显示"收起"图标，收起时显示"展开"图标
  const TocIcon = tocOpen ? PanelLeftClose : PanelLeftOpen

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        {/* 品牌区：占位 logo + 应用名（非交互区域，可作窗口拖拽区） */}
        <div className="brand" title="BookLoft 书阁">
          <LogoPlaceholder />
          <span className="brand-name">书阁阅读器</span>
        </div>

        <button
          className="icon-btn"
          onClick={onToggleToc}
          title={tocOpen ? '收起目录' : '展开目录'}
          aria-label={tocOpen ? '收起目录' : '展开目录'}
        >
          <TocIcon size={18} />
        </button>

        <button
          className={`icon-btn ${homeOpen ? 'active' : ''}`}
          onClick={onToggleHome}
          title="图书馆主页"
          aria-label="图书馆主页"
          aria-pressed={homeOpen}
        >
          <Home size={18} />
        </button>

        <div className="settings-wrap">
          <button
            className={`icon-btn ${menuOpen ? 'active' : ''}`}
            onClick={() => setMenuOpen((v) => !v)}
            onMouseDown={(e) => e.stopPropagation()}
            title="设置"
            aria-label="设置"
            aria-expanded={menuOpen}
          >
            <Settings size={18} />
          </button>
          {menuOpen && (
            <SettingsMenu
              theme={theme}
              onThemeChange={onThemeChange}
              fontSize={fontSize}
              onFontIncrease={onFontIncrease}
              onFontDecrease={onFontDecrease}
              onFontReset={onFontReset}
              mode={mode}
              onModeChange={onModeChange}
              onOpenWorkingDir={onOpenWorkingDir}
              onFixToc={onFixToc}
              onFullscreen={onFullscreen}
              onToggleWindowFullscreen={onToggleWindowFullscreen}
              windowFullscreen={windowFullscreen}
              onQuit={onQuit}
              fixing={fixing}
              onClose={closeMenu}
            />
          )}
        </div>
      </div>

      <div className="toolbar-right">
        <button
          className="icon-btn"
          onClick={onPrev}
          disabled={prevDisabled}
          title="上一页 / 上一章 (←)"
          aria-label="上一页"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          className="icon-btn"
          onClick={onNext}
          disabled={nextDisabled}
          title="下一页 / 下一章 (→)"
          aria-label="下一页"
        >
          <ChevronRight size={20} />
        </button>

        {bookTitle && (
          <span className="now-reading" title={chapterTitle ? `《${bookTitle}》 - ${chapterTitle}` : `《${bookTitle}》`}>
            《{bookTitle}》
            {chapterTitle ? ` - ${chapterTitle}` : ''}
          </span>
        )}

        {/* 自绘窗口控制：最小化 / 最大化(恢复) / 关闭（无边框窗口） */}
        <div className="win-controls">
          <button
            className="win-btn"
            onClick={onMinimize}
            title="最小化"
            aria-label="最小化"
          >
            <Minus size={16} />
          </button>
          <button
            className="win-btn"
            onClick={onToggleMaximize}
            title={maximized ? '向下还原' : '最大化'}
            aria-label={maximized ? '向下还原' : '最大化'}
          >
            {maximized ? <Copy size={13} /> : <Square size={13} />}
          </button>
          <button
            className="win-btn close"
            onClick={onQuit}
            title="关闭"
            aria-label="关闭"
          >
            <X size={17} />
          </button>
        </div>
      </div>

      {/* 菜单展开时铺一层透明遮罩：覆盖整窗（含正文 iframe），
          点击任意位置即收起菜单，避免 iframe 内点击无法冒泡到父文档导致关不掉 */}
      {menuOpen && (
        <div
          className="menu-backdrop"
          onMouseDown={(e) => {
            e.stopPropagation()
            closeMenu()
          }}
        />
      )}
    </header>
  )
}

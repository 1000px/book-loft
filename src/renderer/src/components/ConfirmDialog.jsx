import { useEffect, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'

/**
 * 自定义确认弹框 —— 替代浏览器原生 confirm / alert。
 *
 * 视觉规格：
 *   - 标题栏固定显示品牌名 "Book Loft"（左侧 accent 圆点标识）
 *   - 内容区左侧为红色圆形感叹号图标，右侧为主提示 + 可选次要说明
 *   - 底部右对齐操作按钮：取消（次要）/ 确认（危险色实心）
 *   - alertOnly 模式只显示单个「知道了」按钮（用于错误提示）
 *
 * 交互：
 *   - ESC / 点击遮罩 / 点右上角 X = 取消
 *   - Enter = 确认
 *   - 打开后自动聚焦确认按钮，键盘用户可直接回车
 *
 * @param {boolean} open      是否显示
 * @param {string}  message   主提示文字
 * @param {string}  detail    次要说明（可选，弱化显示）
 * @param {string}  confirmText 确认按钮文案，默认「确认删除」
 * @param {string}  cancelText  取消按钮文案，默认「取消」
 * @param {boolean} alertOnly  true = 只显示一个按钮（alert 语义）
 * @param {Function} onConfirm 确认回调
 * @param {Function} onCancel  取消回调
 */
export default function ConfirmDialog({
  open,
  message,
  detail,
  confirmText = '确认删除',
  cancelText = '取消',
  alertOnly = false,
  onConfirm,
  onCancel
}) {
  const confirmBtnRef = useRef(null)

  // 打开时挂载键盘监听 + 自动聚焦确认按钮
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel?.()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm?.()
      }
    }
    document.addEventListener('keydown', onKey)
    // 聚焦延后一帧，等入场动画开始、元素已可聚焦
    const t = setTimeout(() => confirmBtnRef.current?.focus(), 60)
    return () => {
      document.removeEventListener('keydown', onKey)
      clearTimeout(t)
    }
  }, [open, onCancel, onConfirm])

  if (!open) return null

  return (
    <div
      className="confirm-overlay"
      // 只在点击遮罩本身时关闭，点对话框内部不关
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel?.()
      }}
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label="Book Loft"
      >
        {/* —— 标题栏：品牌标识 —— */}
        <div className="confirm-head">
          <div className="confirm-brand">
            <span className="confirm-brand-dot" aria-hidden="true" />
            <span className="confirm-brand-name">Book Loft</span>
          </div>
          <button
            type="button"
            className="confirm-close"
            onClick={onCancel}
            title="关闭"
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>

        {/* —— 内容：红色感叹号 + 提示文字 —— */}
        <div className="confirm-body">
          <div className="confirm-icon" aria-hidden="true">
            <AlertTriangle size={21} strokeWidth={2.2} />
          </div>
          <div className="confirm-text">
            <p className="confirm-message">{message}</p>
            {detail ? <p className="confirm-detail">{detail}</p> : null}
          </div>
        </div>

        {/* —— 操作按钮 —— */}
        <div className="confirm-actions">
          {!alertOnly && (
            <button
              type="button"
              className="confirm-btn confirm-btn-ghost"
              onClick={onCancel}
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            ref={confirmBtnRef}
            className={`confirm-btn ${
              alertOnly ? 'confirm-btn-primary' : 'confirm-btn-danger'
            }`}
            onClick={onConfirm}
          >
            {alertOnly ? '知道了' : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

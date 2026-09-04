import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, CornerLeftUp, Folder, Check, X } from 'lucide-react'

/**
 * 应用内目录选择器：替代系统原生"选择文件夹"对话框。
 * 全屏阅读时原生对话框会被 Windows 还原窗口、露出任务栏（各种遮罩方案均有闪现），
 * 改为应用内自绘界面后与窗口状态完全解耦，零闪现。
 */
export default function DirPicker({ open, onCancel, onPick, initialDir }) {
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const browse = useCallback(async (dir) => {
    setLoading(true)
    setError('')
    try {
      const res = await window.bookloftAPI.browseDirectory(dir)
      if (res?.error) {
        setError(res.error)
      } else {
        setInfo(res)
      }
      return res
    } catch (e) {
      setError(String(e?.message || e))
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // 打开时优先定位到上次的工作目录；目录已不存在（被删/改名）则回退根视图
  useEffect(() => {
    if (!open) return
    setInfo(null)
    setError('')
    if (initialDir) {
      browse(initialDir).then((res) => {
        if (res?.error && !res?.path) browse(null)
      })
    } else {
      browse(null)
    }
  }, [open, initialDir, browse])

  // ESC 关闭选择器；capture 阶段拦截，避免同键触发沉浸模式退出
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel?.()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onCancel])

  if (!open) return null

  const canConfirm = !!(info && info.path)

  return (
    <div
      className="dirpicker-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel?.()
      }}
    >
      <div className="dirpicker" role="dialog" aria-modal="true" aria-label="选择工作目录">
        <div className="dirpicker-head">
          <span className="dirpicker-title">选择工作目录</span>
          <button className="dirpicker-close" onClick={onCancel} title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="dirpicker-crumbs">
          <button
            className="dirpicker-up"
            disabled={!info?.parent || loading}
            onClick={() => browse(info.parent)}
            title="上一级"
          >
            <CornerLeftUp size={14} />
          </button>
          <div className="crumb-trail">
            {info?.crumbs?.length ? (
              info.crumbs.map((c, i) => (
                <span key={c.path} className="crumb-seg">
                  {i > 0 && <ChevronRight size={12} className="crumb-sep" />}
                  <button className="crumb" onClick={() => browse(c.path)} disabled={loading}>
                    {c.name}
                  </button>
                </span>
              ))
            ) : (
              <span className="crumb-plain">{info?.name || ''}</span>
            )}
          </div>
        </div>

        <div className="dirpicker-list">
          {loading && <div className="dirpicker-hint">读取中…</div>}
          {!loading && error && <div className="dirpicker-hint error">{error}</div>}
          {!loading && !error && info?.dirs?.length === 0 && (
            <div className="dirpicker-hint">此目录下没有子文件夹</div>
          )}
          {!loading && !error && info?.dirs?.map((d) => (
            <button key={d.path} className="dir-row" onClick={() => browse(d.path)} disabled={loading}>
              <Folder size={15} className="dir-icon" />
              <span className="dir-name">{d.name}</span>
              <ChevronRight size={13} className="dir-go" />
            </button>
          ))}
        </div>

        <div className="dirpicker-foot">
          <span className="dirpicker-current" title={info?.path || ''}>
            {info?.path ? info.path : '请选择目录'}
          </span>
          <button className="dirpicker-btn" onClick={onCancel}>
            取消
          </button>
          <button
            className="dirpicker-btn primary"
            disabled={!canConfirm || loading}
            onClick={() => canConfirm && onPick?.(info.path)}
          >
            <Check size={14} />
            选择此目录
          </button>
        </div>
      </div>
    </div>
  )
}

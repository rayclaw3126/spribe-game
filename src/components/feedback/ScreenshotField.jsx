// 截图多图上传字段 —— 照抄 vendor 的 ScreenshotField，改用前台 shell/tokens.js 配色。
// 多张累加 + 点击/拖拽 + 缩略图预览 + 删单张。纯前端预览(URL.createObjectURL)，不发后端。
import { useRef, useState } from 'react'
import { COLORS, RADIUS, SPACE } from '../shell/tokens.js'

function PhotoIcon({ color }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M15 8h.01" />
      <path d="M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12z" />
      <path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5" />
      <path d="M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3" />
    </svg>
  )
}

// 单张缩略图 + 右上角 × 删除（danger 色）。
function Thumb({ url, onRemove }) {
  return (
    <div style={{ position: 'relative', width: 72, height: 72 }}>
      <img
        src={url}
        alt="截图预览"
        style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: `1px solid ${COLORS.border}` }}
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label="移除这张截图"
        style={{
          position: 'absolute',
          top: -7,
          right: -7,
          width: 20,
          height: 20,
          borderRadius: 999,
          background: COLORS.redDark,
          color: COLORS.white,
          border: `1px solid ${COLORS.panel}`,
          fontSize: 13,
          lineHeight: 1,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ×
      </button>
    </div>
  )
}

export default function ScreenshotField({ shots, onAdd, onRemove }) {
  const inputRef = useRef(null)
  const [hover, setHover] = useState(false)

  function handleInput(e) {
    onAdd(e.target.files)
    e.target.value = '' // 清空以便再选同一文件也能触发
  }
  function handleDrop(e) {
    e.preventDefault()
    setHover(false)
    onAdd(e.dataTransfer.files)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, color: COLORS.textMuted }}>截图</span>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setHover(true)
        }}
        onDragLeave={() => setHover(false)}
        onDrop={handleDrop}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: SPACE.sm,
          padding: '16px 12px',
          border: `1px dashed ${hover ? COLORS.green : COLORS.border}`,
          borderRadius: RADIUS.input,
          color: hover ? COLORS.text : COLORS.textFaint,
          background: COLORS.surface,
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        <PhotoIcon color={hover ? COLORS.text : COLORS.textFaint} />
        <span>点击或拖拽图片（可多张）</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleInput}
        style={{ display: 'none' }}
      />
      {shots.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.md, marginTop: 4 }}>
          {shots.map((s) => (
            <Thumb key={s.id} url={s.url} onRemove={() => onRemove(s.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

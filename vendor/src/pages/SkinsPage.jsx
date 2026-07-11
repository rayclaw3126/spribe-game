// 换肤配置台（本单纯 UI + 假数据，不接后端）。页头/下拉照 MerchantsPage 深蓝专业风。
// 选商家 → 高亮其当前皮肤；选皮肤卡 → 预览区套该主色；「保存皮肤」本单先留空。
import { useState } from 'react'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { MERCHANTS_FAKE } from '../data/merchants.js'
import { SKIN_OPTIONS, SKIN_COLORS } from '../data/skins.js'

// 各商家当前皮肤（复用商家列表假数据）。
const MERCHANT_SKIN = Object.fromEntries(MERCHANTS_FAKE.map((m) => [m.name, m.skin]))

const selectStyle = {
  padding: '9px 12px',
  fontSize: 13.5,
  color: COLORS.text,
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADIUS.sm,
  outline: 'none',
  cursor: 'pointer',
}

function PageHeader({ merchant, onMerchant }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: SPACE.md }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: COLORS.text }}>换肤配置台</h1>
        <p style={{ margin: '6px 0 0', fontSize: 13.5, color: COLORS.textMuted }}>
          为各商家挑选并预览皮肤主题（示例数据）
        </p>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
        <span style={{ fontSize: 13, color: COLORS.textMuted }}>配置商家</span>
        <select value={merchant} onChange={(e) => onMerchant(e.target.value)} style={selectStyle}>
          {MERCHANTS_FAKE.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

// 单张皮肤卡：主色块 + 皮肤名 + 选中态（打勾高亮）。
function SkinCard({ name, selected, onSelect }) {
  const color = SKIN_COLORS[name]
  return (
    <button
      type="button"
      onClick={() => onSelect(name)}
      style={{
        flex: '1 1 150px',
        minWidth: 150,
        textAlign: 'left',
        background: COLORS.panel,
        border: `1px solid ${selected ? COLORS.primary : COLORS.border}`,
        borderRadius: RADIUS.md,
        padding: SPACE.md,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: SPACE.sm,
      }}
    >
      <div style={{ height: 56, borderRadius: RADIUS.sm, background: color }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: COLORS.text }}>{name}</span>
        {selected && <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.primary }}>✓ 已选</span>}
      </div>
    </button>
  )
}

// 预览区：套选中皮肤主色的小 mock（顶栏 + 按钮 + 卡片）。
function PreviewMock({ skin }) {
  const color = SKIN_COLORS[skin]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>皮肤预览 · {skin}</span>
      <div style={{ maxWidth: 380, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.md, overflow: 'hidden', background: COLORS.bg }}>
        <div style={{ height: 40, background: color, display: 'flex', alignItems: 'center', gap: 8, padding: `0 ${SPACE.md}px` }}>
          <span style={{ width: 18, height: 18, borderRadius: 5, background: 'rgba(255,255,255,0.9)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.white }}>商家大厅</span>
        </div>
        <div style={{ padding: SPACE.lg, display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.sm, padding: SPACE.md }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, marginBottom: 6 }}>游戏卡片</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted }}>示意内容 · 套用当前皮肤主色</div>
          </div>
          <button type="button" style={{ alignSelf: 'flex-start', padding: '8px 18px', fontSize: 13, fontWeight: 600, color: COLORS.white, background: color, border: 'none', borderRadius: RADIUS.sm, cursor: 'default' }}>
            主按钮
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SkinsPage() {
  const [merchant, setMerchant] = useState(MERCHANTS_FAKE[0].name)
  const [skin, setSkin] = useState(MERCHANT_SKIN[MERCHANTS_FAKE[0].name])

  // 切商家：皮肤重置为该商家当前皮肤。
  function pickMerchant(next) {
    setMerchant(next)
    setSkin(MERCHANT_SKIN[next] || SKIN_OPTIONS[0])
  }

  const currentSkin = MERCHANT_SKIN[merchant]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 1040 }}>
      <PageHeader merchant={merchant} onMerchant={pickMerchant} />

      <div style={{ fontSize: 12.5, color: COLORS.textFaint }}>
        {merchant} 当前皮肤：<strong style={{ color: COLORS.textMuted }}>{currentSkin}</strong>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.md }}>
        {SKIN_OPTIONS.map((s) => (
          <SkinCard key={s} name={s} selected={skin === s} onSelect={setSkin} />
        ))}
      </div>

      <PreviewMock skin={skin} />

      <div>
        <button
          type="button"
          onClick={() => {}}
          disabled={skin === currentSkin}
          style={{
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 600,
            color: COLORS.white,
            background: skin === currentSkin ? COLORS.slate : COLORS.primary,
            border: 'none',
            borderRadius: RADIUS.sm,
            cursor: skin === currentSkin ? 'default' : 'pointer',
          }}
        >
          保存皮肤
        </button>
      </div>
    </div>
  )
}

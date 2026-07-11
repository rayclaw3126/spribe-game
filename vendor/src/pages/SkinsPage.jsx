// 换肤配置台（接后端）。商家/当前皮肤来自 /tenants；选皮肤卡 → 预览套主色；
// 「保存皮肤」→ PATCH /tenants/:id {skin}（复用 patchTenant），成功 toast + 该商家当前皮肤更新、保存钮回禁用。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { SKIN_OPTIONS, SKIN_COLORS } from '../data/skins.js'
import { listTenants, patchTenant } from '../api/client.js'
import { useToast } from '../state/ToastContext.jsx'
import EmptyState from '../components/EmptyState.jsx'

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

function PageHeader({ tenants, selectedId, onSelect }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: SPACE.md }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: COLORS.text }}>换肤配置台</h1>
        <p style={{ margin: '6px 0 0', fontSize: 13.5, color: COLORS.textMuted }}>为各商家挑选并预览皮肤主题</p>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
        <span style={{ fontSize: 13, color: COLORS.textMuted }}>配置商家</span>
        <select value={selectedId} onChange={(e) => onSelect(e.target.value)} style={selectStyle}>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
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
  const { push } = useToast()
  const [tenants, setTenants] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [skin, setSkin] = useState(SKIN_OPTIONS[0])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // 拉真商家，默认选第一个并预填其皮肤。
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await listTenants()
      const items = r.items || []
      setTenants(items)
      if (items.length) {
        setSelectedId(String(items[0].id))
        setSkin(items[0].skin || SKIN_OPTIONS[0])
      }
    } catch (err) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const current = useMemo(() => tenants.find((t) => String(t.id) === String(selectedId)), [tenants, selectedId])
  const currentSkin = current?.skin

  // 切商家：皮肤预填为该商家真实当前皮肤。
  function pickMerchant(id) {
    setSelectedId(id)
    const t = tenants.find((x) => String(x.id) === String(id))
    setSkin(t?.skin || SKIN_OPTIONS[0])
  }

  const dirty = Boolean(current) && skin !== currentSkin
  const disabled = saving || !dirty

  async function handleSave() {
    if (disabled) return
    setSaving(true)
    try {
      await patchTenant(selectedId, { skin })
      // 本地更新该商家 skin → currentSkin=skin → dirty 归零、保存钮回禁用；切走再回也在。
      setTenants((prev) => prev.map((t) => (String(t.id) === String(selectedId) ? { ...t, skin } : t)))
      push('皮肤已保存', 'success')
    } catch (err) {
      push(err.message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 1040 }}>
        <EmptyState text="加载中…" />
      </div>
    )
  }
  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 1040 }}>
        <EmptyState text={error} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 1040 }}>
      <PageHeader tenants={tenants} selectedId={selectedId} onSelect={pickMerchant} />

      <div style={{ fontSize: 12.5, color: COLORS.textFaint }}>
        {current?.name} 当前皮肤：<strong style={{ color: COLORS.textMuted }}>{currentSkin || '—'}</strong>
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
          onClick={handleSave}
          disabled={disabled}
          style={{
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 600,
            color: COLORS.white,
            background: disabled ? COLORS.slate : COLORS.primary,
            border: 'none',
            borderRadius: RADIUS.sm,
            cursor: disabled ? 'default' : 'pointer',
          }}
        >
          {saving ? '保存中…' : '保存皮肤'}
        </button>
      </div>
    </div>
  )
}

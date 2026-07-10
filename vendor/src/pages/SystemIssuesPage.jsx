// 系统问题页（本单核心）：测试员提交的问题永久留档，可搜索追源。
// 全前端假数据：tab 过滤 / 搜索 / 优先级筛选 / 状态改写 / 提交插入 都在内存里做，不请求后端。
import { useMemo, useState } from 'react'
import { COLORS, SPACE } from '../theme/tokens.js'
import { ISSUES, STATUS_TABS } from '../data/issues.js'
import { CURRENT_USER } from '../data/session.js'
import IssueRow from '../components/issues/IssueRow.jsx'
import { StatusTabs, FilterRow, Pagination } from '../components/issues/IssueControls.jsx'
import SubmitIssueModal from '../components/SubmitIssueModal.jsx'
import EmptyState from '../components/EmptyState.jsx'

function countByStatus(issues) {
  const counts = { all: issues.length }
  for (const tab of STATUS_TABS) {
    if (tab.key === 'all') continue
    counts[tab.key] = issues.filter((i) => i.status === tab.key).length
  }
  return counts
}

function filterIssues(issues, { tab, search, priority }) {
  const q = search.trim().toLowerCase()
  return issues.filter((i) => {
    if (tab !== 'all' && i.status !== tab) return false
    if (priority !== 'all' && i.priority !== priority) return false
    if (q && !(`${i.title} ${i.desc}`.toLowerCase().includes(q))) return false
    return true
  })
}

function PageHeader({ onOpenSubmit }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE.md }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: COLORS.text }}>系统问题</h1>
        <p style={{ margin: '6px 0 0', fontSize: 13.5, color: COLORS.textMuted }}>
          测试员提交的问题永久留档，可搜索追源
        </p>
      </div>
      <button
        type="button"
        onClick={onOpenSubmit}
        style={{
          padding: '9px 16px',
          fontSize: 13.5,
          fontWeight: 600,
          color: COLORS.white,
          background: COLORS.primary,
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        + 提交问题
      </button>
    </div>
  )
}

let insertSeq = ISSUES.length

function makeIssue({ title, desc, priority, merchant }) {
  insertSeq += 1
  return {
    id: String(insertSeq).padStart(4, '0'),
    status: 'new',
    priority,
    title,
    desc: desc || '（提交人未填写描述）',
    reporter: CURRENT_USER,
    time: '刚刚',
    source: { merchant, game: '—', player: '—' },
  }
}

export default function SystemIssuesPage() {
  const [issues, setIssues] = useState(ISSUES)
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)

  const counts = useMemo(() => countByStatus(issues), [issues])
  const visible = useMemo(() => filterIssues(issues, { tab, search, priority }), [issues, tab, search, priority])

  function setStatus(id, status) {
    setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)))
  }

  function addIssue(form) {
    setIssues((prev) => [makeIssue(form), ...prev])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 1040 }}>
      <PageHeader onOpenSubmit={() => setModalOpen(true)} />
      <StatusTabs active={tab} counts={counts} onChange={setTab} />
      <FilterRow search={search} onSearch={setSearch} priority={priority} onPriority={setPriority} />

      {visible.length === 0 ? (
        <EmptyState text="没有符合条件的问题" />
      ) : (
        <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: 'hidden' }}>
          {visible.map((issue) => (
            <IssueRow key={issue.id} issue={issue} onSetStatus={setStatus} />
          ))}
        </div>
      )}

      <Pagination total={visible.length} />

      {modalOpen && <SubmitIssueModal onClose={() => setModalOpen(false)} onSubmit={addIssue} />}
    </div>
  )
}

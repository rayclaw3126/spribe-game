// 系统问题页（接后端 /issues）：列表 GET /issues(status/q/分页)，展开 GET /issues/:id，
// 改状态 PATCH /issues/:id，提交 POST /issues + 传图。状态 tab 计数各查一次 total。
// 优先级为前端筛选（后端 GET 无优先级参数），只作用于当前页返回项。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { COLORS, SPACE } from '../theme/tokens.js'
import { STATUS_TABS } from '../data/issues.js'
import { listIssues, patchIssue } from '../api/client.js'
import { useToast } from '../state/ToastContext.jsx'
import IssueRow from '../components/issues/IssueRow.jsx'
import { StatusTabs, FilterRow, Pagination } from '../components/issues/IssueControls.jsx'
import SubmitIssueModal from '../components/SubmitIssueModal.jsx'
import EmptyState from '../components/EmptyState.jsx'

const PAGE_SIZE = 20

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

// 各 tab 计数：对每个状态各查一次（pageSize=1 只取 total）。
async function fetchCounts() {
  const results = await Promise.all(
    STATUS_TABS.map((tab) =>
      listIssues({ status: tab.key, pageSize: 1 }).then((r) => [tab.key, r.total]).catch(() => [tab.key, 0])
    )
  )
  return Object.fromEntries(results)
}

export default function SystemIssuesPage() {
  const { push } = useToast()
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [priority, setPriority] = useState('all')
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)

  // 搜索防抖：输入停 300ms 才打后端。
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // 换 tab / 改搜索 → 回到第 1 页。
  useEffect(() => { setPage(1) }, [tab, debounced])

  const loadList = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await listIssues({ status: tab, q: debounced, page, pageSize: PAGE_SIZE })
      setItems(r.items)
      setTotal(r.total)
    } catch (err) {
      setError(err.message || '加载失败')
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [tab, debounced, page])

  const loadCounts = useCallback(async () => {
    setCounts(await fetchCounts())
  }, [])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => { loadCounts() }, [loadCounts])

  async function setStatus(id, status) {
    try {
      await patchIssue(id, { status })
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)))
      push('状态已更新', 'success')
      loadCounts()
    } catch (err) {
      push(err.message || '更新失败', 'error')
    }
  }

  function handleSubmitted() {
    setModalOpen(false)
    push('问题已提交', 'success')
    loadList()
    loadCounts()
  }

  // 优先级前端筛（作用于当前页返回项）。
  const visible = useMemo(
    () => (priority === 'all' ? items : items.filter((i) => i.priority === priority)),
    [items, priority]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, maxWidth: 1040 }}>
      <PageHeader onOpenSubmit={() => setModalOpen(true)} />
      <StatusTabs active={tab} counts={counts} onChange={setTab} />
      <FilterRow search={search} onSearch={setSearch} priority={priority} onPriority={setPriority} />

      {error ? (
        <EmptyState text={error} />
      ) : loading ? (
        <EmptyState text="加载中…" />
      ) : visible.length === 0 ? (
        <EmptyState text="没有符合条件的问题" />
      ) : (
        <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: 'hidden' }}>
          {visible.map((issue) => (
            <IssueRow key={issue.id} issue={issue} onSetStatus={setStatus} />
          ))}
        </div>
      )}

      <Pagination total={total} page={page} pageSize={PAGE_SIZE} onPage={setPage} />

      {modalOpen && <SubmitIssueModal onClose={() => setModalOpen(false)} onSubmitted={handleSubmitted} />}
    </div>
  )
}

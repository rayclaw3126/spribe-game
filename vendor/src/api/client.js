// 统一网络层（照抄 admin/api/client.js 风格）—— 组件禁止裸 fetch，一律走这里。
//  1. 自动带 Authorization: Bearer <token> + JSON
//  2. 非 2xx：解析 body.error 抛出中文 Error（err.message / err.status）
//  3. 401：清 token 跳 /login（登录接口本身的 401 交调用方展示，skipAuthRedirect）
//  4. 全程参数化：查询串用 URLSearchParams，路径参数 encodeURIComponent，绝不裸拼
import { getToken, clearAuth } from '../auth/authStore.js'

async function request(path, { method = 'GET', body, skipAuthRedirect = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    const err = new Error('网络请求失败，请检查后端服务是否已启动')
    err.status = 0
    throw err
  }

  let data = null
  const text = await res.text()
  if (text) {
    try { data = JSON.parse(text) } catch { data = null }
  }

  if (!res.ok) {
    const err = new Error((data && data.error) || `请求失败（${res.status}）`)
    err.status = res.status
    if (res.status === 401 && !skipAuthRedirect && window.location.pathname !== '/login') {
      clearAuth()
      window.location.href = '/login'
    }
    throw err
  }
  return data
}

// multipart 上传：不走 request()（那边强制 JSON），单独一份，复用同款 token/401 处理。
async function requestForm(path, formData) {
  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetch(path, { method: 'POST', headers, body: formData })
  } catch {
    const err = new Error('网络请求失败，请检查后端服务是否已启动')
    err.status = 0
    throw err
  }

  let data = null
  const text = await res.text()
  if (text) {
    try { data = JSON.parse(text) } catch { data = null }
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `请求失败（${res.status}）`)
    err.status = res.status
    if (res.status === 401 && window.location.pathname !== '/login') {
      clearAuth()
      window.location.href = '/login'
    }
    throw err
  }
  return data
}

// 后端源站：dev 留空走同源 vite proxy(/uploads 已转发)；prod 若前后端不同域，
// 设 VITE_API_ORIGIN 为后端完整地址，图片 <img src> 拼成完整后端 URL。
export const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || ''

export function imageUrl(url) {
  return `${API_ORIGIN}${url}`
}

export function login(username, password) {
  return request('/auth/login', {
    method: 'POST',
    body: { username, password, type: 'agent' },
    skipAuthRedirect: true,
  })
}

// ---- 系统问题 / 反馈 ----
// 列表：status 过滤 + q 搜索 + 分页。参数用 URLSearchParams 组装，绝不手拼。
export function listIssues({ status, q, page = 1, pageSize = 20 } = {}) {
  const params = new URLSearchParams()
  if (status && status !== 'all') params.set('status', status)
  if (q) params.set('q', q)
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  return request(`/issues?${params.toString()}`)
}

export function getIssue(id) {
  return request(`/issues/${encodeURIComponent(id)}`)
}

export function createIssue(payload) {
  return request('/issues', { method: 'POST', body: payload })
}

export function patchIssue(id, patch) {
  return request(`/issues/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
}

export function uploadIssueImages(issueId, files) {
  const form = new FormData()
  for (const f of files) form.append('images', f)
  return requestForm(`/issues/${encodeURIComponent(issueId)}/images`, form)
}

// ---- 白标商家 tenants ----
export function listTenants() {
  return request('/tenants')
}

export function createTenant(payload) {
  return request('/tenants', { method: 'POST', body: payload })
}

export function patchTenant(id, patch) {
  return request(`/tenants/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
}

// ---- 全平台看板 ----
export function getDashboardStats() {
  return request('/dashboard/stats')
}

// ---- 平台费流水 ----
export function getFees({ tenantId, range } = {}) {
  const params = new URLSearchParams()
  if (tenantId && tenantId !== 'all') params.set('tenant_id', tenantId)
  if (range) params.set('range', range)
  return request(`/fees/list?${params.toString()}`)
}

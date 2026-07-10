// 统一网络层 —— 任何页面/组件禁止裸 fetch，一律走这里。
// 职责：
//  1. 自动带 Authorization: Bearer <token> + Content-Type: application/json
//  2. 非 2xx 响应：解析 body.error，抛出带中文消息的 Error（err.message / err.status）
//  3. 401（登录已过期/凭证无效）：清本地 token 并跳转 /login —— 但登录接口本身的
//     401（用户名或密码错误）不属于此类，不应清空/跳转，交给调用方（LoginPage）展示。
import { getToken, clearAuth } from '../auth/authStore.js'

async function request(path, { method = 'GET', body, skipAuthRedirect = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

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
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!res.ok) {
    const message = (data && data.error) || `请求失败（${res.status}）`
    const err = new Error(message)
    err.status = res.status

    if (res.status === 401 && !skipAuthRedirect) {
      clearAuth()
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    throw err
  }

  return data
}

// 后端源站：dev 留空走同源 vite proxy(/uploads 已转发)；prod 若前后端不同域，
// 设 VITE_API_ORIGIN 为后端完整地址，图片 <img src> 会拼成完整后端 URL。
export const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || ''

// 把后端返回的相对 url（/uploads/issues/xx.png）拼成可直接 <img src> 的地址。
export function imageUrl(url) {
  return `${API_ORIGIN}${url}`
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

// ---- 系统问题 / 反馈 ----
export function createIssue(payload) {
  return request('/issues', { method: 'POST', body: payload })
}

export function uploadIssueImages(issueId, files) {
  const form = new FormData()
  for (const f of files) form.append('images', f)
  return requestForm(`/issues/${encodeURIComponent(issueId)}/images`, form)
}

export function login(username, password) {
  return request('/auth/login', {
    method: 'POST',
    body: { username, password, type: 'agent' },
    skipAuthRedirect: true,
  })
}

export function getTree() {
  return request('/agent/tree')
}

export function getDownline() {
  return request('/agent/downline')
}

export function getMe() {
  return request('/agent/me')
}

export function createAgent(username, password, role) {
  return request('/agent/create', { method: 'POST', body: { username, password, role } })
}

export function grantCredit(toAgent, amount) {
  return request('/agent/credit/grant', { method: 'POST', body: { toAgent, amount } })
}

export function reclaimCredit(fromAgent, amount) {
  return request('/agent/credit/reclaim', { method: 'POST', body: { fromAgent, amount } })
}

export function setCommissionConfig(agentId, winLossPct, turnoverPct) {
  return request('/agent/commission/config', {
    method: 'POST',
    body: { agentId, winLossPct, turnoverPct },
  })
}

export function deposit(playerId, amount, idempotencyKey) {
  return request('/agent/player/deposit', { method: 'POST', body: { playerId, amount, idempotencyKey } })
}

export function withdraw(playerId, amount, idempotencyKey) {
  return request('/agent/player/withdraw', { method: 'POST', body: { playerId, amount, idempotencyKey } })
}

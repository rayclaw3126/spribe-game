// 玩家侧后端调用统一封装（#10）。
// 一处收口：Bearer 鉴权 / 401→登出 / 错误 throw（带 err.data）/ balanceAfter 自动回写 / 幂等键 / WS 拼法。
// 替掉 19 款游戏里复制粘贴的 apiPost 与裸 fetch。
//
// 用法：
//   const api = usePlayerApi({ playerToken, onLogout, setServerBalance })
//   const data = await api.apiPlay(G.backendId, { amount, ... })      // 一次性下注
//   const data = await api.apiPost('/round/'+G.backendId+'/start', {}) // 多步游戏
//   const ws   = new WebSocket(api.wsUrl(G.backendId, playerToken))    // WS 两款
//
// 错误约定：
//   - 服务端业务错（4xx/5xx 带 body）→ throw Error(data.error || '请求失败，请重试')，且 err.data = 响应体
//   - 401 → 先 onLogout()，再 throw（err.data 携带响应体，若有）
//   - 网络层异常（fetch reject，断网/超时）→ 原样抛出 fetch 的错误（无 err.data）
//   调用方据 `err.data` 是否存在区分「服务端错（显 err.data.error）」与「网络异常」。

import { useMemo } from 'react'

export function createPlayerApi({ playerToken, onLogout, setServerBalance }) {
  // opts.autoBalance=false：跳过自动余额回写，原样返回 data，由调用方在合适时机（如落地动画回调）手动写。
  async function apiPost(path, body, { autoBalance = true } = {}) {
    // 网络层异常直接冒泡（无 err.data），交给调用方区分「网络异常」文案
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${playerToken}` },
      body: JSON.stringify(body),
    })
    let data = null
    try { data = await resp.json() } catch { /* 无 JSON body（如 204） */ }

    if (resp.status === 401) {
      onLogout?.()
      const err = new Error(data?.error || '登录已失效，请重新登录')
      err.data = data
      throw err
    }
    if (!resp.ok) {
      const err = new Error(data?.error || '请求失败，请重试')
      err.data = data
      throw err
    }

    // 余额只认后端 balanceAfter，自动回写（消灭各款手动 setServerBalance）；
    // 有落地动画的游戏可传 autoBalance:false 关掉，改在动画回调里手动写。
    if (autoBalance && data && data.balanceAfter != null) setServerBalance(Number(data.balanceAfter))
    return data
  }

  // 幂等键：crypto.randomUUID 优先，兜底 `${prefix}-<ts>-<rand>`
  function genIdemKey(prefix) {
    return crypto.randomUUID ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random()}`
  }

  // 一次性下注便捷式：POST /round/<backendId>/play，自动带 idempotencyKey
  function apiPlay(backendId, body, opts) {
    return apiPost(`/round/${backendId}/play`, { ...body, idempotencyKey: genIdemKey(backendId) }, opts)
  }

  // WS 拼法收口（照抄 Aviator/Momentum 现值：${proto}://${host}/ws/<id>?token=）
  function wsUrl(backendId, token) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${window.location.host}/ws/${backendId}?token=${encodeURIComponent(token)}`
  }

  return { apiPost, apiPlay, genIdemKey, wsUrl }
}

export function usePlayerApi({ playerToken, onLogout, setServerBalance }) {
  return useMemo(
    () => createPlayerApi({ playerToken, onLogout, setServerBalance }),
    [playerToken, onLogout, setServerBalance],
  )
}

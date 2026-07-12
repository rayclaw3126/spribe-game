// Global BGM manager — module-level singleton, deliberately outside React so
// StrictMode double-mounting can never create a second Audio instance.
// One Audio for the whole site; games and the header share it via useBgm().

import { useSyncExternalStore } from 'react'

// bgm.mp3（2.3MB）放 public/ 按 URL 引用，不打进 bundle：既不进大厅首屏，也不重复进各 game chunk。
const audio = new Audio('/bgm.mp3')
audio.loop = true
audio.volume = 0.25   // quiet — stays under the per-game WebAudio SFX
// 2.3MB 的 mp3：安卓 Chrome 常把隐式 preload 降级成 none，首次手势时零缓冲 → play() 直接 reject。
// 显式 preload + load() 让它在首次手势前就开始缓冲。
audio.preload = 'auto'
audio.load()

// 解码/网络失败以前被静默吞掉，按钮亮着却没声音且无从排查。
audio.addEventListener('error', () => {
  const err = audio.error
  console.warn('[bgm] audio 加载失败:', err?.code, err?.message || '', audio.currentSrc)
})

let on = true         // master switch, defaults to ON; not persisted
let pending = false   // 一次 play() 在途，避免同一次触摸的多个事件重复抢播
// 注：不再另设 unlocked 标志——手势监听在播成功后才拆，"监听是否还在"就是唯一状态。

const listeners = new Set()
function emit() { listeners.forEach(cb => cb()) }

// 安卓 Chrome 对 touch 可能要到 pointerup/touchend 才授予 user activation，
// 只听 pointerdown 会拿不到激活 → play() 被拒。四种手势任一都试播。
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown']
function armGestures() { GESTURES.forEach(t => window.addEventListener(t, unlock, { passive: true })) }
function disarmGestures() { GESTURES.forEach(t => window.removeEventListener(t, unlock)) }

// 只有 play() 真的 resolve 了才 latch + 拆监听；被拒则保留监听，下次手势重试。
function tryPlay() {
  if (pending) return
  pending = true
  audio.play().then(() => {
    pending = false
    disarmGestures()
  }).catch(err => {
    pending = false
    console.warn('[bgm] play() 被拒，保留手势监听等待下次重试:', err?.name, err?.message || '')
  })
}

function unlock() {
  if (!on) return              // 用户关了音乐：不抢播，但监听留着，等他再打开
  if (!audio.paused) {         // 已经在响 → 收尾拆监听
    disarmGestures()
    return
  }
  tryPlay()
}
armGestures()

export function isOn() { return on }

export function toggle() {
  on = !on
  // 点按钮本身就是一次用户手势：直接试播，不再要求先被 unlock 过
  // （旧写法在首播失败后会让这个按钮变成哑巴）。
  if (on) tryPlay()
  else audio.pause()  // pause only — keep currentTime so ON resumes, not restarts
  emit()
}

export function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useBgm() {
  const bgmOn = useSyncExternalStore(subscribe, isOn)
  return [bgmOn, toggle]
}

// ---- 全局 SFX 静音（各游戏 WebAudio 合成器共用一个开关，跨游戏同步；同 useBgm 模式）----
let sfxMuted = false
const sfxListeners = new Set()

export function isSfxMuted() { return sfxMuted }

export function toggleSfxMuted() {
  sfxMuted = !sfxMuted
  sfxListeners.forEach(cb => cb())
}

export function subscribeSfx(cb) {
  sfxListeners.add(cb)
  return () => sfxListeners.delete(cb)
}

export function useSfxMuted() {
  const muted = useSyncExternalStore(subscribeSfx, isSfxMuted)
  return [muted, toggleSfxMuted]
}

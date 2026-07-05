// Global BGM manager — module-level singleton, deliberately outside React so
// StrictMode double-mounting can never create a second Audio instance.
// One Audio for the whole site; games and the header share it via useBgm().

import { useSyncExternalStore } from 'react'
import bgmUrl from '../../assets/covers/bgm.mp3'

const audio = new Audio(bgmUrl)
audio.loop = true
audio.volume = 0.25   // quiet — stays under the per-game WebAudio SFX

let on = true         // master switch, defaults to ON; not persisted
let unlocked = false  // browser autoplay policy: no play() before a user gesture

const listeners = new Set()
function emit() { listeners.forEach(cb => cb()) }

function tryPlay() { audio.play().catch(() => {}) }

// First user gesture unlocks playback, then the listeners remove themselves.
function unlock() {
  if (unlocked) return
  unlocked = true
  window.removeEventListener('pointerdown', unlock)
  window.removeEventListener('keydown', unlock)
  if (on) tryPlay()
}
window.addEventListener('pointerdown', unlock)
window.addEventListener('keydown', unlock)

export function isOn() { return on }

export function toggle() {
  on = !on
  if (on) { if (unlocked) tryPlay() }
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

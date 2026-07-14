// #41 单8：中奖庆祝 SFX（纯显示层·走现有 WebAudio 合成通道）。
// 欢呼样本参照德比 sfxCheer（带通白噪声 swell，真机可闻基准）；叮/短欢呼/长欢呼三样。
// 每次发声即时读 isSfxMuted()——全局静音开关必吃，静音下零声音。懒起 AudioContext，页面级复用。
import { isSfxMuted } from '../bgmManager'

let ac = null
function ctx() {
  if (ac) return ac
  try { ac = new (window.AudioContext || window.webkitAudioContext)() } catch { ac = null }
  return ac
}
// 发声前置闸：静音 → 直接吞掉；无 AudioContext → 吞掉。返回可用 ctx 或 null。
function gate() {
  if (isSfxMuted()) return null
  const c = ctx()
  if (c && c.state === 'suspended') { try { c.resume() } catch { /* ignore */ } }
  return c
}

// 胜方欢呼声浪：带通白噪声 swell（len 秒）——德比 cheer 同构，短/长档只调时长与增益。
function cheer(len, peak) {
  const c = gate(); if (!c) return
  const t = c.currentTime
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * len)), c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const src = c.createBufferSource(); src.buffer = buf
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.35, len * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + len)
  src.connect(f); f.connect(g); g.connect(c.destination); src.start(t); src.stop(t + len)
}

// 上扬音簇（金光叮当）——胜利小三连音，big/mega 冠于欢呼之上。
function chime(notes, step, peak) {
  const c = gate(); if (!c) return
  const t = c.currentTime
  notes.forEach((freq, i) => {
    const o = c.createOscillator(); const g = c.createGain(); o.type = 'sine'; o.frequency.value = freq
    const s = t + i * step
    g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(peak, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.28)
    o.connect(g); g.connect(c.destination); o.start(s); o.stop(s + 0.3)
  })
}

export function sfxDing() { chime([1320, 1760], 0.07, 0.09) }              // 小中：短「叮」两音
export function sfxCheerShort() { cheer(0.85, 0.09); chime([660, 990], 0.09, 0.07) }  // 大中：短欢呼 + 双音
export function sfxCheerLong() { cheer(1.7, 0.13); chime([660, 880, 1170, 1560], 0.1, 0.08) } // 爆中：长欢呼 + 四连音

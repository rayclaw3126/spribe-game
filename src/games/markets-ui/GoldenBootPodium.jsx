// #41 单14.5：PK10 上局前三名信息条（冠/亚/季 + 车图）——从 GoldenBoot subRowNode 机械切片。
// props {order,isMobile,compact,inline,animate,animKey}：order = 上局名次数组。
// compact（14.6 item1，多桌旧细带）；inline（14.6追加 item8，移入卡头行内：紧凑 nowrap，
//   放不下 overflow 裁季军，冠亚必显）；animate+animKey（item9，揭晓倒序 季→亚→冠 逐个淡入微缩放，
//   冠军金色微闪；仅 live 宣布时真，退化/播种为 false = 静态一次性换新）。
import { CarImgBead } from './GoldenBootMarkets'

const RANK = ['冠', '亚', '季']
const RANK_COLOR = ['#ffd54f', '#cfd6de', '#d9873f']
const PODIUM_ANIM_CSS = `
@keyframes gbPodIn { from { opacity: 0; transform: scale(0.72) } to { opacity: 1; transform: scale(1) } }
@keyframes gbPodGold { 0% { filter: drop-shadow(0 0 0 rgba(255,213,79,0)) } 40% { filter: drop-shadow(0 0 6px rgba(255,213,79,0.95)) } 100% { filter: drop-shadow(0 0 0 rgba(255,213,79,0)) } }`

export default function GoldenBootPodium({ order = [], isMobile = false, compact = false, inline = false, animate = false, animKey }) {
  const carSize = inline ? 16 : compact ? 18 : (isMobile ? 38 : 48)
  const labelFont = inline ? 9 : compact ? 9.5 : (isMobile ? 10 : 12)
  const gap = inline ? 5 : compact ? 6 : (isMobile ? 6 : 12)
  const anim = inline && animate
  return (
    <span style={{
      display: 'flex', alignItems: 'center', minWidth: 0,
      ...(inline ? { flex: '0 1 auto', overflow: 'hidden' } : { flex: '1 1 auto' }),
    }}>
      {anim && <style>{PODIUM_ANIM_CSS}</style>}
      {/* 上期名次串 — 只显前 3 名（冠/亚/季）；inline 紧排右侧，非 inline 撑满整行 */}
      <span style={{
        display: 'flex', alignItems: 'center', minWidth: 0, gap,
        ...(inline ? {} : { justifyContent: 'space-around', flex: 1 }),
      }}>
        {order.slice(0, 3).map((n, i) => {
          // 揭晓倒序：季(i=2)先入 → 亚(i=1) → 冠(i=0)最后，delay=(2-i)·step；冠(i=0)叠金闪
          const delay = (2 - i) * 140
          return (
            <span key={anim ? `${animKey}-${i}` : `${n}-${i}`} title={`第${i + 1}名`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: inline ? 2 : (compact ? 3 : 4), flexShrink: 0,
                ...(anim ? { animation: `gbPodIn 0.34s ease-out ${delay}ms both${i === 0 ? `, gbPodGold 0.55s ease-out ${delay}ms both` : ''}` } : {}),
              }}>
              <span style={{
                color: RANK_COLOR[i], fontSize: labelFont, fontWeight: 900,
                fontFamily: "'Space Grotesk', sans-serif", whiteSpace: 'nowrap',
              }}>{RANK[i]}</span>
              <CarImgBead num={n} size={carSize} />
            </span>
          )
        })}
      </span>
    </span>
  )
}

// #47 定案（全端规则）：珠盘路【列对齐滑动窗口】——不逐颗裁，整列丢最旧。
//
// 规则：网格 cols 列 × rows 行，右端恒留 reserve 列常空 → 可用数据列 = cols − reserve，
//   可用容量 usable = (cols − reserve) × rows（桌面 30×6、留 2 → 28×6 = 168）。
//   丢弃只以【整列】为单位（一次 rows 颗），故显示长度 L 必须与真实总数 N 同余：
//       L ≡ N (mod rows)   且   L ≤ usable   ，取满足两者的最大 L
//   即 N ≤ usable 时全留；否则 L = usable − ((rows − N mod rows) mod rows)。
//   桌面档 L 在 163–168 间浮动（N mod 6 = 0→168、1→163、2→164 … 5→167）。
//
// 视觉效果：珠按列优先填充，新珠沿当前列行位 1→6 往下走；走满该列后本该右移开新列，
//   但一旦要开到第 (cols − reserve + 1) 列，就改为丢掉最左整列 —— 于是整体左移一列、
//   新珠回到第 (cols − reserve) 列的行1。任何时刻新珠右侧空列数 ≥ reserve。
//
// ⚠ 增量可直接套用：本函数对「已窗口化的数组 + 新珠」再调用一次，结果与对完整历史调用一致
//   （因为 L ≡ N mod rows 被保持，L+1 与 N+1 同余）。故 WS 追珠与首灌走同一函数、无需特判。
//
// ⚠ 首灌不要先截到 usable 再进来：那样 N 恰等于 usable、算出 28 满列钉在角落。
//   应把拉回的完整条数（应 > usable）直接喂进来，当前列才会天然半满。
export const ROAD_RESERVE_COLS = 2

export function roadWindow(list, { cols = 30, rows = 6, reserve = ROAD_RESERVE_COLS } = {}) {
  const usable = (cols - reserve) * rows
  const n = Array.isArray(list) ? list.length : 0
  if (n <= usable) return list
  const keep = usable - ((rows - (n % rows)) % rows)
  return list.slice(-keep)
}

// 首灌应拉取的条数下限：比 usable 多一整列，保证有足够素材填满窗口。
export function roadSeedTarget({ cols = 30, rows = 6, reserve = ROAD_RESERVE_COLS } = {}) {
  return (cols - reserve) * rows + rows
}

// 按【指定的 N】开窗（首灌专用）：list 是拉回的素材，n 是真实序列基准。
// ⚠ 首灌【不能】用 list.length 当 N —— 拉取条数是固定的（如恒 174），mod rows 恒为 0，
//   会把当前列算成整列满、新珠钉在角落，正是定案禁止的。应传【最新一期的期号序号】：
//   它每局 +1，与 WS 增量后 window(D+1) 的相位天然连续（因 L ≡ N mod rows 被保持）。
export function roadWindowAt(list, n, { cols = 30, rows = 6, reserve = ROAD_RESERVE_COLS } = {}) {
  const usable = (cols - reserve) * rows
  if (!Array.isArray(list) || !Number.isFinite(n)) return roadWindow(list, { cols, rows, reserve })
  const keep = n <= usable ? n : usable - ((rows - (n % rows)) % rows)
  return list.slice(-Math.max(0, Math.min(keep, list.length)))
}

// 从期号取序号段：'WX-20260722-1347' → 1347（取末段数字；取不到返回 null）
export function roundSeq(roundNo) {
  const t = String(roundNo || '').split('-').pop()
  return /^\d+$/.test(t) ? Number(t) : null
}

// ============================================================================
// #47 追加·路珠活性动效（三款共用，禁三份拷贝）
//
// 两件事，全部走 CSS keyframes —— 【禁 rAF】：路珠是静内容，不为它开帧循环。
//   1) 新珠入场：scale 0.4→1 弹入（~200ms）+ 珠身高亮描边，~1.5s 内淡去。
//      一条 animation 兼顾两段（13% 处已到 scale 1，其后只淡描边），fill-mode forwards
//      让终态停在无描边，不残留。
//   2) 当前列下一个空格：极淡呼吸圆圈作「下一颗落这里」游标。
//      ⚠ 只给【下一格】一个，不许整片空区都闪 —— 调用方按 beads 长度算出该格索引。
//
// ⚠ 只有 WS 真新珠才弹：切房 / 首灌一律传 freshIndex = -1（调用方负责），
//   否则一次灌 160+ 颗会整屏爆闪。
export const ROAD_FX_FRESH = 'rdFresh'   // 新珠入场类名
export const ROAD_FX_NEXT = 'rdNext'     // 下一格呼吸游标类名

export const ROAD_FX_CSS = `
@keyframes rdPop {
  0%   { transform: scale(0.4); box-shadow: 0 0 0 2px rgba(255,255,255,0.95), 0 0 10px rgba(255,255,255,0.7); }
  13%  { transform: scale(1);   box-shadow: 0 0 0 2px rgba(255,255,255,0.95), 0 0 10px rgba(255,255,255,0.7); }
  100% { transform: scale(1);   box-shadow: 0 0 0 2px rgba(255,255,255,0),    0 0 10px rgba(255,255,255,0); }
}
@keyframes rdBreathe {
  0%, 100% { opacity: 0.18; }
  50%      { opacity: 0.5; }
}
.${ROAD_FX_FRESH} { animation: rdPop 1.5s ease-out both; }
.${ROAD_FX_NEXT}  { animation: rdBreathe 1.8s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .${ROAD_FX_FRESH}, .${ROAD_FX_NEXT} { animation: none; }
}
`

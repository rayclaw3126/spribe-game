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
//   应把拉回的完整条数（应 > usable）直接喂进来。
//
// #B1 跨零点相位修复（退役 roadWindowAt）：相位【由珠数 list.length 自持】，不再依赖期号。
//   旧法用 roadWindowAt(list, roundSeq(期号)) 拿【当日期号序号】当相位基准 N —— 期号跨零点归 1，
//   N 从 ~1400 掉到个位数 → keep 骤裁到十几颗，全端路珠每天零点缩水、随当日局数慢慢回血。
//   现首灌与 WS 追珠统一走本函数（N = list.length）：/round/history 不按日切（COALESCE room），
//   跨日仍返回最近 ~174 局 → 裁到 168 满墙，零点不缩水；三场景（重启/切房/重灌）皆连续。
//   代价：首灌初始相位从「当前列半满」变「可能满列」（174%6=0→168 满 28 列）——半列的活性
//   已由弹入动效 + 呼吸游标接管，不为它养期号相位逻辑（Ray B1 定案）。
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

// #Ray 进场相位真实化：按【绝对珠序 N】开窗，而非数组长度。
//   相位锚定真实序号（单珠款 N = 最新珠 roundNo；滚球 N = roundNo*3）：keep ≡ N (mod rows) 且 ≤ usable，
//   取 list 最后 keep 颗 → 最新珠落真实行位 (N−1)%rows，当前列走到第几颗显第几颗（非恒满列底部）。
//   仅手机档用：桌面 history 的 length 相位被首灌 SEED_TARGET(174, 6 的倍数) 整块尾切锁死为 0，
//   桌面按 B1 定案维持满墙零碰；手机改喂真实 N 还原半列相位。跨零点 N 由调用方计数自持（不看钟）。
//   N 缺省(null)时兜底走 roadWindow(按长度)，保证未接相位的调用零行为改变。
// #Ray 期号 → 当日序号（roundNo 形如 "SG-YYYYMMDD-NNN"，取末段数字）。跨零点归 001 —— 故仅
//   用作【首灌相位锚】，live 之后由调用方计数自持（+1），不再重解析，跨零点连续（照 B1 珠数自持判例）。
export function roundSeqNo(roundNo) {
  if (roundNo == null) return null
  const n = parseInt(String(roundNo).split('-').pop(), 10)
  return Number.isFinite(n) ? n : null
}

export function roadWindowN(list, N, { cols = 30, rows = 6, reserve = ROAD_RESERVE_COLS } = {}) {
  const listLen = Array.isArray(list) ? list.length : 0
  if (N == null || listLen === 0) return roadWindow(list, { cols, rows, reserve })
  const usable = (cols - reserve) * rows
  const keepPhase = usable - ((rows - (N % rows)) % rows)   // ≡ N mod rows，≤ usable
  const keep = Math.min(keepPhase, listLen)                 // list 不足时给几颗渲几颗（新库真相位）
  return keep >= listLen ? list : list.slice(-keep)
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
// #47 专单：把某一面的 freshIndex 换算到【另一面】的窗口。
// 起因：桌面与手机/多桌用同一个 fresh 信号，但各自窗口长度不同（桌 163–168、手机 35–36），
//   直接复用索引会落到错误格子甚至越界。fresh 语义恒为「本面最后一颗」，故只需判断
//   源索引是否仍指向源窗口末颗（= 动效仍在生效），是则返回目标窗口末颗，否则 -1。
// #47 双端一致·A 案：横滑路珠的【右端锚定】。
// 目标：最新珠 + 右侧 2 空列恒在视口内，玩家进页即看到最新，往左滑看更早历史。
//
// ⚠ 不能用 el.scrollLeft = el.scrollWidth —— 珠子从左往右填，未满窗时右端是【空格】，
//   锚 scrollWidth 会把视口滚到一片空白（五行实测 62 颗珠时整屏空）。
//   正解：锚到「最后一颗实珠所在列 + reserve 空列」的右边界，未满窗时自然停在 0。
export function roadAnchorLeft(el, beadCount, colW, rows = 6, reserve = ROAD_RESERVE_COLS) {
  if (!el || !colW) return
  const lastCol = Math.ceil((beadCount || 0) / rows)
  const want = (lastCol + reserve) * colW - el.clientWidth
  el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, want))
}

export function freshFor(srcIndex, srcLen, dstLen) {
  if (!(srcIndex >= 0) || srcLen <= 0 || dstLen <= 0) return -1
  return srcIndex === srcLen - 1 ? dstLen - 1 : -1
}

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

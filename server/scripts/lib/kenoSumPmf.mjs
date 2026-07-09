// Keno 和值精确 PMF（可复用给 HalfTime / WuXing）。
// 「从 1..N 无放回取 K 个球，和值 = S」的精确方案数分布，用 DP（恰取 K 个的 0/1 背包计数）。
// 计数超 Number.MAX_SAFE_INTEGER（C(80,20)≈3.5e18），故用 BigInt 精确计数，概率用 BigInt 缩放除法保精度。
//
// 用途：低频/窄带/高赔市场的 RTP 必须用精确 PMF 核（MC 大样本对窄带会骗），此处给闭式精确值。

/**
 * 计算和值方案数分布。
 * @param {number} N 池大小（球号 1..N）
 * @param {number} K 取球数
 * @returns {{ N, K, total: bigint, minSum: number, maxSum: number, counts: bigint[], countOf(s):bigint }}
 *   counts[s] = 取 K 个和为 s 的方案数（s 从 0..maxSum，越界为 0n）；total = C(N,K)。
 */
export function kenoSumCounts(N, K) {
  const maxSum = (N + (N - K + 1)) * K / 2;   // 取最大的 K 个：(N-K+1)+...+N
  // dp[j][s] = 用已遍历球取 j 个、和为 s 的方案数
  const dp = Array.from({ length: K + 1 }, () => new Array(maxSum + 1).fill(0n));
  dp[0][0] = 1n;
  for (let n = 1; n <= N; n++) {
    const jHi = Math.min(n, K);
    for (let j = jHi; j >= 1; j--) {
      const row = dp[j], prev = dp[j - 1];
      for (let s = maxSum; s >= n; s--) {
        const add = prev[s - n];
        if (add !== 0n) row[s] += add;
      }
    }
  }
  const counts = dp[K];
  let total = 0n;
  for (let s = 0; s <= maxSum; s++) total += counts[s];
  let minSum = 0; while (minSum <= maxSum && counts[minSum] === 0n) minSum++;
  return {
    N, K, total, minSum, maxSum, counts,
    countOf: (s) => (s >= 0 && s <= maxSum ? counts[s] : 0n),
  };
}

/** BigInt 概率 → float（缩放 1e15 保 ~15 位有效精度，避免 Number(hugeBigInt) 溢出丢精度）。 */
export function bigProb(num, den) {
  if (den === 0n) return 0;
  return Number((num * 1000000000000000n) / den) / 1e15;
}

/** 和值落 [lo,hi]（含端）的精确概率。 */
export function probSumBand(pmf, lo, hi, pred = null) {
  let num = 0n;
  const a = Math.max(0, lo), b = Math.min(pmf.maxSum, hi);
  for (let s = a; s <= b; s++) {
    if (pred && !pred(s)) continue;
    num += pmf.counts[s];
  }
  return bigProb(num, pmf.total);
}

/** 谓词命中的精确概率（谓词吃和值 s，遍历全和值域）。 */
export function probSumWhere(pmf, pred) {
  let num = 0n;
  for (let s = pmf.minSum; s <= pmf.maxSum; s++) if (pred(s)) num += pmf.counts[s];
  return bigProb(num, pmf.total);
}

// ---- 超几何精确 PMF（半场计数：N=80 池中 K=40 个「低区」，取 n=20，命中 k 个低区球）----
function binom(n, k) {
  if (k < 0 || k > n) return 0n;
  k = Math.min(k, n - k);
  let num = 1n, den = 1n;
  for (let i = 0; i < k; i++) { num *= BigInt(n - i); den *= BigInt(i + 1); }
  return num / den;
}
/** 超几何 P(X=k)：N 总体、K 成功、n 抽样。返回 float。 */
export function hyperProb(N, K, n, k) {
  const num = binom(K, k) * binom(N - K, n - k);
  const den = binom(N, n);
  return bigProb(num, den);
}

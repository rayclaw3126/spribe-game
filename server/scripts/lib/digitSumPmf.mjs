// n 个独立 0-9 数字之和的精确 PMF（可复用给 LineUp 及类似「独立可放回数字和」游戏）。
// 单个数字均匀 0..(base-1)，卷积 n 次得和值分布。精确用 BigInt（10^25 > 2^53 需 BigInt），不靠 MC。
//
// 与 keno（无放回超几何）不同：这里是【独立同分布可放回】——直接卷积，更简单。

/**
 * n 个独立 0..base-1 数字之和 = S 的精确方案数分布。
 * @param {number} n 数字个数
 * @param {number} base 每位取值数（默认 10，即 0-9）
 * @returns {{ n, base, total: bigint, maxSum: number, counts: bigint[], countOf(s):bigint }}
 *   counts[s] = 和为 s 的方案数（s 从 0..n*(base-1)）；total = base^n。
 */
export function digitSumCounts(n, base = 10) {
  let dp = [1n];   // 0 个数字：和为 0 有 1 种
  for (let i = 0; i < n; i++) {
    const next = new Array(dp.length + base - 1).fill(0n);
    for (let s = 0; s < dp.length; s++) {
      const v = dp[s];
      if (v === 0n) continue;
      for (let d = 0; d < base; d++) next[s + d] += v;
    }
    dp = next;
  }
  const total = BigInt(base) ** BigInt(n);
  return {
    n, base, total, maxSum: dp.length - 1, counts: dp,
    countOf: (s) => (s >= 0 && s < dp.length ? dp[s] : 0n),
  };
}

/** BigInt 概率 → float（缩放 1e15 保 ~15 位精度）。 */
export function bigProb(num, den) {
  if (den === 0n) return 0;
  return Number((num * 1000000000000000n) / den) / 1e15;
}

/** 谓词命中的精确概率（谓词吃和值 s）。 */
export function probWhere(pmf, pred) {
  let num = 0n;
  for (let s = 0; s <= pmf.maxSum; s++) if (pred(s)) num += pmf.counts[s];
  return bigProb(num, pmf.total);
}

/** 和值落 [lo,hi]（含端）的精确概率。 */
export function probBand(pmf, lo, hi) {
  let num = 0n;
  const a = Math.max(0, lo), b = Math.min(pmf.maxSum, hi);
  for (let s = a; s <= b; s++) num += pmf.counts[s];
  return bigProb(num, pmf.total);
}

// ---- 二项分布精确尾概率（计数盘：n 位中「命中类」各 P=k/base，此处对半盘 P=1/2）----
function binom(n, k) {
  if (k < 0 || k > n) return 0n;
  k = Math.min(k, n - k);
  let num = 1n, den = 1n;
  for (let i = 0; i < k; i++) { num *= BigInt(n - i); den *= BigInt(i + 1); }
  return num / den;
}
/** P(X >= k)，X ~ Binomial(n, 1/2)。返回 float。 */
export function binomTailGE(n, k) {
  let num = 0n;
  for (let i = k; i <= n; i++) num += binom(n, i);
  return bigProb(num, 2n ** BigInt(n));
}
/** P(X <= k)，X ~ Binomial(n, 1/2)。返回 float。 */
export function binomTailLE(n, k) {
  let num = 0n;
  for (let i = 0; i <= k; i++) num += binom(n, i);
  return bigProb(num, 2n ** BigInt(n));
}

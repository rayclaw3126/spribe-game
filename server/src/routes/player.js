// 玩家自助只读接口
// 说明：GET /me 返回钱包余额；GET /ledger 资金流水、GET /bets 投注记录（玩家自查账单）。
// 全部纯只读 SELECT，不碰任何资金写路径；playerId 只从 token（req.user.sub）取，绝不收
// query 参数，杜绝越权查他人数据。分页用 keyset cursor（id < cursor），比 OFFSET 稳。
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireType } from '../middleware/auth.js';
import riskCfg from '../config/risk.js';

const router = Router();

// —— 平台内广播（跑马灯 + 今日大奖）阈值常量 ——
// 跑马灯收录：近 1 小时内，单局（player_id,round_id 聚合）派彩 ≥ $50 或 倍数 ≥ 10×，取最近 20 条。
const MARQUEE_MIN_PAYOUT = 50;   // 大额线（美元）
const MARQUEE_MIN_MULT = 10;     // 高倍线（Σpayout/Σ同键bet）
const MARQUEE_LIMIT = 20;
const TOP_LIMIT = 5;             // 今日大奖榜 Top5

// 用户名脱敏（与前端 BetFeed 同规则，改由后端出，前端不接触 raw）：
// 首字 + *** + 末字；≤2 字仅首字 + ***。空/异常回 '玩家'。
function maskName(name) {
  const s = typeof name === 'string' ? name.trim() : '';
  if (!s) return '玩家';
  if (s.length <= 2) return `${s[0]}***`;
  return `${s[0]}***${s[s.length - 1]}`;
}

// caps 单一数据源：把 risk.js 的 default+perGame 合成成 { [game]: { maxBet, maxPayout } } 下发给前端，
// 让前端「兑现前」预估/输入封顶与后端同源（后端另有 LEAST 钳制/limits 兜底，前端只做展示防虚高）。
// game 列表取自 perGame 的 key（现即全 21 款）；数值为 perGame 覆盖 default 后的合成结果，转 Number。
const CAPS = Object.fromEntries(
  Object.keys(riskCfg.perGame).map((game) => {
    const merged = { ...riskCfg.default, ...riskCfg.perGame[game] };
    return [game, { maxBet: Number(merged.maxBet), maxPayout: Number(merged.maxPayout) }];
  })
);

// limit 钳制到 1–50，防一次拉爆；非法/缺省取 20
function clampLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 20;
  return Math.min(50, Math.max(1, n));
}
// cursor：合法正整数才透传（pg 转 bigint），否则 null（首页）
function parseCursor(raw) {
  if (raw == null || raw === '') return null;
  return /^\d+$/.test(String(raw)) ? String(raw) : null;
}
// game 白名单：只接受 risk.js perGame 里已知的 21 款 backendId，防注入/越权枚举。
// 缺省返回 null（不筛）；非法值直接抛 400（前端下拉只给合法值，非法即防御）。
const GAME_WHITELIST = new Set(Object.keys(riskCfg.perGame));
function parseGame(raw) {
  if (raw == null || raw === '') return null;
  const g = String(raw);
  if (!GAME_WHITELIST.has(g)) { const e = new Error('未知的 game 筛选值'); e.status = 400; throw e; }
  return g;
}
// 日期：只接受 YYYY-MM-DD，透传给 SQL ::date 转当天边界（>=from 当天 00:00，<to+1 含 to 全天）。
// 非法/缺省返回 null（不筛）。时区随 DB 会话，dev 一致即可。
function parseDate(raw) {
  if (raw == null || raw === '') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(raw)) ? String(raw) : null;
}

// GET /player/me —— 玩家自己的钱包余额 + 全量风控 caps（只读，参数化查询）
router.get('/me', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const result = await query('SELECT balance FROM wallets WHERE player_id = $1', [playerId]);
    const balance = result.rowCount > 0 ? result.rows[0].balance : '0.00';
    return res.json({ balance, caps: CAPS });
  } catch (err) {
    return next(err);
  }
});

// GET /player/ledger?limit=20&cursor=<id>&game=<backendId>&from=YYYY-MM-DD&to=YYYY-MM-DD
// 资金流水（含全 21 款 _bet/_payout + deposit/withdraw）。game 筛选按 type IN (game_bet, game_payout)；
// 日期筛选按 created_at 落 [from 00:00, to+1) 当天含头尾。keyset 与筛选并存（cursor 只夹 id，筛选各自独立）。
router.get('/ledger', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;                 // 只从 token 取，不收 query，杜绝越权
    const limit = clampLimit(req.query.limit);
    const cursor = parseCursor(req.query.cursor);
    const game = parseGame(req.query.game);
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const result = await query(
      `SELECT id, type, amount, balance_before, balance_after, round_id, created_at
       FROM ledger
       WHERE player_id = $1
         AND ($2::bigint IS NULL OR id < $2)
         AND ($3::text IS NULL OR type IN ($3 || '_bet', $3 || '_payout'))
         AND ($4::date IS NULL OR created_at >= $4::date)
         AND ($5::date IS NULL OR created_at < ($5::date + 1))
       ORDER BY id DESC LIMIT $6`,
      [playerId, cursor, game, from, to, limit],
    );
    const items = result.rows;
    const nextCursor = items.length === limit ? items[items.length - 1].id : null;
    return res.json({ items, nextCursor });
  } catch (err) {
    return next(err);
  }
});

// GET /player/bets?limit=20&cursor=<id>&game=<backendId>&from=YYYY-MM-DD&to=YYYY-MM-DD
// 投注记录（注单 + 游戏名 + selections + 结果 + 派彩）。不返 r.result，最小暴露。
// 派彩口径修正：r.payout 对轮次彩/共享开奖局恒 null（rounds 是全场共享开奖行），
// 改从 ledger 按 (player_id, round_id, type=game_payout) SUM 聚合取本人真实派彩（LATERAL 单行不乘行）。
// 取值：COALESCE(NULLIF(ledger聚合,0), r.payout, 0)——ledger 有派彩优先（轮次彩真源）；
// 为 0/无（含远古走通用 type='payout' 的 settle 局）则回落 r.payout，保单人局与旧口径逐位一致。
// 多注同轮（rollingball 逐球 / speedgrid 多注）每行显示该轮本人总派彩。
router.get('/bets', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const playerId = req.user.sub;
    const limit = clampLimit(req.query.limit);
    const cursor = parseCursor(req.query.cursor);
    const game = parseGame(req.query.game);
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const result = await query(
      `SELECT b.id, b.amount, b.outcome, b.created_at, r.game, b.selections,
              COALESCE(NULLIF(lp.payout, 0), r.payout, 0) AS payout
       FROM bets b
       JOIN rounds r ON b.round_id = r.id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(l.amount), 0) AS payout
         FROM ledger l
         WHERE l.player_id = b.player_id
           AND l.round_id = b.round_id
           AND l.type = r.game || '_payout'
       ) lp ON true
       WHERE b.player_id = $1
         AND ($2::bigint IS NULL OR b.id < $2)
         AND ($3::text IS NULL OR r.game = $3)
         AND ($4::date IS NULL OR b.created_at >= $4::date)
         AND ($5::date IS NULL OR b.created_at < ($5::date + 1))
       ORDER BY b.id DESC LIMIT $6`,
      [playerId, cursor, game, from, to, limit],
    );
    const items = result.rows;
    const nextCursor = items.length === limit ? items[items.length - 1].id : null;
    return res.json({ items, nextCursor });
  } catch (err) {
    return next(err);
  }
});

// GET /player/bigwins —— 平台内广播（只读）：跑马灯近 1h 大奖流 + 今日大奖榜 Top5。
// 数据源 = ledger <game>_payout / <game>_bet 按 (player_id, round_id) 聚合（对齐账单派彩真源口径，
// 与 /player/bets 的 ledger 聚合同源）；倍数 = Σpayout / Σ同键bet。join players 取名后端脱敏，
// join rounds 取 game/round_no。纯参数化只读 SELECT，不碰任何写路径；mine 由 token sub 判，不外泄 player_id。
router.get('/bigwins', requireAuth, requireType('player'), async (req, res, next) => {
  try {
    const me = String(req.user.sub);
    // 跑马灯：近 1h 派彩局，按 (player,round) 聚合 payout/bet，过大额或高倍线，最近 20 条。
    const marqueeRes = await query(
      `WITH wins AS (
         SELECT l.player_id, l.round_id, r.game, r.round_no, MAX(l.created_at) AS won_at
         FROM ledger l
         JOIN rounds r ON r.id = l.round_id
         WHERE l.type = r.game || '_payout'
           AND l.created_at >= now() - interval '1 hour'
         GROUP BY l.player_id, l.round_id, r.game, r.round_no
       ), agg AS (
         SELECT w.player_id, w.round_id, w.game, w.round_no, w.won_at,
           (SELECT COALESCE(SUM(lp.amount), 0) FROM ledger lp
              WHERE lp.player_id = w.player_id AND lp.round_id = w.round_id AND lp.type = w.game || '_payout') AS payout,
           (SELECT COALESCE(SUM(lb.amount), 0) FROM ledger lb
              WHERE lb.player_id = w.player_id AND lb.round_id = w.round_id AND lb.type = w.game || '_bet') AS bet
         FROM wins w
       )
       SELECT a.player_id, a.game, a.round_no, a.payout, a.bet, a.won_at, p.username
       FROM agg a
       JOIN players p ON p.id = a.player_id
       WHERE a.payout >= $1 OR (a.bet > 0 AND a.payout / a.bet >= $2)
       ORDER BY a.won_at DESC
       LIMIT $3`,
      [MARQUEE_MIN_PAYOUT, MARQUEE_MIN_MULT, MARQUEE_LIMIT],
    );
    // 今日大奖榜：当日派彩局按 (player,round) 聚合 payout，取 Top5。
    const topRes = await query(
      `WITH wins_today AS (
         SELECT l.player_id, l.round_id, r.game, r.round_no,
                SUM(l.amount) AS payout, MAX(l.created_at) AS won_at
         FROM ledger l
         JOIN rounds r ON r.id = l.round_id
         WHERE l.type = r.game || '_payout'
           AND l.created_at >= current_date
         GROUP BY l.player_id, l.round_id, r.game, r.round_no
       )
       SELECT w.player_id, w.game, w.round_no, w.payout, p.username
       FROM wins_today w
       JOIN players p ON p.id = w.player_id
       ORDER BY w.payout DESC
       LIMIT $1`,
      [TOP_LIMIT],
    );
    const marquee = marqueeRes.rows.map((r) => ({
      game: r.game,
      roundNo: r.round_no,
      name: maskName(r.username),
      payout: Number(r.payout),
      mult: Number(r.bet) > 0 ? Number((Number(r.payout) / Number(r.bet)).toFixed(2)) : null,
      mine: String(r.player_id) === me,
    }));
    const top = topRes.rows.map((r) => ({
      game: r.game,
      roundNo: r.round_no,
      name: maskName(r.username),
      payout: Number(r.payout),
      mine: String(r.player_id) === me,
    }));
    return res.json({ marquee, top });
  } catch (err) {
    return next(err);
  }
});

export default router;

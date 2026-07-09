// 风控配置。金额全用字符串（与 numeric 一致性），校验时转 Number 比较。
export default {
  default: { minBet: '1.00', maxBet: '1000.00', maxPayout: '50000.00' },
  perGame: {
    dice:    { maxBet: '500.00' },
    limbo:   { maxBet: '200.00' },
    hilo:    { exposureMult: 200 }, // 敞口口径：潜在=bet×200（clamp cap），代替理论无界的满 cap
    keno:    { maxBet: '20.00', maxPayout: '50000.00' }, // maxBet 20 降 RTP 侵蚀（小注顶赔零侵蚀）
    goal:    { maxBet: '3.00', maxPayout: '50000.00' }, // lg 满清 13238×，bet3 顶赔 39714<cap（不触顶，靠钳制兜）
    streak:  { maxBet: '100.00', maxPayout: '50000.00' }, // F normal 顶赔 30.40×，bet100 顶赔 3040<cap（零钳制，cap 兜底）
    roulette: { maxBet: '100.00', maxPayout: '50000.00' }, // maxBet=单次转总注额上限；单号 11.4× 顶赔靠钳制兜
    speedgrid: { maxBet: '100.00', maxPayout: '50000.00' }, // 轮次开奖·多注 map；直选 22.85× 顶赔靠钳制兜
    numberup: { maxBet: '100.00', maxPayout: '50000.00' }, // 轮次开奖·多注 map；顶赔 pick 47.5×100=4750<<cap，零钳制
    aviator: { maxBet: '500.00', maxPayout: '50000.00' },
  },
  // 敞口：单玩家所有未结算多步局的潜在最大赔付总额上限 + 并发未结算局数上限（双闸）
  exposure: { perPlayerMaxOpen: '50000.00', maxOpenRounds: 10 },
};

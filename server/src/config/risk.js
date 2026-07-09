// 风控配置。金额全用字符串（与 numeric 一致性），校验时转 Number 比较。
export default {
  default: { minBet: '1.00', maxBet: '1000.00', maxPayout: '50000.00' },
  perGame: {
    dice:    { maxBet: '500.00' },
    limbo:   { maxBet: '200.00' },
    aviator: { maxBet: '500.00', maxPayout: '50000.00' },
  },
  exposure: { perPlayerMaxOpen: '50000.00' },
};

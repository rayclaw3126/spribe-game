import BigWinMarquee from '../MultiTable/BigWinMarquee'

// 单S4c 瘦版跑马灯：**零 fork** —— 原样复用多桌 BigWinMarquee（同一 items 数据形状 +
// 同一 CSS translateX 横滚逻辑，一行播报 JSX 都不重写），仅用局部 scoped CSS !important
// 把 padding/字号压到 ~15px（< 各桌面游戏底部最小留白 19px → 挂顶后零裁零纵滚）。
// 多桌原件 BigWinMarquee.jsx 一字未碰；此件只新建。
// 高度 = padding(1+1) + 行高(font 10 ≈ 12) + borderBottom 1 ≈ 15px，与 App 层 paddingTop 常数对齐。
export default function BigWinMarqueeSlim({ items }) {
  if (!items || items.length === 0) return null
  return (
    <div className="bwSlim">
      <style>{`
        .bwSlim > div { height: 18px !important; padding: 0 !important; border-bottom: none !important; overflow: hidden !important; }
        .bwSlim span { font-size: 9px !important; line-height: 1.2 !important; }
      `}</style>
      <BigWinMarquee items={items} />
    </div>
  )
}

import { useState, useLayoutEffect } from 'react'

// #Ray 手机路珠·列数按屏宽现算：实测珠墙滚动盒可用宽（clientWidth − 左右 padding），
//   列数 = floor((可用宽 + gap) / (珠径 + gap)) → 网格按实宽铺满整屏；
//   数据窗仍走 roadWindow 默认 reserve=2（右恒留 2 空列作落点区，数据上限 =(cols−2)×rows），
//   最新珠落在倒数第 3 列（末数据列），符合路珠定案「新珠右侧恒留 ≥2 空列」。
// boxRef 挂珠墙滚动盒；enabled=false（桌面/多桌）时【不测量、不订阅】，直接返回 fallback，
//   原 cols 路径逐字节不碰。ResizeObserver 兜住帧宽变化（手机帧锁 402 时只测一次）。
export function useRoadFitCols(boxRef, bead, gap, fallback, enabled) {
  const [cols, setCols] = useState(fallback)
  useLayoutEffect(() => {
    if (!enabled) return
    const el = boxRef.current
    if (!el) return
    const calc = () => {
      const cs = getComputedStyle(el)
      const w = el.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0)
      if (w > 0) setCols(Math.max(1, Math.floor((w + gap) / (bead + gap))))
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(el)
    return () => ro.disconnect()
  }, [boxRef, bead, gap, enabled])
  return enabled ? cols : fallback
}

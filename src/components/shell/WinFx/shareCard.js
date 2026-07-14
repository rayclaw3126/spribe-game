// #41 单10：战绩卡出图（纯 canvas，零外部依赖、零后端）。竖版 1080×1350 PNG：
// 该款大厅封面做底(cover-fit) + 深色遮罩 + 金色排版。data 缺 cover 时回落主题渐变(dev预览/加载失败可用)。
// renderShareCard 异步(等封面 decode)后返回;canvasToBlob/copyBlob 供 Modal 下载/复制。
const W = 1080, H = 1350
const GOLD = '#ffd54f', AMBER = '#f5a623', INK = '#0b1016'

const rt = (ctx, text, x, y, font, fill, { align = 'center', stroke = null, sw = 0 } = {}) => {
  ctx.font = font; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'
  if (stroke) { ctx.lineWidth = sw; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.strokeText(text, x, y) }
  ctx.fillStyle = fill; ctx.fillText(text, x, y)
}

function drawBackdrop(ctx, img, color) {
  if (img) {
    const s = Math.max(W / img.width, H / img.height)
    const dw = img.width * s, dh = img.height * s
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh)
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, color || '#243447'); g.addColorStop(1, INK)
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  }
  // 深色遮罩：整体压暗 + 上下加重，保金字可读
  ctx.fillStyle = 'rgba(8,14,20,0.55)'; ctx.fillRect(0, 0, W, H)
  const v = ctx.createLinearGradient(0, 0, 0, H)
  v.addColorStop(0, 'rgba(8,14,20,0.85)'); v.addColorStop(0.35, 'rgba(8,14,20,0.25)')
  v.addColorStop(0.7, 'rgba(8,14,20,0.45)'); v.addColorStop(1, 'rgba(8,14,20,0.92)')
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H)
  // 金色描边框
  ctx.strokeStyle = 'rgba(255,213,79,0.5)'; ctx.lineWidth = 4; ctx.strokeRect(28, 28, W - 56, H - 56)
}

async function loadCover(src) {
  if (!src) return null
  try { const img = new Image(); img.src = src; await img.decode(); return img } catch { return null }
}

// data: { cover, gameName, venue, payout, mult, name, roundNo, date, color }
export async function renderShareCard(canvas, data) {
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  const img = await loadCover(data.cover)
  drawBackdrop(ctx, img, data.color)

  const cx = W / 2
  // 顶：游戏名 · 场馆
  rt(ctx, data.gameName || '', cx, 150, '800 58px system-ui, sans-serif', '#ffffff', { stroke: 'rgba(0,0,0,0.6)', sw: 6 })
  if (data.venue) rt(ctx, data.venue, cx, 205, '600 30px system-ui, sans-serif', 'rgba(255,255,255,0.8)')

  // BIG WIN
  const bw = ctx.createLinearGradient(0, 360, 0, 460)
  bw.addColorStop(0, '#fff3c4'); bw.addColorStop(0.5, GOLD); bw.addColorStop(1, AMBER)
  rt(ctx, 'BIG WIN', cx, 445, '900 104px system-ui, sans-serif', bw, { stroke: 'rgba(0,0,0,0.55)', sw: 8 })

  // 主视觉：+$金额
  rt(ctx, `+$${Number(data.payout).toFixed(2)}`, cx, 640, '900 150px system-ui, sans-serif', GOLD, { stroke: 'rgba(0,0,0,0.6)', sw: 10 })
  // 倍数
  if (data.mult != null) rt(ctx, `${Number(data.mult).toFixed(2)}× 倍`, cx, 720, '800 52px system-ui, sans-serif', AMBER, { stroke: 'rgba(0,0,0,0.5)', sw: 5 })

  // 脱敏名 / 期号 / 日期
  rt(ctx, data.name || '玩家', cx, 970, '800 46px system-ui, sans-serif', '#ffffff', { stroke: 'rgba(0,0,0,0.5)', sw: 5 })
  rt(ctx, `期号 ${data.roundNo || '—'}`, cx, 1030, '600 30px system-ui, sans-serif', 'rgba(255,255,255,0.72)')
  rt(ctx, data.date || '', cx, 1075, '600 30px system-ui, sans-serif', 'rgba(255,255,255,0.72)')

  // 「本局可验证」小标（金框 pill）
  const pillW = 250, pillH = 56, px = cx - pillW / 2, py = 1140
  ctx.beginPath(); ctx.roundRect(px, py, pillW, pillH, 28)
  ctx.fillStyle = 'rgba(255,213,79,0.14)'; ctx.fill(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.stroke()
  rt(ctx, '🔒 本局可验证', cx, py + 38, '700 28px system-ui, sans-serif', GOLD)

  // 页脚品牌
  rt(ctx, 'SPORTS · gamehub.dad', cx, 1285, '800 34px system-ui, sans-serif', GOLD, { stroke: 'rgba(0,0,0,0.5)', sw: 4 })
  return canvas
}

export function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}

// 复制到剪贴板；不支持 ClipboardItem/权限被拒 → 返回 false（调用方降级为仅下载）
export async function copyBlob(blob) {
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch { return false }
}

export const canCopyImage = () => typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write

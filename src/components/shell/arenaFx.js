import { COLORS } from './tokens'

// Shared canvas backdrop + waiting ceremony for the crash games
// (Breakaway / Long Shot). Pure drawing — no game or money logic.
// All geometry is precomputed once in createArenaFx(); the per-frame
// functions only read/advance that state (no array allocation per frame).

const WEDGES = 12
const STARS_PER_LAYER = 36

export function createArenaFx() {
  const wedges = new Float64Array(WEDGES)
  for (let i = 0; i < WEDGES; i++) wedges[i] = (Math.PI * 2 * i) / WEDGES
  // normalized star coords per layer (x scrolls, y fixed), sizes fixed
  const stars = [[], []]
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < STARS_PER_LAYER; i++) {
      stars[layer].push({
        x: Math.random(),
        y: 0.06 + Math.random() * 0.88,
        s: layer === 0 ? 1 + Math.random() * 1.2 : 1.6 + Math.random() * 1.8,
      })
    }
  }
  return { wedges, stars, rot: 0, offset: [0, 0], lastT: 0 }
}

// Radial wedges rotating around the curve origin + two-layer star drift.
// Rotation and drift speed rise while flying (speed scales with multiplier).
export function drawArenaFx(ctx, fx, { W, H, dpr, now, mode, mult }) {
  const dt = fx.lastT ? Math.min((now - fx.lastT) / 1000, 0.05) : 0.016
  fx.lastT = now
  const flying = mode === 'flying'

  // --- radial wedges ---
  const originX = W * 0.08
  const originY = H - H * 0.12
  fx.rot += dt * (flying ? 0.12 : 0.045)
  const R = Math.hypot(W, H)
  ctx.save()
  ctx.translate(originX, originY)
  ctx.rotate(fx.rot)
  for (let i = 0; i < WEDGES; i++) {
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, R, fx.wedges[i], fx.wedges[i] + 0.09)
    ctx.closePath()
    ctx.fillStyle = i % 2 ? COLORS.fxWedgeBright : COLORS.fxWedgeDim
    ctx.fill()
  }
  ctx.restore()

  // --- parallax star drift (leftwards; faster with multiplier in flight) ---
  const base = flying ? 26 + Math.min(mult, 10) * 22 : 7   // css px/s
  for (let layer = 0; layer < 2; layer++) {
    const sp = base * (layer === 0 ? 0.55 : 1.25)
    fx.offset[layer] = (fx.offset[layer] + sp * dt) % 100000
    const shift = fx.offset[layer] * dpr
    ctx.fillStyle = layer === 0 ? COLORS.fxStarFar : COLORS.fxStarNear
    ctx.globalAlpha = layer === 0 ? 0.5 : 0.7
    const layerStars = fx.stars[layer]
    for (let i = 0; i < layerStars.length; i++) {
      const st = layerStars[i]
      const px = ((st.x * W - shift) % W + W) % W
      const py = st.y * H
      const s = st.s * dpr
      ctx.fillRect(px, py, s, s)
    }
  }
  ctx.globalAlpha = 1
}

// Waiting bay: rotating ball in the canvas center, label under it, and a
// bottom progress bar that fills across the betting countdown.
export function drawWaiting(ctx, { W, H, dpr, now, img, progress }) {
  const cx = W / 2
  const cy = H / 2
  const r = Math.min(W, H) * 0.085

  if (img?.complete && img.naturalWidth) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(now / 600)               // uniform idle spin
    ctx.drawImage(img, -r, -r, r * 2, r * 2)
    ctx.restore()
  }

  ctx.font = `800 ${13 * dpr}px 'Space Grotesk', sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = COLORS.fxWaitText
  ctx.fillText('等待下一局', cx, cy + r + 24 * dpr)

  // bottom progress bar
  const barW = Math.min(W * 0.5, 340 * dpr)
  const barH = 5 * dpr
  const bx = cx - barW / 2
  const by = H - 18 * dpr
  ctx.fillStyle = COLORS.fxBarTrack
  ctx.beginPath()
  ctx.roundRect(bx, by, barW, barH, barH / 2)
  ctx.fill()
  const p = Math.max(0, Math.min(1, progress))
  if (p > 0.01) {
    ctx.fillStyle = COLORS.fxBarFill
    ctx.beginPath()
    ctx.roundRect(bx, by, barW * p, barH, barH / 2)
    ctx.fill()
  }
}

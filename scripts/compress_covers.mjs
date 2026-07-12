// 一次性封面压缩：把 15 个大厅封面大图 resize 到宽 600（保持比例）转 WebP q80。
// 只处理下面显式列出的 15 个未压封面（≥1.4MB）；已优化的 6 个小图(150-190K)与
// 游戏内资产(bgm.mp3/ball-3d/goal-front/keeper)一律不碰。原 .png 保留，验收后再删。
//
// 跑法：node scripts/compress_covers.mjs
import sharp from 'sharp'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'covers')

// 15 个待压大厅封面（按体积选，含 4 个 underscore 命名但未压的：wuxing/speedgrid/rollingball/lineup）
const TARGETS = [
  'cover-pk10', 'cover_wuxing', 'cover_speedgrid', 'cover-dominoduel', 'cover_rollingball',
  'cover-goal', 'cover_lineup', 'cover-dribble', 'cover-free-kick', 'cover-total-goals',
  'cover-breakaway', 'cover-odds-climb', 'cover-streak-roll', 'cover-rating-hi-lo', 'cover-team-keno',
]

const kb = b => (b / 1024).toFixed(0) + 'KB'
let totalBefore = 0, totalAfter = 0
const rows = []

for (const name of TARGETS) {
  const src = join(DIR, name + '.png')
  const out = join(DIR, name + '.webp')
  const before = statSync(src).size
  const meta = await sharp(src).metadata()
  await sharp(src)
    .resize({ width: 600, withoutEnlargement: true })   // 宽 600、保持比例、不放大小图
    .webp({ quality: 80 })
    .toFile(out)
  const after = statSync(out).size
  totalBefore += before; totalAfter += after
  rows.push({ name, dim: `${meta.width}×${meta.height}`, before, after })
}

console.log('name'.padEnd(22), 'orig尺寸'.padEnd(12), 'PNG前'.padStart(8), 'WebP后'.padStart(8), '  降幅')
for (const r of rows) {
  const pct = ((1 - r.after / r.before) * 100).toFixed(1)
  console.log(r.name.padEnd(22), r.dim.padEnd(12), kb(r.before).padStart(8), kb(r.after).padStart(8), `  −${pct}%`)
}
console.log('─'.repeat(64))
console.log('合计'.padEnd(22), ''.padEnd(12), kb(totalBefore).padStart(8), kb(totalAfter).padStart(8),
  `  −${((1 - totalAfter / totalBefore) * 100).toFixed(1)}%`)
console.log(`\n15 张：${kb(totalBefore)} → ${kb(totalAfter)}（省 ${kb(totalBefore - totalAfter)}）`)

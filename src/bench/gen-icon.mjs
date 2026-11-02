// 生成应用图标源文件 app-icon.png（1024x1024，RGBA，带透明圆角）。
//
// 为什么自己生成而不是找现成图片：
// 1. 不引入图像处理依赖（sharp / canvas 都不装）
// 2. 确定性输出，可复现，便于 diff
// 3. Tauri 的 `tauri icon` 只需要一张 1024x1024 的方形 PNG，其余尺寸由它派生
//
// 图形语义：深色圆角底 + 白色 M 字形（Markdown 首字母）+ 右下角下箭头
// （暗示「向下阅读」）。刻意保持极简，避免图标在 16x16 时糊成一团。
//
// 用法：node src/bench/gen-icon.mjs
// 输出：src/host/app-icon.png

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const OUT = resolve(REPO_ROOT, 'src/host/app-icon.png')

const SIZE = 1024

// CRC32（PNG chunk 必需）
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}

// ---- 绘图辅助（纯像素运算，无依赖）----

/** 圆角矩形的有向距离场：<0 在内，>0 在外。 */
function roundedRectSdf(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - (halfW - radius)
  const qy = Math.abs(y - cy) - (halfH - radius)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - radius
}

/** 线段距离（用于画 M 字形笔画）。 */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

/** 抗锯齿：把有符号距离转成 0..1 覆盖率（1px 过渡带）。 */
function coverage(d) {
  return Math.max(0, Math.min(1, 0.5 - d))
}

/** 简单 alpha 合成：src over dst。 */
function blend(dst, src, alpha) {
  const a = alpha + (dst[3] / 255) * (1 - alpha)
  if (a <= 0) return [0, 0, 0, 0]
  const mix = (sc, dc) => Math.round((sc * alpha + dc * (dst[3] / 255) * (1 - alpha)) / a)
  return [mix(src[0], dst[0]), mix(src[1], dst[1]), mix(src[2], dst[2]), Math.round(a * 255)]
}

const BG = [13, 17, 23] // #0d1117，与 App Theme 的 dark 背景一致
const FG = [255, 255, 255]
const ACCENT = [47, 129, 247] // #2f81f7，与 App Theme 强调色一致

const pixels = new Uint8Array(SIZE * SIZE * 4)

const cx = SIZE / 2
const cy = SIZE / 2
const half = SIZE * 0.44
const radius = SIZE * 0.20

// M 字形几何（以 1024 为基准的比例）
const mLeft = SIZE * 0.30
const mRight = SIZE * 0.70
const mTop = SIZE * 0.36
const mBottom = SIZE * 0.62
const strokeW = SIZE * 0.072

for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    let px = [0, 0, 0, 0]

    // 1) 圆角底板
    const bgCover = coverage(roundedRectSdf(x + 0.5, y + 0.5, cx, cy, half, half, radius))
    if (bgCover > 0) px = blend(px, BG, bgCover)

    // 2) M 字形：左竖笔 + 两斜笔 + 右竖笔
    const strokes = [
      [mLeft, mBottom, mLeft, mTop],
      [mLeft, mTop, cx, (mTop + mBottom) / 2],
      [cx, (mTop + mBottom) / 2, mRight, mTop],
      [mRight, mTop, mRight, mBottom],
    ]
    let minDist = Infinity
    for (const [ax, ay, bx, by] of strokes) {
      minDist = Math.min(minDist, segmentDistance(x + 0.5, y + 0.5, ax, ay, bx, by))
    }
    const mCover = coverage(minDist - strokeW / 2)
    if (mCover > 0) px = blend(px, FG, mCover)

    // 3) 右下角强调点（暗示「继续向下」）
    const dotCx = cx
    const dotCy = SIZE * 0.74
    const dotR = SIZE * 0.045
    const dotCover = coverage(Math.hypot(x + 0.5 - dotCx, y + 0.5 - dotCy) - dotR)
    if (dotCover > 0) px = blend(px, ACCENT, dotCover)

    const i = (y * SIZE + x) * 4
    pixels[i] = px[0]
    pixels[i + 1] = px[1]
    pixels[i + 2] = px[2]
    pixels[i + 3] = px[3]
  }
}

// ---- 编码为 PNG ----
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type: RGBA
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

// 每行：filter byte(0) + RGBA
// 注意：Uint8Array 没有 .copy 方法，必须用 Buffer.from(view) 拿到底层视图再 copy；
// 或用 Buffer 的 set。这里用后者，最直观且不会踩到「view 与 buffer 偏移」的坑。
const stride = SIZE * 4 + 1
const raw = Buffer.alloc(stride * SIZE)
const pixelBuf = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)

for (let y = 0; y < SIZE; y += 1) {
  raw[y * stride] = 0 // filter type: None
  pixelBuf.copy(raw, y * stride + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

await mkdir(dirname(OUT), { recursive: true })
await writeFile(OUT, png)

console.log(`生成 ${OUT}`)
console.log(`  ${SIZE}x${SIZE} RGBA, ${(png.length / 1024).toFixed(1)} KB`)

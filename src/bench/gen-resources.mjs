#!/usr/bin/env node
// 生成 fixtures/resources/ 下的二进制图片资源。
//
// 用最小合法 PNG/GIF 字节，不引入图像库依赖。
// 确定性：同样的输入每次产生同样的字节。
//
// 用法：node src/bench/gen-resources.mjs

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const OUT = join(REPO_ROOT, 'fixtures', 'resources')

// CRC32（PNG 必需）。
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crcBuf])
}

// 生成纯色 PNG。
function makePng(width, height, rgb) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  // 每行：1 字节 filter type(0=None) + width*3 字节 RGB
  const rowLength = 1 + width * 3
  const raw = Buffer.alloc(rowLength * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowLength
    raw[rowStart] = 0
    for (let x = 0; x < width; x += 1) {
      const p = rowStart + 1 + x * 3
      // 加一点确定性纹理，避免完全单色影响视觉判断
      const shade = (x + y) % 16
      raw[p] = Math.min(255, rgb[0] + shade)
      raw[p + 1] = Math.min(255, rgb[1] + shade)
      raw[p + 2] = Math.min(255, rgb[2] + shade)
    }
  }

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// 最小合法 GIF（1x1 透明）。
function makeGif() {
  return Buffer.from([
    0x47,
    0x49,
    0x46,
    0x38,
    0x39,
    0x61, // GIF89a
    0x01,
    0x00,
    0x01,
    0x00,
    0x80,
    0x00,
    0x00,
    0xff,
    0xff,
    0xff,
    0x00,
    0x00,
    0x00,
    0x21,
    0xf9,
    0x04,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x2c,
    0x00,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0x02,
    0x02,
    0x44,
    0x01,
    0x00,
    0x3b,
  ])
}

// 最小合法 SVG。
function makeSvg(color, label) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60">
  <rect width="120" height="60" fill="${color}"/>
  <text x="60" y="36" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#fff">${label}</text>
</svg>
`,
    'utf8',
  )
}

async function write(fileName, buf) {
  const p = join(OUT, fileName)
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, buf)
  console.log(`${fileName}: ${buf.length} bytes`)
}

await write('sample.png', makePng(160, 90, [40, 90, 160]))
await write('中文图片.png', makePng(160, 90, [160, 70, 40]))
await write('带空格 的图片.png', makePng(120, 60, [70, 140, 90]))
await write('tiny.gif', makeGif())
await write('vector.svg', makeSvg('#2f81f7', 'SVG'))
await write('broken.png', Buffer.alloc(0))
await write('sub/nested.png', makePng(100, 50, [120, 60, 150]))

console.log('\n资源生成完成')

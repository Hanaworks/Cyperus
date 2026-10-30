#!/usr/bin/env node
// 诊断脚本：输出给定 Markdown 文件的实际标题 id（用与生产一致的 slugify）。
//
// 用途：写测试期望值时，以真实输出为准，而不是靠人工推算 slug 规则。
//
// 用法：node src/bench/dump-heading-ids.mjs fixtures/links.md

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 与 docs/design/01-render-pipeline.md §3.2 约定的 slugify 完全一致
function slugify(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
}

const file = process.argv[2]
if (!file) {
  console.error('用法: node src/bench/dump-heading-ids.mjs <file.md>')
  process.exit(1)
}

const text = readFileSync(resolve(process.cwd(), file), 'utf8')
const seen = new Map()

for (const line of text.split('\n')) {
  const m = /^(#{1,6})\s+(.*)$/.exec(line)
  if (!m) continue
  const level = m[1].length
  const raw = m[2].trim()
  const base = slugify(raw)
  const count = seen.get(base) ?? 0
  seen.set(base, count + 1)
  const id = count === 0 ? base : `${base}-${count}`
  console.log(`${'  '.repeat(level - 1)}h${level} "${raw}"  ->  #${id}`)
}

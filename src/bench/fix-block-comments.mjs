// 把被 biome 压平的块注释修复为行注释。
//
// 背景：biome 2.6.4 的 formatter 在处理含中文的 /** ... */ 时，
// 会把多行压成一行且丢失换行，导致注释与代码粘连（语法错误或语义混乱）。
// 已全局关闭 formatter，但之前被损坏的文件需要修复。
//
// 策略：把每个块注释按行拆开，每行前面加 //，
// 保留内容与顺序，不改变语义。
//
// 用法：node src/bench/fix-block-comments.mjs <file...>

import { readFile, writeFile } from 'node:fs/promises'

/** 把块注释转成行注释。 */
function convertBlockComments(source) {
  let out = ''
  let i = 0
  let changed = 0

  while (i < source.length) {
    const start = source.indexOf('/*', i)
    if (start === -1) {
      out += source.slice(i)
      break
    }

    // 保留块注释之前的内容
    out += source.slice(i, start)

    const end = source.indexOf('*/', start + 2)
    if (end === -1) {
      // 未闭合，原样保留
      out += source.slice(start)
      break
    }

    const body = source.slice(start + 2, end)
    const indentMatch = /[ \t]*$/.exec(out)
    const indent = indentMatch ? indentMatch[0] : ''

    const lines = body
      .split('\n')
      .map((line) => line.replace(/^\s*\*?\s?/, '').trimEnd())
      // 去掉首尾空行
      .filter((line, idx, arr) => {
        if (line !== '') return true
        // 保留中间的单个空行，去掉开头和结尾的空行
        if (idx === 0 || idx === arr.length - 1) return false
        return true
      })

    if (lines.length === 0) {
      out += ''
    } else {
      out += lines.map((line) => `${indent}// ${line}`.trimEnd()).join('\n')
    }

    changed += 1
    i = end + 2

    // 若块注释后紧跟换行，保留它
    if (source[i] === '\n') {
      out += '\n'
      i += 1
    } else if (source[i] === '\r' && source[i + 1] === '\n') {
      out += '\n'
      i += 2
    }
  }

  return { text: out, changed }
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('用法: node src/bench/fix-block-comments.mjs <file...>')
  process.exit(1)
}

for (const file of files) {
  const source = await readFile(file, 'utf8')
  const { text, changed } = convertBlockComments(source)
  if (changed > 0) {
    await writeFile(file, text, 'utf8')
    console.log(`${file}: 转换 ${changed} 个块注释`)
  } else {
    console.log(`${file}: 无需转换`)
  }
}

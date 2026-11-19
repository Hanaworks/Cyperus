import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('code-heavy is about 2 MiB, contains exactly 200 real code fences and is deterministic', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'md-fixtures-test-'))
  const generate = async (name) => {
    const output = join(directory, name)
    const result = spawnSync(process.execPath, ['src/bench/gen-fixtures.mjs', '--only', 'special', '--out', output], {
      cwd: repoRoot, encoding: 'utf8', timeout: 30000, windowsHide: true,
    })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    return readFile(join(output, 'fixtures/generated/code-heavy.md'))
  }
  try {
    const first = await generate('first')
    const second = await generate('second')
    const target = 2 * 1024 * 1024
    assert.ok(first.byteLength >= target, `Expected at least 2 MiB, got ${first.byteLength} bytes`)
    assert.ok(first.byteLength <= target + 32768, `Overshot the approximate 2 MiB target: ${first.byteLength}`)
    const markdown = first.toString('utf8')
    assert.equal([...markdown.matchAll(/^```(?:js|ts|python|rust|sql|bash|json|css)$/gm)].length, 200)
    assert.equal([...markdown.matchAll(/^```$/gm)].length, 200)
    const bodies = [...markdown.matchAll(/^```[^\n]*\n([\s\S]*?)^```$/gm)]
    const codeBytes = bodies.reduce((sum, match) => sum + Buffer.byteLength(match[1], 'utf8'), 0)
    assert.ok(codeBytes >= target * 0.97, 'The bulk of the fixture must be inside highlighted code fences')
    assert.deepEqual(first, second)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

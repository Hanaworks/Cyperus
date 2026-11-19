const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { applicationArgs, cleanEnvironment, validateApplication, runExecutable } = require('./external-apps.cjs')

test('external Code receives one absolute filename even when it contains shell punctuation', () => {
  assert.deepEqual(applicationArgs({ kind: 'code' }, 'D:\\资料\\a & $(whoami) 文档.md'), ['--reuse-window', 'D:\\资料\\a & $(whoami) 文档.md'])
  assert.deepEqual(applicationArgs({ kind: 'custom' }, 'D:\\资料\\-name.md'), ['D:\\资料\\-name.md'])
})

test('reader process overrides do not leak into personal editors', () => {
  assert.deepEqual(cleanEnvironment({ PATH: 'normal', VSCODE_APPDATA: 'isolated', VSCODE_IPC_HOOK: 'pipe', MD_READER_OPEN_FILE: 'fixture', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', NODE_PATH: 'private', LANG: 'zh_CN' }), { PATH: 'normal', LANG: 'zh_CN' })
})

test('rejects the running reader itself and missing applications', async () => {
  await assert.rejects(validateApplication(process.execPath, process.execPath), /自身/)
  await assert.rejects(validateApplication(path.resolve('artifacts/code-oss/missing-app.exe'), process.execPath), /不存在|ENOENT/)
  await assert.rejects(validateApplication('relative.exe', process.execPath), /绝对路径/)
  await assert.rejects(validateApplication('\\\\server\\share\\editor.exe', process.execPath), /本地/)
})

test('real child process preserves path arguments and working directory without a shell', async () => {
  const root = await fs.mkdtemp(path.resolve('artifacts/code-oss/external-args-'))
  const script = path.join(root, 'capture.cjs')
  const output = path.join(root, 'received.json')
  const target = path.join(root, '中文 & $(whoami) 文档.md')
  await fs.writeFile(script, "require('node:fs').writeFileSync(process.argv[2], JSON.stringify({args:process.argv.slice(3),cwd:process.cwd(),override:process.env.MD_READER_OPEN_FILE??null}))")
  await runExecutable(process.execPath, [script, output, target], { cwd: root, env: cleanEnvironment({ ...process.env, MD_READER_OPEN_FILE: 'must-not-leak' }) })
  for (let i = 0; i < 100; i++) {
    try {
      const got = JSON.parse(await fs.readFile(output, 'utf8'))
      assert.deepEqual(got, { args: [target], cwd: root, override: null })
      return
    } catch (error) { if (error.code !== 'ENOENT') throw error; await new Promise(resolve => setTimeout(resolve, 20)) }
  }
  assert.fail('Child process did not record its arguments')
})

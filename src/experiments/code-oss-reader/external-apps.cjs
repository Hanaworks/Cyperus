const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const exec = promisify(execFile)

function cleanEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^(VSCODE_|MD_READER_|ELECTRON_RUN_AS_NODE$|NODE_OPTIONS$|NODE_PATH$)/i.test(key)))
}
function applicationArgs(app, file) {
  return app.kind === 'code' ? ['--reuse-window', file] : [file]
}
async function validateApplication(executable, selfExecutable = process.execPath) {
  if (typeof executable !== 'string' || !path.isAbsolute(executable) || /[\0\r\n]/.test(executable)) throw Error('请选择应用的绝对路径')
  if (/^[\\/]{2}/.test(executable)) throw Error('请选择本地应用')
  if (path.extname(executable).toLowerCase() !== '.exe') throw Error('请选择可执行应用（.exe）')
  const canonical = await fs.realpath(executable)
  const self = await fs.realpath(selfExecutable)
  if (canonical.toLowerCase() === self.toLowerCase()) throw Error('不能选择阅读器自身，请选择其他应用')
  if (!(await fs.stat(canonical)).isFile()) throw Error('应用不存在')
  return canonical
}
function runExecutable(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, shell: false, stdio: 'ignore', detached: true })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve({ pid: child.pid }) })
  })
}
async function launchApplication(app, file) {
  const executable = await validateApplication(app.executable)
  if (!path.isAbsolute(file) || /^[\\/]{2}/.test(file) || !(await fs.stat(file)).isFile()) throw Error('请打开一个存在的本地文件')
  return runExecutable(executable, applicationArgs(app, file), { cwd: path.dirname(file), env: cleanEnvironment() })
}
async function discoverApplications(env = process.env) {
  const candidates = []
  const addCode = root => { if (root) candidates.push({ label: 'VS Code', kind: 'code', executable: path.join(root, 'Code.exe') }) }
  if (env.LOCALAPPDATA) addCode(path.join(env.LOCALAPPDATA, 'Programs/Microsoft VS Code'))
  for (const root of [env.ProgramFiles, env['ProgramFiles(x86)']]) if (root) addCode(path.join(root, 'Microsoft VS Code'))
  for (const entry of (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    addCode(entry)
    if (path.basename(entry).toLowerCase() === 'bin') addCode(path.dirname(entry))
  }
  if (env['ProgramFiles(x86)']) {
    const locator = path.join(env['ProgramFiles(x86)'], 'Microsoft Visual Studio/Installer/vswhere.exe')
    try {
      const { stdout } = await exec(locator, ['-latest', '-prerelease', '-products', '*', '-property', 'installationPath'], { timeout: 3000, windowsHide: true })
      const install = stdout.trim()
      if (install && path.isAbsolute(install)) candidates.push({ label: 'Visual Studio', kind: 'visual-studio', executable: path.join(install, 'Common7/IDE/devenv.exe') })
    } catch { /* Visual Studio is optional. */ }
  }
  const found = []
  for (const candidate of candidates) {
    try {
      const executable = await validateApplication(candidate.executable)
      if (!found.some(app => app.executable.toLowerCase() === executable.toLowerCase())) found.push({ ...candidate, executable })
    } catch { /* Missing installations are not shown. */ }
  }
  return found
}
async function openTerminal(file) {
  if (!path.isAbsolute(file) || /^[\\/]{2}/.test(file) || !(await fs.stat(file)).isFile()) throw Error('请打开一个存在的本地文件')
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
  return runExecutable(executable, ['-NoLogo', '-NoProfile', '-NoExit'], { cwd: path.dirname(file), env: cleanEnvironment() })
}
module.exports = { applicationArgs, cleanEnvironment, validateApplication, runExecutable, launchApplication, discoverApplications, openTerminal }

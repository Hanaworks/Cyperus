const { posix } = require('node:path')

// Audited against this Code OSS checkout. These are feature roots, not a
// wildcard ban on scopes or SDK-looking names. Callers must first disconnect
// their workbench/shared-process/main-process entry points. A core dependency
// or explicit retain always wins over this policy, including all descendants.
const REMOVAL_POLICY = Object.freeze({
  '@vscode/tree-sitter-wasm': 'The Reader registers the upstream inert standalone service and uses TextMate.',
  'node-pty': 'The Reader desktop bundle has no native PTY process.',
  '@xterm/headless': 'The local PTY host is disconnected and excluded from the desktop bundle.',
  '@github/copilot-sdk': 'AgentHost Copilot provider removed (platform/agentHost/node/copilot/copilotAgent.ts); its optional platform runtimes follow its dependency closure.',
  '@anthropic-ai/sdk': 'AgentHost provider types/API removed (platform/agentHost/node/shared/copilotApiService.ts).',
  '@vscode/copilot-api': 'AgentHost provider API removed (platform/agentHost/node/shared/copilotApiService.ts).',
  '@hpke/core': 'AgentHost Mission Control credential encryption removed (platform/agentHost/node/missionControl/missionControlAuthentication.ts).',
  'libsodium-wrappers': 'AgentHost credential sealing removed (platform/agentHost/node/missionControl/missionControlAuthentication.ts).',
  '@vscode/sandbox-runtime': 'AgentHost/terminal sandbox CLI feature removed (platform/sandbox/common/terminalSandboxEngine.ts).',
  'foundry-local-sdk': 'Local speech transcription replaced with the null service (platform/localTranscription/node/localTranscriptionService.ts).',
  '@devcontainers/cli': 'AgentHost container sandboxes and remote-container channels removed (platform/agentHost/node/devContainerSandbox.ts).',
  '@microsoft/dev-tunnels-connections': 'Remote AgentHost tunnel service/channel removed (platform/agentHost/node/tunnelAgentHostService.ts).',
  '@microsoft/dev-tunnels-contracts': 'Remote AgentHost tunnel service/channel removed (platform/agentHost/node/tunnelAgentHostService.ts).',
  '@microsoft/dev-tunnels-management': 'Remote AgentHost tunnel service/channel removed (platform/agentHost/node/tunnelAgentHostService.ts).',
  '@microsoft/dev-tunnels-ssh': 'Remote AgentHost tunnel transport removed; a peer of dev-tunnels-connections.',
  '@microsoft/dev-tunnels-ssh-tcp': 'Remote AgentHost tunnel transport removed; a peer of dev-tunnels-connections.',
  'ssh2': 'Remote AgentHost SSH service/channel removed (platform/agentHost/node/sshRemoteAgentHostService.ts).',
  'playwright-core': 'Embedded browser automation and shared-process Playwright service removed (platform/browserView/node/playwrightService.ts).'
})

// These candidates were audited and deliberately retained. Configuration alone
// is not proof that a service or its runtime import is unreachable.
const RETAINED_AUDIT = Object.freeze({
  'kerberos': 'General HTTP proxy authentication still imports it (platform/request/node/requestService.ts).',
  'chrome-remote-interface': 'Shared-process V8 inspection/profiling still reaches base/node/profiling.ts.',
  '@microsoft/1ds-core-js': 'Telemetry appender runtime import remains (platform/telemetry/common/1dsAppender.ts).',
  '@microsoft/1ds-post-js': 'Telemetry appender runtime import remains (platform/telemetry/common/1dsAppender.ts).',
  'tas-client': 'Assignment service runtime loader remains (workbench/services/assignment/common/assignmentService.ts).',
  '@xterm/xterm': 'Browser terminal compatibility surfaces still reference it.'
})

const NATIVE_BUILD_EXTENSIONS = new Set(['.obj', '.o', '.pdb', '.ipdb', '.iobj', '.ilk', '.lib', '.a', '.exp', '.pch', '.idb', '.tlog', '.lastbuildstate'])
const noticeName = /^(?:licen[cs]es?|copying|copyright|notices?|third[-_ ]?party[-_ ]?notices?)(?:$|[._ -])/i

function shouldShipFile(relativePath, { isDirectory = false } = {}) {
  if (isDirectory) return true
  const parts = relativePath.replaceAll('\\', '/').split('/')
  // Preserve notices even if an upstream vendor gave them a build-like suffix.
  if (parts.some(part => noticeName.test(part))) return true
  return !NATIVE_BUILD_EXTENSIONS.has(posix.extname(parts.at(-1)).toLowerCase())
}

function packageName(packagePath) {
  return packagePath.split('node_modules/').at(-1)
}

function createRuntimePlan(lock, { retain = [] } = {}) {
  if (!lock?.packages?.['']) throw Error('An npm package-lock with packages and a root package is required')
  const packages = lock.packages
  const production = new Set()
  const installedPaths = new Set()
  for (const [packagePath, metadata] of Object.entries(packages)) {
    if (!packagePath || !packagePath.startsWith('node_modules/')) continue
    if (!/^(?:node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(packagePath)
      || packagePath.includes('\\') || packagePath.split('/').some(part => part === '.' || part === '..')) {
      throw Error(`Invalid package path: ${packagePath}`)
    }
    installedPaths.add(packagePath)
    if (!metadata.dev) production.add(packagePath)
  }

  function resolveDependency(from, name) {
    let directory = from
    while (true) {
      const candidate = directory ? `${directory}/node_modules/${name}` : `node_modules/${name}`
      if (installedPaths.has(candidate)) return candidate
      if (!directory) return undefined
      const parent = posix.dirname(directory)
      directory = parent === '.' ? '' : parent
    }
  }

  function references(metadata) {
    const refs = new Map(Object.keys(metadata.dependencies ?? {}).map(name => [name, true]))
    for (const name of Object.keys(metadata.optionalDependencies ?? {})) refs.set(name, false)
    for (const name of Object.keys(metadata.peerDependencies ?? {})) {
      if (!refs.has(name)) refs.set(name, !metadata.peerDependenciesMeta?.[name]?.optional)
    }
    return refs
  }

  const edges = new Map()
  function dependencyEdges(packagePath) {
    if (edges.has(packagePath)) return edges.get(packagePath)
    if (packages[packagePath].link) throw Error(`Linked runtime package requires a separate packaging audit: ${packagePath}`)
    const resolved = new Map()
    for (const [name, required] of references(packages[packagePath])) {
      const target = resolveDependency(packagePath, name)
      if (target) resolved.set(name, target)
      else if (required) throw Error(`Required dependency ${name} is missing from ${packagePath || 'the root package'}`)
    }
    edges.set(packagePath, resolved)
    return resolved
  }

  function closure(seeds) {
    const owners = new Map()
    const pending = [...seeds]
    while (pending.length) {
      const [packagePath, owner] = pending.pop()
      if (owners.get(packagePath)?.has(owner)) continue
      if (!owners.has(packagePath)) owners.set(packagePath, new Set())
      owners.get(packagePath).add(owner)
      for (const child of dependencyEdges(packagePath).values()) pending.push([child, owner])
    }
    return owners
  }

  const roots = [...dependencyEdges('')]
  const allRootPaths = closure(roots.map(([name, packagePath]) => [packagePath, name]))
  const denySeeds = roots.filter(([name]) => Object.hasOwn(REMOVAL_POLICY, name)).map(([name, packagePath]) => [packagePath, name])
  const keepSeeds = roots.filter(([name]) => !Object.hasOwn(REMOVAL_POLICY, name)).map(([name, packagePath]) => [packagePath, name])
  // Unknown production entries may serve unrecorded dynamic imports. Keep them
  // and their dependencies rather than silently equating "unreachable" with safe.
  for (const packagePath of production) {
    if (!allRootPaths.has(packagePath)) keepSeeds.push([packagePath, `untracked runtime ${packagePath}`])
  }
  for (const selector of retain) {
    const matches = [...installedPaths].filter(packagePath => packagePath === selector || packageName(packagePath) === selector)
    if (!matches.length) throw Error(`Unknown retain package: ${selector}`)
    for (const packagePath of matches) keepSeeds.push([packagePath, `explicit retain ${selector}`])
  }

  const excludedClosure = closure(denySeeds)
  const retainedClosure = closure(keepSeeds)
  // npm can mark a required peer as dev-only (the upstream telemetry peer
  // tslib is one example). Runtime reachability overrides that metadata flag.
  for (const packagePath of [...excludedClosure.keys(), ...retainedClosure.keys()]) production.add(packagePath)
  const includedPaths = new Set()
  const omittedPaths = new Set()
  const reasons = {}
  for (const packagePath of [...production].sort()) {
    if (excludedClosure.has(packagePath) && !retainedClosure.has(packagePath)) {
      omittedPaths.add(packagePath)
      reasons[packagePath] = [...excludedClosure.get(packagePath)].sort().map(name => `${name}: ${REMOVAL_POLICY[name]}`).join(' ')
    } else {
      includedPaths.add(packagePath)
      reasons[packagePath] = `Required by ${[...(retainedClosure.get(packagePath) ?? [])].sort().join(', ') || 'untracked production runtime'}.`
    }
  }
  const rootNames = new Set([...Object.keys(packages[''].dependencies ?? {}), ...Object.keys(packages[''].optionalDependencies ?? {})])
  const removedRootDependencies = [...rootNames].filter(name => Object.hasOwn(REMOVAL_POLICY, name)
    && !includedPaths.has(resolveDependency('', name))).sort()
  return { includedPaths, omittedPaths, removedRootDependencies, reasons }
}

function shouldShipWindowsX64DependencyFile(packagePath, relativePath) {
  const file = relativePath.replaceAll('\\', '/')
  if (packagePath === 'node_modules/@vscode/ripgrep-universal') {
    const platform = /^bin\/([^/]+)(?:\/|$)/.exec(file)?.[1]
    return platform === undefined || platform === 'win32-x64'
  }
  if (packagePath === 'node_modules/@vscode/sqlite3') {
    return !/^build\/Release\/obj\/global_intermediate(?:\/|$)/.test(file)
      && !/^deps\/sqlite-autoconf-\d+\.tar\.gz$/.test(file)
  }
  return true
}

module.exports = { createRuntimePlan, shouldShipFile, shouldShipWindowsX64DependencyFile, REMOVAL_POLICY, RETAINED_AUDIT }

const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const zero = value => /^0+$/.test(value)
function newer(left, right) {
  const a = left.split('.').map(BigInt), b = right.split('.').map(BigInt)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

function createReleaseTools({ appRoot = path.resolve(__dirname, '..'), remote = 'origin' } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd: appRoot, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const optionalGit = (...args) => {
    try { return git(...args) } catch (error) { if (error.status === 1) return null; throw error }
  }
  function version() {
    const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'))
    const lock = JSON.parse(fs.readFileSync(path.join(appRoot, 'package-lock.json'), 'utf8'))
    assert.match(pkg.version, stableVersion, 'Use a stable semantic version, such as 2.2.1')
    assert.equal(lock.version, pkg.version, 'Lockfile version mismatch')
    assert.equal(lock.packages[''].version, pkg.version, 'Root lockfile version mismatch')
    return pkg.version
  }
  function remoteTags() {
    try {
      return new Map(git('ls-remote', '--tags', '--', remote).split(/\r?\n/).filter(Boolean).map(line => line.split(/\s+/).reverse()))
    } catch {
      throw new Error(`Cannot verify tags on ${remote}. No release tag will be created or pushed. Check remote access and retry.`)
    }
  }
  const refFor = value => `refs/tags/v${value}`
  const localTag = value => optionalGit('rev-parse', '--verify', '--quiet', refFor(value))
  function requireNewVersion(value, tags) {
    for (const ref of tags.keys()) {
      const published = ref.slice('refs/tags/v'.length)
      if (ref.startsWith('refs/tags/v') && stableVersion.test(published) && !newer(value, published)) {
        throw new Error(`v${value} must be newer than published ${ref.slice('refs/tags/'.length)}. Bump package.json and package-lock.json before a new release.`)
      }
    }
  }
  function check() {
    const value = version(), local = localTag(value), tags = remoteTags(), published = tags.get(refFor(value))
    if (local || published) throw new Error(`v${value} already exists${local ? ` locally (${local})` : ''}${published ? ` on ${remote} (${published})` : ''}. Existing release tags are immutable; choose a new version. Do not delete or move the tag.`)
    requireNewVersion(value, tags)
    return `v${value}`
  }
  function cleanHead() {
    assert.equal(git('status', '--porcelain'), '', 'Release tagging/pushing requires a clean committed tree')
    return git('rev-parse', 'HEAD')
  }
  function create() {
    const tag = check(), head = cleanHead()
    // No --force: Git also rejects a concurrent creator of the same local tag.
    git('tag', '--create-reflog', '-a', tag, head, '-m', `Cortex DL ${tag}`)
    return tag
  }
  function verify({ allowUnpublished = false } = {}) {
    const value = version(), ref = refFor(value), local = localTag(value), tags = remoteTags(), published = tags.get(ref)
    assert.ok(local, `Missing local ${ref}`)
    if (published) {
      assert.equal(local, published, `${ref} Git object differs from ${remote}; stop and investigate without moving the published tag`)
    } else {
      assert.ok(allowUnpublished, `Missing ${ref} on ${remote}`)
      requireNewVersion(value, tags)
    }
    const commit = git('rev-parse', `${ref}^{commit}`)
    assert.equal(commit, git('rev-parse', 'HEAD'), `${ref} belongs to a different commit; bump the version before publishing current changes`)
    return `v${value}`
  }
  function push() {
    const value = version(), ref = refFor(value), local = localTag(value), tags = remoteTags()
    assert.ok(local, `Create v${value} with release:tag first`)
    assert.ok(!tags.has(ref), `${ref} already exists on ${remote}; it cannot be reused or overwritten`)
    requireNewVersion(value, tags)
    assert.equal(git('rev-parse', `${ref}^{commit}`), cleanHead(), `${ref} must identify the current clean commit`)
    // Push only this new tag. The server rejects any race; never retry with force.
    git('push', '--no-follow-tags', remote, `${ref}:${ref}`)
    return `v${value}`
  }
  function guardPush(input) {
    const updates = input.trim().split(/\r?\n/).filter(Boolean).map(line => line.split(/\s+/)).filter(([, , ref]) => ref?.startsWith('refs/tags/'))
    if (!updates.length) return
    // Inspect the actual destination before allowing direct Git/GUI tag pushes too.
    const value = version(), ref = refFor(value), tags = remoteTags()
    for (const [localRef, localObject, remoteRef, remoteObject] of updates) {
      assert.ok(!zero(localObject), `Deleting published tag ${remoteRef} is prohibited`)
      assert.ok(zero(remoteObject) && !tags.has(remoteRef), `${remoteRef} already exists on ${remote}; existing tags cannot be reused or overwritten`)
      assert.equal(remoteRef, ref, `New release tag must match package version v${value}`)
      assert.equal(localRef, remoteRef, 'Push the release tag explicitly, without renaming it')
      assert.equal(localTag(value), localObject, 'Local tag changed during push')
      assert.equal(git('rev-parse', `${ref}^{commit}`), cleanHead(), `${ref} must identify the current clean commit`)
      requireNewVersion(value, tags)
    }
  }
  function installHooks() {
    const configured = optionalGit('config', '--get', 'core.hooksPath')
    assert.ok(!configured, `Custom core.hooksPath is configured (${configured}); integrate the release guards there instead of disabling existing hooks`)
    const hooks = path.resolve(appRoot, git('rev-parse', '--git-path', 'hooks'))
    const launcher = mode => `#!/bin/sh\n# Cortex DL immutable release tag guard (managed by release-tags.cjs).\nroot=$(git rev-parse --show-toplevel) || exit 1\nguard="$(git rev-parse --git-path hooks)/cortex-release-tags.cjs"\nCORTEX_RELEASE_APP_ROOT="$root/app" exec node "$guard" ${mode} "$@"\n`
    const files = [['pre-push', launcher('guard-push')], ['reference-transaction', launcher('guard-update')]]
    const helper = path.join(hooks, 'cortex-release-tags.cjs')
    const managed = '// Cortex DL installed release tag guards. Regenerated by git:hooks.\n'
    // Preflight both destinations before installing either; never replace another hook.
    for (const [name, content] of files) {
      const file = path.join(hooks, name)
      if (fs.existsSync(file)) assert.equal(fs.readFileSync(file, 'utf8'), content, `Existing ${name} hook preserved; integrate the release guard before installing`)
    }
    if (fs.existsSync(helper)) assert.ok(fs.readFileSync(helper, 'utf8').startsWith(managed), 'Existing cortex-release-tags.cjs helper preserved; inspect it before installing')
    fs.mkdirSync(hooks, { recursive: true })
    // Keep a local copy so checking out an older branch cannot break Git hooks.
    const stagedHelper = `${helper}.${process.pid}.tmp`
    try {
      fs.writeFileSync(stagedHelper, managed + fs.readFileSync(__filename, 'utf8'), { flag: 'wx' })
      fs.renameSync(stagedHelper, helper)
    } finally { fs.rmSync(stagedHelper, { force: true }) }
    for (const [name, content] of files) {
      const file = path.join(hooks, name)
      if (!fs.existsSync(file)) fs.writeFileSync(file, content, { flag: 'wx', mode: 0o755 })
      fs.chmodSync(file, 0o755)
    }
    return hooks
  }
  return { version, check, create, verify, push, guardPush, installHooks }
}

function guardUpdates(input, state) {
  if (state !== 'prepared') return
  for (const line of input.trim().split(/\r?\n/).filter(Boolean)) {
    const [oldObject, newObject, ref] = line.split(/\s+/)
    if (ref?.startsWith('refs/tags/') && !zero(oldObject) && oldObject !== newObject) {
      throw new Error(`${ref} is immutable. Refusing to move or delete an existing local tag; use a new release version. For a verified upstream repair, back it up and explicitly review the repair first.`)
    }
  }
}

function main() {
  const mode = process.argv[2]
  if (mode === 'guard-update') { guardUpdates(fs.readFileSync(0, 'utf8'), process.argv[3]); return }
  const tools = createReleaseTools({ appRoot: process.env.CORTEX_RELEASE_APP_ROOT || path.resolve(__dirname, '..'), remote: mode === 'guard-push' ? process.argv[3] : 'origin' })
  if (mode === 'guard-push') { tools.guardPush(fs.readFileSync(0, 'utf8')); return }
  const actions = { check: tools.check, create: tools.create, push: tools.push, verify: tools.verify, 'install-hooks': tools.installHooks }
  assert.ok(actions[mode], 'Usage: release-tags.cjs check|create|push|verify|install-hooks')
  console.log(`${mode}: ${actions[mode]()}`)
}
if (require.main === module) {
  try { main() } catch (error) { console.error(`[release tags] ${error.message}`); process.exitCode = 1 }
}
module.exports = { createReleaseTools, guardUpdates }

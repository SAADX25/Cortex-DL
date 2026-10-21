const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const { createReleaseTools, guardUpdates } = require('../scripts/release-tags.cjs')
const script = path.resolve(__dirname, '../scripts/release-tags.cjs')

function fixture(work) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-release-tags-'))
  const repository = path.join(directory, 'checkout'), remote = path.join(directory, 'remote.git')
  const appRoot = path.join(repository, 'app')
  fs.mkdirSync(path.join(appRoot, 'scripts'), { recursive: true })
  const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const git = (...args) => run(repository, ...args)
  function setVersion(version, commit = true) {
    fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'release-fixture', version }))
    fs.writeFileSync(path.join(appRoot, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version } } }))
    if (commit) { git('add', '.'); git('commit', '-m', 'Fixture version') }
  }
  try {
    run(directory, '-c', 'init.defaultBranch=master', 'init', '--bare', remote)
    git('-c', 'init.defaultBranch=master', 'init')
    git('config', 'user.name', 'Release fixture'); git('config', 'user.email', 'fixture@example.invalid')
    git('config', 'commit.gpgSign', 'false'); git('config', 'tag.gpgSign', 'false')
    fs.copyFileSync(script, path.join(appRoot, 'scripts/release-tags.cjs'))
    setVersion('2.2.1')
    git('remote', 'add', 'origin', remote)
    git('tag', 'v2.2.0')
    git('push', 'origin', 'refs/tags/v2.2.0:refs/tags/v2.2.0')
    return work({ directory, repository, remote, appRoot, git, setVersion, tools: createReleaseTools({ appRoot }) })
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(directory).startsWith('cortex-release-tags-'))
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('new versions create one annotated tag with a reflog and push only that tag', () => fixture(({ git, tools }) => {
  const head = git('rev-parse', 'HEAD')
  assert.equal(tools.check(), 'v2.2.1')
  assert.equal(tools.create(), 'v2.2.1')
  assert.equal(git('cat-file', '-t', 'refs/tags/v2.2.1'), 'tag')
  assert.equal(git('rev-parse', 'v2.2.1^{}'), head)
  assert.doesNotThrow(() => git('reflog', 'exists', 'refs/tags/v2.2.1'))
  assert.equal(tools.push(), 'v2.2.1')
  assert.ok(git('ls-remote', 'origin', 'refs/tags/v2.2.1').startsWith(git('rev-parse', 'refs/tags/v2.2.1')))
  assert.equal(git('ls-remote', 'origin', 'refs/heads/*'), '', 'Tag publication must not push branches')
  assert.equal(tools.verify(), 'v2.2.1')
}))

test('duplicate local tag is rejected before creation and its object stays intact', () => fixture(({ git, tools }) => {
  git('tag', 'v2.2.1')
  const before = git('rev-parse', 'refs/tags/v2.2.1')
  assert.throws(() => tools.create(), /already exists locally/)
  assert.equal(git('rev-parse', 'refs/tags/v2.2.1'), before)
}))

test('local release builds can validate a new unpublished tag before the explicit push', () => fixture(({ tools }) => {
  tools.create()
  assert.throws(() => tools.verify(), /Missing refs\/tags\/v2.2.1 on origin/)
  assert.equal(tools.verify({ allowUnpublished: true }), 'v2.2.1')
}))

test('remote-only duplicate is rejected and is never fetched over a local tag or recreated', () => fixture(({ git, tools, setVersion }) => {
  setVersion('2.2.0')
  git('update-ref', '-d', 'refs/tags/v2.2.0')
  const before = git('ls-remote', '--tags', 'origin')
  assert.throws(() => tools.create(), /already exists on origin/)
  assert.equal(git('ls-remote', '--tags', 'origin'), before)
  assert.equal(git('tag', '--list', 'v2.2.0'), '', 'Preflight must not recreate a tag missing locally')
}))

test('an existing remote tag cannot be pushed again, even with an identical local object', () => fixture(({ git, tools }) => {
  tools.create(); tools.push()
  const before = git('ls-remote', '--tags', 'origin')
  assert.throws(() => tools.push(), /already exists on origin/)
  assert.equal(git('ls-remote', '--tags', 'origin'), before)
}))

test('unreachable remote fails closed before creating any version tag', () => fixture(({ directory, git, tools }) => {
  git('remote', 'set-url', 'origin', path.join(directory, 'absent.git'))
  assert.throws(() => tools.create(), /Cannot verify tags.*No release tag will be created or pushed/)
  assert.equal(git('tag', '--list', 'v2.2.1'), '')
}))

test('new versions must be greater than every published stable version', () => fixture(({ tools, setVersion }) => {
  setVersion('2.1.9')
  assert.throws(() => tools.check(), /must be newer than published v2.2.0/)
}))

test('package/lockfile mismatch and uncommitted source changes block tagging', () => fixture(({ appRoot, git, tools }) => {
  const lock = path.join(appRoot, 'package-lock.json'), original = fs.readFileSync(lock)
  fs.writeFileSync(lock, JSON.stringify({ version: '2.2.2', packages: { '': { version: '2.2.2' } } }))
  assert.throws(() => tools.create(), /Lockfile version mismatch/)
  fs.writeFileSync(lock, original)
  fs.writeFileSync(path.join(appRoot, 'uncommitted.txt'), 'fixture')
  assert.throws(() => tools.create(), /clean committed tree/)
  assert.equal(git('tag', '--list', 'v2.2.1'), '')
}))

test('release verification rejects different tag objects even when their peeled commits match', () => fixture(({ git, tools }) => {
  tools.create(); tools.push()
  const target = git('rev-parse', 'v2.2.1^{}')
  git('update-ref', 'refs/tags/v2.2.1', target)
  assert.throws(() => tools.verify(), /Git object differs from origin/)
}))

test('release verification rejects a tag attached to a different source commit', () => fixture(({ appRoot, git, tools }) => {
  tools.create(); tools.push()
  fs.writeFileSync(path.join(appRoot, 'next-source.txt'), 'new source update')
  git('add', '.'); git('commit', '-m', 'Fixture source update')
  assert.throws(() => tools.verify(), /belongs to a different commit/)
}))

test('reference guard rejects moving or deleting a tag and permits new tags or branch updates', () => {
  const old = '1'.repeat(40), next = '2'.repeat(40), empty = '0'.repeat(40)
  assert.throws(() => guardUpdates(`${old} ${next} refs/tags/v2.2.0\n`, 'prepared'), /immutable/)
  assert.throws(() => guardUpdates(`${old} ${empty} refs/tags/v2.2.0\n`, 'prepared'), /immutable/)
  assert.doesNotThrow(() => guardUpdates(`${empty} ${next} refs/tags/v2.2.1\n${old} ${next} refs/heads/master\n`, 'prepared'))
  assert.doesNotThrow(() => guardUpdates(`${old} ${next} refs/tags/v2.2.0\n`, 'committed'))
})

test('installed hooks block actual local tag movement while normal branch/tag synchronization works', () => fixture(({ repository, appRoot, git, tools }) => {
  const old = git('rev-parse', 'v2.2.0')
  fs.writeFileSync(path.join(appRoot, 'next-source.txt'), 'fixture')
  git('add', '.'); git('commit', '-m', 'Fixture source')
  const head = git('rev-parse', 'HEAD')
  tools.installHooks(); tools.installHooks()
  const source = path.join(appRoot, 'scripts/release-tags.cjs')
  fs.renameSync(source, source + '.fixture-backup')
  const attempt = spawnSync('git', ['update-ref', 'refs/tags/v2.2.0', head, old], { cwd: repository, encoding: 'utf8', windowsHide: true })
  assert.notEqual(attempt.status, 0)
  assert.match(attempt.stderr, /immutable/)
  assert.equal(git('rev-parse', 'v2.2.0'), old)
  git('push', 'origin', 'refs/heads/master:refs/heads/master')
  fs.renameSync(source + '.fixture-backup', source)
  tools.create(); tools.push()
  git('fetch', '--tags', 'origin')
  assert.equal(tools.verify(), 'v2.2.1')
}))

test('direct/GUI tag push guard rejects duplicates, deletion and a package-version mismatch', () => fixture(({ git, tools }) => {
  const head = git('rev-parse', 'HEAD'), empty = '0'.repeat(40)
  assert.throws(() => tools.guardPush(`refs/tags/v2.2.0 ${head} refs/tags/v2.2.0 ${head}\n`), /already exists/)
  assert.throws(() => tools.guardPush(`(delete) ${empty} refs/tags/v2.2.0 ${head}\n`), /Deleting published tag/)
  assert.throws(() => tools.guardPush(`refs/tags/v2.2.2 ${head} refs/tags/v2.2.2 ${empty}\n`), /must match package version/)
}))

test('hook installation preserves an existing custom hook without partially installing another', () => fixture(({ repository, tools }) => {
  const hook = path.join(repository, '.git/hooks/pre-push'), existing = '#!/bin/sh\n# User hook\nexit 0\n'
  fs.mkdirSync(path.dirname(hook), { recursive: true }); fs.writeFileSync(hook, existing)
  assert.throws(() => tools.installHooks(), /Existing pre-push hook preserved/)
  assert.equal(fs.readFileSync(hook, 'utf8'), existing)
  assert.equal(fs.existsSync(path.join(path.dirname(hook), 'reference-transaction')), false)
}))

test('hook installation does not override a repository-specific hook configuration', () => fixture(({ git, tools }) => {
  git('config', 'core.hooksPath', 'custom-hooks')
  assert.throws(() => tools.installHooks(), /Custom core.hooksPath is configured/)
  assert.equal(git('config', '--get', 'core.hooksPath'), 'custom-hooks')
}))

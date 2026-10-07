const fs = require('node:fs/promises')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const generated = [
  'dist-electron', 'Front-End/dist', 'smoke-results', 'installer-validation',
  'bin', 'build-manifest.json', 'THIRD-PARTY-NOTICES.txt',
  'tsconfig.node.tsbuildinfo', 'vite.config.js', 'vite.config.d.ts',
]

async function statIfPresent(file) {
  try { return await fs.lstat(file) }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null }
}

// Refuse junctions/symlinks before removing anything, including redirected parents.
async function assertLocal(root, target) {
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Cleanup target is outside app: ${target}`)
  }
  let current = root
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    const stat = await statIfPresent(current)
    if (!stat) break
    if (stat.isSymbolicLink()) throw new Error(`Cleanup refuses linked path: ${current}`)
  }
}

async function inspect(target) {
  const stat = await statIfPresent(target)
  if (!stat) return { files: 0, bytes: 0 }
  if (stat.isSymbolicLink()) throw new Error(`Cleanup refuses linked path: ${target}`)
  if (!stat.isDirectory()) return { files: 1, bytes: stat.size }
  const total = { files: 0, bytes: 0 }
  for (const name of await fs.readdir(target)) {
    const entry = await inspect(path.join(target, name))
    total.files += entry.files
    total.bytes += entry.bytes
  }
  return total
}

async function cleanProject(root = appRoot, { dryRun = false, packaged = false } = {}) {
  root = path.resolve(root)
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('Cleanup refuses a linked app root')
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  if (pkg.name !== 'cortex-dl') throw new Error('Cleanup requires the Cortex DL app directory')
  const targets = generated.map(name => path.join(root, name))
  if (packaged) {
    const release = path.join(root, 'release')
    await assertLocal(root, release)
    if (await statIfPresent(release)) {
      for (const version of await fs.readdir(release)) {
        if (/^\d+\.\d+\.\d+$/.test(version)) targets.push(path.join(release, version, 'win-unpacked'))
      }
    }
  }
  // Preflight the complete plan so an unsafe target cannot cause partial cleanup.
  const plan = []
  for (const target of targets) {
    await assertLocal(root, target)
    plan.push({ target, ...await inspect(target) })
  }
  for (const { target } of plan) {
    if (!dryRun) await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
  return plan
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const unknown = args.find(arg => !['--dry-run', '--packaged'].includes(arg))
  if (unknown) {
    console.error(`Unknown cleanup option: ${unknown}`)
    process.exitCode = 1
  } else {
    const dryRun = args.includes('--dry-run')
    cleanProject(appRoot, { dryRun, packaged: args.includes('--packaged') }).then(plan => {
      for (const entry of plan) console.log(`${dryRun ? 'Would remove' : 'Removed'} ${path.relative(appRoot, entry.target)} (${entry.files} files, ${(entry.bytes / 1024 ** 2).toFixed(2)} MiB)`)
      const bytes = plan.reduce((sum, entry) => sum + entry.bytes, 0)
      console.log(`${dryRun ? 'Reclaimable' : 'Reclaimed'}: ${(bytes / 1024 ** 3).toFixed(2)} GiB`)
    }).catch(error => { console.error(error.message); process.exitCode = 1 })
  }
}

module.exports = { cleanProject }

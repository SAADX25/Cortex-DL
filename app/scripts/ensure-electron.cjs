const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const electronDir = path.dirname(require.resolve('electron/package.json'))
const { version } = require('electron/package.json')
const executableName = 'electron.exe'
const executablePath = path.join(electronDir, 'dist', executableName)
const pathFile = path.join(electronDir, 'path.txt')
const distDir = path.join(electronDir, 'dist')
const archiveName = `electron-v${version}-win32-${process.arch}.zip`
const checksums = JSON.parse(fs.readFileSync(path.join(electronDir, 'checksums.json'), 'utf8'))

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function isValidArchive(filePath) {
  if (!fs.existsSync(filePath)) return false
  const expected = checksums[archiveName]
  return Boolean(expected) && sha256(filePath) === expected
}

function findCachedArchive(rootDir) {
  if (!fs.existsSync(rootDir)) return null
  let entries
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true })
  } catch {
    return null
  }

  for (const entry of entries) {
    const candidate = path.join(rootDir, entry.name)
    if (entry.isFile() && entry.name === archiveName && isValidArchive(candidate)) return candidate
    if (entry.isDirectory()) {
      const nested = findCachedArchive(candidate)
      if (nested) return nested
    }
  }
  return null
}

function run(command, args, description) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${description} failed with exit code ${result.status}`)
}

function ensureElectron() {
  if (process.platform !== 'win32') {
    throw new Error('Cortex DL development currently requires Windows.')
  }

  if (!fs.existsSync(executablePath)) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    const defaultCacheRoot = process.env.electron_config_cache || path.join(localAppData, 'electron', 'Cache')
    let archivePath = findCachedArchive(defaultCacheRoot)

    if (!archivePath) {
      const cacheDir = path.join(defaultCacheRoot, 'cortex-dl')
      fs.mkdirSync(cacheDir, { recursive: true })
      archivePath = path.join(cacheDir, archiveName)
      const url = `https://github.com/electron/electron/releases/download/v${version}/${archiveName}`
      console.log(`Electron ${version} binary is missing; downloading it now...`)
      run('curl.exe', ['--fail', '--location', '--output', archivePath, url], 'Electron download')
      if (!isValidArchive(archivePath)) throw new Error('Downloaded Electron archive failed SHA-256 verification.')
    }

    console.log(`Extracting ${archiveName}...`)
    fs.mkdirSync(distDir, { recursive: true })
    run('tar.exe', ['-xf', archivePath, '-C', distDir], 'Electron extraction')
  }

  if (!fs.existsSync(executablePath)) {
    throw new Error(`Electron executable was not found after installation: ${executablePath}`)
  }

  // Electron reads this value verbatim, so it must not contain a trailing newline.
  fs.writeFileSync(pathFile, executableName, 'utf8')
}

try {
  ensureElectron()
} catch (error) {
  console.error('Unable to prepare Electron:', error)
  process.exitCode = 1
}

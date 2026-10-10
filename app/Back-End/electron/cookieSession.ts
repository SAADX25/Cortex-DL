import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/** yt-dlp writes its jar. A private, owned copy protects the selected export. */
export async function withCookieSession<T>(args: string[], signal: AbortSignal | undefined,
  run: (args: string[]) => Promise<T>): Promise<T> {
  signal?.throwIfAborted()
  if (args[0] !== '--cookies' || !args[1]) return run([])
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-cookie-'))
  const copy = path.join(directory, 'cookies.txt')
  try {
    await fs.chmod(directory, 0o700)
    if (process.platform === 'win32') {
      const execute = promisify(execFile)
      const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
      const identity = await execute(path.join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { windowsHide: true })
      const sid = identity.stdout.match(/S-1-5-(?:\d+-)*\d+/)?.[0]
      if (!sid) throw new Error('Could not secure temporary cookie session')
      await execute(path.join(system, 'icacls.exe'), [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true })
    }
    await fs.writeFile(copy, await fs.readFile(args[1]), { mode: 0o600, flag: 'wx' })
    signal?.throwIfAborted()
    return await run(['--cookies', copy])
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}

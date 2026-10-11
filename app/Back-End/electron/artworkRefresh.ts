import path from 'node:path'
import { execFile } from 'node:child_process'

// Notify only the changed item. Do not invalidate all thumbnails or restart Explorer.
// Paths travel through the environment, never through executable PowerShell source.
const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CortexArtworkShell {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern void SHChangeNotify(int eventId, uint flags, string item1, IntPtr item2);
}
'@
# SHCNE_UPDATEITEM; SHCNF_PATHW | SHCNF_FLUSHNOWAIT.
[CortexArtworkShell]::SHChangeNotify(0x00002000, 0x00002005, $env:CORTEX_ARTWORK_FILE, [IntPtr]::Zero)
`

/** Best effort: third-party players can retain their own artwork cache. */
export async function refreshArtworkFile(file: string): Promise<boolean> {
  if (process.platform !== 'win32') return false
  if (!path.isAbsolute(file) || file.includes('\0')) return false
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return new Promise<boolean>(resolve => {
    execFile(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 5000, maxBuffer: 8192,
      env: { ...process.env, CORTEX_ARTWORK_FILE: file },
    }, error => resolve(!error))
  })
}

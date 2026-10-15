import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type NvidiaGpu = { index: number; name: string; memoryMB: number; freeMB: number; capability: number }

export function parseNvidiaDevices(output: string): NvidiaGpu[] {
  return output.trim().split(/\r?\n/).flatMap(line => {
    const [index, name, memory, free, capability] = line.split(',').map(s => s.trim())
    const gpu = { index: Number(index), name, memoryMB: Number(memory), freeMB: Number(free), capability: Number(capability) }
    return /^NVIDIA /i.test(name ?? '') && Number.isInteger(gpu.index) && gpu.index >= 0 && gpu.memoryMB >= 2048
      && gpu.freeMB >= 0 && gpu.freeMB <= gpu.memoryMB && gpu.capability >= 5.2 && gpu.capability <= 9 ? [gpu] : []
  }).sort((a, b) => b.freeMB - a.freeMB)
}

export async function detectNvidiaGpu(signal?: AbortSignal): Promise<NvidiaGpu | null> {
  if (process.platform !== 'win32') return null
  const candidates = [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')]
  for (const binary of candidates) {
    signal?.throwIfAborted()
    if (!await fs.access(binary).then(() => true, () => false)) continue
    try {
      const output = await new Promise<string>((resolve, reject) => execFile(binary, ['--query-gpu=index,name,memory.total,memory.free,compute_cap', '--format=csv,noheader,nounits'],
        { windowsHide: true, timeout: 3000, maxBuffer: 8192, signal }, (error, stdout) => error ? reject(error) : resolve(stdout)))
      return parseNvidiaDevices(output)[0] ?? null
    } catch { signal?.throwIfAborted() }
  }
  return null
}

export function translationGpuLayers(model: 'standard' | 'quality', freeMB: number): number {
  const weightsMB = model === 'standard' ? 2375 : 6963
  const layers = model === 'standard' ? 34 : 49
  return Math.max(0, Math.min(layers, Math.floor((freeMB - 768) / (weightsMB / layers))))
}

export function selectVulkanDevice(output: string, name: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(Vulkan\d+):\s*(.+?)\s*\(/.exec(line)
    if (match?.[2] === name) return match[1]
  }
  return null
}

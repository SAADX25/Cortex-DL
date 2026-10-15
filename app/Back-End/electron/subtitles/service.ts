import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { type SubtitleCue, type SubtitleDocument, type SubtitleRequest, type SubtitleState, type SpeechModel, type TranslationModel, isSubtitleLanguage, validateSubtitleRequest } from '../../../Shared/localSubtitles'
import { getBinaryPath } from '../paths'
import { ensureEnginesReady } from '../engines/engineManager'
import { getJsRuntimeArgs, checkJsRuntime } from '../engines/ytdlpService'
import { probeMediaFile, validateSubtitleMedia, subtitleLanguageTag } from '../services/mediaService'
import { SubtitleAssets } from './assets'
import { SubtitleProcesses } from './process'
import { parseSpeechRecognition, serializeSubtitles, validateCues } from '../../../Shared/subtitleCues'
import { startTranslator } from './translator'
import { youtubeErrorCode } from '../../../Shared/youtubeErrors'
import { detectNvidiaGpu, selectVulkanDevice, translationGpuLayers } from './gpu'

export class LocalSubtitleService {
  state: SubtitleState = { id: '', stage: 'idle', progress: null }
  private operation: { controller: AbortController; settled: Promise<void> } | null = null
  private speechCache: { key: string; language: string; cues: SubtitleCue[]; duration: number; name: string; acceleration: NonNullable<SubtitleState['acceleration']> } | null = null
  constructor(readonly assets: SubtitleAssets) {}
  get busy(): boolean { return !!this.operation }
  private begin(stage: SubtitleState['stage'], work: (signal: AbortSignal) => Promise<void>): string {
    if (this.busy) throw new Error('LOCAL_SUBTITLES_BUSY')
    const id = randomUUID(), controller = new AbortController()
    this.state = { id, stage, progress: null }
    const settled = Promise.resolve().then(() => work(controller.signal)).catch(error => {
      this.state = { ...this.state, stage: controller.signal.aborted ? 'canceled' : 'error', error: controller.signal.aborted ? undefined : (youtubeErrorCode(error) ?? (error instanceof Error ? error.message : 'Local subtitles failed')), progress: null }
    }).finally(() => { this.operation = null })
    this.operation = { controller, settled }
    return id
  }
  install(speech: SpeechModel, translation: TranslationModel | null, compute: 'auto' | 'cpu' = 'auto'): string {
    if (!['accurate', 'fast'].includes(speech) || translation !== null && !['standard', 'quality'].includes(translation) || !['auto', 'cpu'].includes(compute)) throw new Error('Invalid local subtitle model')
    return this.begin('installing', async signal => {
      await this.assets.install(speech, translation, signal, (progress, detail) => { this.state = { ...this.state, progress, detail } }, compute)
      signal.throwIfAborted(); this.state = { ...this.state, stage: 'idle', progress: null, detail: 'installed' }
    })
  }
  start(request: SubtitleRequest): string {
    validateSubtitleRequest(request)
    return this.begin('preparing', signal => this.generate(request, signal))
  }
  async cancel(id: string): Promise<void> {
    if (this.operation && this.state.id === id) { this.operation.controller.abort(); await this.operation.settled }
  }
  clear(id: string): SubtitleState {
    if (this.busy) throw new Error('LOCAL_SUBTITLES_BUSY')
    if (id !== this.state.id) throw new Error('Subtitle session has changed')
    this.speechCache = null
    this.state = { id: '', stage: 'idle', progress: null }
    return this.state
  }
  async dispose(): Promise<void> {
    if (this.operation) await this.cancel(this.state.id)
    this.clear(this.state.id)
  }
  private async generate(request: SubtitleRequest, signal: AbortSignal): Promise<void> {
    const ready = await this.assets.readiness()
    const translate = request.targetLanguage !== 'original' && request.targetLanguage !== request.sourceLanguage
    if (!ready.speech[request.speechModel] || translate && !ready.translation[request.translationModel]) throw new Error('LOCAL_SUBTITLES_NOT_INSTALLED')
    if (translate && request.translationModel === 'quality' && ready.ramGB < 24) throw new Error('LOCAL_SUBTITLES_MEMORY')
    await ensureEnginesReady(['ffmpeg', 'ffprobe'])
    signal.throwIfAborted()
    const gpu = request.compute !== 'cpu' ? await detectNvidiaGpu(signal) : null
    const speechBackend = gpu && gpu.freeMB >= 2048 && ready.gpu?.speech[request.speechModel] ? 'gpu' : 'cpu'
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-subtitles-'))
    const processes = new SubtitleProcesses(signal)
    this.state = { ...this.state, acceleration: { speech: 'cpu', translation: 'cpu', device: gpu?.name } }
    let input = request.source.trim(), localFile: string | undefined
    const recognitionMode = request.recognitionMode ?? 'speech'
    let cacheKey: string
    try {
      if (/^https?:\/\//i.test(input)) {
        const url = new URL(input)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid media URL')
        cacheKey = JSON.stringify([input, request.sourceLanguage, request.speechModel, recognitionMode, request.compute ?? 'auto', speechBackend])
        if (this.speechCache?.key !== cacheKey) {
          await ensureEnginesReady(['yt-dlp', 'deno']); await checkJsRuntime(); signal.throwIfAborted()
          await processes.run(getBinaryPath('yt-dlp'), ['--ignore-config', '--no-playlist', '--no-progress', '--retries', '0', '--extractor-retries', '0', '--socket-timeout', '20',
            ...getJsRuntimeArgs(), '--ffmpeg-location', path.dirname(getBinaryPath('ffmpeg')), '-f', 'bestaudio/best', '-x', '--audio-format', 'wav', '-o', path.join(directory, 'input.%(ext)s'), input])
          input = path.join(directory, 'input.wav')
        }
      } else {
        if (!path.isAbsolute(input) || !/\.(mp4|mkv|webm|mov|avi|m4v|ogv|mp3|wav|m4a|aac|opus|flac|ogg|wma)$/i.test(input)) throw new Error('Select a supported local media file')
        const stat = await fs.lstat(input)
        if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('Media file is not readable')
        localFile = input; cacheKey = JSON.stringify([input, stat.size, stat.mtimeMs, request.sourceLanguage, request.speechModel, recognitionMode, request.compute ?? 'auto', speechBackend])
      }
      if (this.speechCache?.key !== cacheKey) {
        const probe = await probeMediaFile(input, undefined, signal)
        const duration = Number(probe.format?.duration)
        if (!probe.streams?.some(s => s.codec_type === 'audio') || !Number.isFinite(duration) || duration <= 0) throw new Error('This media has no readable audio')
        if (duration > 8 * 3600) throw new Error('Split media longer than eight hours before transcription')
        const space = await fs.statfs(directory)
        if (Number(space.bavail) * Number(space.bsize) < duration * 32000 + 50 * 1024 * 1024) throw new Error('LOCAL_SUBTITLES_DISK_SPACE')
        const wav = path.join(directory, 'speech.wav')
        await processes.run(getBinaryPath('ffmpeg'), ['-y', '-v', 'error', '-i', input, '-map', '0:a:0', '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
        this.state = { ...this.state, stage: 'transcribing', progress: null }
        const output = path.join(directory, 'speech')
        const executable = (await this.assets.locate('whisper'))!, model = (await this.assets.locate(request.speechModel))!, vad = (await this.assets.locate('vad'))!
        const gpuExecutable = gpu && gpu.freeMB >= 2048 ? await this.assets.locate('whisperGpu') : null
        const gpuLibraries = gpuExecutable ? await this.assets.locate('cudaLibraries') : null
        const gpuModel = gpuLibraries ? await this.assets.locate(request.speechModel === 'accurate' ? 'accurateGpu' : 'fast') : null
        let useGpu = !!(gpuExecutable && gpuLibraries && gpuModel)
        const recognize = async (useVad: boolean): Promise<ReturnType<typeof parseSpeechRecognition>> => {
          signal.throwIfAborted()
          this.state = { ...this.state, acceleration: { ...this.state.acceleration!, speech: 'cpu', compact: useGpu && request.speechModel === 'accurate' } }
          let backendOutput = '', gpuConfirmed = false
          try {
          await processes.run(useGpu ? gpuExecutable! : executable, ['-m', useGpu ? gpuModel! : model, '-f', wav, '-l', request.sourceLanguage, '-ojf', '-of', output,
            '-bs', request.speechModel === 'fast' ? '3' : '5', '-bo', request.speechModel === 'fast' ? '3' : '5', '-mc', '0',
            ...(useGpu ? ['--device', String(gpu!.index)] : []),
            ...(useVad ? ['--vad', '--vad-model', vad, '--vad-speech-pad-ms', '120', '--vad-min-silence-duration-ms', '300'] : []),
            '-pp', '-t', String(Math.max(1, Math.min(8, os.availableParallelism() - 2)))], text => {
            backendOutput = (backendOutput + text).slice(-12000)
            if (useGpu && /CUDA\d*\s+total size|CUDA\d*\s+model buffer/i.test(backendOutput)) {
              gpuConfirmed = true; this.state = { ...this.state, acceleration: { ...this.state.acceleration!, speech: 'gpu' } }
            }

            if (useGpu && !gpuConfirmed && /no GPU found/.test(text)) this.state = { ...this.state, acceleration: { ...this.state.acceleration!, speech: 'cpu', compact: false }, detail: 'gpu-fallback' }
            const match = /progress\s*=\s*(\d+)%/.exec(text)
            if (match) this.state = { ...this.state, progress: Math.min(99, Number(match[1])) }
          }, useGpu ? path.dirname(gpuLibraries!) : undefined)
          } catch (error) {
            signal.throwIfAborted()
            if (!useGpu) throw error
            useGpu = false; this.state = { ...this.state, progress: null, detail: 'gpu-fallback' }
            return recognize(useVad)
          }
          if (useGpu && !gpuConfirmed) {
            this.state = { ...this.state, acceleration: { ...this.state.acceleration!, speech: 'cpu', compact: true }, detail: 'gpu-fallback' }
          }
          signal.throwIfAborted()
          return parseSpeechRecognition(JSON.parse(await fs.readFile(output + '.json', 'utf8')), duration)
        }
        let recognized: ReturnType<typeof parseSpeechRecognition>
        try {
          recognized = await recognize(recognitionMode === 'speech')
        } catch (error) {
          signal.throwIfAborted()
          if (recognitionMode !== 'speech' || !(error instanceof Error) || error.message !== 'Speech engine returned invalid timing') throw error
          this.state = { ...this.state, progress: null, detail: 'retrying-speech-timing' }
          recognized = await recognize(false)
          if (!recognized) throw new Error('LOCAL_SUBTITLES_NO_SPEECH')
        }
        if (!recognized && recognitionMode === 'speech') {
          this.state = { ...this.state, progress: null, detail: 'retrying-full-audio' }
          recognized = await recognize(false)
        }
        if (!recognized) throw new Error('LOCAL_SUBTITLES_NO_SPEECH')
        this.state = { ...this.state, detail: undefined }
        const language = request.sourceLanguage === 'auto' ? recognized.language : request.sourceLanguage
        this.speechCache = { key: cacheKey, language, cues: recognized.cues, duration, name: localFile ? path.parse(localFile).name : 'Video subtitles', acceleration: { ...this.state.acceleration! } }
      }
      signal.throwIfAborted()
      const speech = this.speechCache!
      this.state = { ...this.state, acceleration: { ...speech.acceleration, translation: 'cpu' } }
      const document: SubtitleDocument = { id: this.state.id, name: speech.name, sourceLanguage: speech.language, targetLanguage: speech.language, duration: speech.duration,
        cues: speech.cues.map(cue => ({ ...cue })), localFile }
      this.state = { ...this.state, document }
      if (request.targetLanguage !== 'original' && request.targetLanguage !== speech.language) {
        if (!isSubtitleLanguage(speech.language)) throw new Error('Select the spoken language; automatic language detection could not identify a supported translation language')
        this.state = { ...this.state, stage: 'translating', progress: null }
        const translationModel = (await this.assets.locate(request.translationModel))!
        const translationGpu = request.compute !== 'cpu' ? await detectNvidiaGpu(signal) : null
        const gpuTranslator = translationGpu ? await this.assets.locate('llamaGpu') : null
        let translator: Awaited<ReturnType<typeof startTranslator>> | undefined
        if (gpuTranslator && translationGpu) {
          try {
            let output = ''
            await processes.run(gpuTranslator, ['--list-devices'], text => { output += text })
            const device = selectVulkanDevice(output, translationGpu.name), layers = translationGpuLayers(request.translationModel, translationGpu.freeMB)
            if (device && layers) {
              translator = await startTranslator(gpuTranslator, translationModel, processes, { device, layers })
              this.state = { ...this.state, acceleration: { ...this.state.acceleration!, translation: 'gpu' } }
            }
          } catch {
            signal.throwIfAborted(); await processes.stop()
            this.state = { ...this.state, detail: 'gpu-fallback' }
          }
        }
        translator ??= await startTranslator((await this.assets.locate('llama'))!, translationModel, processes)

        const translated: SubtitleCue[] = []
        const memo = new Map<string, string>()
        for (const cue of document.cues) {
          signal.throwIfAborted()
          const text = memo.get(cue.original) ?? await translator(cue.original, speech.language, request.targetLanguage)
          memo.set(cue.original, text)
          translated.push({ ...cue, text, review: cue.review || text.length > 84 || text.length / (cue.end - cue.start) > 25 })
          this.state = { ...this.state, progress: translated.length / document.cues.length * 100 }
        }
        document.cues = translated; document.targetLanguage = request.targetLanguage
      }
      validateCues(document.cues, document.duration)
      signal.throwIfAborted()
      this.state = { ...this.state, stage: 'ready', progress: 100, document }
    } finally {
      await processes.stop()

      if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('cortex-subtitles-')) await fs.rm(directory, { recursive: true, force: true })
    }
  }
  async exportDocument(id: string, cues: SubtitleCue[], format: 'srt' | 'vtt', file: string): Promise<void> {
    if (this.busy || this.state.document?.id !== id || !['srt', 'vtt'].includes(format)) throw new Error('Subtitle document is not ready')
    const document = this.state.document
    const content = serializeSubtitles(cues, document.duration, format)
    const temp = path.join(path.dirname(file), `.cortex-subtitles-${randomUUID()}.tmp`)
    try { await fs.writeFile(temp, content, { flag: 'wx' }); await fs.rename(temp, file) }
    finally { await fs.rm(temp, { force: true }) }

    if (this.state.document?.id === id) this.state = { ...this.state, document: { ...document, cues: cues.map(c => ({ ...c })) } }
  }
  embedDocument(id: string, cues: SubtitleCue[], file: string): string {
    if (this.busy || this.state.document?.id !== id || !this.state.document.localFile) throw new Error('Subtitle video is not ready')
    const document = { ...this.state.document, cues: cues.map(c => ({ ...c })) }
    const media = document.localFile!
    if (path.resolve(media).toLowerCase() === path.resolve(file).toLowerCase() || path.extname(file).toLowerCase() !== '.mkv') throw new Error('Choose a new MKV output file')
    const content = serializeSubtitles(cues, document.duration, 'vtt')
    return this.begin('exporting', async signal => {
      this.state = { ...this.state, document }
      const subtitle = path.join(path.dirname(file), `.cortex-subtitles-${randomUUID()}.vtt`)
      const output = path.join(path.dirname(file), `.cortex-subtitles-${randomUUID()}.mkv`)
      const processes = new SubtitleProcesses(signal)
      try {
        await ensureEnginesReady(['ffmpeg', 'ffprobe']); signal.throwIfAborted()
        const before = await probeMediaFile(media, undefined, signal)
        if (!before.streams?.some(s => s.codec_type === 'video' && !s.disposition?.attached_pic)) throw new Error('Select a video to embed captions')
        await fs.writeFile(subtitle, content, { flag: 'wx' })
        await processes.run(getBinaryPath('ffmpeg'), ['-v', 'error', '-i', media, '-i', subtitle, '-map', '0:v?', '-map', '0:a?', '-map', '1:0',
          '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'srt', '-metadata:s:s:0', `language=${subtitleLanguageTag(document.targetLanguage)}`,
          '-metadata:s:s:0', `title=${document.targetLanguage}`, '-map_metadata', '0', output])
        const after = await probeMediaFile(output, undefined, signal)
        validateSubtitleMedia(before, after, document.targetLanguage)
        signal.throwIfAborted()
        await fs.rename(output, file)
        this.state = { ...this.state, stage: 'ready', progress: 100, detail: 'video-saved', document }
      } finally { await processes.stop(); await Promise.all([fs.rm(subtitle, { force: true }), fs.rm(output, { force: true })]) }
    })
  }
}

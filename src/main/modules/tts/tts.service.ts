import { existsSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { EdgeTTS } from 'node-edge-tts'
import {
  TRUSTED_CLIENT_TOKEN,
  generateSecMsGecToken_V2,
  SEC_MS_GEC_VERSION_V2,
  CHROMIUM_FULL_VERSION
} from 'node-edge-tts/dist/drm'
import { WebSocket } from 'ws'
import { TtsSegment, TtsWordTimestamp } from '../../../shared/types'

// Monkey-patch _connectWebSocket trên EdgeTTS prototype để loại bỏ header `host: 'speech.platform.bing.com'`
// Header này khiến Microsoft Edge TTS API (api.msedgeservices.com) chặn kết nối và trả về HTTP 429
// @ts-ignore - Monkey patching private internal method
EdgeTTS.prototype._connectWebSocket = function (): Promise<WebSocket> {
  const wsConnect = new WebSocket(
    `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${generateSecMsGecToken_V2()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION_V2}`,
    {
      origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      headers: {
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0`,
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }
  )

  return new Promise((resolve, reject) => {
    // @ts-ignore - Timeout type inference
    const timeout = setTimeout(
      () => {
        reject(new Error('Timed out while connecting to Edge TTS'))
        wsConnect.terminate()
      },
      ((this as unknown as { timeout?: number }).timeout || 15000) as number
    )

    const onOpen = (): void => {
      clearTimeout(timeout)
      resolve(wsConnect)
    }

    const onError = (error: Error): void => {
      clearTimeout(timeout)
      reject(error)
    }

    const onClose = (): void => {
      clearTimeout(timeout)
      wsConnect.off('open', onOpen)
      wsConnect.off('error', onError)
      reject(new Error('WebSocket closed before the connection was established'))
    }

    wsConnect.once('open', onOpen)
    wsConnect.on('error', onError)
    wsConnect.once('close', onClose)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export class TtsService {
  /**
   * Sinh giọng đọc từ văn bản kèm timestamp từng từ
   * Mặc định giọng Edge-TTS tiếng Việt (vi-VN-HoaiMyNeural hoặc vi-VN-NamMinhNeural)
   */
  async generateSpeech(
    text: string,
    voice = 'vi-VN-HoaiMyNeural',
    audioDestPath: string,
    rate = 'default',
    pitch = 'default'
  ): Promise<{ audioPath: string; durationSec: number; subtitles: TtsWordTimestamp[] }> {
    const parentDir = join(audioDestPath, '..')
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true })
    }

    console.log(`[TtsService] Đang tạo giọng đọc (${text.length} ký tự) với voice: ${voice}`)

    const maxRetries = 3
    let lastError: unknown = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const tts = new EdgeTTS({
          voice,
          lang: 'vi-VN',
          saveSubtitles: true,
          rate,
          pitch,
          timeout: 15000
        })

        await tts.ttsPromise(text, audioDestPath)
        lastError = null
        break
      } catch (err) {
        lastError = err
        console.warn(
          `[TtsService] Thử nghiệm TTS lần ${attempt}/${maxRetries} thất bại (${err}). Đang thử lại sau ${attempt * 1000}ms...`
        )
        if (attempt < maxRetries) {
          await sleep(attempt * 1000)
        }
      }
    }

    if (lastError) {
      throw lastError
    }

    // Đọc file json chứa word timestamps được node-edge-tts tạo ra cùng đường dẫn
    const jsonSubPath = `${audioDestPath}.json`
    const subtitles: TtsWordTimestamp[] = []
    let durationSec = 3.0

    if (existsSync(jsonSubPath)) {
      try {
        const rawJson = readFileSync(jsonSubPath, 'utf-8')
        const items = JSON.parse(rawJson) as Array<{ part: string; start: number; end: number }>

        if (Array.isArray(items) && items.length > 0) {
          items.forEach((it) => {
            subtitles.push({
              word: it.part.trim(),
              startMs: it.start,
              endMs: it.end
            })
          })
          const lastEnd = items[items.length - 1].end
          durationSec = Math.max(1.0, Number((lastEnd / 1000).toFixed(2)))
        }
      } catch (e) {
        console.warn(`[TtsService] Không thể đọc file subtitle json ${jsonSubPath}:`, e)
      }
    }

    const realDur = this.getAudioDuration(audioDestPath)
    if (realDur > 0) {
      durationSec = realDur
    }

    return {
      audioPath: audioDestPath,
      durationSec,
      subtitles
    }
  }

  private getAudioDuration(audioPath: string): number {
    try {
      const candidates = [
        join(process.cwd(), 'resources', 'bin', 'ffprobe'),
        '/home/dvs-chienpd/ThreadCut/resources/bin/ffprobe',
        'ffprobe'
      ]
      for (const p of candidates) {
        if (existsSync(p)) {
          const out = execSync(
            `"${p}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
            { timeout: 3000 }
          ).toString()
          const val = parseFloat(out.trim())
          if (!isNaN(val) && val > 0) return Number(val.toFixed(2))
        }
      }
    } catch {
      // fallback
    }
    return 0
  }

  /**
   * Sinh toàn bộ chuỗi audio cho bài viết gốc và danh sách comment đã chọn
   * Có giãn cách delay giữa các request để phòng ngừa rate-limit
   */
  async generateBatchSpeech(
    postItem: { id: string; author: string; text: string },
    comments: Array<{ id: string; author: string; text: string }>,
    voice: string,
    outputBaseDir: string,
    onProgress?: (index: number, total: number, label: string) => void,
    rate = 'default'
  ): Promise<TtsSegment[]> {
    const segments: TtsSegment[] = []
    const total = 1 + comments.length

    // 1. Audio bài viết gốc
    onProgress?.(1, total, `Tạo giọng đọc bài viết của @${postItem.author}`)
    const postAudioPath = join(outputBaseDir, 'audio_post.mp3')
    const postTts = await this.generateSpeech(postItem.text, voice, postAudioPath, rate)
    segments.push({
      id: postItem.id,
      type: 'post',
      authorName: postItem.author,
      text: postItem.text,
      audioPath: postTts.audioPath,
      durationSec: postTts.durationSec,
      subtitles: postTts.subtitles
    })

    // 2. Audio các bình luận
    for (let i = 0; i < comments.length; i++) {
      // Delay 800ms giữa các request để bảo đảm an toàn với Edge-TTS server
      await sleep(800)

      const c = comments[i]
      onProgress?.(i + 2, total, `Tạo giọng đọc bình luận #${i + 1} của @${c.author}`)
      const commentAudioPath = join(outputBaseDir, `audio_comment_${i + 1}.mp3`)
      const commentTts = await this.generateSpeech(c.text, voice, commentAudioPath, rate)

      segments.push({
        id: c.id,
        type: 'comment',
        authorName: c.author,
        text: c.text,
        audioPath: commentTts.audioPath,
        durationSec: commentTts.durationSec,
        subtitles: commentTts.subtitles
      })
    }

    return segments
  }
}

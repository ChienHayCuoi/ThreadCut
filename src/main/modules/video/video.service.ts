import { join, dirname } from 'path'
import { existsSync, writeFileSync, mkdirSync, statSync } from 'fs'
import { spawn } from 'child_process'
import { VideoTemplateConfig, VideoJobProgress, TtsSegment } from '../../../shared/types'

export class VideoRendererService {
  private ffmpegPath: string

  constructor(customPath?: string) {
    this.ffmpegPath = this.resolveFfmpegBinary(customPath)
    console.log(`[VideoRenderer] Khởi tạo với FFmpeg binary: ${this.ffmpegPath}`)
  }

  private isValidExecutable(filePath?: string): boolean {
    if (!filePath) return false
    try {
      if (!existsSync(filePath)) return false
      const stat = statSync(filePath)
      // File nhị phân hợp lệ phải có dung lượng tối thiểu (> 1MB), tránh trường hợp file rỗng 0 byte
      return stat.isFile() && stat.size > 1024 * 1024
    } catch {
      return false
    }
  }

  private resolveFfmpegBinary(customPath?: string): string {
    const isWin = process.platform === 'win32'
    const exeName = isWin ? 'ffmpeg.exe' : 'ffmpeg'

    if (customPath && this.isValidExecutable(customPath)) {
      return customPath
    }

    // Trong ứng dụng đóng gói, binary được unpack ra process.resourcesPath
    const resourcesDir = process.resourcesPath || ''
    const unpackedBin = join(resourcesDir, 'app.asar.unpacked', 'resources', 'bin', exeName)
    const directBin = join(resourcesDir, 'resources', 'bin', exeName)
    const devBin = join(process.cwd(), 'resources', 'bin', exeName)

    if (this.isValidExecutable(unpackedBin)) return unpackedBin
    if (this.isValidExecutable(directBin)) return directBin
    if (this.isValidExecutable(devBin)) return devBin

    // Các đường dẫn phổ biến trên Windows
    if (isWin) {
      const winFallbacks = [
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
        join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
        join(process.env.USERPROFILE || '', 'scoop', 'shims', 'ffmpeg.exe'),
        join(process.env.ProgramData || '', 'chocolatey', 'bin', 'ffmpeg.exe')
      ]
      for (const p of winFallbacks) {
        if (this.isValidExecutable(p)) return p
      }
    }

    // Mặc định gọi lệnh hệ thống trong PATH
    return isWin ? 'ffmpeg.exe' : 'ffmpeg'
  }

  private resolveFfprobeBinary(): string {
    const isWin = process.platform === 'win32'
    const exeName = isWin ? 'ffprobe.exe' : 'ffprobe'

    // Ưu tiên tìm ffprobe cùng thư mục với ffmpeg đã tìm thấy
    if (this.ffmpegPath && this.ffmpegPath !== 'ffmpeg' && this.ffmpegPath !== 'ffmpeg.exe') {
      const siblingFfprobe = join(dirname(this.ffmpegPath), exeName)
      if (this.isValidExecutable(siblingFfprobe)) {
        return siblingFfprobe
      }
    }

    const resourcesDir = process.resourcesPath || ''
    const unpackedBin = join(resourcesDir, 'app.asar.unpacked', 'resources', 'bin', exeName)
    const directBin = join(resourcesDir, 'resources', 'bin', exeName)
    const devBin = join(process.cwd(), 'resources', 'bin', exeName)

    if (this.isValidExecutable(unpackedBin)) return unpackedBin
    if (this.isValidExecutable(directBin)) return directBin
    if (this.isValidExecutable(devBin)) return devBin

    if (isWin) {
      const winFallbacks = [
        'C:\\ffmpeg\\bin\\ffprobe.exe',
        'C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe',
        join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffprobe.exe'),
        join(process.env.USERPROFILE || '', 'scoop', 'shims', 'ffprobe.exe'),
        join(process.env.ProgramData || '', 'chocolatey', 'bin', 'ffprobe.exe')
      ]
      for (const p of winFallbacks) {
        if (this.isValidExecutable(p)) return p
      }
    }

    return isWin ? 'ffprobe.exe' : 'ffprobe'
  }

  async getAudioDuration(audioPath: string): Promise<number> {
    return new Promise((resolve) => {
      if (!existsSync(audioPath)) {
        return resolve(3.0)
      }
      const ffprobePath = this.resolveFfprobeBinary()
      const proc = spawn(ffprobePath, [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        audioPath
      ])
      let stdout = ''
      proc.stdout.on('data', (d) => (stdout += d.toString()))
      proc.on('close', () => {
        const val = parseFloat(stdout.trim())
        resolve(isNaN(val) || val <= 0 ? 3.0 : val)
      })
      proc.on('error', () => resolve(3.0))
    })
  }

  /**
   * Ghép video 9:16:
   * Background template + chuỗi giọng đọc TTS + Card bài viết/comment + phụ đề nhảy chữ Karaoke
   */
  async renderFullVideo(
    segments: TtsSegment[],
    template: VideoTemplateConfig,
    outputFilePath: string,
    onProgress?: (progress: VideoJobProgress) => void
  ): Promise<string> {
    const outputDir = join(outputFilePath, '..')
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    onProgress?.({
      step: 'rendering_video',
      percent: 5,
      message: 'Chuẩn bị tài nguyên và kịch bản dựng video...'
    })

    // 1. Tạo file danh sách nối audio (concat list) và hợp nhất toàn bộ giọng đọc
    const concatListPath = join(outputDir, `audio_list_${Date.now()}.txt`)
    const concatContent = segments
      .map((s) => `file '${s.audioPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
      .join('\n')
    writeFileSync(concatListPath, concatContent, 'utf-8')

    const masterAudioPath = join(outputDir, `master_audio_${Date.now()}.mp3`)
    await this.concatAudioFiles(concatListPath, masterAudioPath)

    // Lấy thời lượng chuẩn từng mili-giây của master audio bằng ffprobe
    const masterAudioDuration = await this.getAudioDuration(masterAudioPath)

    // 2. Tính toán chính xác thời gian bắt đầu và kết thúc của từng phân đoạn
    let currentTimeline = 0
    const segmentTimings: Array<{
      segment: TtsSegment
      startSec: number
      endSec: number
    }> = []

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const realDur = await this.getAudioDuration(seg.audioPath)
      const startSec = currentTimeline
      const endSec = currentTimeline + realDur
      segmentTimings.push({
        segment: { ...seg, durationSec: realDur },
        startSec,
        endSec
      })
      currentTimeline = endSec
    }

    // Thời lượng video = thời lượng audio thực tế + 0.8s đệm tự nhiên cuối video để câu cuối đọc xong trọn vẹn
    const totalDuration = Math.max(currentTimeline, masterAudioDuration) + 0.8

    console.log(
      `[VideoRenderer] Master audio: ${masterAudioDuration.toFixed(2)}s, Tổng thời lượng video: ${totalDuration.toFixed(2)}s`
    )

    // 3. Tạo file phụ đề karaoke .ass đồng bộ chuẩn xác
    const assSubtitlePath = join(outputDir, `subtitles_${Date.now()}.ass`)
    this.generateAssSubtitles(segmentTimings, assSubtitlePath)

    onProgress?.({
      step: 'rendering_video',
      percent: 30,
      message: 'Đã tổng hợp file âm thanh, bắt đầu xuất khung hình 9:16...'
    })

    // 4. Xây dựng tham số FFmpeg Filtergraph
    // Input 0: Nền video hoặc Background Gradient generator
    // Input 1..N: Các ảnh Card của từng phân đoạn
    // Filter overlay: Chèn từng Card theo thời gian [startSec, endSec]
    // Filter ass: Chèn phụ đề karaoke
    const ffmpegArgs: string[] = []

    const hasBgVideo = Boolean(
      template.backgroundVideoPath && existsSync(template.backgroundVideoPath)
    )

    if (hasBgVideo) {
      ffmpegArgs.push('-stream_loop', '-1', '-i', template.backgroundVideoPath!)
    } else {
      // Chế độ 1: Animated Motion Gradient tự sinh chuyển động bởi FFmpeg
      const style = template.generatorStyle || 'midnight_blue'
      let c0 = '0x0a0f1d'
      let c1 = '0x1e1b4b'

      if (style === 'cyber_purple') {
        c0 = '0x110726'
        c1 = '0x4a044e'
      } else if (style === 'emerald_dark') {
        c0 = '0x021a12'
        c1 = '0x064e3b'
      } else if (style === 'sunset_glow') {
        c0 = '0x1c0a00'
        c1 = '0x450a0a'
      }

      ffmpegArgs.push(
        '-f',
        'lavfi',
        '-i',
        `gradients=s=1080x1920:c0=${c0}:c1=${c1}:x0=540:y0=0:x1=540:y1=1920:speed=0.003:d=${Math.ceil(totalDuration) + 2},format=yuv420p`
      )
    }

    // Input master audio
    ffmpegArgs.push('-i', masterAudioPath)

    // Inputs ảnh Card
    const cardIndexStart = 2
    segmentTimings.forEach((st) => {
      if (st.segment.cardImagePath && existsSync(st.segment.cardImagePath)) {
        ffmpegArgs.push('-i', st.segment.cardImagePath)
      } else {
        // Fallback transparent 1x1 nếu card bị thiếu
        ffmpegArgs.push('-f', 'lavfi', '-i', 'color=c=black@0.0:s=10x10:d=1')
      }
    })

    // Input video của bài viết gốc (nếu bài viết có video đính kèm)
    const postSegment = segmentTimings[0]?.segment
    const hasPostVideo = Boolean(
      postSegment?.mediaVideoPath && existsSync(postSegment.mediaVideoPath)
    )
    let postVideoInputIdx = -1
    if (hasPostVideo) {
      postVideoInputIdx = cardIndexStart + segmentTimings.length
      ffmpegArgs.push('-stream_loop', '-1', '-i', postSegment!.mediaVideoPath!)
      console.log(
        `[VideoRenderer] Đã thêm input video của bài viết gốc vào FFmpeg: ${postSegment!.mediaVideoPath}`
      )
    }

    // Xây dựng chuỗi filter
    let currentVideoLabel = 'v0'
    const filterParts: string[] = []

    // Scale / Crop video nền cho chuẩn 1080x1920 (9:16)
    if (hasBgVideo) {
      filterParts.push(
        `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[${currentVideoLabel}]`
      )
    } else {
      filterParts.push(`[0:v]setsar=1[${currentVideoLabel}]`)
    }

    // Ghép các thẻ Card và Video bài viết lên video
    segmentTimings.forEach((st, idx) => {
      const inputIdx = cardIndexStart + idx
      const nextLabel = `v_card_${idx}`
      const isLast = idx === segmentTimings.length - 1
      const cardEndSec = isLast ? totalDuration : st.endSec
      const enableClause = `between(t,${st.startSec.toFixed(2)},${cardEndSec.toFixed(2)})`

      if (idx === 0 && hasPostVideo) {
        // Bài viết có video: Đặt Card ở y = 140
        filterParts.push(
          `[${currentVideoLabel}][${inputIdx}:v]overlay=(W-w)/2:140:enable='${enableClause}'[${nextLabel}]`
        )
        currentVideoLabel = nextLabel

        // Ghép video của bài viết ở ngay dưới Card (y = 510)
        const postVidLabel = 'v_post_vid'
        const vidEnable = `between(t,0,${st.endSec.toFixed(2)})`
        filterParts.push(
          `[${postVideoInputIdx}:v]scale=900:680:force_original_aspect_ratio=decrease,setsar=1,format=yuva420p[${postVidLabel}_scaled]`
        )
        filterParts.push(
          `[${currentVideoLabel}][${postVidLabel}_scaled]overlay=(W-w)/2:510:enable='${vidEnable}'[${postVidLabel}]`
        )
        currentVideoLabel = postVidLabel
      } else {
        // Card bình thường: Đặt ở giữa màn hình (y = 380)
        filterParts.push(
          `[${currentVideoLabel}][${inputIdx}:v]overlay=(W-w)/2:380:enable='${enableClause}'[${nextLabel}]`
        )
        currentVideoLabel = nextLabel
      }
    })

    // Áp dụng phụ đề karaoke ASS lên trên cùng
    // Chuẩn hóa đường dẫn tương thích FFmpeg filter trên cả Windows (escape dấu : và đổi \ thành /)
    const finalVideoLabel = 'v_final'
    const escapedAssPath = assSubtitlePath
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:')
      .replace(/'/g, "\\'")
    filterParts.push(`[${currentVideoLabel}]ass=filename='${escapedAssPath}'[${finalVideoLabel}]`)

    ffmpegArgs.push(
      '-filter_complex',
      filterParts.join(';'),
      '-map',
      `[${finalVideoLabel}]`,
      '-map',
      '1:a',
      '-t',
      totalDuration.toFixed(2),
      '-c:v',
      'libx264',
      '-preset',
      'faster',
      '-crf',
      '22',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-pix_fmt',
      'yuv420p',
      '-y',
      outputFilePath
    )

    console.log(`[VideoRenderer] Đang thực thi FFmpeg lệnh ghép video...`)

    return new Promise((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, ffmpegArgs)

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString()
        // Bắt tiến trình time=xx:xx:xx.xx
        const match = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/)
        if (match) {
          const hours = parseFloat(match[1])
          const minutes = parseFloat(match[2])
          const seconds = parseFloat(match[3])
          const currentTime = hours * 3600 + minutes * 60 + seconds
          const percent = Math.min(98, Math.round(30 + (currentTime / totalDuration) * 65))

          onProgress?.({
            step: 'rendering_video',
            percent,
            message: `Đang render video: ${currentTime.toFixed(1)}s / ${totalDuration.toFixed(1)}s (${percent}%)`
          })
        }
      })

      proc.on('close', (code) => {
        if (code === 0) {
          onProgress?.({
            step: 'completed',
            percent: 100,
            message: 'Xuất video hoàn tất thành công!',
            outputFilePath
          })
          resolve(outputFilePath)
        } else {
          const err = new Error(`FFmpeg kết thúc với mã lỗi: ${code}`)
          onProgress?.({
            step: 'error',
            percent: 100,
            message: `Lỗi khi xuất video (mã: ${code})`
          })
          reject(err)
        }
      })

      proc.on('error', (err) => {
        reject(err)
      })
    })
  }

  private async concatAudioFiles(listFilePath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, [
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFilePath,
        '-c',
        'copy',
        '-y',
        outputPath
      ])
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Nối audio thất bại với mã lỗi: ${code}`))
      })
      proc.on('error', reject)
    })
  }

  /**
   * Tạo phụ đề dạng ASS với hiệu ứng karaoke highlight từng chữ theo nhịp đọc
   */
  private generateAssSubtitles(
    timings: Array<{ segment: TtsSegment; startSec: number; endSec: number }>,
    assPath: string
  ): void {
    const lines: string[] = []

    lines.push('[Script Info]')
    lines.push('ScriptType: v4.00+')
    lines.push('PlayResX: 1080')
    lines.push('PlayResY: 1920')
    lines.push('ScaledBorderAndShadow: yes')
    lines.push('')
    lines.push('[V4+ Styles]')
    lines.push(
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'
    )
    // Style chữ nhảy: Font 58pt, màu trắng chữ thường, màu vàng chanh highlight khi hát/đọc (&H0000FFFF), viền đen dày 5px
    lines.push(
      'Style: Karaoke,Arial,60,&H00FFFFFF,&H0000FFFF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,5,3,2,60,60,340,1'
    )
    lines.push('')
    lines.push('[Events]')
    lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text')

    for (const t of timings) {
      const seg = t.segment
      const baseStartMs = Math.round(t.startSec * 1000)

      if (seg.subtitles && seg.subtitles.length > 0) {
        // Gom các từ thành các cụm 3-5 từ để hiển thị vừa vặn trên màn hình dọc 9:16
        const chunkSize = 4
        for (let i = 0; i < seg.subtitles.length; i += chunkSize) {
          const chunk = seg.subtitles.slice(i, i + chunkSize)
          const chunkStartMs = baseStartMs + chunk[0].startMs
          const isLastChunk = i + chunkSize >= seg.subtitles.length
          const chunkEndMs = isLastChunk
            ? Math.round(t.endSec * 1000)
            : baseStartMs + chunk[chunk.length - 1].endMs + 100

          const startStr = this.formatAssTimestamp(chunkStartMs)
          const endStr = this.formatAssTimestamp(chunkEndMs)

          let karaokeText = ''
          for (let j = 0; j < chunk.length; j++) {
            const w = chunk[j]
            const durationCs = Math.max(10, Math.round((w.endMs - w.startMs) / 10))
            karaokeText += `{\\k${durationCs}}${w.word} `
          }

          lines.push(`Dialogue: 0,${startStr},${endStr},Karaoke,,0,0,0,,${karaokeText.trim()}`)
        }
      } else {
        // Fallback nếu không có timestamp chi tiết
        const startStr = this.formatAssTimestamp(Math.round(t.startSec * 1000))
        const endStr = this.formatAssTimestamp(Math.round(t.endSec * 1000))
        lines.push(`Dialogue: 0,${startStr},${endStr},Karaoke,,0,0,0,,${seg.text}`)
      }
    }

    writeFileSync(assPath, lines.join('\n'), 'utf-8')
  }

  private formatAssTimestamp(ms: number): string {
    const totalSeconds = ms / 1000
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = Math.floor(totalSeconds % 60)
    const centiseconds = Math.floor((ms % 1000) / 10)

    const pad = (n: number, z = 2): string => String(n).padStart(z, '0')
    return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}`
  }
}

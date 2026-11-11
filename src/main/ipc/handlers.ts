import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync, readdirSync, copyFileSync } from 'fs'
import { ThreadsCrawler } from '../modules/crawler/threads.crawler'
import { GeminiService } from '../modules/ai/gemini.service'
import { TtsService } from '../modules/tts/tts.service'
import { CardRendererService } from '../modules/card/card.service'
import { VideoRendererService } from '../modules/video/video.service'
import { SettingsService } from '../modules/settings/settings.service'
import { FullPipelineParams, VideoJobProgress, ThreadComment } from '../../shared/types'

const settingsService = new SettingsService()
const crawler = new ThreadsCrawler()
const tts = new TtsService()
const cardRenderer = new CardRendererService()

export function registerIpcHandlers(): void {
  // 0. Quản lý cấu hình Settings
  ipcMain.handle('settings:get', async () => {
    return settingsService.getSettings()
  })

  ipcMain.handle('settings:save', async (_event, newSettings) => {
    return settingsService.saveSettings(newSettings)
  })

  // 1. Cào bài viết & bình luận từ Threads
  ipcMain.handle('crawler:fetch-post', async (_event, url: string) => {
    return await crawler.crawlPost(url)
  })

  // 2. Lọc 5 comment peak nhất bằng Gemini Flash
  ipcMain.handle(
    'ai:filter-comments',
    async (
      _event,
      {
        apiKey,
        model: _model,
        postText,
        comments
      }: { apiKey?: string; model?: string; postText: string; comments: ThreadComment[] }
    ) => {
      const currentSettings = settingsService.getSettings()
      const key = apiKey || currentSettings.geminiApiKey
      const gemini = new GeminiService(key)
      return await gemini.pickPeakComments(postText, comments, 5)
    }
  )

  // 3. Tạo giọng đọc đơn lẻ
  ipcMain.handle('tts:generate', async (_event, { text, voice, destPath }) => {
    const currentSettings = settingsService.getSettings()
    const targetVoice = voice || currentSettings.defaultTtsVoice
    const targetPath =
      destPath || join(currentSettings.outputDir, 'temp', `speech_${Date.now()}.mp3`)
    return await tts.generateSpeech(text, targetVoice, targetPath)
  })

  // 4. Render thẻ Threads Card thành ảnh PNG
  ipcMain.handle('card:render', async (_event, { cardOptions, destPath }) => {
    const currentSettings = settingsService.getSettings()
    const targetPath = destPath || join(currentSettings.outputDir, 'temp', `card_${Date.now()}.png`)
    return await cardRenderer.renderThreadsCard(cardOptions, targetPath)
  })

  // 5. Chạy toàn bộ Pipeline sản xuất Video tự động
  ipcMain.handle('pipeline:run-full', async (event, params: FullPipelineParams) => {
    const currentSettings = settingsService.getSettings()
    const workDir = join(currentSettings.outputDir, `project_${Date.now()}`)
    if (!existsSync(workDir)) {
      mkdirSync(workDir, { recursive: true })
    }

    const sendProgress = (prog: VideoJobProgress): void => {
      event.sender.send('pipeline:progress', prog)
    }

    try {
      const post = params.post
      const selectedComments = (params.selectedComments || []).filter((c) => c.selected !== false)
      if (selectedComments.length === 0) {
        throw new Error('Vui lòng chọn ít nhất 1 bình luận để sản xuất video.')
      }
      const voice = params.voice || currentSettings.defaultTtsVoice
      const rate = params.rate || currentSettings.ttsRate || '+20%'

      // BƯỚC 1: Render ảnh Card giao diện Threads
      sendProgress({
        step: 'rendering_cards',
        percent: 10,
        message: `Đang render ảnh giao diện thẻ Threads cho bài viết và ${selectedComments.length} bình luận...`
      })

      const postCardPath = join(workDir, 'card_post.png')
      await cardRenderer.renderThreadsCard(
        {
          author: post.author.username,
          avatarUrl: post.author.avatarUrl,
          text: post.text,
          likesCount: post.likesCount,
          isPost: true
        },
        postCardPath
      )

      const commentCardPaths: string[] = []
      for (let i = 0; i < selectedComments.length; i++) {
        const c = selectedComments[i]
        const cPath = join(workDir, `card_comment_${i + 1}.png`)
        await cardRenderer.renderThreadsCard(
          {
            author: c.author.username,
            avatarUrl: c.author.avatarUrl,
            text: c.text,
            likesCount: c.likesCount,
            isPost: false
          },
          cPath
        )
        commentCardPaths.push(cPath)
      }

      // BƯỚC 2: Sinh giọng đọc TTS & lấy word timestamps
      sendProgress({
        step: 'generating_tts',
        percent: 25,
        message: `Đang sinh giọng đọc AI (${voice}) và bóc tách nhịp chữ...`
      })

      const segments = await tts.generateBatchSpeech(
        { id: post.id, author: post.author.username, text: post.text },
        selectedComments.map((c) => ({ id: c.id, author: c.author.username, text: c.text })),
        voice,
        workDir,
        (current, total, label) => {
          sendProgress({
            step: 'generating_tts',
            percent: 25 + Math.round((current / total) * 20),
            message: `${label} (${current}/${total})`
          })
        },
        rate
      )

      // Gắn ảnh Card vào từng segment tương ứng
      segments[0].cardImagePath = postCardPath
      if (post.localVideoPath && existsSync(post.localVideoPath)) {
        segments[0].mediaVideoPath = post.localVideoPath
        console.log(`[Pipeline] Đã gắn video bài viết (${post.localVideoPath}) vào segment bài viết gốc`)
      }
      for (let i = 0; i < commentCardPaths.length; i++) {
        if (segments[i + 1]) {
          segments[i + 1].cardImagePath = commentCardPaths[i]
        }
      }

      // BƯỚC 3: Dựng Video 9:16 bằng FFmpeg
      sendProgress({
        step: 'rendering_video',
        percent: 50,
        message: 'Đang ghép Video 9:16 (Template + Audio + Card + Phụ đề karaoke nhảy chữ)...'
      })

      const videoRenderer = new VideoRendererService(currentSettings.customFfmpegPath)
      const outputVideoPath = join(currentSettings.outputDir, `ThreadCut_${Date.now()}_9x16.mp4`)

      await videoRenderer.renderFullVideo(segments, params.template, outputVideoPath, (prog) =>
        sendProgress(prog)
      )

      sendProgress({
        step: 'completed',
        percent: 100,
        message: 'Sản xuất video thành công!',
        outputFilePath: outputVideoPath
      })

      return outputVideoPath
    } catch (err: unknown) {
      console.error('[Pipeline] Lỗi trong quá trình render video:', err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      sendProgress({
        step: 'error',
        percent: 100,
        message: `Đã xảy ra lỗi: ${errorMessage}`
      })
      throw err
    }
  })

  // Chọn thư mục lưu video
  ipcMain.handle('dialog:select-directory', async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(
      focusedWindow || (undefined as unknown as BrowserWindow),
      {
        properties: ['openDirectory', 'createDirectory']
      }
    )
    return result.filePaths[0] || null
  })

  // Chọn video nền background
  ipcMain.handle('dialog:select-video', async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(
      focusedWindow || (undefined as unknown as BrowserWindow),
      {
        properties: ['openFile'],
        filters: [{ name: 'Video Files', extensions: ['mp4', 'mov', 'webm', 'mkv'] }]
      }
    )
    return result.filePaths[0] || null
  })

  // Chọn file FFmpeg executable thủ công
  ipcMain.handle('dialog:select-ffmpeg', async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(
      focusedWindow || (undefined as unknown as BrowserWindow),
      {
        properties: ['openFile'],
        filters: [
          { name: 'FFmpeg Executable', extensions: ['exe', '*'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      }
    )
    return result.filePaths[0] || null
  })

  // Mở thư mục hoặc video ngoài OS
  ipcMain.handle('shell:open-path', async (_event, targetPath: string) => {
    if (existsSync(targetPath)) {
      shell.showItemInFolder(targetPath)
      return true
    }
    return false
  })

  // Danh sách các video preset có sẵn
  ipcMain.handle('template:list-presets', async () => {
    const currentSettings = settingsService.getSettings()
    const templatesDir = currentSettings.backgroundTemplateDir
    if (!existsSync(templatesDir)) {
      mkdirSync(templatesDir, { recursive: true })
    }

    // Tự động sao chép các video loop mặc định sang nếu cần
    const resourcesTemplateDir = join(__dirname, '../../resources/templates')
    if (existsSync(resourcesTemplateDir)) {
      try {
        const files = readdirSync(resourcesTemplateDir)
        for (const file of files) {
          const dest = join(templatesDir, file)
          if (!existsSync(dest)) {
            copyFileSync(join(resourcesTemplateDir, file), dest)
          }
        }
      } catch (e) {
        console.warn('[Handlers] Không thể copy template mặc định:', e)
      }
    }

    const presets: Array<{ id: string; name: string; path: string }> = []
    try {
      const files = readdirSync(templatesDir)
      for (const f of files) {
        if (/\.(mp4|mov|webm|mkv)$/i.test(f)) {
          let label = f.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
          if (f.includes('nebula')) label = '🌌 ' + label
          else if (f.includes('cyber') || f.includes('neon')) label = '🔮 ' + label
          else if (f.includes('aurora') || f.includes('emerald')) label = '🌿 ' + label
          else if (f.includes('minecraft')) label = '🎮 ' + label
          else if (f.includes('subway')) label = '🏃 ' + label
          else label = '🎬 ' + label

          presets.push({
            id: f,
            name: label,
            path: join(templatesDir, f)
          })
        }
      }
    } catch (e) {
      console.warn('[Handlers] Lỗi đọc danh sách template:', e)
    }

    return presets
  })

  // Mở thư mục templates để user có thể kéo thả video gameplay vào
  ipcMain.handle('shell:open-templates-folder', async () => {
    const currentSettings = settingsService.getSettings()
    const dir = currentSettings.backgroundTemplateDir
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    shell.openPath(dir)
    return true
  })
}

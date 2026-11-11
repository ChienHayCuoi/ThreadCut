import { ipcMain } from 'electron'
import { ThreadsCrawler } from '../modules/crawler/threads.crawler'
import { GeminiService } from '../modules/ai/gemini.service'
import { TtsService } from '../modules/tts/tts.service'
import { VideoRendererService } from '../modules/video/video.service'

const crawler = new ThreadsCrawler()
const tts = new TtsService()
const videoRenderer = new VideoRendererService()

export function registerIpcHandlers(): void {
  // 1. Cào bài viết & comment
  ipcMain.handle('crawler:fetch-post', async (_event, url: string) => {
    return await crawler.crawlPost(url)
  })

  // 2. Lọc 5 comment peak nhất
  ipcMain.handle('ai:filter-comments', async (_event, { apiKey, postText, comments }) => {
    const gemini = new GeminiService(apiKey)
    return await gemini.pickPeakComments(postText, comments, 5)
  })

  // 3. Tạo giọng đọc
  ipcMain.handle('tts:generate', async (_event, { text, voice }) => {
    return await tts.generateSpeech(text, voice)
  })

  // 4. Render video
  ipcMain.handle('video:render', async (_event, { templateConfig }) => {
    return await videoRenderer.renderVideo(templateConfig)
  })
}


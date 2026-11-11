import { ElectronAPI } from '@electron-toolkit/preload'
import { ThreadPostDetail, ThreadComment, VideoTemplateConfig } from '../shared/types'

interface ThreadCutAPI {
  crawlPost: (url: string) => Promise<ThreadPostDetail>
  filterComments: (params: {
    apiKey: string
    postText: string
    comments: ThreadComment[]
  }) => Promise<ThreadComment[]>
  generateTts: (params: { text: string; voice?: string }) => Promise<{ audioPath: string }>
  renderVideo: (params: { templateConfig: VideoTemplateConfig }) => Promise<string>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ThreadCutAPI
  }
}

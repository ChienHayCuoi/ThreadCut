import { ElectronAPI } from '@electron-toolkit/preload'
import {
  ThreadPostDetail,
  ThreadComment,
  AppSettings,
  FullPipelineParams,
  VideoJobProgress,
  UpdateInfoState
} from '../shared/types'

interface ThreadCutAPI {
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
  crawlPost: (url: string) => Promise<ThreadPostDetail>
  filterComments: (params: {
    apiKey?: string
    model?: string
    postText: string
    comments: ThreadComment[]
  }) => Promise<ThreadComment[]>
  generateTts: (params: {
    text: string
    voice?: string
    destPath?: string
  }) => Promise<{ audioPath: string; durationSec: number }>
  renderCard: (params: { cardOptions: unknown; destPath?: string }) => Promise<string>
  runFullPipeline: (params: FullPipelineParams) => Promise<string>
  selectDirectory: () => Promise<string | null>
  selectVideo: () => Promise<string | null>
  selectFfmpeg: () => Promise<string | null>
  openPath: (targetPath: string) => Promise<boolean>
  openExternal: (targetUrl: string) => Promise<boolean>
  checkForUpdates: () => Promise<UpdateInfoState>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  onUpdaterStatus: (callback: (status: UpdateInfoState) => void) => () => void
  listPresetBackgrounds: () => Promise<Array<{ id: string; name: string; path: string }>>
  openTemplatesFolder: () => Promise<boolean>
  onProgress: (callback: (progress: VideoJobProgress) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ThreadCutAPI
  }
}

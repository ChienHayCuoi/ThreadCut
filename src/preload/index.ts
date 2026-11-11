import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  ThreadPostDetail,
  ThreadComment,
  AppSettings,
  FullPipelineParams,
  VideoJobProgress,
  UpdateInfoState
} from '../shared/types'

// Custom APIs for ThreadCut renderer
const api = {
  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:save', settings),

  // Pipeline steps
  crawlPost: (url: string): Promise<ThreadPostDetail> =>
    ipcRenderer.invoke('crawler:fetch-post', url),
  filterComments: (params: {
    apiKey?: string
    model?: string
    postText: string
    comments: ThreadComment[]
  }): Promise<ThreadComment[]> => ipcRenderer.invoke('ai:filter-comments', params),
  generateTts: (params: { text: string; voice?: string; destPath?: string }) =>
    ipcRenderer.invoke('tts:generate', params),
  renderCard: (params: { cardOptions: unknown; destPath?: string }) =>
    ipcRenderer.invoke('card:render', params),
  runFullPipeline: (params: FullPipelineParams): Promise<string> =>
    ipcRenderer.invoke('pipeline:run-full', params),

  // File dialogs & Shell
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:select-directory'),
  selectVideo: (): Promise<string | null> => ipcRenderer.invoke('dialog:select-video'),
  selectFfmpeg: (): Promise<string | null> => ipcRenderer.invoke('dialog:select-ffmpeg'),
  openPath: (targetPath: string): Promise<boolean> =>
    ipcRenderer.invoke('shell:open-path', targetPath),
  openExternal: (targetUrl: string): Promise<boolean> =>
    ipcRenderer.invoke('app:open-external', targetUrl),

  // In-App Auto-Update APIs
  checkForUpdates: (): Promise<UpdateInfoState> => ipcRenderer.invoke('updater:check'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('updater:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('updater:install'),
  onUpdaterStatus: (callback: (status: UpdateInfoState) => void): (() => void) => {
    const sub = (_e: Electron.IpcRendererEvent, status: UpdateInfoState): void => {
      callback(status)
    }
    ipcRenderer.on('updater:status', sub)
    return () => {
      ipcRenderer.removeListener('updater:status', sub)
    }
  },

  listPresetBackgrounds: (): Promise<Array<{ id: string; name: string; path: string }>> =>
    ipcRenderer.invoke('template:list-presets'),
  openTemplatesFolder: (): Promise<boolean> => ipcRenderer.invoke('shell:open-templates-folder'),

  // Progress listener
  onProgress: (callback: (progress: VideoJobProgress) => void): (() => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, progress: VideoJobProgress): void => {
      callback(progress)
    }
    ipcRenderer.on('pipeline:progress', subscription)
    return () => {
      ipcRenderer.removeListener('pipeline:progress', subscription)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

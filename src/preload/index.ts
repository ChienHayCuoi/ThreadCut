import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for ThreadCut renderer
const api = {
  crawlPost: (url: string) => ipcRenderer.invoke('crawler:fetch-post', url),
  filterComments: (params: { apiKey: string; postText: string; comments: unknown[] }) =>
    ipcRenderer.invoke('ai:filter-comments', params),
  generateTts: (params: { text: string; voice?: string }) =>
    ipcRenderer.invoke('tts:generate', params),
  renderVideo: (params: { templateConfig: unknown }) =>ipcRenderer.invoke('video:render', params)
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

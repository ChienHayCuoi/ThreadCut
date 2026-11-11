export interface ThreadAuthor {
  username: string
  avatarUrl?: string
  isVerified?: boolean
}

export interface ThreadComment {
  id: string
  author: ThreadAuthor
  text: string
  likesCount?: number
  timestamp?: number
  isPeak?: boolean
  selected?: boolean
}

export interface ThreadPostDetail {
  id: string
  url: string
  author: ThreadAuthor
  text: string
  mediaUrls?: string[]
  likesCount?: number
  commentsCount?: number
  timestamp?: number
  comments: ThreadComment[]
}

export interface VideoTemplateConfig {
  id: string
  name: string
  backgroundVideoPath: string
  bgmAudioPath?: string
  bgmVolume?: number
  aspectRatio: '9:16'
  resolution: { width: 1080; height: 1920 }
}

export interface VideoJobProgress {
  step: 'crawling' | 'filtering_ai' | 'generating_tts' | 'rendering_video' | 'completed' | 'error'
  percent: number
  message: string
  outputFilePath?: string
}

export interface AppSettings {
  geminiApiKey: string
  outputDir: string
  defaultTtsVoice: string
  backgroundTemplateDir: string
}

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
  score?: number
  reason?: string
  mediaUrls?: string[]
  imageUrl?: string
  localImagePath?: string
}

export interface ThreadPostDetail {
  id: string
  url: string
  author: ThreadAuthor
  text: string
  mediaUrls?: string[]
  imageUrl?: string
  imageUrls?: string[]
  localImagePath?: string
  localImagePaths?: string[]
  videoUrl?: string
  localVideoPath?: string
  likesCount?: number
  commentsCount?: number
  timestamp?: number
  comments: ThreadComment[]
}

export interface TtsWordTimestamp {
  word: string
  startMs: number
  endMs: number
}

export interface TtsSegment {
  id: string
  type: 'post' | 'comment'
  authorName: string
  text: string
  audioPath: string
  durationSec: number
  subtitles: TtsWordTimestamp[]
  cardImagePath?: string
  mediaVideoPath?: string
  mediaImagePath?: string
}

export type BackgroundMode = 'generator' | 'preset' | 'custom'

export interface BackgroundPreset {
  id: string
  name: string
  path: string
}

export interface VideoTemplateConfig {
  id: string
  name: string
  bgMode?: BackgroundMode
  generatorStyle?: 'midnight_blue' | 'cyber_purple' | 'emerald_dark' | 'sunset_glow'
  backgroundVideoPath?: string
  bgmAudioPath?: string
  bgmVolume?: number
  aspectRatio: '9:16'
  resolution: { width: 1080; height: 1920 }
}

export interface VideoJobProgress {
  step:
    | 'crawling'
    | 'filtering_ai'
    | 'generating_tts'
    | 'rendering_cards'
    | 'rendering_video'
    | 'completed'
    | 'error'
  percent: number
  message: string
  outputFilePath?: string
}

export interface AppSettings {
  geminiApiKey: string
  geminiModel: string
  defaultTtsVoice: string
  ttsRate: string
  outputDir: string
  backgroundTemplateDir: string
  customFfmpegPath?: string
}

export interface FullPipelineParams {
  post: ThreadPostDetail
  selectedComments: ThreadComment[]
  voice: string
  rate?: string
  template: VideoTemplateConfig
}

export interface UpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface UpdateInfoState {
  status:
    'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  currentVersion: string
  latestVersion?: string
  releaseNotes?: string
  progress?: UpdateProgress
  error?: string
}

export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseNotes?: string
  downloadUrl?: string
  publishedAt?: string
  error?: string
}

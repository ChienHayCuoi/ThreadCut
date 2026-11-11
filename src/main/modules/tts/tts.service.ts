export interface TtsOutput {
  audioPath: string
  durationSec: number
  subtitles?: Array<{ word: string; startMs: number; endMs: number }>
}

export class TtsService {
  /**
   * Sinh giọng đọc từ văn bản (mặc định giọng Microsoft Edge TTS tiếng Việt)
   */
  async generateSpeech(text: string, voice = 'vi-VN-HoaiMyNeural'): Promise<TtsOutput> {
    console.log(`[TtsService] Đang tạo giọng đọc (${text.length} ký tự) với voice: ${voice}`)
    return {
      audioPath: '',
      durationSec: 5
    }
  }
}

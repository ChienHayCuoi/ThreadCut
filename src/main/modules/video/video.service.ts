import { VideoTemplateConfig, VideoJobProgress } from '../../../shared/types'

export class VideoRendererService {
  /**
   * Ghép video 9:16 theo template (Background gameplay/chill + voiceover + pop-up comments + captions)
   */
  async renderVideo(
    template: VideoTemplateConfig,
    onProgress?: (progress: VideoJobProgress) => void
  ): Promise<string> {
    console.log(`[VideoRenderer] Đang render video theo template: ${template.name}`)
    onProgress?.({
      step: 'rendering_video',
      percent: 50,
      message: 'Đang kết hợp audio và template video...'
    })
    return '/path/to/output.mp4'
  }
}

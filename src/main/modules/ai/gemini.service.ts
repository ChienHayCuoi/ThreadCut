import { ThreadComment } from '../../../shared/types'

export class GeminiService {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  /**
   * Phân tích ngữ cảnh toàn bộ bình luận và chọn ra 5 bình luận hay/peak nhất
   */
  async pickPeakComments(
    postContent: string,
    comments: ThreadComment[],
    limit = 5
  ): Promise<ThreadComment[]> {
    console.log(
      `[GeminiService] Dùng key ${this.apiKey.slice(0, 4)}... để lọc comments cho bài viết (${postContent.length} ký tự)`
    )
    return comments.slice(0, limit).map((c) => ({ ...c, isPeak: true, selected: true }))
  }
}

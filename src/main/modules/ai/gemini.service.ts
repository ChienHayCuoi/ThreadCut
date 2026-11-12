import { GoogleGenAI } from '@google/genai'
import { ThreadComment } from '../../../shared/types'

function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  let timer: NodeJS.Timeout
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMsg)), ms)
  })
  return Promise.race([
    promise.then((res) => {
      clearTimeout(timer)
      return res
    }),
    timeoutPromise
  ])
}

export class GeminiService {
  private apiKey: string
  private readonly model = 'gemini-3.5-flash'

  constructor(apiKey: string) {
    this.apiKey = apiKey.trim()
  }

  /**
   * Phân tích ngữ cảnh toàn bộ bình luận và chọn ra 10 bình luận hay/peak nhất.
   * Tiêu chuẩn: Ưu tiên chọn bình luận có nhiều like, tim nhất trước, sau đó mới tới đánh giá nội dung.
   */
  async pickPeakComments(
    postContent: string,
    comments: ThreadComment[],
    limit = 10
  ): Promise<ThreadComment[]> {
    if (!comments || comments.length === 0) {
      return []
    }

    if (comments.length <= limit) {
      return comments.map((c) => ({
        ...c,
        isPeak: true,
        selected: true,
        score: 9.0,
        reason: 'Bình luận nổi bật'
      }))
    }

    if (!this.apiKey) {
      console.warn('[GeminiService] Chưa có API Key, sử dụng thuật toán tính điểm nội bộ...')
      return this.fallbackHeuristicSort(comments, limit)
    }

    // Sắp xếp trước danh sách bình luận theo lượng like/tim giảm dần
    const sortedByLikes = [...comments].sort((a, b) => (b.likesCount || 0) - (a.likesCount || 0))

    const prompt = `
Bạn là chuyên gia sáng tạo nội dung video ngắn (TikTok, YouTube Shorts, Reels) chuyên về các chủ đề Threads Việt Nam.
Nhiệm vụ của bạn là đọc bài viết gốc và danh sách bình luận bên dưới, sau đó chọn ra đúng ${limit} bình luận xuất sắc nhất để dựng video ngắn.

QUY TẮC CHỌN LỰA BẮT BUỘC (THEO THỨ TỰ ƯU TIÊN):
1. TIÊU CHÍ SỐ 1 - ƯU TIÊN LƯỢNG LIKE / TIM / TƯƠNG TÁC CAO NHẤT:
   - Bình luận có nhiều like/tim nhất phản ánh độ viral và sự đồng tình lớn nhất của cộng đồng Threads.
   - BẮT BUỘC ưu tiên tuyển chọn các bình luận nằm trong top có số lượng like/tim cao nhất của bài viết.
2. TIÊU CHÍ SỐ 2 - ĐÁNH GIÁ NỘI DUNG (XÉT TRONG NHÓM NHIỀU LIKE):
   - Trong số các bình luận có nhiều like/tim, đánh giá độ châm biếm (sarcasm), hài hước, phản dame bất ngờ, hoặc "mặn mòi" theo văn hóa mạng giới trẻ Việt Nam.
   - Nội dung câu từ gọn gàng, súc tích, dễ đọc và phù hợp làm phụ đề nhảy chữ cho video ngắn.
3. Không chọn bình luận 0 like hoặc quá ít tương tác nếu còn các bình luận nhiều like khác.

BÀI VIẾT GỐC:
"""
${postContent}
"""

DANH SÁCH BÌNH LUẬN (ĐÃ XẾP THEO LƯỢNG LIKE GIẢM DẦN):
${JSON.stringify(
  sortedByLikes.map((c) => ({
    id: c.id,
    author: c.author.username,
    text: c.text,
    likes: c.likesCount || 0
  })),
  null,
  2
)}

HÃY TRẢ VỀ JSON HỢP LỆ VỚI CẤU TRÚC SAU:
{
  "selected": [
    {
      "id": "id_bình_luận",
      "score": 9.8,
      "reason": "Nêu rõ số like và lý do bình luận này viral/chất"
    }
  ]
}
`

    const ai = new GoogleGenAI({ apiKey: this.apiKey })

    try {
      console.log(
        `[GeminiService] Đang gọi ${this.model} để chấm điểm ${comments.length} comments (ưu tiên like/tim cao nhất)...`
      )

      const response = await withTimeout(
        ai.models.generateContent({
          model: this.model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json'
          }
        }),
        15000,
        `Quá thời gian chờ phản hồi từ model ${this.model} (15s)`
      )

      const rawText = response.text || ''
      const parsed = JSON.parse(rawText)

      if (parsed && Array.isArray(parsed.selected)) {
        const selectedMap = new Map<string, { score: number; reason: string }>()
        parsed.selected.forEach((item: { id: string; score: number; reason: string }) => {
          selectedMap.set(item.id, { score: item.score || 9.0, reason: item.reason || '' })
        })

        const result: ThreadComment[] = []
        for (const c of comments) {
          if (selectedMap.has(c.id)) {
            const meta = selectedMap.get(c.id)!
            result.push({
              ...c,
              isPeak: true,
              selected: true,
              score: meta.score,
              reason: meta.reason
            })
          }
        }

        // Sắp xếp ưu tiên: lượt like/tim nhiều nhất lên đầu, rồi tới điểm Gemini
        result.sort(
          (a, b) => (b.likesCount || 0) - (a.likesCount || 0) || (b.score || 0) - (a.score || 0)
        )

        if (result.length > 0) {
          console.log(
            `[GeminiService] Đã chọn thành công ${result.length} bình luận qua ${this.model}`
          )
          return result.slice(0, limit)
        }
      }
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err)
      console.warn(
        `[GeminiService] Model ${this.model} gặp sự cố (${errMessage}), chuyển sang chấm điểm cục bộ...`
      )
    }

    return this.fallbackHeuristicSort(comments, limit)
  }

  private fallbackHeuristicSort(comments: ThreadComment[], limit: number): ThreadComment[] {
    const scored = comments.map((c) => {
      // Ưu tiên số like/tim lên hàng đầu
      const likes = c.likesCount || 0
      let score = likes * 10
      const len = c.text.length
      if (len >= 15 && len <= 120) score += 5
      if (c.text.includes('?') || c.text.includes('!')) score += 2
      if (/😂|🤣|💀|cl|vcl|đỉnh|chóp|quá|trời|ơi/i.test(c.text)) score += 3

      return {
        ...c,
        isPeak: true,
        selected: true,
        score: Math.min(9.9, Number((7.0 + Math.min(score, 100) * 0.029).toFixed(1))),
        reason: `Bình luận có lượng tương tác cao (${likes} lượt thích)`
      }
    })

    // Sắp xếp ưu tiên: lượt like giảm dần, rồi đến điểm chất lượng
    scored.sort(
      (a, b) => (b.likesCount || 0) - (a.likesCount || 0) || (b.score || 0) - (a.score || 0)
    )
    return scored.slice(0, limit)
  }
}

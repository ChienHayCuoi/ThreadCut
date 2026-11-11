import { useState } from 'react'
import { ThreadComment, ThreadPostDetail } from '../../shared/types'

function App(): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentStep, setCurrentStep] = useState<string>('idle')
  const [postData, setPostData] = useState<ThreadPostDetail | null>(null)
  const [peakComments, setPeakComments] = useState<ThreadComment[]>([])

  const handleStartProcess = async (): Promise<void> => {
    if (!url.trim()) return
    setLoading(true)
    setCurrentStep('Đang cào bài viết và bình luận...')

    try {
      // 1. Cào dữ liệu
      const post = await window.api.crawlPost(url)
      setPostData(post)

      // 2. Gọi AI chọn lọc comment
      setCurrentStep('AI đang phân tích và chọn 5 bình luận peak nhất...')
      const topComments = await window.api.filterComments({
        apiKey: '',
        postText: post.text,
        comments: post.comments
      })
      setPeakComments(topComments)

      setCurrentStep('Hoàn tất chọn bình luận! Sẵn sàng tạo video.')
    } catch (err) {
      console.error(err)
      setCurrentStep('Đã có lỗi xảy ra trong quá trình xử lý.')
    } finally {
      setLoading(false)
    }
  }

  const handleRenderVideo = async (): Promise<void> => {
    setLoading(true)
    setCurrentStep('Đang tổng hợp giọng đọc TTS và render video 9:16...')
    try {
      await window.api.renderVideo({
        templateConfig: {
          id: 'template-default',
          name: 'Gameplay Subway Surfers',
          backgroundVideoPath: '',
          aspectRatio: '9:16',
          resolution: { width: 1080, height: 1920 }
        }
      })
      setCurrentStep('Xuất video thành công!')
    } catch (err) {
      console.error(err)
      setCurrentStep('Lỗi khi render video.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', padding: '24px', boxSizing: 'border-box', background: '#0f172a', color: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '16px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
            🎬 ThreadCut <span style={{ fontSize: '12px', background: '#3b82f6', color: '#fff', padding: '2px 8px', borderRadius: '12px' }}>v1.0.0</span>
          </h1>
          <p style={{ margin: '4px 0 0 0', color: '#94a3b8', fontSize: '14px' }}>Tự động hóa sản xuất video Shorts/TikTok từ Threads</p>
        </div>
      </header>

      {/* Main Content: 2 Columns */}
      <div style={{ display: 'flex', flex: 1, gap: '24px', marginTop: '20px', minHeight: 0 }}>
        {/* Left Column: Form & Controls */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
          {/* Input Box */}
          <div style={{ background: '#1e293b', padding: '16px', borderRadius: '12px', border: '1px solid #334155' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '14px' }}>
              Link bài viết Threads:
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="https://www.threads.net/@user/post/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', fontSize: '14px' }}
              />
              <button
                onClick={handleStartProcess}
                disabled={loading || !url}
                style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, opacity: loading || !url ? 0.6 : 1 }}
              >
                {loading ? 'Đang xử lý...' : 'Phân tích bài'}
              </button>
            </div>
            {currentStep !== 'idle' && (
              <p style={{ margin: '10px 0 0', fontSize: '13px', color: '#38bdf8' }}>
                ℹ️ {currentStep}
              </p>
            )}
          </div>

          {/* Post info preview */}
          {postData && (
            <div style={{ background: '#1e293b', padding: '16px', borderRadius: '12px', border: '1px solid #334155' }}>
              <h3 style={{ margin: '0 0 10px', fontSize: '16px' }}>📝 Bài viết: @{postData.author.username}</h3>
              <p style={{ color: '#cbd5e1', fontSize: '14px', margin: 0, lineHeight: 1.5 }}>{postData.text}</p>
            </div>
          )}

          {/* Top 5 Peak Comments */}
          <div style={{ background: '#1e293b', padding: '16px', borderRadius: '12px', border: '1px solid #334155', flex: 1 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '16px', display: 'flex', justifyContent: 'space-between' }}>
              🔥 Top 5 bình luận hay nhất ({peakComments.length})
            </h3>
            {peakComments.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: '14px', textAlign: 'center', padding: '40px 0' }}>
                Chưa có dữ liệu. Hãy dán link Threads và bấm "Phân tích bài".
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {peakComments.map((c, idx) => (
                  <div key={c.id || idx} style={{ background: '#0f172a', padding: '10px 12px', borderRadius: '8px', border: '1px solid #334155' }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: '#93c5fd' }}>#{idx + 1} @{c.author.username}</div>
                    <div style={{ fontSize: '14px', color: '#e2e8f0', marginTop: '4px' }}>{c.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action button: Render video */}
          <button
            onClick={handleRenderVideo}
            disabled={loading || peakComments.length === 0}
            style={{
              background: '#16a34a',
              color: '#fff',
              border: 'none',
              padding: '14px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '16px',
              opacity: loading || peakComments.length === 0 ? 0.6 : 1
            }}
          >
            🚀 Bắt đầu sản xuất Video 9:16
          </button>
        </div>

        {/* Right Column: 9:16 Video Preview Box */}
        <div style={{ width: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h4 style={{ margin: '0 0 10px', color: '#94a3b8' }}>Preview Video (9:16)</h4>
          <div style={{ width: '270px', height: '480px', background: '#000', borderRadius: '16px', border: '2px solid #334155', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '16px', boxSizing: 'border-box', position: 'relative', overflow: 'hidden' }}>
            <div style={{ color: '#64748b', textAlign: 'center', fontSize: '13px' }}>
              🎥 Video Template 9:16
              <br />
              <small>(Gameplay / Background)</small>
            </div>
            {/* Overlay mockup */}
            <div style={{ position: 'absolute', bottom: '60px', left: '16px', right: '16px', background: 'rgba(255,255,255,0.9)', color: '#000', padding: '10px', borderRadius: '8px', fontSize: '12px' }}>
              💬 Thẻ bình luận sẽ hiển thị tại đây
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App

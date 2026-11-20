import { useState, useEffect } from 'react'
import {
  ThreadComment,
  ThreadPostDetail,
  AppSettings,
  VideoJobProgress,
  UpdateInfoState
} from '../../shared/types'

const formatLikes = (count?: number): string => {
  if (count === undefined || count === null) return '0'
  if (count >= 1000000) return (count / 1000000).toFixed(1).replace('.0', '') + 'M'
  if (count >= 1000) return (count / 1000).toFixed(1).replace('.0', '') + 'K'
  return count.toLocaleString()
}

const toMediaUrl = (pathOrUrl?: string | null): string => {
  if (!pathOrUrl) return ''
  if (
    pathOrUrl.startsWith('http://') ||
    pathOrUrl.startsWith('https://') ||
    pathOrUrl.startsWith('blob:') ||
    pathOrUrl.startsWith('data:')
  ) {
    return pathOrUrl
  }
  if (pathOrUrl.startsWith('atom://media/?path=')) {
    return pathOrUrl
  }
  let cleanPath = pathOrUrl
  if (cleanPath.startsWith('atom://')) {
    cleanPath = decodeURIComponent(cleanPath.replace(/^atom:\/\/(media\/)?(\?path=)?/, ''))
  }
  cleanPath = cleanPath.replace(/^file:\/\//, '')
  return `atom://media/?path=${encodeURIComponent(cleanPath)}`
}

function App(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings>({
    defaultTtsVoice: 'vi-VN-HoaiMyNeural',
    ttsRate: 'default',
    outputDir: '',
    backgroundTemplateDir: ''
  })
  const [showSettings, setShowSettings] = useState(false)
  const [settingsSavedMsg, setSettingsSavedMsg] = useState('')

  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<VideoJobProgress>({
    step: 'crawling',
    percent: 0,
    message: ''
  })
  const [postData, setPostData] = useState<ThreadPostDetail | null>(null)
  const [peakComments, setPeakComments] = useState<ThreadComment[]>([])
  const [originalComments, setOriginalComments] = useState<ThreadComment[]>([])
  const [draggedCommentId, setDraggedCommentId] = useState<string | null>(null)
  const [dragOverCommentId, setDragOverCommentId] = useState<string | null>(null)
  const [dropIndicatorPosition, setDropIndicatorPosition] = useState<'before' | 'after' | null>(
    null
  )
  const [commentSearchKeyword, setCommentSearchKeyword] = useState<string>('')
  const [commentFilterTab, setCommentFilterTab] = useState<'all' | 'selected' | 'media'>('all')
  const [previewCardMode, setPreviewCardMode] = useState<'post' | 'comment'>('post')
  const [previewCommentId, setPreviewCommentId] = useState<string | null>(null)

  const [selectedVoice, setSelectedVoice] = useState('vi-VN-HoaiMyNeural')
  const [selectedRate, setSelectedRate] = useState('+20%')
  const [lastOutputVideo, setLastOutputVideo] = useState<string | null>(null)

  // Video nền do người dùng tải lên
  const [backgroundVideoPath, setBackgroundVideoPath] = useState<string>('')
  const [previewTab, setPreviewTab] = useState<'layout' | 'rendered'>('layout')

  // Quản lý In-App Auto Update
  const [updateState, setUpdateState] = useState<UpdateInfoState | null>(null)
  const [showUpdateBanner, setShowUpdateBanner] = useState<boolean>(true)
  const [checkingUpdate, setCheckingUpdate] = useState<boolean>(false)
  const [updateCheckMsg, setUpdateCheckMsg] = useState<string>('')

  // Load settings, attach progress listener & lắng nghe auto-update
  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s)
      if (s.defaultTtsVoice) setSelectedVoice(s.defaultTtsVoice)
    })

    // Lắng nghe trạng thái cập nhật thời gian thực
    const unsubUpdater = window.api.onUpdaterStatus((status) => {
      setUpdateState(status)
      if (
        status.status === 'available' ||
        status.status === 'downloading' ||
        status.status === 'downloaded'
      ) {
        setShowUpdateBanner(true)
      }
    })

    // Tự động kiểm tra cập nhật khi mở app
    window.api
      .checkForUpdates()
      .then((res) => {
        setUpdateState(res)
        if (res.status === 'available') {
          setShowUpdateBanner(true)
        }
      })
      .catch((err) => console.warn('Lỗi kiểm tra cập nhật:', err))

    const unsubscribe = window.api.onProgress((p) => {
      setProgress(p)
      if (p.outputFilePath) {
        setLastOutputVideo(p.outputFilePath)
      }
    })

    return () => {
      unsubscribe()
      unsubUpdater()
    }
  }, [])

  const handleManualCheckUpdate = async (): Promise<void> => {
    setCheckingUpdate(true)
    setUpdateCheckMsg('')
    try {
      const res = await window.api.checkForUpdates()
      setUpdateState(res)
      if (res.status === 'available') {
        setUpdateCheckMsg(`🎉 Đã có bản cập nhật mới: v${res.latestVersion}!`)
        setShowUpdateBanner(true)
      } else if (res.status === 'not-available') {
        setUpdateCheckMsg(`✅ Bạn đang sử dụng phiên bản mới nhất (v${res.currentVersion}).`)
      } else if (res.status === 'error') {
        setUpdateCheckMsg(`⚠️ ${res.error || 'Lỗi kiểm tra cập nhật'}`)
      }
    } catch {
      setUpdateCheckMsg('❌ Không thể kết nối tới máy chủ để kiểm tra cập nhật.')
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleDownloadUpdate = async (): Promise<void> => {
    try {
      await window.api.downloadUpdate()
    } catch (err) {
      console.error(err)
    }
  }

  const handleInstallUpdate = (): void => {
    window.api.installUpdate()
  }

  const handleSaveSettings = async (): Promise<void> => {
    const updated = await window.api.saveSettings(settings)
    setSettings(updated)
    setSettingsSavedMsg('Đã lưu cấu hình thành công!')
    setTimeout(() => setSettingsSavedMsg(''), 2500)
  }

  const handleStartProcess = async (): Promise<void> => {
    if (!url.trim()) return
    setLoading(true)
    setLastOutputVideo(null)
    setProgress({
      step: 'crawling',
      percent: 10,
      message: 'Đang bóc tách bài viết & bình luận từ Threads...'
    })

    try {
      // 1. Cào dữ liệu bài viết & bình luận
      const post = await window.api.crawlPost(url)
      setPostData(post)

      // 2. Bỏ qua chấm điểm AI: Hiển thị toàn bộ bình luận cào được (tối đa 20 bình luận)
      const rawComments = post.comments || []
      const commentsToShow = rawComments.slice(0, 20).map((c, idx) => ({
        ...c,
        id: c.id || `comment-${idx + 1}-${Date.now()}`,
        isPeak: true,
        selected: true
      }))

      setPeakComments(commentsToShow)
      setOriginalComments(commentsToShow)
      if (commentsToShow.length > 0) {
        setPreviewCommentId(commentsToShow[0].id)
      }
      setProgress({
        step: 'completed',
        percent: 100,
        message: `Đã cào được ${commentsToShow.length} bình luận! Sẵn sàng sản xuất video.`
      })
    } catch (err) {
      console.error(err)
      setProgress({
        step: 'error',
        percent: 100,
        message: 'Lỗi trong quá trình xử lý cào dữ liệu từ Threads.'
      })
    } finally {
      setLoading(false)
    }
  }

  const selectedCommentsCount = peakComments.filter((c) => c.selected !== false).length

  const handleRunFullPipeline = async (): Promise<void> => {
    const activeComments = peakComments.filter((c) => c.selected !== false)
    if (!postData || activeComments.length === 0) return
    setLoading(true)
    setLastOutputVideo(null)

    try {
      const outputPath = await window.api.runFullPipeline({
        post: postData,
        selectedComments: activeComments,
        voice: selectedVoice,
        rate: selectedRate,
        template: {
          id: 'template-vertical',
          name: '9:16 Shorts/TikTok Template',
          backgroundVideoPath: backgroundVideoPath || undefined,
          aspectRatio: '9:16',
          resolution: { width: 1080, height: 1920 }
        }
      })
      setLastOutputVideo(outputPath)
      setPreviewTab('rendered')
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectOutputDir = async (): Promise<void> => {
    const dir = await window.api.selectDirectory()
    if (dir) {
      setSettings((prev) => ({ ...prev, outputDir: dir }))
    }
  }

  const handleSelectCustomFfmpeg = async (): Promise<void> => {
    const f = await window.api.selectFfmpeg()
    if (f) {
      setSettings((prev) => ({ ...prev, customFfmpegPath: f }))
    }
  }

  const handleSelectBgVideo = async (): Promise<void> => {
    const v = await window.api.selectVideo()
    if (v) {
      setBackgroundVideoPath(v)
      setPreviewTab('layout')
    }
  }

  const handleClearBgVideo = (): void => {
    setBackgroundVideoPath('')
  }

  const handleOpenOutputFolder = (): void => {
    if (lastOutputVideo) {
      window.api.openPath(lastOutputVideo)
    } else if (settings.outputDir) {
      window.api.openPath(settings.outputDir)
    }
  }

  const handleToggleComment = (id: string): void => {
    setPeakComments((prev) => prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c)))
  }

  const handleUpdateCommentText = (id: string, text: string): void => {
    setPeakComments((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)))
  }

  // Sắp xếp lại thứ tự danh sách bình luận (Drag and drop)
  const reorderComments = (
    draggedId: string,
    targetId: string,
    position: 'before' | 'after'
  ): void => {
    if (draggedId === targetId) return
    const fromIndex = peakComments.findIndex((c) => c.id === draggedId)
    if (fromIndex === -1) return

    const updated = [...peakComments]
    const [moved] = updated.splice(fromIndex, 1)

    const targetIndex = updated.findIndex((c) => c.id === targetId)
    if (targetIndex === -1) return

    const insertIndex = position === 'before' ? targetIndex : targetIndex + 1
    updated.splice(insertIndex, 0, moved)
    setPeakComments(updated)
  }

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, id: string): void => {
    setDraggedCommentId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, targetId: string): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (targetId === draggedCommentId) return

    const rect = e.currentTarget.getBoundingClientRect()
    const offset = e.clientY - rect.top
    const position: 'before' | 'after' = offset < rect.height / 2 ? 'before' : 'after'

    if (dragOverCommentId !== targetId || dropIndicatorPosition !== position) {
      setDragOverCommentId(targetId)
      setDropIndicatorPosition(position)
    }
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    const related = e.relatedTarget as Node | null
    if (!related || !e.currentTarget.contains(related)) {
      if (dragOverCommentId === e.currentTarget.dataset.commentId) {
        setDragOverCommentId(null)
        setDropIndicatorPosition(null)
      }
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetId: string): void => {
    e.preventDefault()
    if (draggedCommentId && draggedCommentId !== targetId && dropIndicatorPosition) {
      reorderComments(draggedCommentId, targetId, dropIndicatorPosition)
    }
    setDraggedCommentId(null)
    setDragOverCommentId(null)
    setDropIndicatorPosition(null)
  }

  const handleDragEnd = (): void => {
    setDraggedCommentId(null)
    setDragOverCommentId(null)
    setDropIndicatorPosition(null)
  }

  const handleMoveComment = (id: string, direction: 'up' | 'down'): void => {
    const filteredIndex = filteredComments.findIndex((c) => c.id === id)
    if (filteredIndex === -1) return
    const neighborIndex = direction === 'up' ? filteredIndex - 1 : filteredIndex + 1
    if (neighborIndex < 0 || neighborIndex >= filteredComments.length) return
    const neighborId = filteredComments[neighborIndex].id
    reorderComments(id, neighborId, direction === 'up' ? 'before' : 'after')
  }

  const handleSortByLikes = (): void => {
    const sorted = [...peakComments].sort((a, b) => (b.likesCount || 0) - (a.likesCount || 0))
    setPeakComments(sorted)
  }

  const handleSelectAllComments = (select: boolean): void => {
    setPeakComments((prev) => prev.map((c) => ({ ...c, selected: select })))
  }

  const handleResetOriginalOrder = (): void => {
    if (originalComments.length === 0) return
    const currentMap = new Map(peakComments.map((c) => [c.id, c]))
    const restored = originalComments.map((orig) => currentMap.get(orig.id) || orig)
    setPeakComments(restored)
  }

  // Danh sách bình luận sau khi lọc theo keyword và filter tab
  const filteredComments = peakComments.filter((c) => {
    if (commentFilterTab === 'selected' && c.selected === false) return false
    if (
      commentFilterTab === 'media' &&
      !c.localImagePath &&
      !c.imageUrl &&
      (!c.mediaUrls || c.mediaUrls.length === 0)
    ) {
      return false
    }
    if (commentSearchKeyword.trim()) {
      const q = commentSearchKeyword.trim().toLowerCase()
      const matchText = c.text?.toLowerCase().includes(q)
      const matchAuthor = c.author?.username?.toLowerCase().includes(q)
      if (!matchText && !matchAuthor) return false
    }
    return true
  })

  const commentsWithMediaCount = peakComments.filter((c) =>
    Boolean(c.localImagePath || c.imageUrl || (c.mediaUrls && c.mediaUrls.length > 0))
  ).length

  // Bình luận được chọn để xem trước trong Mockup 9:16
  const currentPreviewComment =
    peakComments.find((c) => c.id === previewCommentId) ||
    peakComments.find((c) => c.selected !== false) ||
    peakComments[0]

  const previewCommentOrder = currentPreviewComment
    ? peakComments.findIndex((c) => c.id === currentPreviewComment.id) + 1
    : 1

  const previewCommentImage = currentPreviewComment
    ? toMediaUrl(currentPreviewComment.localImagePath) ||
      currentPreviewComment.imageUrl ||
      (currentPreviewComment.mediaUrls && currentPreviewComment.mediaUrls[0]) ||
      ''
    : ''

  // Thu thập toàn bộ hình ảnh đính kèm của bài viết gốc (chỉ áp dụng khi bài viết không có video)
  const hasPostVideo = Boolean(postData?.localVideoPath || postData?.videoUrl)
  const postImages: string[] = []
  if (!hasPostVideo) {
    if (postData?.localImagePaths && postData.localImagePaths.length > 0) {
      postImages.push(...postData.localImagePaths.map((p) => toMediaUrl(p)))
    } else if (postData?.localImagePath) {
      postImages.push(toMediaUrl(postData.localImagePath))
    } else if (postData?.imageUrls && postData.imageUrls.length > 0) {
      postImages.push(...postData.imageUrls)
    } else if (postData?.imageUrl) {
      postImages.push(postData.imageUrl)
    }
  }
  const hasPostImages = postImages.length > 0

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 24px',
        boxSizing: 'border-box',
        background: '#0a0f1d',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}
    >
      {/* Top Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #1e293b',
          paddingBottom: '14px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px'
            }}
          >
            🎬
          </div>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: '20px',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              ThreadCut
            </h1>
            <p style={{ margin: '2px 0 0 0', color: '#94a3b8', fontSize: '13px' }}>
              Tự động hóa sản xuất Video 9:16 (Shorts/TikTok/Reels) từ Threads
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => setShowSettings(true)}
            style={{
              background: '#1e293b',
              color: '#f1f5f9',
              border: '1px solid #334155',
              padding: '8px 16px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            ⚙️ Cài đặt
          </button>
        </div>
      </header>

      {/* In-App Auto Update Notification Banner */}
      {updateState &&
        (updateState.status === 'available' ||
          updateState.status === 'downloading' ||
          updateState.status === 'downloaded') &&
        showUpdateBanner && (
          <div
            style={{
              background: 'linear-gradient(90deg, #1e3a8a, #2563eb)',
              border: '1px solid #60a5fa',
              borderRadius: '10px',
              padding: '12px 18px',
              marginTop: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              boxShadow: '0 4px 14px rgba(37,99,235,0.25)',
              flexShrink: 0
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>
                  {updateState.status === 'downloaded'
                    ? '🎉'
                    : updateState.status === 'downloading'
                      ? '⏳'
                      : '🚀'}
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: '#fff' }}>
                    {updateState.status === 'downloaded'
                      ? `Bản cập nhật v${updateState.latestVersion} đã tải xong!`
                      : updateState.status === 'downloading'
                        ? `Đang tải bản cập nhật v${updateState.latestVersion}... (${updateState.progress?.percent || 0}%)`
                        : `Đã có phiên bản mới: v${updateState.latestVersion}!`}
                  </div>
                  <div style={{ fontSize: '11px', color: '#bfdbfe' }}>
                    {updateState.status === 'downloaded'
                      ? 'Bấm nút bên phải để khởi động lại và tự động nâng cấp ứng dụng ngay.'
                      : updateState.status === 'downloading'
                        ? 'Đang tải file cập nhật ngầm, bạn vẫn có thể sử dụng ứng dụng bình thường.'
                        : `Phiên bản hiện tại: v${updateState.currentVersion}. Cập nhật trực tiếp không cần mở web.`}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {updateState.status === 'available' && (
                  <button
                    type="button"
                    onClick={handleDownloadUpdate}
                    style={{
                      background: '#ffffff',
                      color: '#1d4ed8',
                      border: 'none',
                      padding: '7px 16px',
                      borderRadius: '6px',
                      fontWeight: 700,
                      fontSize: '12px',
                      cursor: 'pointer',
                      boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
                    }}
                  >
                    Cập nhật ngay 🚀
                  </button>
                )}

                {updateState.status === 'downloaded' && (
                  <button
                    type="button"
                    onClick={handleInstallUpdate}
                    style={{
                      background: '#22c55e',
                      color: '#ffffff',
                      border: 'none',
                      padding: '7px 16px',
                      borderRadius: '6px',
                      fontWeight: 700,
                      fontSize: '12px',
                      cursor: 'pointer',
                      boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
                    }}
                  >
                    Khởi động lại để cập nhật 🔄
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowUpdateBanner(false)}
                  title="Ẩn thông báo"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#bfdbfe',
                    cursor: 'pointer',
                    fontSize: '14px',
                    padding: '4px 6px',
                    lineHeight: 1
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Thanh tiến trình khi đang download */}
            {updateState.status === 'downloading' && (
              <div
                style={{
                  width: '100%',
                  height: '6px',
                  background: 'rgba(0,0,0,0.3)',
                  borderRadius: '3px',
                  overflow: 'hidden',
                  marginTop: '4px'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${updateState.progress?.percent || 0}%`,
                    background: '#38bdf8',
                    transition: 'width 0.2s ease'
                  }}
                />
              </div>
            )}
          </div>
        )}

      {/* Main Grid: 2 Columns */}
      <div style={{ display: 'flex', flex: 1, gap: '20px', marginTop: '16px', minHeight: 0 }}>
        {/* Left Column: Workflow */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            overflowY: 'auto',
            paddingRight: '4px'
          }}
        >
          {/* Step 1: Input URL */}
          <div
            style={{
              background: '#111827',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid #1f2937'
            }}
          >
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontWeight: 700, fontSize: '14px', color: '#60a5fa' }}>
                1. Dán Link bài viết Threads:
              </label>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="https://www.threads.net/@username/post/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid #374151',
                  background: '#030712',
                  color: '#fff',
                  fontSize: '14px'
                }}
              />
              <button
                onClick={handleStartProcess}
                disabled={loading || !url}
                style={{
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  padding: '10px 22px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: '14px',
                  opacity: loading || !url ? 0.6 : 1
                }}
              >
                {loading && progress.step === 'crawling' ? 'Đang cào...' : '🔍 Phân tích'}
              </button>
            </div>
          </div>

          {/* Progress Banner */}
          {progress.message && (
            <div
              style={{
                background:
                  progress.step === 'error'
                    ? '#7f1d1d'
                    : progress.step === 'completed'
                      ? '#064e3b'
                      : '#1e3a8a',
                padding: '12px 16px',
                borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.1)'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '13px',
                  fontWeight: 600
                }}
              >
                <span>{progress.message}</span>
                <span>{progress.percent}%</span>
              </div>
              <div
                style={{
                  height: '6px',
                  background: 'rgba(0,0,0,0.3)',
                  borderRadius: '3px',
                  marginTop: '8px',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${progress.percent}%`,
                    background: '#38bdf8',
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>
            </div>
          )}

          {/* Post info preview */}
          {postData && (
            <div
              style={{
                background: '#111827',
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid #1f2937'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px'
                }}
              >
                <span style={{ fontWeight: 700, fontSize: '14px', color: '#93c5fd' }}>
                  📝 Bài viết gốc (@{postData.author.username})
                </span>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  ❤️ {formatLikes(postData.likesCount)} lượt thích
                </span>
              </div>
              <textarea
                value={postData.text}
                onChange={(e) => setPostData({ ...postData, text: e.target.value })}
                rows={3}
                style={{
                  width: '100%',
                  background: '#030712',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  padding: '10px',
                  color: '#e2e8f0',
                  fontSize: '13px',
                  lineHeight: 1.5,
                  boxSizing: 'border-box',
                  resize: 'vertical'
                }}
              />

              {/* Khung xem trước Hình ảnh của bài viết (nếu bài viết có hình ảnh) */}
              {hasPostImages && (
                <div
                  style={{
                    marginTop: '10px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    border: '1px solid #374151',
                    background: '#030712'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      overflowX: 'auto',
                      padding: '8px',
                      background: '#050a15'
                    }}
                  >
                    {postImages.map((imgSrc, imgIdx) => (
                      <img
                        key={imgIdx}
                        src={imgSrc}
                        alt={`Post image ${imgIdx + 1}`}
                        style={{
                          maxHeight: '160px',
                          borderRadius: '6px',
                          objectFit: 'cover',
                          border: '1px solid #1e293b'
                        }}
                      />
                    ))}
                  </div>
                  <div
                    style={{
                      padding: '6px 10px',
                      background: '#0f172a',
                      fontSize: '11px',
                      color: '#c084fc',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <span>
                      🖼️ Bài viết có {postImages.length} hình ảnh đính kèm (sẽ hiển thị trên thẻ bài
                      viết trong video 9:16)
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Khung xem trước Video đính kèm của bài viết (hiển thị riêng ở dưới bài viết) */}
          {postData && hasPostVideo && (
            <div
              style={{
                background: '#111827',
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid #1f2937'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '10px'
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: '14px',
                    color: '#38bdf8',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  🎬 Video đính kèm của bài viết
                </span>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Hiển thị dưới thẻ bài viết trong video 9:16
                </span>
              </div>
              <div
                style={{
                  borderRadius: '10px',
                  overflow: 'hidden',
                  border: '1px solid #374151',
                  background: '#030712',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center'
                }}
              >
                <video
                  src={toMediaUrl(postData.localVideoPath) || postData.videoUrl}
                  controls
                  muted
                  style={{
                    width: '100%',
                    maxHeight: '260px',
                    display: 'block',
                    objectFit: 'contain'
                  }}
                />
              </div>
            </div>
          )}

          {/* Danh sách bình luận với tính năng Kéo thả sắp xếp và Lọc */}
          <div
            style={{
              background: '#111827',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid #1f2937',
              flex: 1,
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
                flexWrap: 'wrap',
                gap: '8px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: '14px',
                    color: '#f59e0b',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  💬 Danh sách bình luận ({selectedCommentsCount}/{peakComments.length} đã chọn)
                </span>
                {peakComments.length > 0 && (
                  <span
                    style={{
                      background: '#1e293b',
                      color: '#38bdf8',
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    🖐️ Kéo thả để đổi thứ tự
                  </span>
                )}
              </div>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                Hiển thị tối đa 20 bình luận cào được từ Threads
              </span>
            </div>

            {/* Filter & Action Toolbar */}
            {peakComments.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  marginBottom: '12px',
                  padding: '10px',
                  background: '#0a0f1d',
                  borderRadius: '8px',
                  border: '1px solid #1e293b'
                }}
              >
                {/* Search & Tabs */}
                <div
                  style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
                    <input
                      type="text"
                      placeholder="🔍 Lọc theo nội dung, @tác giả..."
                      value={commentSearchKeyword}
                      onChange={(e) => setCommentSearchKeyword(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 28px 6px 10px',
                        borderRadius: '6px',
                        border: '1px solid #374151',
                        background: '#030712',
                        color: '#fff',
                        fontSize: '12px',
                        boxSizing: 'border-box'
                      }}
                    />
                    {commentSearchKeyword && (
                      <button
                        type="button"
                        onClick={() => setCommentSearchKeyword('')}
                        style={{
                          position: 'absolute',
                          right: '6px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'transparent',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer',
                          fontSize: '12px',
                          padding: '2px 4px'
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      type="button"
                      onClick={() => setCommentFilterTab('all')}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        border: '1px solid #334155',
                        background: commentFilterTab === 'all' ? '#2563eb' : '#0f172a',
                        color: commentFilterTab === 'all' ? '#fff' : '#94a3b8',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Tất cả ({peakComments.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCommentFilterTab('selected')}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        border: '1px solid #334155',
                        background: commentFilterTab === 'selected' ? '#2563eb' : '#0f172a',
                        color: commentFilterTab === 'selected' ? '#fff' : '#94a3b8',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Đã chọn ({selectedCommentsCount})
                    </button>
                    {commentsWithMediaCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setCommentFilterTab('media')}
                        style={{
                          padding: '4px 8px',
                          borderRadius: '6px',
                          border: '1px solid #334155',
                          background: commentFilterTab === 'media' ? '#2563eb' : '#0f172a',
                          color: commentFilterTab === 'media' ? '#fff' : '#94a3b8',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        Có ảnh ({commentsWithMediaCount})
                      </button>
                    )}
                  </div>
                </div>

                {/* Quick actions row */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '6px',
                    fontSize: '11px',
                    borderTop: '1px solid #1e293b',
                    paddingTop: '6px'
                  }}
                >
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={handleSortByLikes}
                      title="Sắp xếp toàn bộ bình luận theo số lượt thích giảm dần"
                      style={{
                        background: '#1e293b',
                        color: '#fca5a5',
                        border: '1px solid #475569',
                        padding: '3px 8px',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      ❤️ Xếp theo Like
                    </button>
                    {originalComments.length > 0 && (
                      <button
                        type="button"
                        onClick={handleResetOriginalOrder}
                        title="Khôi phục lại thứ tự ban đầu khi cào từ Threads"
                        style={{
                          background: '#1e293b',
                          color: '#94a3b8',
                          border: '1px solid #475569',
                          padding: '3px 8px',
                          borderRadius: '5px',
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: '11px'
                        }}
                      >
                        ↺ Thứ tự gốc
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => handleSelectAllComments(true)}
                      style={{
                        background: 'transparent',
                        color: '#60a5fa',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '2px 4px',
                        fontSize: '11px',
                        textDecoration: 'underline'
                      }}
                    >
                      ✓ Chọn tất cả
                    </button>
                    <span style={{ color: '#475569' }}>|</span>
                    <button
                      type="button"
                      onClick={() => handleSelectAllComments(false)}
                      style={{
                        background: 'transparent',
                        color: '#94a3b8',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '2px 4px',
                        fontSize: '11px',
                        textDecoration: 'underline'
                      }}
                    >
                      ✕ Bỏ chọn tất cả
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Empty or List */}
            {peakComments.length === 0 ? (
              <div
                style={{
                  color: '#64748b',
                  fontSize: '13px',
                  textAlign: 'center',
                  padding: '30px 0'
                }}
              >
                Chưa có dữ liệu. Hãy dán link bài viết và bấm &quot;Phân tích&quot;.
              </div>
            ) : filteredComments.length === 0 ? (
              <div
                style={{
                  color: '#94a3b8',
                  fontSize: '13px',
                  textAlign: 'center',
                  padding: '30px 0',
                  background: '#030712',
                  borderRadius: '8px',
                  border: '1px dashed #374151'
                }}
              >
                Không có bình luận nào khớp với bộ lọc &quot;{commentSearchKeyword}&quot;.
                <br />
                <button
                  type="button"
                  onClick={() => {
                    setCommentSearchKeyword('')
                    setCommentFilterTab('all')
                  }}
                  style={{
                    marginTop: '8px',
                    background: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    padding: '4px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  Xóa bộ lọc
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  overflowY: 'auto',
                  maxHeight: '440px',
                  paddingRight: '4px'
                }}
              >
                {filteredComments.map((c) => {
                  const globalIdx = peakComments.findIndex((item) => item.id === c.id)
                  const isDragged = draggedCommentId === c.id
                  const isDragOver = dragOverCommentId === c.id
                  const isPreviewing = previewCardMode === 'comment' && previewCommentId === c.id

                  let cardBorder = c.selected !== false ? '1px solid #1f2937' : '1px dashed #374151'
                  let boxShadow = 'none'

                  if (isDragOver && dropIndicatorPosition === 'before') {
                    cardBorder = '1px solid #38bdf8'
                    boxShadow = '0 -3px 0 0 #38bdf8, 0 4px 12px rgba(56,189,248,0.25)'
                  } else if (isDragOver && dropIndicatorPosition === 'after') {
                    cardBorder = '1px solid #38bdf8'
                    boxShadow = '0 3px 0 0 #38bdf8, 0 4px 12px rgba(56,189,248,0.25)'
                  } else if (isPreviewing) {
                    cardBorder = '1px solid #f59e0b'
                    boxShadow = '0 0 10px rgba(245, 158, 11, 0.2)'
                  }

                  return (
                    <div
                      key={c.id}
                      data-comment-id={c.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, c.id)}
                      onDragOver={(e) => handleDragOver(e, c.id)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, c.id)}
                      onDragEnd={handleDragEnd}
                      style={{
                        background: isDragged ? '#0e1726' : isPreviewing ? '#0f172a' : '#030712',
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: cardBorder,
                        boxShadow,
                        opacity: isDragged ? 0.35 : c.selected !== false ? 1 : 0.45,
                        transform: isDragged ? 'scale(0.98)' : 'none',
                        transition:
                          'border 0.15s ease, box-shadow 0.15s ease, background 0.15s ease',
                        cursor: 'grab'
                      }}
                    >
                      {/* Top Header of Card */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '6px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {/* Drag handle */}
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '18px',
                              height: '22px',
                              color: '#64748b',
                              cursor: 'grab',
                              userSelect: 'none'
                            }}
                            title="Kéo thả để sắp xếp vị trí hiển thị"
                          >
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                              <circle cx="5" cy="3" r="1.5" />
                              <circle cx="11" cy="3" r="1.5" />
                              <circle cx="5" cy="8" r="1.5" />
                              <circle cx="11" cy="8" r="1.5" />
                              <circle cx="5" cy="13" r="1.5" />
                              <circle cx="11" cy="13" r="1.5" />
                            </svg>
                          </div>

                          {/* Quick Up/Down buttons */}
                          <div
                            style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              disabled={globalIdx === 0}
                              onClick={() => handleMoveComment(c.id, 'up')}
                              title="Chuyển lên trên"
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: globalIdx === 0 ? '#334155' : '#94a3b8',
                                cursor: globalIdx === 0 ? 'not-allowed' : 'pointer',
                                padding: 0,
                                fontSize: '8px',
                                lineHeight: 1
                              }}
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              disabled={globalIdx === peakComments.length - 1}
                              onClick={() => handleMoveComment(c.id, 'down')}
                              title="Chuyển xuống dưới"
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color:
                                  globalIdx === peakComments.length - 1 ? '#334155' : '#94a3b8',
                                cursor:
                                  globalIdx === peakComments.length - 1 ? 'not-allowed' : 'pointer',
                                padding: 0,
                                fontSize: '8px',
                                lineHeight: 1
                              }}
                            >
                              ▼
                            </button>
                          </div>

                          {/* Order badge */}
                          <span
                            style={{
                              background: '#3b82f6',
                              color: '#fff',
                              fontSize: '11px',
                              padding: '1px 6px',
                              borderRadius: '6px',
                              fontWeight: 700
                            }}
                            title={`Thứ tự phát trong video: #${globalIdx + 1}`}
                          >
                            #{globalIdx + 1}
                          </span>

                          <span style={{ fontWeight: 700, fontSize: '13px', color: '#60a5fa' }}>
                            @{c.author.username}
                          </span>

                          {c.likesCount !== undefined && (
                            <span
                              style={{
                                fontSize: '11px',
                                background: '#3f1d24',
                                color: '#fca5a5',
                                padding: '1px 6px',
                                borderRadius: '6px',
                                fontWeight: 700
                              }}
                            >
                              ❤️ {formatLikes(c.likesCount)}
                            </span>
                          )}
                        </div>

                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewTab('layout')
                              setPreviewCardMode('comment')
                              setPreviewCommentId(c.id)
                            }}
                            title="Xem mô phỏng thẻ này trên khung Preview 9:16"
                            style={{
                              background: isPreviewing ? '#f59e0b' : '#1e293b',
                              color: isPreviewing ? '#000' : '#94a3b8',
                              border: isPreviewing ? '1px solid #f59e0b' : '1px solid #334155',
                              padding: '2px 7px',
                              borderRadius: '5px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                          >
                            👁️ {isPreviewing ? 'Đang xem' : 'Xem thẻ'}
                          </button>

                          <label
                            style={{
                              fontSize: '12px',
                              color: '#94a3b8',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              cursor: 'pointer'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={c.selected !== false}
                              onChange={() => handleToggleComment(c.id)}
                            />
                            Sử dụng
                          </label>
                        </div>
                      </div>

                      {/* Text Input */}
                      <div onMouseDown={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={c.text}
                          onChange={(e) => handleUpdateCommentText(c.id, e.target.value)}
                          style={{
                            width: '100%',
                            background: '#111827',
                            border: '1px solid #374151',
                            borderRadius: '6px',
                            padding: '6px 8px',
                            color: '#f8fafc',
                            fontSize: '13px',
                            boxSizing: 'border-box',
                            cursor: 'text'
                          }}
                        />
                      </div>

                      {/* Hình ảnh đính kèm của bình luận nếu có */}
                      {Boolean(
                        c.localImagePath || c.imageUrl || (c.mediaUrls && c.mediaUrls.length > 0)
                      ) && (
                        <div
                          style={{
                            marginTop: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px'
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <div
                            style={{
                              borderRadius: '8px',
                              overflow: 'hidden',
                              border: '1px solid #374151',
                              background: '#030712',
                              maxHeight: '120px',
                              display: 'inline-flex'
                            }}
                          >
                            <img
                              src={
                                toMediaUrl(c.localImagePath) ||
                                c.imageUrl ||
                                (c.mediaUrls && c.mediaUrls[0])
                              }
                              alt="Comment attachment"
                              draggable={false}
                              style={{
                                maxHeight: '120px',
                                maxWidth: '220px',
                                objectFit: 'contain',
                                display: 'block'
                              }}
                            />
                          </div>
                          <span style={{ fontSize: '11px', color: '#c084fc' }}>
                            📷 Có ảnh đính kèm (sẽ hiển thị trên thẻ bình luận)
                          </span>
                        </div>
                      )}

                      {c.reason && (
                        <div
                          style={{
                            fontSize: '11px',
                            color: '#9ca3af',
                            marginTop: '4px',
                            fontStyle: 'italic'
                          }}
                        >
                          💡 {c.reason}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Video Options & Action Button */}
          <div
            style={{
              background: '#111827',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid #1f2937'
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                marginBottom: '14px'
              }}
            >
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    color: '#94a3b8',
                    marginBottom: '4px',
                    fontWeight: 600
                  }}
                >
                  Giọng đọc:
                </label>
                <select
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '8px',
                    border: '1px solid #374151',
                    background: '#030712',
                    color: '#fff',
                    fontSize: '13px'
                  }}
                >
                  <option value="vi-VN-HoaiMyNeural">Dun</option>
                  <option value="vi-VN-NamMinhNeural">Chin</option>
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    color: '#94a3b8',
                    marginBottom: '4px',
                    fontWeight: 600
                  }}
                >
                  Tốc độ đọc (Speed):
                </label>
                <select
                  value={selectedRate}
                  onChange={(e) => setSelectedRate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '8px',
                    border: '1px solid #374151',
                    background: '#030712',
                    color: '#38bdf8',
                    fontWeight: 600,
                    fontSize: '13px'
                  }}
                >
                  <option value="+0%">Chuẩn</option>
                  <option value="+15%">Nhanh vừa</option>
                  <option value="+25%">TikTok cuốn</option>
                </select>
              </div>
            </div>

            {/* VIDEO NỀN (TỰ TẢI TỪ MÁY TÍNH) */}
            <div
              style={{
                background: '#0a0f1d',
                border: '1px solid #1e293b',
                borderRadius: '8px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                marginBottom: '14px'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <label
                  style={{
                    fontSize: '12px',
                    color: '#94a3b8',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}
                >
                  🎬 Video nền (9:16 Shorts / TikTok):
                </label>
                {backgroundVideoPath && (
                  <button
                    type="button"
                    onClick={handleClearBgVideo}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#ef4444',
                      fontSize: '11px',
                      cursor: 'pointer',
                      textDecoration: 'underline'
                    }}
                  >
                    ✕ Xóa / Bỏ chọn
                  </button>
                )}
              </div>

              <div style={{ fontSize: '11px', color: '#64748b' }}>
                Tải lên video nền từ máy tính (Gameplay Minecraft, Subway Surfers, ASMR, vlog... tự
                động căn giữa chuẩn 9:16):
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  readOnly
                  placeholder="Chưa chọn video (Bấm 'Chọn file video' bên phải)..."
                  value={backgroundVideoPath}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: '1px solid #374151',
                    background: '#030712',
                    color: backgroundVideoPath ? '#38bdf8' : '#64748b',
                    fontSize: '12px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                />
                <button
                  type="button"
                  onClick={handleSelectBgVideo}
                  style={{
                    background: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    padding: '0 14px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  📁 Chọn file
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={handleRunFullPipeline}
                disabled={loading || !postData || selectedCommentsCount === 0}
                style={{
                  flex: 1,
                  background: 'linear-gradient(135deg, #16a34a, #059669)',
                  color: '#fff',
                  border: 'none',
                  padding: '14px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 800,
                  fontSize: '15px',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: '8px',
                  opacity: loading || !postData || selectedCommentsCount === 0 ? 0.6 : 1
                }}
              >
                🚀 Bắt đầu sản xuất Video 9:16 ({selectedCommentsCount} bình luận)
              </button>

              {lastOutputVideo && (
                <button
                  onClick={handleOpenOutputFolder}
                  style={{
                    background: '#1e293b',
                    color: '#38bdf8',
                    border: '1px solid #38bdf8',
                    padding: '0 16px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontSize: '13px'
                  }}
                >
                  📂 Mở thư mục video
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: 9:16 Vertical Preview */}
        <div
          style={{ width: '310px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              marginBottom: '10px'
            }}
          >
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#94a3b8' }}>
              Preview 9:16
            </span>
            <div
              style={{
                display: 'flex',
                gap: '4px',
                background: '#030712',
                padding: '2px',
                borderRadius: '8px',
                border: '1px solid #1f2937'
              }}
            >
              <button
                type="button"
                onClick={() => setPreviewTab('layout')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '6px',
                  border: 'none',
                  background: previewTab === 'layout' ? '#2563eb' : 'transparent',
                  color: previewTab === 'layout' ? '#fff' : '#94a3b8',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                📱 Bố cục nền
              </button>
              <button
                type="button"
                onClick={() => setPreviewTab('rendered')}
                disabled={!lastOutputVideo}
                style={{
                  padding: '3px 8px',
                  borderRadius: '6px',
                  border: 'none',
                  background: previewTab === 'rendered' ? '#16a34a' : 'transparent',
                  color:
                    previewTab === 'rendered' ? '#fff' : lastOutputVideo ? '#94a3b8' : '#475569',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: lastOutputVideo ? 'pointer' : 'not-allowed'
                }}
              >
                🎬 Video xuất {lastOutputVideo ? '✓' : ''}
              </button>
            </div>
          </div>

          {/* Mockup Card Mode Switcher (Bài viết vs Bình luận) */}
          {previewTab === 'layout' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '270px',
                marginBottom: '8px',
                padding: '3px 6px',
                background: '#111827',
                borderRadius: '8px',
                border: '1px solid #1f2937'
              }}
            >
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  onClick={() => setPreviewCardMode('post')}
                  style={{
                    background: previewCardMode === 'post' ? '#2563eb' : 'transparent',
                    color: previewCardMode === 'post' ? '#fff' : '#94a3b8',
                    border: 'none',
                    padding: '3px 8px',
                    borderRadius: '5px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  📝 Bài viết
                </button>
                <button
                  type="button"
                  disabled={peakComments.length === 0}
                  onClick={() => {
                    setPreviewCardMode('comment')
                    if (!previewCommentId && peakComments.length > 0) {
                      setPreviewCommentId(peakComments[0].id)
                    }
                  }}
                  style={{
                    background: previewCardMode === 'comment' ? '#f59e0b' : 'transparent',
                    color:
                      previewCardMode === 'comment'
                        ? '#000'
                        : peakComments.length > 0
                          ? '#94a3b8'
                          : '#475569',
                    border: 'none',
                    padding: '3px 8px',
                    borderRadius: '5px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: peakComments.length > 0 ? 'pointer' : 'not-allowed'
                  }}
                >
                  💬 Bình luận ({peakComments.length > 0 ? `#${previewCommentOrder}` : 0})
                </button>
              </div>

              {previewCardMode === 'comment' && peakComments.length > 0 && (
                <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                  <button
                    type="button"
                    disabled={previewCommentOrder <= 1}
                    onClick={() => {
                      const curIdx = peakComments.findIndex((c) => c.id === previewCommentId)
                      if (curIdx > 0) setPreviewCommentId(peakComments[curIdx - 1].id)
                    }}
                    title="Bình luận trước đó"
                    style={{
                      background: '#1e293b',
                      color: previewCommentOrder <= 1 ? '#475569' : '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '2px 5px',
                      fontSize: '10px',
                      cursor: previewCommentOrder <= 1 ? 'not-allowed' : 'pointer'
                    }}
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    disabled={previewCommentOrder >= peakComments.length}
                    onClick={() => {
                      const curIdx = peakComments.findIndex((c) => c.id === previewCommentId)
                      if (curIdx < peakComments.length - 1)
                        setPreviewCommentId(peakComments[curIdx + 1].id)
                    }}
                    title="Bình luận kế tiếp"
                    style={{
                      background: '#1e293b',
                      color: previewCommentOrder >= peakComments.length ? '#475569' : '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '2px 5px',
                      fontSize: '10px',
                      cursor: previewCommentOrder >= peakComments.length ? 'not-allowed' : 'pointer'
                    }}
                  >
                    ▶
                  </button>
                </div>
              )}
            </div>
          )}

          <div
            style={{
              width: '270px',
              height: '480px',
              background: '#000',
              borderRadius: '24px',
              border: '3px solid #334155',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: previewTab === 'rendered' ? 0 : '16px',
              boxSizing: 'border-box',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 20px 40px rgba(0,0,0,0.8)'
            }}
          >
            {previewTab === 'rendered' && lastOutputVideo ? (
              <video
                key={lastOutputVideo}
                src={toMediaUrl(lastOutputVideo)}
                controls
                autoPlay
                playsInline
                preload="auto"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  borderRadius: '20px',
                  background: '#000'
                }}
              />
            ) : (
              <>
                {/* 1. Live Background Video hoặc Nền chờ */}
                {backgroundVideoPath ? (
                  <video
                    key={backgroundVideoPath}
                    src={toMediaUrl(backgroundVideoPath)}
                    autoPlay
                    loop
                    muted
                    playsInline
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      zIndex: 0
                    }}
                  />
                ) : (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'radial-gradient(circle at 50% 30%, #1e1b4b, #070b14 85%)',
                      zIndex: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '20px',
                      textAlign: 'center'
                    }}
                  >
                    <div style={{ fontSize: '32px', marginBottom: '8px', opacity: 0.35 }}>🎬</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>
                      Chưa chọn video nền
                    </div>
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#475569',
                        marginTop: '4px',
                        lineHeight: 1.4
                      }}
                    >
                      Chọn video từ máy để xem chuyển động loop tại đây
                    </div>
                  </div>
                )}

                {/* Top: Card Overlay Simulation */}
                {previewCardMode === 'comment' && currentPreviewComment ? (
                  <div
                    style={{
                      position: 'relative',
                      zIndex: 1,
                      background: '#101010',
                      border: '1px solid #282828',
                      borderRadius: '14px',
                      padding: '12px',
                      marginTop: '36px',
                      boxShadow: '0 10px 25px rgba(0,0,0,0.7)',
                      transition: 'all 0.3s'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '8px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            background: '#f59e0b',
                            color: '#000',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '11px',
                            fontWeight: 'bold'
                          }}
                        >
                          {currentPreviewComment.author.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: '#fff' }}>
                            @{currentPreviewComment.author.username}
                          </div>
                          <div style={{ fontSize: '9px', color: '#777' }}>1 giờ trước</div>
                        </div>
                      </div>
                      <span
                        style={{
                          background: '#1e3a8a',
                          color: '#93c5fd',
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: '6px'
                        }}
                      >
                        Bình luận #{previewCommentOrder}
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: '11px',
                        color: '#f3f5f7',
                        lineHeight: 1.4,
                        maxHeight: previewCommentImage ? '45px' : '75px',
                        overflow: 'hidden'
                      }}
                    >
                      {currentPreviewComment.text}
                    </div>

                    {previewCommentImage && (
                      <div
                        style={{
                          marginTop: '8px',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          border: '1px solid #282828',
                          background: '#000',
                          maxHeight: '120px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <img
                          src={previewCommentImage}
                          alt="Comment media preview"
                          style={{
                            width: '100%',
                            maxHeight: '120px',
                            objectFit: 'cover'
                          }}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      position: 'relative',
                      zIndex: 1,
                      background: '#101010',
                      border: '1px solid #282828',
                      borderRadius: '14px',
                      padding: '12px',
                      marginTop: hasPostVideo ? '10px' : '36px',
                      boxShadow: '0 10px 25px rgba(0,0,0,0.7)',
                      transition: 'all 0.3s'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '8px'
                      }}
                    >
                      <div
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          background: '#6366f1',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '11px',
                          fontWeight: 'bold'
                        }}
                      >
                        {postData ? postData.author.username.charAt(0).toUpperCase() : 'T'}
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#fff' }}>
                          {postData ? postData.author.username : 'threads_user'}
                        </div>
                        <div style={{ fontSize: '9px', color: '#777' }}>2 giờ trước</div>
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: '11px',
                        color: '#f3f5f7',
                        lineHeight: 1.4,
                        maxHeight: hasPostVideo ? '60px' : hasPostImages ? '40px' : '65px',
                        overflow: 'hidden'
                      }}
                    >
                      {postData
                        ? postData.text.slice(0, 90) + '...'
                        : 'Nội dung bài viết Threads và 10 bình luận peak sẽ tự động hiển thị tại đây...'}
                    </div>

                    {/* Hình ảnh bài viết trong Mockup (chỉ hiển thị khi bài viết KHÔNG có video) */}
                    {!hasPostVideo && hasPostImages && (
                      <div
                        style={{
                          marginTop: '8px',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          border: '1px solid #282828',
                          background: '#000',
                          maxHeight: '120px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <img
                          src={postImages[0]}
                          alt="Post media preview"
                          style={{
                            width: '100%',
                            maxHeight: '120px',
                            objectFit: 'cover'
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Video bài viết gốc hiển thị trong mockup (hiển thị khi xem bài viết gốc) */}
                {previewCardMode === 'post' && hasPostVideo && (
                  <div
                    style={{
                      position: 'relative',
                      zIndex: 1,
                      marginTop: '12px',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      border: '1.5px solid #374151',
                      background: '#000',
                      boxShadow: '0 12px 28px rgba(0,0,0,0.7)'
                    }}
                  >
                    <video
                      key={postData?.localVideoPath || postData?.videoUrl}
                      src={toMediaUrl(postData?.localVideoPath) || postData?.videoUrl}
                      autoPlay
                      loop
                      muted
                      playsInline
                      style={{
                        width: '100%',
                        maxHeight: '220px',
                        objectFit: 'contain',
                        display: 'block'
                      }}
                    />
                  </div>
                )}

                {/* Bottom: Karaoke jumping text simulation */}
                <div
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    textAlign: 'center',
                    marginBottom: '20px'
                  }}
                >
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: 900,
                      color: '#ffffff',
                      textShadow: '0 2px 8px #000, 0 0 10px #000',
                      lineHeight: 1.3,
                      padding: '0 8px'
                    }}
                  >
                    <span style={{ color: '#facc15' }}>
                      {previewCardMode === 'comment' && currentPreviewComment
                        ? currentPreviewComment.text.slice(0, 32) +
                          (currentPreviewComment.text.length > 32 ? '...' : '')
                        : 'Chữ nhảy phụ đề karaoke'}
                    </span>
                  </div>
                  <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px' }}>
                    ⚡ Đồng bộ theo giọng Edge-TTS
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            backdropFilter: 'blur(4px)'
          }}
        >
          <div
            style={{
              width: '540px',
              background: '#111827',
              borderRadius: '16px',
              border: '1px solid #374151',
              padding: '24px',
              boxShadow: '0 25px 50px rgba(0,0,0,0.8)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px'
              }}
            >
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>⚙️ Cài đặt hệ thống</h2>
              <button
                onClick={() => setShowSettings(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#9ca3af',
                  fontSize: '20px',
                  cursor: 'pointer'
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#e2e8f0',
                    marginBottom: '6px'
                  }}
                >
                  Thư mục xuất video (Output Directory):
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={settings.outputDir}
                    onChange={(e) => setSettings({ ...settings, outputDir: e.target.value })}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: '8px',
                      border: '1px solid #374151',
                      background: '#030712',
                      color: '#fff',
                      fontSize: '13px'
                    }}
                  />
                  <button
                    onClick={handleSelectOutputDir}
                    style={{
                      background: '#1f2937',
                      color: '#fff',
                      border: '1px solid #374151',
                      padding: '0 14px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '13px'
                    }}
                  >
                    Chọn
                  </button>
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#e2e8f0',
                    marginBottom: '6px'
                  }}
                >
                  Đường dẫn FFmpeg (Tự động nhận diện nếu để trống):
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Mặc định tự động nhận diện từ hệ thống (ffmpeg.exe)..."
                    value={settings.customFfmpegPath || ''}
                    onChange={(e) => setSettings({ ...settings, customFfmpegPath: e.target.value })}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: '8px',
                      border: '1px solid #374151',
                      background: '#030712',
                      color: settings.customFfmpegPath ? '#38bdf8' : '#9ca3af',
                      fontSize: '13px'
                    }}
                  />
                  <button
                    onClick={handleSelectCustomFfmpeg}
                    style={{
                      background: '#1f2937',
                      color: '#fff',
                      border: '1px solid #374151',
                      padding: '0 14px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Chọn file
                  </button>
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  Nếu máy Windows chưa cài FFmpeg, bạn có thể tải file ffmpeg.exe về và chọn vào ô
                  này.
                </div>
              </div>

              {/* Phần kiểm tra phiên bản cập nhật tự động */}
              <div
                style={{
                  borderTop: '1px solid #1f2937',
                  paddingTop: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
                      Phiên bản ứng dụng: v{updateState?.currentVersion || '1.0.0'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                      Cập nhật ứng dụng tự động trực tiếp trong app
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleManualCheckUpdate}
                    disabled={checkingUpdate || updateState?.status === 'downloading'}
                    style={{
                      background: '#1f2937',
                      color: '#38bdf8',
                      border: '1px solid #38bdf8',
                      padding: '8px 14px',
                      borderRadius: '8px',
                      cursor:
                        checkingUpdate || updateState?.status === 'downloading'
                          ? 'not-allowed'
                          : 'pointer',
                      fontWeight: 600,
                      fontSize: '12px'
                    }}
                  >
                    {checkingUpdate
                      ? 'Đang kiểm tra...'
                      : updateState?.status === 'downloading'
                        ? 'Đang tải...'
                        : '🔄 Kiểm tra cập nhật'}
                  </button>
                </div>

                {/* Kết quả kiểm tra thủ công */}
                {updateCheckMsg && (
                  <div
                    style={{
                      fontSize: '12px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background:
                        updateState?.status === 'available'
                          ? '#1e3a8a'
                          : updateState?.status === 'error'
                            ? '#7f1d1d'
                            : '#064e3b',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <span>{updateCheckMsg}</span>
                    {updateState?.status === 'available' && (
                      <button
                        type="button"
                        onClick={handleDownloadUpdate}
                        style={{
                          background: '#fff',
                          color: '#1d4ed8',
                          border: 'none',
                          padding: '4px 12px',
                          borderRadius: '4px',
                          fontWeight: 700,
                          fontSize: '11px',
                          cursor: 'pointer'
                        }}
                      >
                        Cập nhật ngay
                      </button>
                    )}
                  </div>
                )}

                {/* Trạng thái tải bản cập nhật trong Settings */}
                {updateState?.status === 'downloading' && (
                  <div
                    style={{
                      padding: '10px 12px',
                      background: '#1e293b',
                      borderRadius: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '12px',
                        color: '#93c5fd'
                      }}
                    >
                      <span>Đang tải bản cập nhật v{updateState.latestVersion}...</span>
                      <span style={{ fontWeight: 700 }}>{updateState.progress?.percent || 0}%</span>
                    </div>
                    <div
                      style={{
                        width: '100%',
                        height: '6px',
                        background: '#0f172a',
                        borderRadius: '3px',
                        overflow: 'hidden'
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${updateState.progress?.percent || 0}%`,
                          background: '#38bdf8',
                          transition: 'width 0.2s ease'
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Trạng thái đã tải xong trong Settings */}
                {updateState?.status === 'downloaded' && (
                  <div
                    style={{
                      padding: '10px 12px',
                      background: '#064e3b',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <span style={{ fontSize: '12px', color: '#fff', fontWeight: 600 }}>
                      🎉 Bản cập nhật v{updateState.latestVersion} đã sẵn sàng!
                    </span>
                    <button
                      type="button"
                      onClick={handleInstallUpdate}
                      style={{
                        background: '#22c55e',
                        color: '#fff',
                        border: 'none',
                        padding: '6px 14px',
                        borderRadius: '6px',
                        fontWeight: 700,
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      Khởi động lại ngay 🔄
                    </button>
                  </div>
                )}
              </div>

              {settingsSavedMsg && (
                <div
                  style={{
                    color: '#4ade80',
                    fontSize: '13px',
                    textAlign: 'center',
                    fontWeight: 600
                  }}
                >
                  {settingsSavedMsg}
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '10px',
                  marginTop: '10px'
                }}
              >
                <button
                  onClick={() => setShowSettings(false)}
                  style={{
                    background: '#1f2937',
                    color: '#9ca3af',
                    border: 'none',
                    padding: '10px 16px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '13px'
                  }}
                >
                  Đóng
                </button>
                <button
                  onClick={handleSaveSettings}
                  style={{
                    background: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    padding: '10px 20px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontSize: '13px'
                  }}
                >
                  Lưu cấu hình
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App

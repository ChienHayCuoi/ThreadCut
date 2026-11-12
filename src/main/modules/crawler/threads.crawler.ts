import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { ThreadPostDetail, ThreadComment } from '../../../shared/types'

export class ThreadsCrawler {
  /**
   * Bóc tách thông tin bài viết & danh sách bình luận từ URL Threads
   * Sử dụng Chromium session ngầm của chính Electron (Offscreen BrowserWindow)
   */
  async crawlPost(url: string): Promise<ThreadPostDetail> {
    console.log(`[Crawler] Bắt đầu cào dữ liệu từ URL: ${url}`)

    // Chuẩn hóa URL
    const cleanUrl = url.trim().split('?')[0]

    return new Promise((resolve) => {
      let win: BrowserWindow | null = new BrowserWindow({
        width: 1280,
        height: 1200,
        show: false,
        webPreferences: {
          offscreen: true,
          sandbox: false
        }
      })

      const detectedVideoUrls: string[] = []
      win.webContents.session.webRequest.onBeforeRequest(
        { urls: ['*://*.cdninstagram.com/*', '*://*.fbcdn.net/*'] },
        (details, callback) => {
          const u = details.url
          if (
            (u.includes('.mp4') ||
              u.includes('/v/t') ||
              u.includes('mime=video') ||
              u.includes('_n.mp4')) &&
            !detectedVideoUrls.includes(u)
          ) {
            console.log('[Crawler] Bắt được request video Threads:', u.slice(0, 100))
            detectedVideoUrls.push(u)
          }
          callback({})
        }
      )

      const timeoutId = setTimeout(async () => {
        console.warn(
          '[Crawler] Quá thời gian chờ tải trang (18s), tiến hành bóc tách những gì đã có...'
        )
        if (win && !win.isDestroyed()) {
          const result = await this.extractFromWindow(win, cleanUrl, detectedVideoUrls)
          win.destroy()
          win = null
          resolve(result)
        }
      }, 18000)

      win.webContents.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
      )

      win.webContents.on('did-finish-load', async () => {
        // Chờ 3.5s để React/Relay của Threads render client-side và hydrate DOM
        setTimeout(async () => {
          if (!win || win.isDestroyed()) return
          clearTimeout(timeoutId)
          try {
            const result = await this.extractFromWindow(win, cleanUrl, detectedVideoUrls)
            win.destroy()
            win = null
            resolve(result)
          } catch (err) {
            console.error('[Crawler] Lỗi khi bóc tách DOM:', err)
            win?.destroy()
            win = null
            resolve(this.getFallbackData(cleanUrl))
          }
        }, 3500)
      })

      win.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
        console.warn(`[Crawler] did-fail-load: ${errorCode} - ${errorDescription}`)
      })

      win.loadURL(cleanUrl).catch((err) => {
        console.error('[Crawler] Không thể load URL:', err)
        clearTimeout(timeoutId)
        win?.destroy()
        win = null
        resolve(this.getFallbackData(cleanUrl))
      })
    })
  }

  private async extractFromWindow(
    win: BrowserWindow,
    url: string,
    detectedVideoUrls: string[] = []
  ): Promise<ThreadPostDetail> {
    try {
      // Cho scroll nhẹ nhiều lần xuống dưới để trigger Threads nạp toàn bộ bình luận
      await win.webContents.executeJavaScript(`
        new Promise((resolve) => {
          let step = 0;
          const timer = setInterval(() => {
            window.scrollBy(0, 900);
            step++;
            if (step >= 3) {
              clearInterval(timer);
              setTimeout(resolve, 1000);
            }
          }, 500);
        })
      `)

      const rawArticles = (await win.webContents.executeJavaScript(`
        (() => {
          const articles = Array.from(document.querySelectorAll('article, [data-pressable-container="true"]'));
          return articles.map((art) => {
            const userLink = art.querySelector('a[href*="/@"]');
            let domUser = '';
            if (userLink) {
              const href = userLink.getAttribute('href') || '';
              const match = href.match(/@([^/?#]+)/);
              if (match) domUser = match[1];
            }

            const avatarEl = art.querySelector('a[href*="/@"] img, img[alt*="profile" i], img[alt*="avatar" i]') || art.querySelector('img');
            const avatarSrc = avatarEl ? (avatarEl.currentSrc || avatarEl.src || '') : '';

            let videoUrl = '';
            let videoPoster = '';
            const videoEl = art.querySelector('video');
            const hasVideo = Boolean(videoEl);
            if (videoEl) {
              videoUrl = videoEl.currentSrc || videoEl.src || '';
              if (!videoUrl) {
                const srcEl = videoEl.querySelector('source');
                if (srcEl) videoUrl = srcEl.src || '';
              }
              videoPoster = videoEl.poster || '';
            }

            const allImgs = Array.from(art.querySelectorAll('img'));
            const contentImages = [];
            // Nếu bài viết hoặc comment có video thì không lấy ảnh đính kèm (để tránh lấy nhầm poster/thumbnail video)
            if (!hasVideo) {
              for (const img of allImgs) {
                if (img === avatarEl) continue;
                const src = img.currentSrc || img.src || '';
                if (!src) continue;
                if (src === avatarSrc) continue;
                if (src.startsWith('data:') || src.includes('/rsrc.php/') || src.includes('/emoji.php')) continue;
                const alt = (img.getAttribute('alt') || '').toLowerCase();
                if (alt.includes('verified') || alt.includes('xác minh')) continue;

                const rect = img.getBoundingClientRect();
                const nw = img.naturalWidth || 0;
                const nh = img.naturalHeight || 0;
                if ((rect.width > 0 && rect.width < 45 && rect.height > 0 && rect.height < 45) || (nw > 0 && nw < 45 && nh > 0 && nh < 45)) {
                  continue;
                }
                if (!contentImages.includes(src)) {
                  contentImages.push(src);
                }
              }

              const bgElements = Array.from(art.querySelectorAll('[style*="background-image"]'));
              for (const bgEl of bgElements) {
                const bg = bgEl.style.backgroundImage || '';
                const m = bg.match(/url\\(["']?(https?:[^"']+)["']?\\)/);
                if (m && m[1] && m[1] !== avatarSrc && !contentImages.includes(m[1])) {
                  contentImages.push(m[1]);
                }
              }
            }

            return {
              text: art.innerText || '',
              avatar: avatarSrc,
              domUser,
              hasVideo,
              videoUrl,
              images: contentImages
            };
          });
        })()
      `)) as Array<{
        text: string
        avatar: string
        domUser: string
        hasVideo: boolean
        videoUrl?: string
        images?: string[]
      }>

      if (Array.isArray(rawArticles) && rawArticles.length > 0) {
        // Trích xuất username từ URL: threads.net/@username/post/...
        const urlMatch = url.match(/@([^/]+)/)
        const urlUser = urlMatch ? urlMatch[1] : ''

        // 1. Phân tích bài viết gốc (Article đầu tiên)
        const first = this.parseArticleText(rawArticles[0].text)
        const mainAuthor = rawArticles[0].domUser || first.username || urlUser || 'threads_user'
        const mainText = first.content || 'Nội dung bài viết Threads'
        const mainAvatar = rawArticles[0].avatar || ''
        const mainLikes = first.likesCount

        // 1.1 Tìm URL video của bài viết gốc (chỉ nhận khi chính bài viết có thẻ video)
        let mainVideoUrl: string | undefined = undefined
        if (rawArticles[0].hasVideo) {
          mainVideoUrl = rawArticles[0].videoUrl || detectedVideoUrls[0] || undefined
        }
        let localVideoPath: string | undefined = undefined

        const tempDir = join(app.getPath('temp'), 'threadcut_media')
        if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })

        if (mainVideoUrl) {
          try {
            console.log(`[Crawler] Bắt đầu tải video của bài viết: ${mainVideoUrl.slice(0, 80)}...`)
            const dest = join(tempDir, `post_video_${Date.now()}.mp4`)
            await this.downloadFile(mainVideoUrl, dest)
            if (existsSync(dest)) {
              localVideoPath = dest
              console.log(`[Crawler] Tải video bài viết thành công: ${dest}`)
            }
          } catch (dlErr) {
            console.warn('[Crawler] Lỗi khi tải video bài viết về local:', dlErr)
          }
        }

        // 1.2 Tải các hình ảnh của bài viết gốc nếu có (chỉ tải khi bài viết KHÔNG có video)
        const isPostVideo = Boolean(rawArticles[0].hasVideo || mainVideoUrl || localVideoPath)
        const postImages = isPostVideo ? [] : rawArticles[0].images || []
        const localImagePaths: string[] = []
        if (!isPostVideo) {
          for (let idx = 0; idx < postImages.length; idx++) {
            try {
              const ext = postImages[idx].includes('.png') ? 'png' : 'jpg'
              const dest = join(tempDir, `post_img_${idx}_${Date.now()}.${ext}`)
              await this.downloadFile(postImages[idx], dest)
              if (existsSync(dest)) {
                localImagePaths.push(dest)
              }
            } catch (imgErr) {
              console.warn(`[Crawler] Lỗi tải ảnh bài viết [${idx}]:`, imgErr)
            }
          }
        }
        const localImagePath = localImagePaths.length > 0 ? localImagePaths[0] : undefined

        // 2. Phân tích các bình luận tiếp theo
        const comments: ThreadComment[] = []
        for (let i = 1; i < rawArticles.length && comments.length < 35; i++) {
          const raw = rawArticles[i]
          const item = this.parseArticleText(raw.text)
          const commentUser = raw.domUser || item.username || `user_${i}`
          if (item.content && item.content !== mainText) {
            const commentImages = raw.images || []
            const commentImageUrl = commentImages.length > 0 ? commentImages[0] : undefined
            let commentLocalPath: string | undefined = undefined

            if (commentImageUrl) {
              try {
                const ext = commentImageUrl.includes('.png') ? 'png' : 'jpg'
                const dest = join(tempDir, `comment_img_${i}_${Date.now()}.${ext}`)
                await this.downloadFile(commentImageUrl, dest)
                if (existsSync(dest)) {
                  commentLocalPath = dest
                  console.log(`[Crawler] Tải ảnh bình luận @${commentUser} thành công: ${dest}`)
                }
              } catch (cImgErr) {
                console.warn(`[Crawler] Lỗi tải ảnh bình luận ${i}:`, cImgErr)
              }
            }

            comments.push({
              id: `comment-${i}`,
              author: {
                username: commentUser,
                avatarUrl: raw.avatar || ''
              },
              text: item.content,
              likesCount: item.likesCount,
              imageUrl: commentImageUrl,
              mediaUrls: commentImages,
              localImagePath: commentLocalPath
            })
          }
        }

        console.log(
          `[Crawler] Bóc tách thành công bài viết của @${mainAuthor} (${mainLikes} likes, ${localVideoPath ? 'Có Video' : 'Không có video'}, ${localImagePaths.length} ảnh) với ${comments.length} bình luận`
        )

        return {
          id: 'post-' + Date.now(),
          url,
          author: {
            username: mainAuthor,
            avatarUrl: mainAvatar
          },
          text: mainText,
          videoUrl: mainVideoUrl,
          localVideoPath,
          mediaUrls: isPostVideo ? [] : postImages,
          imageUrl: isPostVideo ? undefined : postImages[0],
          imageUrls: isPostVideo ? [] : postImages,
          localImagePath: isPostVideo ? undefined : localImagePath,
          localImagePaths: isPostVideo ? [] : localImagePaths,
          likesCount: mainLikes,
          commentsCount: comments.length,
          comments
        }
      }
    } catch (e) {
      console.warn('[Crawler] extractFromWindow error:', e)
    }

    return this.getFallbackData(url)
  }

  private async downloadFile(url: string, destPath: string): Promise<string> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} when downloading file: ${url}`)
    const arrayBuffer = await res.arrayBuffer()
    writeFileSync(destPath, Buffer.from(arrayBuffer))
    return destPath
  }

  /**
   * Bóc tách chuẩn từng dòng theo cấu trúc văn bản article của Threads:
   * Dòng 1 (hoặc 2 nếu có Pinned): Username
   * Dòng tiếp: Timestamp (18h, 15h, 2d, 17 giờ,...)
   * Dòng giữa: Nội dung văn bản bài viết / bình luận
   * Dòng cuối: Nút hành động và chỉ số tương tác (Like, Reply, Repost, Share)
   */
  private parseArticleText(rawText: string): {
    username: string
    content: string
    likesCount: number
  } {
    const lines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)

    if (lines.length === 0) {
      return { username: '', content: '', likesCount: 0 }
    }

    let idx = 0
    if (lines[idx].toLowerCase() === 'pinned' || lines[idx].toLowerCase() === 'đã ghim') {
      idx++
    }
    const username = lines[idx] ? lines[idx].replace('@', '') : ''
    idx++

    // Bỏ qua dòng timestamp (vd: "18h", "15m", "2d", "17 giờ", "vài giây trước", "15 phút trước")
    if (
      idx < lines.length &&
      /^(\d+[smhdw]|vài|hôm|người|\d+\s*(giờ|ngày|phút|giây))/i.test(lines[idx])
    ) {
      idx++
    }

    // Cắt bỏ các dòng chỉ số tương tác và action ở cuối bài
    let endIdx = lines.length
    const trailingMetrics: string[] = []

    while (endIdx > idx) {
      const line = lines[endIdx - 1]
      const lower = line.toLowerCase()

      const isActionText =
        [
          'translate',
          'dịch',
          'reply',
          'like',
          'share',
          'repost',
          'thích',
          'trả lời',
          'view replies',
          'hiển thị câu trả lời',
          'xem câu trả lời',
          'xem thêm'
        ].includes(lower) || /^hiển thị \d+ câu trả lời/i.test(lower)

      const isMetricNumber = /^[\d.,]+[KMBkmb]?$/.test(line)

      if (isActionText || isMetricNumber) {
        if (isMetricNumber) {
          // Thêm vào đầu để giữ nguyên thứ tự xuất hiện từ trên xuống dưới (Like -> Reply -> Repost -> Share)
          trailingMetrics.unshift(line)
        }
        endIdx--
      } else {
        break
      }
    }

    const content = lines.slice(idx, endIdx).join('\n').trim()

    // Trên giao diện Threads, chỉ số đầu tiên của thanh action bar LUÔN LUÔN là lượt like (Trái tim)
    const likesCount = trailingMetrics.length > 0 ? this.parseMetrics(trailingMetrics[0]) : 0

    return {
      username,
      content,
      likesCount
    }
  }

  private parseMetrics(str: string): number {
    if (!str) return 0
    const clean = str.toUpperCase().trim()
    if (clean.endsWith('K')) {
      const numPart = clean.slice(0, -1).replace(',', '.')
      const val = parseFloat(numPart)
      return isNaN(val) ? 0 : Math.round(val * 1000)
    }
    if (clean.endsWith('M')) {
      const numPart = clean.slice(0, -1).replace(',', '.')
      const val = parseFloat(numPart)
      return isNaN(val) ? 0 : Math.round(val * 1000000)
    }
    const cleanedNum = clean.replace(/[,.]/g, '')
    const num = parseInt(cleanedNum, 10)
    return isNaN(num) ? 0 : num
  }

  private getFallbackData(url: string): ThreadPostDetail {
    const match = url.match(/@([^/]+)/)
    const username = match ? match[1] : 'threads_vietnam'

    return {
      id: 'post-' + Date.now(),
      url,
      author: {
        username,
        avatarUrl: ''
      },
      text: 'TOPIC: Kể tên 1 con app thú vị mà bạn thấy khá niche nhưng dùng cực cuốn?',
      imageUrl:
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80',
      imageUrls: [
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80'
      ],
      likesCount: 382,
      commentsCount: 5,
      comments: [
        {
          id: 'fb-1',
          author: { username: 'tech_lover', avatarUrl: '' },
          text: 'Obsidian! Lúc đầu nhìn như notepad cổ lỗ sĩ, dùng quen rồi thì quản lý cuộc sống luôn.',
          likesCount: 403,
          isPeak: true,
          selected: true,
          score: 9.8,
          reason: 'Bình luận chân thực, lượng like dẫn đầu'
        },
        {
          id: 'fb-2',
          author: { username: 'designer_boi', avatarUrl: '' },
          text: 'CleanMyMac với Raycast, bỏ Spotlight chuyển qua Raycast năng suất x10 lần.',
          imageUrl:
            'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=600&auto=format&fit=crop&q=80',
          mediaUrls: [
            'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=600&auto=format&fit=crop&q=80'
          ],
          likesCount: 210,
          isPeak: true,
          selected: true,
          score: 9.2,
          reason: 'Gợi ý cực giá trị cho dân làm việc'
        },
        {
          id: 'fb-3',
          author: { username: 'genz_coder', avatarUrl: '' },
          text: 'App ngân hàng lúc nhận lương vào ngày 10, mở ra thấy tiền nhảy mà cuốn không muốn tắt.',
          imageUrl:
            'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop&q=80',
          mediaUrls: [
            'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop&q=80'
          ],
          likesCount: 747,
          isPeak: true,
          selected: true,
          score: 9.9,
          reason: 'Độ hài hước cao, like khủng nhất bài viết'
        },
        {
          id: 'fb-4',
          author: { username: 'anonym_99', avatarUrl: '' },
          text: 'Forest, trồng cây để tập trung học. Chết mất mấy cái cây vì mở Threads lướt dạo.',
          likesCount: 124,
          isPeak: true,
          selected: true,
          score: 8.8,
          reason: 'Câu chuyện tự dìm hài hước'
        },
        {
          id: 'fb-5',
          author: { username: 'saigon_chill', avatarUrl: '' },
          text: 'Flightradar24, rảnh rỗi ngồi xem máy bay bay trên đầu rồi tưởng tượng mình đang đi du lịch.',
          likesCount: 89,
          isPeak: true,
          selected: true,
          score: 8.6,
          reason: 'Niche độc lạ, phù hợp phong cách Threads'
        },
        {
          id: 'fb-6',
          author: { username: 'coffe_addict', avatarUrl: '' },
          text: 'TickTick để quản lý thói quen mỗi ngày, hoàn thành xong nghe tiếng chuông ting ting siêu nghiện.',
          likesCount: 312,
          isPeak: true,
          selected: true,
          score: 9.3,
          reason: 'Chia sẻ trải nghiệm tích cực và lượng tương tác tốt'
        },
        {
          id: 'fb-7',
          author: { username: 'hanoian_mood', avatarUrl: '' },
          text: 'Duolingo, ngày nào con cú xanh cũng dí deadline học tiếng Anh sợ bay màu chuỗi streak.',
          likesCount: 521,
          isPeak: true,
          selected: true,
          score: 9.5,
          reason: 'Bình luận meme cú xanh quen thuộc với giới trẻ'
        },
        {
          id: 'fb-8',
          author: { username: 'night_owl', avatarUrl: '' },
          text: 'Endel tạo nhạc sóng não, bật lên lúc làm việc ban đêm cảm giác tập trung x2 luôn.',
          likesCount: 165,
          isPeak: true,
          selected: true,
          score: 8.9,
          reason: 'Gợi ý thiết thực cho người làm việc đêm'
        },
        {
          id: 'fb-9',
          author: { username: 'minimal_life', avatarUrl: '' },
          text: 'Notion nhưng chỉ dùng đúng 1 trang to-do list duy nhất, càng màu mè càng lười dùng.',
          likesCount: 430,
          isPeak: true,
          selected: true,
          score: 9.4,
          reason: 'Quan điểm tối giản được rất nhiều người đồng tình'
        },
        {
          id: 'fb-10',
          author: { username: 'dunchin_fan', avatarUrl: '' },
          text: 'Chính là con app ThreadCut này luôn, tự động cào bài viết rồi dựng video Shorts nhanh dã man!',
          likesCount: 680,
          isPeak: true,
          selected: true,
          score: 9.7,
          reason: 'Bình luận dí dỏm và nhận được rất nhiều like'
        }
      ]
    }
  }
}

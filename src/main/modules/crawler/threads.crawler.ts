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
    let cleanUrl = url.trim().split('?')[0]
    cleanUrl = cleanUrl.replace(/^(https?:\/\/)?(www\.)?threads\.com/i, 'https://www.threads.net')
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl
    }

    return new Promise((resolve, reject) => {
      let win: BrowserWindow | null = new BrowserWindow({
        width: 1280,
        height: 1200,
        show: false,
        webPreferences: {
          offscreen: true,
          partition: 'persist:threads',
          sandbox: false
        }
      })

      const targetWebContentsId = win.webContents.id
      const detectedVideoUrls: string[] = []

      win.webContents.session.webRequest.onBeforeRequest(
        { urls: ['*://*.cdninstagram.com/*', '*://*.fbcdn.net/*'] },
        (details, callback) => {
          if (details.webContentsId === targetWebContentsId) {
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
          }
          callback({})
        }
      )

      const timeoutId = setTimeout(async () => {
        console.warn(
          '[Crawler] Quá thời gian chờ tải trang (18s), tiến hành bóc tách những gì đã có...'
        )
        if (win && !win.isDestroyed()) {
          try {
            const result = await this.extractFromWindow(win, cleanUrl, detectedVideoUrls)
            win?.destroy()
            win = null
            resolve(result)
          } catch (timeoutErr) {
            win?.destroy()
            win = null
            reject(timeoutErr)
          }
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
            reject(err)
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
        reject(new Error(`Không thể kết nối đến Threads: ${err?.message || err}`))
      })
    })
  }

  private async extractFromWindow(
    win: BrowserWindow,
    url: string,
    detectedVideoUrls: string[] = []
  ): Promise<ThreadPostDetail> {
    try {
      // 0. Kiểm tra trạng thái trang (bài viết bị xóa, không tồn tại hoặc bị chặn giới hạn đối tượng)
      const pageStatus = (await win.webContents.executeJavaScript(`
      (() => {
        const text = document.body ? document.body.innerText : '';
        const currentUrl = window.location.href;

        if (
          currentUrl.includes('error=invalid_post') ||
          text.includes("Sorry, this page isn't available") ||
          text.includes('Trang này không hiển thị') ||
          text.includes('Page not found')
        ) {
          return { type: 'invalid_post' };
        }

        if (
          text.includes("This content isn't available to everyone") ||
          text.includes("It can't be seen by certain audiences") ||
          text.includes('Nội dung này không khả dụng cho mọi người') ||
          text.includes('Nội dung này không dành cho mọi đối tượng')
        ) {
          return { type: 'restricted_audience' };
        }

        return { type: 'ok' };
      })()
    `)) as { type: string }

      if (pageStatus.type === 'invalid_post') {
        throw new Error(
          'Link bài viết Threads không tồn tại hoặc đã bị xóa. Vui lòng kiểm tra lại URL (lưu ý chữ hoa/thường trong mã bài viết).'
        )
      }

      if (pageStatus.type === 'restricted_audience') {
        throw new Error(
          'Bài viết này bị giới hạn độ tuổi hoặc đối tượng xem (yêu cầu đăng nhập Threads). Vui lòng đăng nhập tài khoản Threads trong phần Cài đặt và thử lại.'
        )
      }

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
          let containers = Array.from(document.querySelectorAll('article'));
          if (containers.length === 0) {
            containers = Array.from(document.querySelectorAll('[data-pressable-container="true"]'));
          }
          containers = containers.filter(c => c.querySelector('a[href*="/@"]'));
          containers = containers.filter(c => !containers.some(other => other !== c && other.contains(c)));

          return containers.map((c, i) => {
            const userLink = c.querySelector('a[href*="/@"]');
            let domUser = '';
            if (userLink) {
              const href = userLink.getAttribute('href') || '';
              const match = href.match(/@([^/?#]+)/);
              if (match) domUser = match[1];
            }

            const avatarEl = c.querySelector('a[href*="/@"] img, img[alt*="profile" i], img[alt*="avatar" i]') || c.querySelector('img');
            const avatarSrc = avatarEl ? (avatarEl.currentSrc || avatarEl.src || '') : '';

            let videoUrl = '';
            let videoPoster = '';
            const videoEl = c.querySelector('video');
            const hasVideo = Boolean(videoEl);
            if (videoEl) {
              videoUrl = videoEl.currentSrc || videoEl.src || '';
              if (!videoUrl) {
                const srcEl = videoEl.querySelector('source');
                if (srcEl) videoUrl = srcEl.src || '';
              }
              videoPoster = videoEl.poster || '';
            }

            const allImgs = Array.from(c.querySelectorAll('img'));
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

              const bgElements = Array.from(c.querySelectorAll('[style*="background-image"]'));
              for (const bgEl of bgElements) {
                const bg = bgEl.style.backgroundImage || '';
                const m = bg.match(/url\\(["']?(https?:[^"']+)["']?\\)/);
                if (m && m[1] && m[1] !== avatarSrc && !contentImages.includes(m[1])) {
                  contentImages.push(m[1]);
                }
              }
            }

            // Bóc tách nội dung văn bản chuẩn xác trực tiếp từ các phần tử [dir="auto"]
            let contentText = '';
            const dirEls = Array.from(c.querySelectorAll('[dir="auto"]'));
            for (const el of dirEls) {
              const clone = el.cloneNode(true);
              const transBtns = clone.querySelectorAll('button, [role="button"]');
              transBtns.forEach(b => {
                const bt = (b.innerText || '').toLowerCase();
                if (bt.includes('translate') || bt.includes('dịch') || bt.includes('original')) {
                  b.remove();
                }
              });

              let t = (clone.innerText || '').trim();
              t = t.replace(/\\s*(Translate|Dịch|See translation|Xem bản dịch)$/i, '').trim();

              if (!t || t.toLowerCase() === domUser.toLowerCase() || t === 'Author' || t === 'Tác giả' || t === '·') continue;
              if (/^[0-9]+[smhdw]$/i.test(t)) continue;
              if (/^[0-9.,]+[KMB]?$/i.test(t)) continue;
              if (/^(Follow|Following|Theo dõi|Đang theo dõi)$/i.test(t)) continue;
              if (/^(Like|Reply|Repost|Share|Save|Sort|Top|More)$/i.test(t)) continue;
              if (/^(View activity|Xem hoạt động|Reply to|Trả lời)/i.test(t)) continue;

              if (t.length > contentText.length) {
                contentText = t;
              }
            }

            // Fallback cho bài viết đầu tiên nếu chưa có
            if (i === 0 && !contentText && document.title) {
              contentText = document.title.replace(/\\s*•\\s*Threads$/i, '').trim();
            }

            // Lấy likes count từ các dòng số tương tác ở cuối container
            const allLines = (c.innerText || '').split(/\\r?\\n/).map(l => l.trim()).filter(Boolean);
            const metricNums = [];
            for (let j = allLines.length - 1; j >= 0; j--) {
              const l = allLines[j];
              if (/^[0-9.,]+[KMB]?$/i.test(l) && !/^[0-9]+[smhdw]$/i.test(l)) {
                metricNums.unshift(l);
              } else if (metricNums.length > 0) {
                break;
              }
            }
            const likesStr = metricNums.length > 0 ? metricNums[0] : '0';

            return {
              text: contentText || (c.innerText || '').trim(),
              avatar: avatarSrc,
              domUser,
              hasVideo,
              videoUrl,
              videoPoster,
              images: contentImages,
              likesStr
            };
          });
        })()
      `)) as Array<{
        text: string
        avatar: string
        domUser: string
        hasVideo: boolean
        videoUrl?: string
        videoPoster?: string
        images?: string[]
        likesStr?: string
      }>

      if (Array.isArray(rawArticles) && rawArticles.length > 0) {
        // Trích xuất username từ URL: threads.net/@username/post/...
        const urlMatch = url.match(/@([^/]+)/)
        const urlUser = urlMatch ? urlMatch[1] : ''

        // 1. Phân tích bài viết gốc (Article đầu tiên)
        const first = this.parseArticleText(rawArticles[0].text, rawArticles[0].domUser || urlUser)
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
          const item = this.parseArticleText(raw.text, raw.domUser)
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

      // Nếu không tìm thấy thẻ article nào
      const isLoginRequired = (await win.webContents.executeJavaScript(`
        Boolean(document.body && (
          document.body.innerText.includes('Log in') ||
          document.body.innerText.includes('Đăng nhập') ||
          document.body.innerText.includes("This content isn't available") ||
          document.body.innerText.includes('See Why')
        ))
      `)) as boolean

      if (isLoginRequired) {
        throw new Error(
          'Bài viết này yêu cầu đăng nhập Threads mới xem được. Vui lòng đăng nhập tài khoản Threads và thử lại.'
        )
      }

      throw new Error(
        'Không thể tìm thấy nội dung bài viết từ liên kết này. Vui lòng kiểm tra lại URL.'
      )
    } catch (e) {
      console.warn('[Crawler] extractFromWindow error:', e)
      throw e
    }
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
  private parseArticleText(
    rawText: string,
    domUser?: string
  ): {
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

    let username = ''
    if (idx < lines.length) {
      const candidate = lines[idx].replace(/^@/, '')
      // Nếu dòng này khớp với domUser hoặc có dạng username không chứa khoảng trắng
      if (domUser && candidate.toLowerCase() === domUser.toLowerCase()) {
        username = candidate
        idx++
      } else if (!candidate.includes(' ') && candidate.length > 0 && candidate.length < 40) {
        username = candidate
        idx++
      }
    }

    // Bỏ qua Pinned nếu xuất hiện sau username
    if (
      idx < lines.length &&
      (lines[idx].toLowerCase() === 'pinned' || lines[idx].toLowerCase() === 'đã ghim')
    ) {
      idx++
    }

    // Bỏ qua dòng Follow / Theo dõi nếu có
    if (
      idx < lines.length &&
      /^(follow|theo\s*dõi|đang\s*theo\s*dõi|following)$/i.test(lines[idx])
    ) {
      idx++
    }

    // Bỏ qua dòng timestamp (vd: "18h", "15m", "2d", "17 giờ", "vài giây trước", "15 phút trước")
    if (
      idx < lines.length &&
      /^(\d+[smhdw]|vài|hôm|người|just|vừa|\d+\s*(giờ|ngày|phút|giây|h|m|s|d|w|y))/i.test(lines[idx])
    ) {
      idx++
    }

    const isFooterOrActionLine = (line: string): boolean => {
      const lower = line.toLowerCase().trim()
      // 1. Chỉ số tương tác (1.1K, 89, 47, 52, 10M, 1,234)
      if (/^[\d.,]+[kmb]?$/i.test(lower)) return true

      // 2. Nút dịch bài viết (Translate, Dịch, See translation, Xem bản dịch,...)
      if (
        /^(translate|dịch|see\s+translation|xem\s+bản\s+dịch|bản\s+gốc|original)(\s+(post|bài\s+viết))?$/i.test(
          lower
        )
      ) {
        return true
      }

      // 3. Khung trả lời (vd: Reply to 2909_lhp..., Trả lời 2909_lhp..., Reply..., Trả lời...)
      if (/^(reply(\s+to)?|trả\s+lời(\s+cho)?)\b/i.test(lower)) {
        return true
      }

      // 4. Xem hoạt động / insights (vd: View activity, Xem hoạt động, View insights, Activity, Hoạt động)
      if (
        /^(view\s+activity|xem\s+hoạt\s+động|view\s+insights|xem\s+thông\s+tin\s+chi\s+tiết|activity|hoạt\s+động)$/i.test(
          lower
        )
      ) {
        return true
      }

      // 5. Bộ lọc sắp xếp bình luận (Top, Recent, Phổ biến nhất, Mới nhất, Tất cả, Cũ nhất)
      if (
        /^(top|recent|phổ\s+biến(\s+nhất)?|mới(\s+nhất)?|oldest|cũ\s+nhất|all|tất\s+cả)$/i.test(
          lower
        )
      ) {
        return true
      }

      // 6. Nút hành động tương tác
      if (/^(like|reply|share|repost|thích|trả\s+lời|chia\s+sẻ|đăng\s+lại)$/i.test(lower)) {
        return true
      }

      // 7. Xem thêm câu trả lời (vd: View replies, Xem câu trả lời, Hiển thị 5 câu trả lời)
      if (
        /^(view|xem|hiển\s+thị|ẩn|hide|show)\s+(more\s+)?(\d+\s+)?(câu\s+trả\s+lời|replies|reply|thêm)/i.test(
          lower
        )
      ) {
        return true
      }

      // 8. Đăng nhập / ứng dụng / thông báo
      if (/^(log\s+in\s+to|đăng\s+nhập\s+để|open\s+app|mở\s+ứng\s+dụng)/i.test(lower)) {
        return true
      }

      return false
    }

    let endIdx = lines.length
    const trailingMetrics: string[] = []

    while (endIdx > idx) {
      const line = lines[endIdx - 1]
      if (isFooterOrActionLine(line)) {
        if (/^[\d.,]+[kmb]?$/i.test(line)) {
          trailingMetrics.unshift(line)
        }
        endIdx--
      } else {
        break
      }
    }

    // Quét thêm một lượt nếu cuối bài vẫn còn chữ Translate / Dịch / Xem bản dịch bị sót
    while (endIdx > idx) {
      const lastLine = lines[endIdx - 1].trim().toLowerCase()
      if (
        /^(translate|dịch|see\s+translation|xem\s+bản\s+dịch|bản\s+gốc|original)(\s+(post|bài\s+viết))?$/i.test(
          lastLine
        )
      ) {
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
}

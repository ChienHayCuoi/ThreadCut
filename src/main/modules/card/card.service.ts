import { BrowserWindow } from 'electron'
import { join } from 'path'
import { writeFileSync, existsSync, mkdirSync } from 'fs'

export interface CardRenderOptions {
  author: string
  avatarUrl?: string
  text: string
  likesCount?: number
  timeAgo?: string
  isPost?: boolean
}

export class CardRendererService {
  /**
   * Tạo ảnh thẻ bài viết hoặc bình luận mô phỏng 100% giao diện Threads
   * Xuất ra file PNG có nền trong suốt (transparent) để ghép trực tiếp vào video
   */
  async renderThreadsCard(options: CardRenderOptions, destFilePath: string): Promise<string> {
    const parentDir = join(destFilePath, '..')
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true })
    }

    const html = this.buildThreadsHtml(options)

    return new Promise((resolve, reject) => {
      let win: BrowserWindow | null = new BrowserWindow({
        width: 1000,
        height: 700,
        show: false,
        frame: false,
        transparent: true,
        webPreferences: {
          offscreen: true,
          sandbox: false
        }
      })

      const timeout = setTimeout(() => {
        if (win && !win.isDestroyed()) {
          win.destroy()
          win = null
          reject(new Error('Render card timeout sau 8s'))
        }
      }, 8000)

      win.webContents.on('did-finish-load', async () => {
        setTimeout(async () => {
          if (!win || win.isDestroyed()) return
          clearTimeout(timeout)
          try {
            // Lấy kích thước chính xác của thẻ card trong DOM
            const bounds = await win.webContents.executeJavaScript(`
              (() => {
                const el = document.getElementById('threads-card');
                if (!el) return { x: 0, y: 0, width: 920, height: 400 };
                const rect = el.getBoundingClientRect();
                return {
                  x: Math.floor(rect.x),
                  y: Math.floor(rect.y),
                  width: Math.ceil(rect.width),
                  height: Math.ceil(rect.height)
                };
              })()
            `)

            const image = await win.webContents.capturePage(bounds)
            const pngBuffer = image.toPNG()
            writeFileSync(destFilePath, pngBuffer)

            win.destroy()
            win = null
            resolve(destFilePath)
          } catch (e) {
            win?.destroy()
            win = null
            reject(e)
          }
        }, 300)
      })

      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    })
  }

  private buildThreadsHtml(opt: CardRenderOptions): string {
    const likes = opt.likesCount !== undefined ? opt.likesCount : opt.isPost ? 382 : 0
    const formattedLikes =
      likes >= 1000000
        ? (likes / 1000000).toFixed(1).replace('.0', '') + 'M'
        : likes >= 1000
          ? (likes / 1000).toFixed(1).replace('.0', '') + 'K'
          : likes > 0
            ? likes.toString()
            : ''
    const initial = (opt.author || 'T').charAt(0).toUpperCase()
    const timeAgo = opt.timeAgo || (opt.isPost ? '2 giờ trước' : '45 phút trước')

    // Escape text để chống vỡ HTML
    const safeText = opt.text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br/>')

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: transparent;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 30px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .card {
      width: 900px;
      background: #101010;
      border: 1.5px solid #282828;
      border-radius: 32px;
      padding: 36px 40px;
      color: #f3f5f7;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.65);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 18px;
      margin-bottom: 22px;
    }
    .avatar {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: linear-gradient(135deg, #ec4899, #8b5cf6, #3b82f6);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      font-weight: 700;
      color: #ffffff;
      flex-shrink: 0;
    }
    .avatar img {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      object-fit: cover;
    }
    .meta {
      flex: 1;
    }
    .username-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .username {
      font-size: 24px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: -0.3px;
    }
    .badge {
      width: 20px;
      height: 20px;
      fill: #0095f6;
    }
    .time {
      font-size: 18px;
      color: #777777;
      margin-top: 2px;
    }
    .threads-logo {
      width: 32px;
      height: 32px;
      fill: #ffffff;
      opacity: 0.85;
    }
    .content {
      font-size: 28px;
      line-height: 1.52;
      color: #f3f5f7;
      word-break: break-word;
      margin-bottom: 28px;
      font-weight: 400;
    }
    .footer {
      display: flex;
      align-items: center;
      gap: 36px;
      padding-top: 18px;
      border-top: 1px solid #222222;
      color: #888888;
      font-size: 20px;
      font-weight: 600;
    }
    .action-btn {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .icon {
      width: 26px;
      height: 26px;
      fill: none;
      stroke: #888888;
      stroke-width: 2;
    }
    .icon.heart {
      stroke: #ff3040;
      fill: rgba(255, 48, 64, 0.15);
    }
  </style>
</head>
<body>
  <div id="threads-card" class="card">
    <div class="header">
      <div class="avatar">
        ${opt.avatarUrl ? `<img src="${opt.avatarUrl}" onerror="this.style.display='none'" />` : initial}
      </div>
      <div class="meta">
        <div class="username-row">
          <span class="username">${opt.author}</span>
          <svg class="badge" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
        </div>
        <div class="time">@${opt.author} • ${timeAgo}</div>
      </div>
      <svg class="threads-logo" viewBox="0 0 192 192"><path d="M141.537 88.9883C140.71 88.5919 139.87 88.2104 139.019 87.8451C137.537 60.5382 122.616 44.905 97.5619 44.745C97.4484 44.7443 97.3355 44.7443 97.222 44.7443C82.2364 44.7443 69.7731 51.1409 62.102 62.7807L75.8711 72.3995C81.1687 64.3541 89.2828 60.778 97.2206 60.778C97.3061 60.778 97.3916 60.778 97.4771 60.7787C110.873 60.8654 120.301 69.8665 122.253 84.4533C114.78 82.7712 106.666 82.2619 97.9407 82.9463C68.9664 85.2212 50.8407 101.621 52.0911 123.633C53.3031 144.966 70.9231 158.461 93.3053 157.945C108.623 157.591 120.763 150.871 127.873 139.467C133.517 148.653 142.148 153.535 153.791 153.078C170.835 152.409 181.145 139.734 181.758 119.537C182.441 96.9731 170.198 80.6053 147.241 74.0041C145.419 73.4801 143.517 73.0189 141.537 88.9883ZM94.2023 142.022C81.8797 142.308 71.8598 134.428 71.2163 123.111C70.5728 111.795 80.1448 100.862 96.6974 99.5638C103.882 99.0001 110.833 99.4312 117.26 100.757C114.654 130.655 105.776 141.754 94.2023 142.022Z"/></svg>
    </div>
    <div class="content">${safeText}</div>
    <div class="footer">
      <div class="action-btn">
        <svg class="icon heart" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        ${formattedLikes ? `<span>${formattedLikes}</span>` : ''}
      </div>
      <div class="action-btn">
        <svg class="icon" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        <span>${Math.floor(likes / 4) + 1}</span>
      </div>
      <div class="action-btn">
        <svg class="icon" viewBox="0 0 24 24"><path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        <span>${Math.floor(likes / 8)}</span>
      </div>
      <div class="action-btn">
        <svg class="icon" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
      </div>
    </div>
  </div>
</body>
</html>
`
  }
}

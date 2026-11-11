import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { createWriteStream, existsSync, mkdirSync, chmodSync } from 'fs'
import { spawn } from 'child_process'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { UpdateInfoState, UpdateProgress } from '../../../shared/types'

function compareSemver(v1: string, v2: string): number {
  const p1 = v1.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const p2 = v2.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0
    const num2 = p2[i] || 0
    if (num1 > num2) return 1
    if (num1 < num2) return -1
  }
  return 0
}

interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GitHubReleaseData {
  tag_name: string
  body?: string
  assets: GitHubReleaseAsset[]
}

export class AppUpdaterService {
  private state: UpdateInfoState
  private targetDownloadUrl: string | null = null
  private downloadedFilePath: string | null = null

  constructor() {
    this.state = {
      status: 'idle',
      currentVersion: app?.getVersion ? app.getVersion() : '1.0.0'
    }
  }

  private sendState(window?: BrowserWindow): void {
    const win = window || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater:status', this.state)
    }
  }

  async checkForUpdates(): Promise<UpdateInfoState> {
    const currentVersion = app?.getVersion ? app.getVersion() : '1.0.0'
    this.state = { ...this.state, status: 'checking', currentVersion }
    this.sendState()

    try {
      const res = await fetch(
        'https://api.github.com/repos/ChienHayCuoi/ThreadCut/releases/latest',
        {
          headers: { 'User-Agent': 'ThreadCut-Desktop-App' }
        }
      )

      if (!res.ok) {
        this.state = { status: 'not-available', currentVersion, latestVersion: currentVersion }
        this.sendState()
        return this.state
      }

      const data = (await res.json()) as GitHubReleaseData
      const latestVersion = (data.tag_name || '').replace(/^v/, '')
      const hasUpdate = compareSemver(latestVersion, currentVersion) > 0

      // Tìm file asset tương ứng với hệ điều hành hiện tại
      let matchedAsset: GitHubReleaseAsset | undefined = undefined
      const isWin = process.platform === 'win32'
      const isMac = process.platform === 'darwin'

      if (Array.isArray(data.assets)) {
        if (isWin) {
          matchedAsset = data.assets.find((a) => a.name.endsWith('.exe'))
        } else if (isMac) {
          matchedAsset = data.assets.find((a) => a.name.endsWith('.dmg'))
        } else {
          // Linux: ưu tiên .AppImage, sau đó đến .deb
          matchedAsset =
            data.assets.find((a) => a.name.endsWith('.AppImage')) ||
            data.assets.find((a) => a.name.endsWith('.deb'))
        }
      }

      this.targetDownloadUrl = matchedAsset?.browser_download_url || null

      this.state = {
        status: hasUpdate ? 'available' : 'not-available',
        currentVersion,
        latestVersion,
        releaseNotes: data.body
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[Updater] Lỗi kiểm tra cập nhật:', msg)
      this.state = {
        status: 'error',
        currentVersion,
        error: `Không thể kết nối máy chủ cập nhật: ${msg}`
      }
    }

    this.sendState()
    return this.state
  }

  async downloadUpdate(): Promise<void> {
    if (!this.targetDownloadUrl) {
      // Nếu chưa có URL, thử kiểm tra lại
      await this.checkForUpdates()
      if (!this.targetDownloadUrl) {
        this.state = {
          ...this.state,
          status: 'error',
          error: 'Không tìm thấy file cài đặt phù hợp với hệ điều hành của bạn.'
        }
        this.sendState()
        return
      }
    }

    this.state = {
      ...this.state,
      status: 'downloading',
      progress: { percent: 0, bytesPerSecond: 0, transferred: 0, total: 100 }
    }
    this.sendState()

    try {
      console.log(`[Updater] Bắt đầu tải bản cập nhật từ: ${this.targetDownloadUrl}`)

      // Thử tải trực tiếp với timeout 6s, nếu mạng chặn GitHub CDN (ETIMEDOUT) thì tự động chuyển sang CDN tăng tốc
      let res: Response | null = null
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 6000)
        const directRes = await fetch(this.targetDownloadUrl, {
          headers: { 'User-Agent': 'ThreadCut-Desktop-App' },
          signal: controller.signal
        })
        clearTimeout(timer)
        if (directRes.ok && directRes.body) {
          res = directRes
        }
      } catch (directErr) {
        console.warn(
          '[Updater] Tải trực tiếp không khả dụng (do nhà mạng chặn CDN GitHub), chuyển sang CDN tăng tốc...'
        )
      }

      if (!res) {
        const mirrorUrl = `https://ghfast.top/${this.targetDownloadUrl}`
        console.log(`[Updater] Đang tải qua CDN tăng tốc: ${mirrorUrl}`)
        res = await fetch(mirrorUrl, {
          headers: { 'User-Agent': 'ThreadCut-Desktop-App' }
        })
      }

      if (!res || !res.ok || !res.body) {
        throw new Error(`Tải file thất bại với mã trạng thái: ${res ? res.status : 'No response'}`)
      }

      const total = parseInt(res.headers.get('content-length') || '0', 10)
      const fileName =
        this.targetDownloadUrl.split('/').pop()?.split('?')[0] || `update_${Date.now()}`
      const tempDir = join(app.getPath('temp'), 'threadcut_updates')
      if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })
      const destPath = join(tempDir, fileName)

      let transferred = 0
      let lastTime = Date.now()
      let lastBytes = 0

      const fileStream = createWriteStream(destPath)
      const webStream = Readable.fromWeb(res.body as any)

      webStream.on('data', (chunk: Buffer) => {
        transferred += chunk.length
        const now = Date.now()
        if (now - lastTime >= 400) {
          const deltaSec = (now - lastTime) / 1000
          const bytesPerSecond = deltaSec > 0 ? Math.round((transferred - lastBytes) / deltaSec) : 0
          lastTime = now
          lastBytes = transferred
          const percent = total > 0 ? Math.min(99, Math.round((transferred / total) * 100)) : 50

          const progress: UpdateProgress = {
            percent,
            bytesPerSecond,
            transferred,
            total: total || transferred
          }

          this.state = {
            ...this.state,
            status: 'downloading',
            progress
          }
          this.sendState()
        }
      })

      await pipeline(webStream, fileStream)

      this.downloadedFilePath = destPath
      console.log(`[Updater] Tải hoàn tất bản cập nhật: ${destPath}`)

      this.state = {
        ...this.state,
        status: 'downloaded',
        progress: {
          percent: 100,
          bytesPerSecond: 0,
          transferred: total || transferred,
          total: total || transferred
        }
      }
      this.sendState()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Updater] Lỗi khi tải cập nhật:', msg)
      this.state = {
        ...this.state,
        status: 'error',
        error: `Lỗi tải cập nhật: ${msg}`
      }
      this.sendState()
    }
  }

  quitAndInstall(): void {
    if (!this.downloadedFilePath || !existsSync(this.downloadedFilePath)) {
      console.error('[Updater] Không tìm thấy file đã tải:', this.downloadedFilePath)
      return
    }

    console.log(`[Updater] Bắt đầu cài đặt bản cập nhật: ${this.downloadedFilePath}`)
    const isWin = process.platform === 'win32'
    const isLinux = process.platform === 'linux'

    if (isWin) {
      // Trên Windows: Chạy installer và tắt app hiện tại
      const subprocess = spawn(this.downloadedFilePath, ['--updated'], {
        detached: true,
        stdio: 'ignore'
      })
      subprocess.unref()
      app.quit()
    } else if (isLinux) {
      // Trên Linux: Cấp quyền thực thi và mở file AppImage
      try {
        chmodSync(this.downloadedFilePath, 0o755)
      } catch (e) {
        console.warn('[Updater] Không thể chmod file:', e)
      }
      const subprocess = spawn(this.downloadedFilePath, [], {
        detached: true,
        stdio: 'ignore'
      })
      subprocess.unref()
      app.quit()
    } else {
      // macOS: Mở file .dmg
      app.quit()
    }
  }

  getState(): UpdateInfoState {
    return this.state
  }
}

import { app, shell, BrowserWindow, ipcMain, protocol } from 'electron'
import { join, extname, normalize } from 'path'
import { existsSync, statSync, createReadStream } from 'fs'
import { Readable } from 'stream'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc/handlers'

app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu-sandbox')

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mov':
      return 'video/quicktime'
    case '.mkv':
      return 'video/x-matroska'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.svg':
      return 'image/svg+xml'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.ogg':
      return 'audio/ogg'
    case '.m4a':
      return 'audio/mp4'
    default:
      return 'application/octet-stream'
  }
}

// Đăng ký custom protocol đặc quyền để phát video trực tiếp trong Renderer
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'atom',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true
    }
  }
])

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 960,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Đăng ký protocol stream video local hỗ trợ Range request (bắt buộc để phát video HTML5 mượt mà trên Chromium)
  protocol.handle('atom', (request) => {
    try {
      let targetPath: string | null = null

      try {
        const parsed = new URL(request.url)
        targetPath = parsed.searchParams.get('path')
      } catch {
        targetPath = null
      }

      if (!targetPath) {
        // Fallback tương thích ngược định dạng cũ atom:// hoặc atom:///
        let raw = decodeURIComponent(request.url.replace(/^atom:\/\/(media\/)?(\?path=)?/, ''))
        if (/^\/[a-zA-Z]:[/\\]/.test(raw)) {
          raw = raw.slice(1)
        }
        targetPath = raw
      }

      if (!targetPath) {
        return new Response('Not Found', { status: 404 })
      }

      targetPath = normalize(targetPath)

      if (!existsSync(targetPath)) {
        console.warn('[Protocol atom] File không tồn tại:', targetPath)
        return new Response('File Not Found', { status: 404 })
      }

      const stat = statSync(targetPath)
      const fileSize = stat.size
      const mimeType = getMimeType(targetPath)
      const rangeHeader = request.headers.get('range')

      // Xử lý Range Request (bắt buộc đối với thẻ <video> trong Chromium khi phát hoặc tua)
      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1

        if (isNaN(start) || start >= fileSize) {
          return new Response(null, {
            status: 416,
            headers: {
              'Content-Range': `bytes */${fileSize}`,
              'Accept-Ranges': 'bytes'
            }
          })
        }

        const chunkSize = end - start + 1
        const nodeStream = createReadStream(targetPath, { start, end })
        const webStream = Readable.toWeb(nodeStream)

        return new Response(webStream as unknown as BodyInit, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': mimeType
          }
        })
      }

      // Trả về toàn bộ file nếu request không có header Range
      const nodeStream = createReadStream(targetPath)
      const webStream = Readable.toWeb(nodeStream)

      return new Response(webStream as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Length': String(fileSize),
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes'
        }
      })
    } catch (err) {
      console.error('[Protocol atom] Lỗi đọc media:', request.url, err)
      return new Response('Internal Server Error', { status: 500 })
    }
  })

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Register ThreadCut pipeline IPC handlers
  registerIpcHandlers()

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

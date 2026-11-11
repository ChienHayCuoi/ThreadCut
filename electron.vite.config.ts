import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Đảm bảo không bị xung đột khi chạy trong terminal của IDE (VS Code / Antigravity IDE)
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { AppSettings } from '../../../shared/types'

export class SettingsService {
  private configPath: string
  private defaultSettings: AppSettings

  constructor() {
    const userData = app?.getPath ? app.getPath('userData') : process.cwd()
    const defaultOutput = app?.getPath
      ? join(app.getPath('videos'), 'ThreadCut')
      : join(process.cwd(), 'output')

    this.configPath = join(userData, 'settings.json')
    this.defaultSettings = {
      defaultTtsVoice: 'vi-VN-HoaiMyNeural',
      ttsRate: 'default',
      outputDir: defaultOutput,
      backgroundTemplateDir: join(userData, 'templates')
    }
  }

  getSettings(): AppSettings {
    try {
      if (existsSync(this.configPath)) {
        const raw = readFileSync(this.configPath, 'utf-8')
        const parsed = JSON.parse(raw)
        return { ...this.defaultSettings, ...parsed }
      }
    } catch (e) {
      console.error('[SettingsService] Lỗi khi đọc settings:', e)
    }
    return { ...this.defaultSettings }
  }

  saveSettings(newSettings: Partial<AppSettings>): AppSettings {
    const current = this.getSettings()
    const merged: AppSettings = { ...current, ...newSettings }
    try {
      const dir = join(this.configPath, '..')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(this.configPath, JSON.stringify(merged, null, 2), 'utf-8')
    } catch (e) {
      console.error('[SettingsService] Lỗi khi lưu settings:', e)
    }
    return merged
  }
}

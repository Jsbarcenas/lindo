import { app } from 'electron'
import { Application } from './application'
import { setupRootStore } from './store'
import { setupTitlebar } from 'custom-electron-titlebar/main'
import { logger } from './logger'

// prevent chrome using cpu instead of the gpu
// renamed in Chromium M81; the old spelling has been a silent no-op ever since
app.commandLine.appendSwitch('ignore-gpu-blocklist')

// prevent throttling when window is not focus
app.commandLine.appendSwitch('disable-site-isolation-trials')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

// more webgl and less black screen (default is probably 16, maybe...)
app.commandLine.appendSwitch('max-active-webgl-contexts', '32')

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.name)

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

app.whenReady().then(async () => {
  logger.debug('App -> whenReady')
  setupTitlebar()
  const store = await setupRootStore()
  await Application.init(store)
  Application.instance.run()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

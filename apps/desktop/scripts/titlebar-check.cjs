/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * custom-electron-titlebar is the most fragile dependency across Electron
 * majors: it serialises Menu.getApplicationMenu() with JSON.stringify, i.e. the
 * internal MenuItem shape, and the app's preload reaches into its private
 * `titlebar` field. Neither is covered by the smoke test, so this reproduces
 * both against the window options the app actually uses.
 *
 * Run under Electron, from the project root:
 *   npx electron scripts/titlebar-check.cjs
 */
const path = require('path')
const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const { setupTitlebar, attachTitlebarToWindow } = require('custom-electron-titlebar/main')

setupTitlebar()

const fail = (msg) => {
  console.error('TITLEBAR_FAIL ' + msg)
  app.exit(1)
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ label: 'Lindo', submenu: [{ role: 'quit' }, { type: 'separator' }, { role: 'reload' }] }])
  )

  const win = new BrowserWindow({
    show: false,
    // same combination as apps/desktop/src/main/windows/game-window.ts
    frame: process.platform !== 'linux',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'titlebar-check-preload.cjs'),
      sandbox: false,
      contextIsolation: false
    }
  })
  attachTitlebarToWindow(win)

  ipcMain.on('titlebar-result', (_event, result) => {
    console.log('titlebar: ' + JSON.stringify(result))
    if (result.error) return fail(result.error)
    if (!result.privateFieldPresent) return fail('private `titlebar` field is gone')
    if (!result.isElement || !result.inDom) return fail('titlebar element not attached to the document')
    if (!result.height) return fail('titlebar has no height')
    if (!result.menuRendered) return fail('application menu did not render into the titlebar')

    win.maximize()
    setTimeout(() => {
      if (!win.isMaximized()) return fail('maximize did not take effect')
      win.unmaximize()
      setTimeout(() => {
        if (win.isMaximized()) return fail('unmaximize did not take effect')
        console.log(`electron ${process.versions.electron}: maximize/restore OK`)
        console.log('TITLEBAR_OK')
        app.exit(0)
      }, 400)
    }, 400)
  })

  win.loadURL('data:text/html,<html><body></body></html>')
})

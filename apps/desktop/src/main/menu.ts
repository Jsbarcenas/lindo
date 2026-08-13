import { IPCEvents, RootStore } from '@lindo/shared'
import { app, BaseWindow, BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron'
import { Application } from './application'
import { I18n } from './utils'

const isMac = process.platform === 'darwin'

/**
 * Electron 30 widened the menu click callback's window argument to BaseWindow,
 * which carries neither webContents nor reload. Every window this menu is
 * attached to is a BrowserWindow, so narrow rather than cast.
 */
const asBrowserWindow = (window?: BaseWindow): BrowserWindow | undefined =>
  window instanceof BrowserWindow ? window : undefined

export const getAppMenu = (rootStore: RootStore, i18n: I18n) => {
  const windowHotkey = rootStore.hotkeyStore.window
  const template: MenuItemConstructorOptions[] = [
    {
      label: i18n.LL.main.gameMenu.file.title(),
      submenu: [
        {
          label: i18n.LL.main.gameMenu.file.newWindow(),
          accelerator: windowHotkey.newWindow,
          click() {
            Application.instance.createGameWindow()
          }
        },
        {
          label: i18n.LL.main.gameMenu.file.newTab(),
          accelerator: windowHotkey.newTab,
          click(_, focusedWindow) {
            asBrowserWindow(focusedWindow)?.webContents.send(IPCEvents.NEW_TAB, {})
          }
        },
        {
          type: 'separator'
        },
        {
          label: i18n.LL.main.gameMenu.file.closeTab(),
          accelerator: windowHotkey.closeTab,
          click(_, focusedWindow) {
            asBrowserWindow(focusedWindow)?.webContents.send(IPCEvents.CLOSE_TAB, {})
          }
        },
        {
          label: i18n.LL.main.gameMenu.file.closeWindow(),
          accelerator: 'Shift+CmdOrCtrl+W',
          click(item, focusedWindow) {
            if (focusedWindow) focusedWindow.close()
          }
        }
      ]
    },
    {
      label: i18n.LL.main.gameMenu.edit.title(),
      submenu: [
        {
          label: i18n.LL.main.gameMenu.edit.undo(),
          role: 'undo'
        },
        {
          label: i18n.LL.main.gameMenu.edit.redo(),
          role: 'redo'
        },
        {
          type: 'separator'
        },
        {
          label: i18n.LL.main.gameMenu.edit.cut(),
          role: 'cut'
        },
        {
          label: i18n.LL.main.gameMenu.edit.copy(),
          role: 'copy'
        },
        {
          label: i18n.LL.main.gameMenu.edit.paste(),
          role: 'paste'
        },
        {
          label: i18n.LL.main.gameMenu.edit.selectAll(),
          role: 'selectAll'
        }
      ]
    },
    {
      label: i18n.LL.main.gameMenu.window.title(),
      submenu: [
        {
          label: i18n.LL.main.gameMenu.window.reload(),
          accelerator: 'CmdOrCtrl+R',
          click(item, focusedWindow) {
            asBrowserWindow(focusedWindow)?.reload()
          }
        },
        {
          type: 'separator'
        },

        {
          label: i18n.LL.main.gameMenu.window.prevTab(),
          accelerator: windowHotkey.prevTab,
          click(_, focusedWindow) {
            asBrowserWindow(focusedWindow)?.webContents.send(IPCEvents.PREV_TAB, {})
          }
        },
        {
          label: i18n.LL.main.gameMenu.window.nextTab(),
          accelerator: windowHotkey.nextTab,
          click(_, focusedWindow) {
            asBrowserWindow(focusedWindow)?.webContents.send(IPCEvents.NEXT_TAB, {})
          }
        },
        {
          type: 'separator'
        },
        {
          label: i18n.LL.main.gameMenu.window.disableSound(),
          type: 'checkbox',
          checked: rootStore.optionStore.window.audioMuted,
          click(item) {
            rootStore.optionStore.window.setAudioMuted(item.checked)
          }
        },
        {
          label: i18n.LL.main.gameMenu.window.zoomIn(),
          role: 'zoomIn'
        },
        {
          label: i18n.LL.main.gameMenu.window.zoomOut(),
          role: 'zoomOut'
        },
        {
          label: i18n.LL.main.gameMenu.window.resetZoom(),
          role: 'resetZoom'
        },
        {
          type: 'separator'
        },
        {
          label: i18n.LL.main.gameMenu.window.fullScreen(),
          role: 'togglefullscreen'
        }
      ]
    },
    {
      label: i18n.LL.main.gameMenu.infos.title(),
      submenu: [
        {
          label: i18n.LL.main.gameMenu.infos.console(),
          accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click(item, focusedWindow) {
            asBrowserWindow(focusedWindow)?.webContents.toggleDevTools()
          }
        }
      ]
    }
  ]
  if (isMac) {
    template.unshift({
      label: app.name,
      submenu: [
        {
          role: 'about'
        },
        {
          type: 'separator'
        },
        {
          role: 'services',
          submenu: []
        },
        {
          type: 'separator'
        },
        {
          role: 'hide'
        },
        {
          role: 'hideOthers'
        },
        {
          role: 'unhide'
        },
        {
          type: 'separator'
        },
        {
          role: 'quit'
        }
      ]
    })
    // Edit menu.
    // const windowSubmenu = template[2]!.submenu as Array<MenuItemConstructorOptions>
    // windowSubmenu.push!(
    //   {
    //     type: 'separator'
    //   },
    //   {
    //     label: 'Sound',
    //     submenu: [
    //       {
    //         label: 'Enable Sound',
    //         role: 'startSpeaking'
    //       },
    //       {
    //         label: 'Disable Sound',
    //         role: 'stopSpeaking'
    //       }
    //     ]
    //   }
    // )
  }

  return Menu.buildFromTemplate(template)
}

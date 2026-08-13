/* eslint-disable @typescript-eslint/no-var-requires */
// Renderer half of scripts/titlebar-check.cjs. Must live inside the project so
// that require('custom-electron-titlebar') resolves the same way the real
// preload does.
const { ipcRenderer } = require('electron')

window.addEventListener('DOMContentLoaded', () => {
  try {
    const { Titlebar, TitlebarColor } = require('custom-electron-titlebar')
    const titleBar = new Titlebar({ backgroundColor: TitlebarColor.fromHex('#121212') })
    // the private field apps/desktop/src/preload/index.ts reaches into
    const ref = titleBar.titlebar
    titleBar.updateTitle('Lindo')
    ipcRenderer.send('titlebar-result', {
      constructed: !!titleBar,
      privateFieldPresent: !!ref,
      isElement: ref instanceof HTMLElement,
      height: ref ? ref.clientHeight : null,
      inDom: ref ? document.body.contains(ref) : false,
      // proves Menu.getApplicationMenu() still survives the library's
      // JSON.stringify of MenuItem, the part that breaks on Electron majors
      menuRendered: ref ? !!ref.querySelector('.cet-menubar') : false
    })
  } catch (e) {
    ipcRenderer.send('titlebar-result', { error: e.message })
  }
})

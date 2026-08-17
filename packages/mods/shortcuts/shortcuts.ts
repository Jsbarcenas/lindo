import { DofusWindow, GUIButton, Slot } from '@lindo/dofus-window'
import { RootStore } from '@lindo/client-store'
import { LindoShortcuts } from '../utils'
import { TranslationFunctions } from '@lindo/i18n'
import { GameInterfaceHotkey } from '@lindo/shared'
import { IArrayDidChange, IObjectDidChange, Lambda, observe } from 'mobx'
import { IAnyType, IMSTArray } from 'mobx-state-tree'
import { contain, ignoreKeyboardEvent } from '../helpers'
import { Mod } from '../mod'
import { Mover } from './mover'

const lowerCaseFirstLetter = (value: string) => {
  return value.charAt(0).toLowerCase() + value.slice(1)
}

interface ValueDidChange {
  value: string
  oldValue: string
}
export class ShortcutsMod extends Mod {
  private readonly _disposers: Array<Lambda> = []
  private readonly _shortcuts = new LindoShortcuts({
    target: this.wGame.document,
    shouldHandleEvent: (event) => {
      // don't apply the shortcut if the user is on a input (like chat)
      if (ignoreKeyboardEvent(event)) {
        return false
      }
      return !event.defaultPrevented
    }
  })

  private readonly _mover: Mover

  constructor(wGame: DofusWindow, rootStore: RootStore, LL: TranslationFunctions) {
    super(wGame, rootStore, LL)
    this._mover = new Mover(wGame)
    this._bindAll()
  }

  /**
   * Resolve a shortcut-bar slot at press time rather than when the mod is built.
   * The bar used to be gui.shortcutBar; it is now created by shortcutBarManager
   * after character selection, and it is rebuilt when the controlled entity
   * changes, so a reference captured up front goes stale - or does not exist yet.
   */
  private _slot(panel: 'spell' | 'item', index: number): Slot | undefined {
    return this.wGame.gui.shortcutBarManager?.shortcutBars?.playerBar?._panels[panel].slotList[index]
  }

  private _addShortcut<S extends object, K extends keyof S>(
    store: S,
    shortcutProp: K,
    handler: (event: KeyboardEvent) => boolean | void
  ) {
    const addShortcut = (shortcut: string) => {
      if (shortcut !== '') {
        this._shortcuts.add({ shortcut, handler })
      }
    }
    const disposer = observe(store, (change: IObjectDidChange<ValueDidChange>) => {
      if (change.name !== shortcutProp) {
        return
      }
      if (change.type === 'update') {
        const newShortcut = change.newValue.value
        this._shortcuts.remove({ shortcut: change.oldValue.value, handler })
        if (newShortcut !== '') {
          addShortcut(newShortcut)
        }
      }
    })
    this._disposers.push(disposer)
    addShortcut(store[shortcutProp] as never)
  }

  private _addShortcutFromArray<S extends IAnyType>(
    store: IMSTArray<S>,
    index: number,
    handler: (event: KeyboardEvent) => boolean | void
  ) {
    const addShortcut = (shortcut: string) => {
      if (shortcut !== '') {
        this._shortcuts.add({ shortcut, handler })
      }
    }
    const disposer = observe(store, (change: IArrayDidChange<ValueDidChange>) => {
      if (change.index !== index) {
        return
      }
      if (change.type === 'update') {
        const newShortcut = change.newValue.value
        this._shortcuts.remove({ shortcut: change.oldValue.value, handler })
        if (newShortcut !== '') {
          addShortcut(newShortcut)
        }
      }
    })
    this._disposers.push(disposer)
    addShortcut(store[index])
  }

  private _bindAll() {
    const gameActionHotkey = this.rootStore.hotkeyStore.gameAction

    // End turn
    this._addShortcut(gameActionHotkey, 'endTurn', () => {
      if (this.wGame.gui.fightManager.fightState === 0) {
        this.wGame.gui.timeline.fightControlButtons.toggleReadyForFight()
      } else if (this.wGame.gui.fightManager.fightState === 1) {
        this.wGame.gui.fightManager.finishTurn()
      }
    })

    // go to top map
    this._addShortcut(gameActionHotkey, 'goUp', () => {
      this._mover.move(
        'top',
        () => {
          window.lindoAPI.logger.debug('Move to Up OK')()
        },
        (reason: string = '') => {
          window.lindoAPI.logger.warn('Move to Up Failed... (' + reason + ')')()
        }
      )
    })

    // go to bottom map
    this._addShortcut(gameActionHotkey, 'goDown', () => {
      this._mover.move(
        'bottom',
        () => {
          window.lindoAPI.logger.info('Move to Bottom OK')()
        },
        (reason: string = '') => {
          window.lindoAPI.logger.warn('Move to Bottom Failed... (' + reason + ')')()
        }
      )
    })

    this._addShortcut(gameActionHotkey, 'goLeft', () => {
      this._mover.move(
        'left',
        () => {
          window.lindoAPI.logger.info('Move to Left OK')()
        },
        (reason: string = '') => {
          window.lindoAPI.logger.warn('Move to Left Failed... (' + reason + ')')()
        }
      )
    })

    this._addShortcut(gameActionHotkey, 'goRight', () => {
      this._mover.move(
        'right',
        () => {
          window.lindoAPI.logger.info('Move to Right OK')()
        },
        (reason: string = '') => {
          window.lindoAPI.logger.warn('Move to Right Failed... (' + reason + ')')()
        }
      )
    })

    // Open chat
    this._addShortcut(gameActionHotkey, 'openChat', () => {
      if (!this.wGame.gui.numberInputPad.isVisible()) {
        this.wGame.gui.chat.activate()
      }
    })

    // Open menu
    this._addShortcut(gameActionHotkey, 'openMenu', () => {
      this.wGame.gui.mainControls.buttonBox._childrenList[15].tap()
    })

    const gameInterfaceHotkey = this.rootStore.hotkeyStore.gameInterface

    // Spells
    gameInterfaceHotkey.spells.forEach((_, index) => {
      this._addShortcutFromArray(gameInterfaceHotkey.spells, index, () => {
        this._slot('spell', index)?.tap()
        // return true to prevent spell cast multiple times
        return true
      })

      const handleDoubleTap = () => {
        // TODO:  (HoPollo) : Allow double shortcut tap to work as well (currently only mouseclick works)
        if (this.wGame.gui.fightManager.fightState === 0) {
          return
        }

        this._slot('spell', index)?.tap()

        setTimeout(() => {
          this.wGame.isoEngine._castSpellImmediately(this.wGame.isoEngine.actorManager.userActor.cellId)
        }, 150)
      }

      const selectedSpell = this._slot('spell', index)
      if (selectedSpell) {
        selectedSpell.on('doubletap', handleDoubleTap)
        this._disposers.push(() => {
          selectedSpell.removeListener('doubletap', handleDoubleTap)
        })
      }
    })

    // Skills
    gameInterfaceHotkey.items.forEach((_, index) => {
      this._addShortcutFromArray(gameInterfaceHotkey.items, index, () => {
        this._slot('item', index)?.tap()
        // return true to prevent spell cast multiple times
        return true
      })
    })

    this.wGame.gui.menuBar._icons._childrenList.forEach((child, index) => {
      const propName = lowerCaseFirstLetter(child.id)
      const hasPropName = Object.hasOwn(gameInterfaceHotkey, propName)

      if (hasPropName) {
        this._addShortcut(gameInterfaceHotkey, propName as keyof GameInterfaceHotkey, () => {
          this.wGame.gui.menuBar._icons._childrenList[index].tap()
          return true
        })
      } else {
        window.lindoAPI.logger.info('no hotkey for ' + propName)()
      }
    })

    // Close window on escape
    const escapeListener = (e: KeyboardEvent) => {
      if (e.key.toLocaleLowerCase() !== 'escape') {
        return
      }
      if (this.wGame.gui.chat.active) {
        this.wGame.gui.chat.deactivate()
      } else {
        let winClosed = 0
        for (let i = this.wGame.gui.windowsContainer._childrenList.length - 1; i >= 0; i--) {
          const win = this.wGame.gui.windowsContainer._childrenList[i]
          if (win.isVisible() && win.id !== 'recaptcha') {
            win.close()
            winClosed++
            break
          }
        }
        if (this.wGame.gui.notificationBar._elementIsVisible) {
          const dialogName = this.wGame.gui.notificationBar.currentOpenedId
          // If notifiaction is openened, allow to close it with ESC
          // TODO: find better typing solution for the guibutton
          const notification = this.wGame.gui.notificationBar.dialogs[dialogName]._childrenList[0]
            ._childrenList[1] as GUIButton
          notification.tap()
          winClosed++
        }
        if (this.rootStore.optionStore.gameGeneral.activeOpenMenu && !winClosed) {
          // If no window closed open menu
          this.wGame.gui.mainControls.buttonBox._childrenList[15].tap()
        }
      }
    }

    // Envueltos porque los invoca el frame del juego: una excepción aquí subiría
    // a su `window.onerror`, que el cliente reporta al servidor de Ankama junto
    // al accountId. Se engancha y se quita el envoltorio, no el original.
    const guardedEscape = contain(escapeListener, 'keydown')
    this.wGame.addEventListener('keydown', guardedEscape)
    this._disposers.push(() => this.wGame.removeEventListener('keydown', guardedEscape))

    // Monster tooltips
    //
    // La opción se lee dentro del manejador, no al montarlo: así desmarcarla
    // surte efecto en el momento, igual que `activeOpenMenu` aquí arriba. Antes
    // no se leía en absoluto y la casilla de ajustes no hacía nada - la función
    // estaba siempre activa.
    const showMonsterTooltips = (e: KeyboardEvent) => {
      if (
        this.rootStore.optionStore.gameFight.monsterTooltip &&
        e.key.toLocaleUpperCase() === gameActionHotkey.showMonsterTooltips.toLocaleUpperCase() &&
        this.wGame.foreground._monsterTooltips.length === 0
      )
        this.wGame.foreground.showAllMonsterGroupAndNpcTooltips()
    }
    const hideMonsterTooltips = (e: KeyboardEvent) => {
      if (
        e.key.toLocaleUpperCase() === gameActionHotkey.showMonsterTooltips.toLocaleUpperCase() &&
        this.wGame.foreground._monsterTooltips.length > 0
      )
        this.wGame.foreground.removeAllMonsterGroupAndNpcTooltips()
    }

    const guardedShow = contain(showMonsterTooltips, 'keydown')
    const guardedHide = contain(hideMonsterTooltips, 'keyup')
    this.wGame.addEventListener('keydown', guardedShow)
    this.wGame.addEventListener('keyup', guardedHide)

    this._disposers.push(() => this.wGame.removeEventListener('keydown', guardedShow))
    this._disposers.push(() => this.wGame.removeEventListener('keyup', guardedHide))
  }

  destroy() {
    this._shortcuts.reset()
    for (const disposer of this._disposers) {
      disposer()
    }
    this._mover.close()
  }
}

import { DofusWindow, HTMLIFrameElementWithDofus } from '@lindo/dofus-window'
import { useGameContext } from '../../../providers'
import { Game, useStores } from '@lindo/client-store'
import { useI18nContext } from '@lindo/i18n'
import { reaction } from 'mobx'
import React, { memo, useEffect, useRef } from 'react'
import { useGameManager } from './use-game-manager'

export interface GameScreenProps {
  game: Game
}

// eslint-disable-next-line react/display-name
export const GameScreen = memo(({ game }: GameScreenProps) => {
  const gameContext = useGameContext()
  const rootStore = useStores()
  const { LL } = useI18nContext()
  const gameManager = useGameManager({
    game,
    rootStore,
    LL
  })
  const iframeGameRef = useRef<HTMLIFrameElementWithDofus>(null)

  useEffect(() => {
    return reaction(
      () => rootStore.gameStore.selectedGame,
      (selectedGame) => {
        if (selectedGame?.id === game.id) {
          setTimeout(() => {
            iframeGameRef.current?.focus()
          }, 100)
        }
      },
      { fireImmediately: true }
    )
  }, [])

  const handleLoad = () => {
    if (iframeGameRef.current) {
      const gameWindow = iframeGameRef.current.contentWindow

      // only for debug purpose
      gameWindow.findSingleton = (searchKey: string, window: DofusWindow) => {
        const singletons = Object.values(window.singletons.c)

        const results = singletons.filter(({ exports }) => {
          if (!!exports.prototype && searchKey in exports.prototype) {
            return true
          } else if (searchKey in exports) {
            return true
          } else return false
        })

        if (results.length > 1) {
          window.lindoAPI.logger.error(
            `[MG] Singleton searcher found multiple results for key "${searchKey}". Returning all of them.`
          )()
          return results
        }

        return results.pop()
      }

      // Primary web authentication window handler for desktop client login.
      gameWindow.lindoOpenWebAuth = (url: string) => {
        window.lindoAPI
          .openWebAuth(url)
          .then((result) => {
            // Closing the window is a deliberate "I picked the wrong method",
            // not a failure. Reporting it as an error would pop up the game's
            // login-error dialog; staying quiet leaves the login screen exactly
            // as it was, because requesting a key never disabled anything.
            if (result.cancelled) {
              window.lindoAPI.logger.info('web auth cancelled by the user')()
              return
            }
            gameWindow.lindoWebAuth?.connectThroughIonicDeepLink(
              result.code ? { code: result.code } : { error: result.error ?? 'unknown web auth error' }
            )
          })
          .catch((error: Error) => {
            window.lindoAPI.logger.error('web auth failed', error)()
            gameWindow.lindoWebAuth?.connectThroughIonicDeepLink({ error: error.message })
          })
      }

      // Disable WebSQL database initialization
      gameWindow.openDatabase = undefined
      gameWindow.initDofus(() => {
        window.lindoAPI.logger.info('initDofus done')()
        gameManager.init(gameWindow)
      })
    }
  }

  return (
    <iframe
      id={`iframe-game-${game.id}`}
      ref={iframeGameRef}
      onLoad={handleLoad}
      style={{ border: 'none', width: '100%', height: '100%' }}
      src={gameContext.gameSrc}
    />
  )
})

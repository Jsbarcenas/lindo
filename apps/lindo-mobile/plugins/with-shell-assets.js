/**
 * Mete el cliente web en los assets del proyecto nativo, en cada prebuild.
 *
 * El prebuild regenera `android/`, así que una copia hecha antes se pierde.
 * Hacerla aquí la ata al momento correcto y sirve igual para desarrollo que
 * para release - antes solo la hacía `build-apk.mjs`, y por eso un
 * `expo run:android` acababa en pantalla negra: el servidor de loopback
 * levantaba sin nada que servir y contestaba 404 a `/`.
 *
 * Con `EXPO_PUBLIC_LINDO_URL` puesta no hace nada: el cliente viene de esa URL.
 */
const { withDangerousMod } = require('@expo/config-plugins')
const { stageShell } = require('../scripts/stage-shell.cjs')

module.exports = (config) =>
  withDangerousMod(config, [
    'android',
    (inner) => {
      stageShell({ androidRoot: inner.modRequest.platformProjectRoot })
      return inner
    }
  ])

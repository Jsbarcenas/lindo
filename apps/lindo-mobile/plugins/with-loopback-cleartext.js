/**
 * Permite http en claro **solo** hacia el propio aparato.
 *
 * Android lo permite en debug y lo prohíbe en release, y ese reparto es
 * correcto salvo en un caso: el cliente en desarrollo se sirve desde el
 * anfitrión por `adb reverse`, y llega como `http://localhost:5173`. Una build
 * de release lo rechazaba con `ERR_CLEARTEXT_NOT_PERMITTED`, así que el APK se
 * instalaba y luego no cargaba nada.
 *
 * La salida no es abrir el cleartext entero con `usesCleartextTraffic`, que lo
 * abriría también hacia internet. Es una `network-security-config` que solo
 * exceptúa las tres direcciones que significan "esta misma máquina":
 *
 *   localhost · 127.0.0.1 · 10.0.2.2   (el anfitrión visto desde el emulador)
 *
 * Todo lo demás sigue exigiendo https, incluido el despliegue real al que
 * apunta `EXPO_PUBLIC_LINDO_URL`. En un teléfono sin `adb reverse` no hay nada
 * escuchando en esas direcciones, así que la excepción no abre nada.
 */
const fs = require('node:fs')
const path = require('node:path')
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins')

const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generado por plugins/with-loopback-cleartext.js: no editar a mano -->
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">10.0.2.2</domain>
  </domain-config>
</network-security-config>
`

module.exports = function withLoopbackCleartext(config) {
  config = withDangerousMod(config, [
    'android',
    (inner) => {
      const directory = path.join(inner.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml')
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(path.join(directory, 'network_security_config.xml'), NETWORK_SECURITY_CONFIG)
      return inner
    }
  ])

  return withAndroidManifest(config, (inner) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(inner.modResults)
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config'
    return inner
  })
}

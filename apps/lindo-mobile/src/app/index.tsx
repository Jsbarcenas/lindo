import { useKeepAwake } from 'expo-keep-awake'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, Modal, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native'
import { WebView, type WebViewNavigation } from 'react-native-webview'
import { AUTH_UA, CLIENT_UA_SUFFIX, CLIENT_URL } from '../native/config'
import { collectNativeInfo, nativePrelude, parseWebMessage, resolveAuth } from '../native/bridge'

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#121212' },
  fill: { flex: 1, backgroundColor: '#121212' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  message: { color: '#b0b0b0', fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },
  authBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: '#1e1e1e'
  },
  authTitle: { color: '#e0e0e0', fontSize: 15, fontWeight: '600' },
  authClose: { color: '#7cb342', fontSize: 15, fontWeight: '600' }
})

/** el `code` tal y como aparece en la URL de vuelta */
const codeFrom = (url: string): string | undefined => {
  const match = /[?&]code=([^&\s]+)/.exec(url)?.[1]
  return match ? decodeURIComponent(match) : undefined
}

const errorFrom = (url: string): string | undefined => {
  const match = /[?&]error=([^&\s]+)/.exec(url)?.[1]
  return match ? decodeURIComponent(match) : undefined
}

export default function Index() {
  useKeepAwake()

  const game = useRef<WebView>(null)
  const [authUrl, setAuthUrl] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)

  // se lee una vez: el aparato no cambia mientras la app vive
  const native = useMemo(collectNativeInfo, [])
  const prelude = useMemo(() => nativePrelude(native), [native])

  /**
   * El botón atrás de Android navega el WebView antes que cerrar la app.
   *
   * Con el login abierto lo cierra a él, que es lo que espera cualquiera que lo
   * haya abierto sin querer.
   */
  const onBack = useCallback(() => {
    if (authUrl) {
      setAuthUrl(undefined)
      game.current?.injectJavaScript(resolveAuth({ cancelled: true }))
      return true
    }
    game.current?.goBack()
    return true
  }, [authUrl])

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBack)
    return () => subscription.remove()
  }, [onBack])

  /**
   * El login, en un WebView nuestro en vez de en una pestaña que no podemos
   * leer.
   *
   * Es la diferencia entera con la versión web: allí el `code` aterriza en un
   * dominio de Ankama y hay que copiarlo a mano porque el origen no puede leer
   * la URL de otra pestaña. Aquí la ventana es nuestra, así que cada navegación
   * pasa por `onNavigationStateChange` y el `code` se recoge solo.
   */
  const onAuthNavigation = useCallback((event: WebViewNavigation) => {
    const code = codeFrom(event.url)
    const error = errorFrom(event.url)
    if (!code && !error) return
    setAuthUrl(undefined)
    game.current?.injectJavaScript(resolveAuth(code ? { code } : { error }))
  }, [])

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <WebView
        ref={game}
        source={{ uri: CLIENT_URL }}
        style={styles.fill}
        // el equivalente de `AppendUserAgent`: el UA sale idéntico al del cliente real
        applicationNameForUserAgent={CLIENT_UA_SUFFIX}
        injectedJavaScriptBeforeContentLoaded={prelude}
        onMessage={(event) => {
          const message = parseWebMessage(event.nativeEvent.data)
          if (message) setAuthUrl(message.url)
        }}
        onLoadEnd={() => setLoading(false)}
        // sin esto `window.open` abre una ventana que no controlamos y el login
        // se pierde igual que en el navegador
        setSupportMultipleWindows={false}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        // el juego dibuja en canvas y WebGL
        androidLayerType='hardware'
        // la restricción dura: contexto seguro o nada
        originWhitelist={['https://*', 'http://localhost*']}
      />

      {loading ? (
        <View style={[styles.centre, StyleSheet.absoluteFill]}>
          <ActivityIndicator color='#7cb342' />
          <Text style={styles.message}>Cargando el cliente desde {CLIENT_URL}</Text>
        </View>
      ) : null}

      <Modal visible={!!authUrl} animationType='slide' onRequestClose={onBack}>
        <View style={styles.root}>
          <View style={styles.authBar}>
            <Text style={styles.authTitle}>Cuenta Ankama</Text>
            <Pressable onPress={onBack}>
              <Text style={styles.authClose}>Cerrar</Text>
            </Pressable>
          </View>
          {authUrl ? (
            <WebView
              source={{ uri: authUrl }}
              style={styles.fill}
              // Safari de iPhone, que es lo que pone el cliente oficial en
              // `InAppBrowserOverrideUserAgent`: Google rechaza OAuth dentro de
              // un WebView que se declare como tal
              userAgent={AUTH_UA}
              onNavigationStateChange={onAuthNavigation}
              javaScriptEnabled
              domStorageEnabled
              thirdPartyCookiesEnabled
              sharedCookiesEnabled
            />
          ) : null}
        </View>
      </Modal>
    </View>
  )
}

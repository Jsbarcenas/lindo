import { useKeepAwake } from 'expo-keep-awake'
import * as NavigationBar from 'expo-navigation-bar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { WebView, type WebViewNavigation } from 'react-native-webview'
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes'
import { AUTH_UA, CLIENT_ORIGIN, CLIENT_UA_SUFFIX, CLIENT_URL } from '../native/config'
import {
  authBlockedProbe,
  browserUserAgent,
  collectNativeInfo,
  nativePrelude,
  parseWebMessage,
  resolveAuth
} from '../native/bridge'

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

/** una promesa que no se espera a propósito, con su fallo a la vista */
const detach = (promise: Promise<unknown>): void => {
  promise.catch((error) => console.warn('lindo: no se pudo abrir fuera de la app', error))
}

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
  /** el UA real del WebView, que solo se conoce desde dentro de una página */
  const [deviceUserAgent, setDeviceUserAgent] = useState<string | undefined>()
  /**
   * Con qué identidad se está intentando el login.
   *
   * Empieza por la del cliente oficial. Si Google contesta que el navegador no
   * es seguro, pasa a `browser` - la del propio aparato sin marcas de WebView -
   * y se reintenta una sola vez. Cambiar esta prop remonta el WebView, que es
   * justo lo que hace falta para que se aplique.
   */
  const [authIdentity, setAuthIdentity] = useState<'client' | 'browser'>('client')

  const authUserAgent = authIdentity === 'browser' && deviceUserAgent ? browserUserAgent(deviceUserAgent) : AUTH_UA

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
      setAuthIdentity('client')
      game.current?.injectJavaScript(resolveAuth({ cancelled: true }))
      return true
    }
    game.current?.goBack()
    return true
  }, [authUrl])

  /**
   * Pantalla completa de verdad.
   *
   * Expo dibuja de borde a borde, así que sin esto la barra de gestos se queda
   * encima del WebView y le tapa el pie - que es justo donde el cliente pone su
   * versión y el "jugar como invitado". Se recupera deslizando desde el borde.
   */
  useEffect(() => {
    detach(NavigationBar.setVisibilityAsync('hidden'))
  }, [])

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBack)
    return () => subscription.remove()
  }, [onBack])

  /**
   * Lo que puede navegar el WebView del juego: el juego, y nada más.
   *
   * Con `setSupportMultipleWindows` en false, un `target="_blank"` no abre una
   * ventana nueva sino que **sustituye** la actual, así que el primer enlace de
   * las noticias de Ankama se lleva el cliente entero por delante y no hay forma
   * de volver. Lo de fuera se abre fuera; lo de casa sigue su camino.
   */
  const onGameNavigation = useCallback((request: ShouldStartLoadRequest) => {
    if (request.url.startsWith(CLIENT_ORIGIN)) return true
    detach(Linking.openURL(request.url))
    return false
  }, [])

  /**
   * El login, en un WebView nuestro en vez de en una pestaña que no podemos
   * leer.
   *
   * Es la diferencia entera con la versión web: allí el `code` aterriza en un
   * dominio de Ankama y hay que copiarlo a mano porque el origen no puede leer
   * la URL de otra pestaña. Aquí la ventana es nuestra, así que cada navegación
   * pasa por `onNavigationStateChange` y el `code` se recoge solo.
   */
  const onAuthNavigation = useCallback(
    (event: WebViewNavigation) => {
      // Google puede llevar el rechazo en la propia URL, sin llegar a pintar la
      // página; el sondeo inyectado solo corre cuando una carga termina
      if (/disallowed_useragent/i.test(event.url)) {
        setAuthIdentity((current) => (current === 'client' && deviceUserAgent ? 'browser' : current))
        return
      }
      const code = codeFrom(event.url)
      const error = errorFrom(event.url)
      if (!code && !error) return
      setAuthUrl(undefined)
      setAuthIdentity('client')
      game.current?.injectJavaScript(resolveAuth(code ? { code } : { error }))
    },
    [deviceUserAgent]
  )

  /**
   * "Este navegador o app puede no ser seguro".
   *
   * Google la saca a mitad del flujo, y solo a veces: depende de si toca volver
   * a autenticarse. Cuando aparece, se reintenta el mismo login con la identidad
   * del propio aparato en vez de la del cliente oficial. Una vez y no más - si
   * la segunda también cae, se deja la pantalla como está en lugar de dar
   * vueltas, para que se vea qué ha pasado.
   */
  const onAuthMessage = useCallback(
    (raw: string) => {
      if (parseWebMessage(raw)?.type !== 'auth:blocked') return
      if (authIdentity !== 'client' || !deviceUserAgent) return
      setAuthIdentity('browser')
    },
    [authIdentity, deviceUserAgent]
  )

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
          if (message?.type === 'ua') setDeviceUserAgent(message.value)
          if (message?.type === 'auth:open') {
            setAuthIdentity('client')
            setAuthUrl(message.url)
          }
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
        onShouldStartLoadWithRequest={onGameNavigation}
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
              // remontar al cambiar de identidad es lo que reaplica el UA
              key={authIdentity}
              source={{ uri: authUrl }}
              style={styles.fill}
              // De partida, Safari de iPhone: es lo que pone el cliente oficial
              // en `InAppBrowserOverrideUserAgent`, porque Google rechaza OAuth
              // dentro de un WebView que se declare como tal. Si aun así lo
              // rechaza, `onAuthMessage` cambia a la del aparato.
              userAgent={authUserAgent}
              onNavigationStateChange={onAuthNavigation}
              injectedJavaScript={authBlockedProbe}
              onMessage={(event) => onAuthMessage(event.nativeEvent.data)}
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

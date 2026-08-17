package expo.modules.shellassets

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.util.concurrent.Executors

/**
 * Sirve el cliente desde dentro del APK, en un origen que cuenta como seguro.
 *
 * El shell necesita service worker, IndexedDB y `crypto.subtle`, y las tres
 * exigen contexto seguro. `file://` no lo es, así que hasta ahora hacía falta un
 * servidor de verdad: el de desarrollo, o uno desplegado. Esto pone uno dentro
 * de la propia app, escuchando solo en loopback.
 *
 * Se intentó antes con `WebViewAssetLoader`, que es la respuesta idiomática de
 * Android y no abre ningún puerto. Se descartó por dónde hay que engancharlo:
 * exige sustituir el `WebViewClient` de react-native-webview sobre la vista ya
 * montada, y localizar esa vista desde el lado nativo no resultó fiable - ni por
 * el tag del propio WebView, que la librería no expone, ni bajando desde un
 * contenedor, que con Fabric no siempre lo tiene debajo cuando toca. Un socket
 * en `127.0.0.1` da el mismo contexto seguro sin tocar nada de la librería: el
 * WebView solo ve una URL normal.
 */
private const val HAAPI_PREFIX = "/haapi/"
private const val HAAPI_UPSTREAM = "https://haapi.ankama.com/"

private val MIME_TYPES = mapOf(
  "html" to "text/html; charset=utf-8",
  "js" to "text/javascript; charset=utf-8",
  "mjs" to "text/javascript; charset=utf-8",
  "css" to "text/css; charset=utf-8",
  "json" to "application/json; charset=utf-8",
  "png" to "image/png",
  "jpg" to "image/jpeg",
  "jpeg" to "image/jpeg",
  "svg" to "image/svg+xml",
  "ico" to "image/x-icon",
  "woff" to "font/woff",
  "woff2" to "font/woff2",
  "ttf" to "font/ttf",
  "wasm" to "application/wasm"
)

private fun mimeOf(path: String) =
  MIME_TYPES[path.substringAfterLast('.', "").lowercase()] ?: "application/octet-stream"

internal class ShellServer(private val context: Context) {
  private val socket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
  private val workers = Executors.newFixedThreadPool(4)
  private var running = true

  val port: Int get() = socket.localPort

  fun start() {
    Thread({
      while (running) {
        try {
          val client = socket.accept()
          workers.execute { serve(client) }
        } catch (error: IOException) {
          if (!running) break
        }
      }
    }, "lindo-shell-server").start()
  }

  fun stop() {
    running = false
    try {
      socket.close()
    } catch (error: IOException) {
      // se está cerrando de todas formas
    }
    workers.shutdownNow()
  }

  private fun serve(client: Socket) {
    client.use { connection ->
      try {
        val input = BufferedInputStream(connection.getInputStream())
        val request = readRequest(input) ?: return
        val output = BufferedOutputStream(connection.getOutputStream())

        if (request.path.startsWith(HAAPI_PREFIX)) {
          proxyHaapi(request, output)
        } else {
          serveAsset(request.path, output)
        }
        output.flush()
      } catch (error: Exception) {
        // una petición rota no puede llevarse el servidor por delante
      }
    }
  }

  private data class Request(
    val method: String,
    val path: String,
    val headers: Map<String, String>,
    val body: ByteArray
  )

  /**
   * La línea de petición, sus cabeceras y su cuerpo.
   *
   * El cuerpo hay que leerlo aunque parezca que no se usa: `RefreshApiKey` de
   * haapi es un POST, y reenviarlo sin cuerpo hacía que Ankama contestara 422 y
   * el cliente enseñara "todos los servidores están en mantenimiento". Un fallo
   * que no daba la cara en web ni en Electron, donde el proxy sí lo reenvía.
   */
  private fun readRequest(input: InputStream): Request? {
    val first = readLine(input) ?: return null
    val parts = first.split(' ')
    if (parts.size < 2) return null

    val headers = mutableMapOf<String, String>()
    while (true) {
      val line = readLine(input) ?: break
      if (line.isEmpty()) break
      val separator = line.indexOf(':')
      if (separator > 0) {
        headers[line.substring(0, separator).trim().lowercase()] = line.substring(separator + 1).trim()
      }
    }
    val length = headers["content-length"]?.toIntOrNull() ?: 0
    val body = if (length > 0) ByteArray(length).also { readFully(input, it) } else ByteArray(0)
    return Request(parts[0], parts[1], headers, body)
  }

  /** `read` puede devolver menos de lo pedido, y un cuerpo a medias es un 422 */
  private fun readFully(input: InputStream, buffer: ByteArray) {
    var read = 0
    while (read < buffer.size) {
      val count = input.read(buffer, read, buffer.size - read)
      if (count == -1) break
      read += count
    }
  }

  private fun readLine(input: InputStream): String? {
    val builder = StringBuilder()
    while (true) {
      val byte = input.read()
      if (byte == -1) return if (builder.isEmpty()) null else builder.toString()
      if (byte == '\n'.code) return builder.toString().trimEnd('\r')
      builder.append(byte.toChar())
    }
  }

  private fun serveAsset(rawPath: String, output: BufferedOutputStream) {
    val withoutQuery = rawPath.substringBefore('?')
    // nada de subir por encima de los assets del shell
    if (withoutQuery.contains("..")) {
      return respond(output, 403, "text/plain", "forbidden".toByteArray())
    }

    val trimmed = withoutQuery.trimStart('/')
    val name = if (trimmed.isEmpty() || withoutQuery.endsWith("/")) "${trimmed}index.html" else trimmed

    val body = readAsset(name)
    if (body != null) {
      val headers = mutableMapOf<String, String>()
      // sin referer hacia fuera: static.ankama.com sirve las imágenes de
      // noticias detrás de una lista blanca de referers y contesta 403 a
      // cualquiera que no sea suyo, y el origen de loopback no lo es. Va como
      // cabecera además de como <meta> en el shell para no depender de qué
      // versión del HTML haya quedado empaquetada.
      headers["Referrer-Policy"] = "same-origin"
      // el worker se registra en la raíz, y esta cabecera se lo permite
      if (name.endsWith(".js")) headers["Service-Worker-Allowed"] = "/"
      return respond(output, 200, mimeOf(name), body, headers)
    }

    /**
     * Sin extensión es una ruta de la aplicación y le toca el index; con
     * extensión, 404. Devolver el index donde se pedía un `.json` no da un
     * error, da un `JSON.parse` roto mucho más lejos del problema - eso ya nos
     * pasó una vez en la versión web.
     */
    if (name.substringAfterLast('/').contains('.')) {
      return respond(output, 404, "text/plain", "not found".toByteArray())
    }
    val index = readAsset("index.html")
      ?: return respond(output, 404, "text/plain", "no hay shell empaquetado".toByteArray())
    respond(output, 200, "text/html; charset=utf-8", index)
  }

  private fun readAsset(name: String): ByteArray? = try {
    context.assets.open("shell/$name").use { it.readBytes() }
  } catch (error: IOException) {
    null
  }

  /**
   * Haapi, alcanzado desde el mismo origen.
   *
   * Su preflight contesta con `access-control-request-headers` donde debería ir
   * `Access-Control-Allow-Headers`, así que el navegador nunca ve permitida la
   * cabecera `apikey` y bloquea la llamada de cuenta que sigue al login. Desde
   * aquí no hay CORS que fallar. Es lo mismo que hace `apps/lindo-web/server.mjs`.
   */
  private fun proxyHaapi(request: Request, output: BufferedOutputStream) {
    val target = HAAPI_UPSTREAM + request.path.removePrefix(HAAPI_PREFIX)
    try {
      val connection = (URL(target).openConnection() as HttpURLConnection).apply {
        requestMethod = request.method
        connectTimeout = 15000
        readTimeout = 15000
        request.headers.forEach { (name, value) ->
          if (name != "host" && name != "connection" && name != "content-length") {
            setRequestProperty(name, value)
          }
        }
        if (request.body.isNotEmpty()) {
          doOutput = true
          setFixedLengthStreamingMode(request.body.size)
        }
      }
      if (request.body.isNotEmpty()) {
        connection.outputStream.use { it.write(request.body) }
      }
      val status = connection.responseCode
      val body = (if (status >= 400) connection.errorStream else connection.inputStream)
        ?.use { it.readBytes() } ?: ByteArray(0)
      respond(output, status, connection.contentType ?: "application/json", body, mapOf("Cache-Control" to "no-store"))
    } catch (error: Exception) {
      respond(output, 502, "text/plain", "no se pudo alcanzar haapi: ${error.message}".toByteArray())
    }
  }

  private fun respond(
    output: BufferedOutputStream,
    status: Int,
    contentType: String,
    body: ByteArray,
    extra: Map<String, String> = emptyMap()
  ) {
    val headers = StringBuilder()
      .append("HTTP/1.1 ").append(status).append(if (status == 200) " OK" else " ERROR").append("\r\n")
      .append("Content-Type: ").append(contentType).append("\r\n")
      .append("Content-Length: ").append(body.size).append("\r\n")
      .append("Connection: close\r\n")
    extra.forEach { (name, value) -> headers.append(name).append(": ").append(value).append("\r\n") }
    headers.append("\r\n")

    output.write(headers.toString().toByteArray())
    output.write(body)
  }
}

class ShellAssetsModule : Module() {
  private var server: ShellServer? = null

  override fun definition() = ModuleDefinition {
    Name("ShellAssets")

    /**
     * Levanta el servidor y devuelve el origen que hay que cargar.
     *
     * El puerto lo elige el sistema para no chocar con nada, y por eso se
     * pregunta desde JS en vez de estar fijado en una constante.
     */
    AsyncFunction("start") {
      val existing = server
      if (existing != null) return@AsyncFunction "http://127.0.0.1:${existing.port}/"

      val context = appContext.reactContext?.applicationContext
        ?: throw CodedException("Sin contexto para leer los assets del APK")
      val created = ShellServer(context)
      created.start()
      server = created
      "http://127.0.0.1:${created.port}/"
    }

    OnDestroy {
      server?.stop()
      server = null
    }
  }
}

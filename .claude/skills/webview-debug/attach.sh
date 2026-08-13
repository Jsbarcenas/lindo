#!/usr/bin/env bash
#
# Engancha DevTools al WebView de lindo-mobile y deja el puerto listo.
#
#   .claude/skills/webview-debug/attach.sh [serie-del-dispositivo]
#
# El socket lleva el pid en el nombre, así que **esto hay que repetirlo cada vez
# que la app se reinicia**. Es el error más fácil de cometer: se relanza la app,
# se sigue mirando el puerto viejo y parece que no hay nada que depurar.
set -euo pipefail

ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
PACKAGE=com.lindo.mobile
PORT=9222

[[ -x "$ADB" ]] || { echo "no encuentro adb en $ADB" >&2; exit 2; }

DEVICE="${1:-$("$ADB" devices | awk '/\tdevice$/ {print $1; exit}')}"
[[ -n "$DEVICE" ]] || { echo "no hay ningún dispositivo conectado" >&2; exit 2; }
echo "dispositivo: $DEVICE ($("$ADB" -s "$DEVICE" shell getprop ro.product.model | tr -d '\r'))"

if ! "$ADB" -s "$DEVICE" shell pidof "$PACKAGE" >/dev/null 2>&1; then
  echo "la app no está corriendo; lánzala primero:" >&2
  echo "  $ADB -s $DEVICE shell am start -n $PACKAGE/.MainActivity" >&2
  exit 2
fi

SOCKET="$("$ADB" -s "$DEVICE" shell cat /proc/net/unix 2>/dev/null \
  | grep -o 'webview_devtools_remote_[0-9]*' | sort -u | head -1)"
if [[ -z "$SOCKET" ]]; then
  echo "el WebView no expone DevTools." >&2
  echo "En release hace falta la prop 'webviewDebuggingEnabled' en src/app/index.tsx." >&2
  exit 2
fi

"$ADB" -s "$DEVICE" forward --remove-all >/dev/null 2>&1 || true
"$ADB" -s "$DEVICE" forward "tcp:$PORT" "localabstract:$SOCKET" >/dev/null
echo "devtools:    http://localhost:$PORT/json  (socket $SOCKET)"

# El servidor que sirve el shell desde dentro del APK escucha en loopback con un
# puerto que elige el sistema. Sacarlo permite hablar con él -y con su proxy de
# haapi- sin pasar por el juego, que es como se separa "el proxy está roto" de
# "el cliente hace algo raro".
SHELL_PORT="$("$ADB" -s "$DEVICE" shell cat /proc/net/tcp6 2>/dev/null | python3 -c '
import sys
for line in sys.stdin.read().splitlines()[1:]:
    fields = line.split()
    if len(fields) < 4 or fields[3] != "0A":   # 0A = LISTEN
        continue
    address, port = fields[1].rsplit(":", 1)
    if address.endswith("0100007F"):           # 127.0.0.1
        print(int(port, 16))
' | head -1)"

if [[ -n "$SHELL_PORT" ]]; then
  "$ADB" -s "$DEVICE" forward "tcp:$SHELL_PORT" "tcp:$SHELL_PORT" >/dev/null
  echo "shell:       http://127.0.0.1:$SHELL_PORT/"
  echo "             curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:$SHELL_PORT/game/regex.json"
  echo "             curl -s -i 'http://127.0.0.1:$SHELL_PORT/haapi/json/Ankama/v5/Account/Account?' -H 'apikey: prueba'"
fi

echo
echo "grabar la red:  node .claude/skills/webview-debug/netwatch.mjs 120"

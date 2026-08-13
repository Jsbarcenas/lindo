#!/usr/bin/env bash
#
# Captures a ClientHello from Android's WebView, which is the stack the real
# Dofus Touch client runs on - not Chrome.
#
# The TLS comparison done from Chrome was inconclusive because the emulator's
# Chrome and this project's Electron were a major version apart, so the one
# difference found (three extra signature algorithms) could have been the
# version rather than the platform. The WebView on that emulator is the same
# Chromium line as Electron, which makes it the comparison that settles it.
#
# No WebView-capable app ships on a stock emulator image, so this builds the
# smallest possible one: a single activity that loads a URL. Everything it needs
# is already in the Android SDK.
#
#   tools/android-probe/webview-capture.sh [url]
#
# Start tls-probe.mjs first. 10.0.2.2 is how the emulator reaches the host.

set -euo pipefail

URL="${1:-https://10.0.2.2:8443/}"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG=lindo.probe

BUILD_TOOLS="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"
PLATFORM="$(ls -d "$SDK"/platforms/* | sort -V | tail -1)"
ANDROID_JAR="$PLATFORM/android.jar"

for tool in "$ADB" "$BUILD_TOOLS/aapt2" "$BUILD_TOOLS/d8" "$BUILD_TOOLS/apksigner" "$BUILD_TOOLS/zipalign"; do
  [[ -x "$tool" ]] || { echo "falta $tool" >&2; exit 2; }
done
command -v javac >/dev/null || { echo "falta javac" >&2; exit 2; }

"$ADB" get-state >/dev/null 2>&1 || { echo "no hay emulador conectado" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/src/lindo/probe"

cat > "$WORK/AndroidManifest.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="lindo.probe">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34" />
    <!-- the JS probe reports over plain http to the host; TLS captures do not
         need this, and Android 9+ blocks cleartext without it -->
    <application android:label="Lindo TLS probe" android:usesCleartextTraffic="true">
        <activity android:name=".Main" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
XML

cat > "$WORK/src/lindo/probe/Main.java" <<'JAVA'
package lindo.probe;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;

/** Loads one URL in a WebView so its TLS stack emits a ClientHello. */
public class Main extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        WebView view = new WebView(this);
        view.getSettings().setJavaScriptEnabled(true);
        setContentView(view);
        String url = getIntent().getStringExtra("url");
        view.loadUrl(url == null ? "https://10.0.2.2:8443/" : url);
    }
}
JAVA

echo "==> compilando"
javac -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" \
      -d "$WORK/classes" "$WORK/src/lindo/probe/Main.java" 2>/dev/null

"$BUILD_TOOLS/d8" --lib "$ANDROID_JAR" --output "$WORK" "$WORK/classes/lindo/probe/"*.class >/dev/null

echo "==> empaquetando"
"$BUILD_TOOLS/aapt2" link -o "$WORK/unsigned.apk" --manifest "$WORK/AndroidManifest.xml" \
    -I "$ANDROID_JAR" --min-sdk-version 24 --target-sdk-version 34 >/dev/null
(cd "$WORK" && zip -q unsigned.apk classes.dex)

KEYSTORE="$WORK/debug.keystore"
keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android \
        -alias probe -keyalg RSA -keysize 2048 -validity 365 \
        -dname "CN=lindo-probe" >/dev/null 2>&1

"$BUILD_TOOLS/zipalign" -f 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
"$BUILD_TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
    --out "$WORK/probe.apk" "$WORK/aligned.apk"

echo "==> instalando"
"$ADB" install -r -g "$WORK/probe.apk" >/dev/null

echo "==> lanzando contra $URL"
"$ADB" shell am start -n "$PKG/.Main" -e url "$URL" >/dev/null
sleep 4

echo
echo "Mira la salida de tls-probe.mjs: la captura nueva es la del WebView."
echo "El paquete queda instalado; para quitarlo:  $ADB uninstall $PKG"

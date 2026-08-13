#!/usr/bin/env bash
#
# Smoke test: boots the app and checks that the whole chain still works.
#
#   origin resolved -> game files updated -> dofus bundle executes -> mods initialize
#
# Run it after every step of a toolchain/Electron upgrade: it is the difference
# between "something broke" and "this step broke it".
#
# Usage:  scripts/smoke.sh [timeout-seconds]      (default 120, use ~240 for a cold start)
#
# Exit code 0 = all markers found. Anything else = the chain is broken.

set -uo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$PWD"
# pnpm keeps its store at the workspace root, and node_modules/electron here is
# only a symlink into it, so the running process shows a path under the root.
# Anchoring the pkill patterns on APP_DIR would match nothing and silently stop
# reaping strays - which looks exactly like a regression on the next run.
WORKSPACE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[[ -n "$WORKSPACE_ROOT" ]] || WORKSPACE_ROOT="$(cd ../.. && pwd)"
TIMEOUT="${1:-120}"

RENDERER_LOG="$HOME/Library/Logs/Lindo/renderer-logs-$(date +%F).log"
GAME_PATH="$HOME/Library/Application Support/Lindo/game"
if [[ "$(uname)" == "Linux" ]]; then
  RENDERER_LOG="$HOME/.config/Lindo/logs/renderer-logs-$(date +%F).log"
  GAME_PATH="$HOME/.config/Lindo/game"
fi

RUN_LOG="$(mktemp -t lindo-smoke)"
trap 'rm -f "$RUN_LOG"' EXIT

PKG=pnpm

# Electron outlives the package-manager process when it is killed, and keeps the
# single-instance lock. The next boot then exits silently and every marker looks
# like a regression. Always start from a clean slate.
# node_modules/electron is a symlink under pnpm's isolated layout, and the
# process shows the resolved .pnpm path, so match either shape. Both patterns
# stay anchored on this workspace: never touch the user's other Electron apps.
STRAY_PATTERNS=(
  "$WORKSPACE_ROOT/node_modules/.*electron.*/dist/Electron.app/Contents/MacOS/Electron"
  "$WORKSPACE_ROOT/node_modules/.*electron.*/dist/electron"
)

kill_strays() {
  for pattern in "${STRAY_PATTERNS[@]}"; do
    pkill -f "$pattern" 2>/dev/null
  done
  sleep 1

  # Verify no orphan Electron processes remain from this workspace.
  local survivors=0
  for pattern in "${STRAY_PATTERNS[@]}"; do
    survivors=$((survivors + $(pgrep -f "$pattern" 2>/dev/null | wc -l)))
  done
  if [[ $survivors -gt 0 ]]; then
    printf '  \033[31mFAIL\033[0m %s\n' "quedan $survivors procesos Electron de este workspace; retienen el lock de instancia única"
    printf '       revisa el patrón anclado en: %s\n' "$WORKSPACE_ROOT"
    exit 1
  fi
}

strip_ansi() { sed 's/\x1b\[[0-9;]*m//g'; }

echo "==> smoke: $PKG dev, timeout ${TIMEOUT}s"
kill_strays

# Only renderer lines produced by THIS run should count.
renderer_before=0
[[ -f "$RENDERER_LOG" ]] && renderer_before=$(wc -l < "$RENDERER_LOG")

timeout "$TIMEOUT" "$PKG" dev > "$RUN_LOG" 2>&1
kill_strays

renderer_new=""
if [[ -f "$RENDERER_LOG" ]]; then
  renderer_new=$(tail -n "+$((renderer_before + 1))" "$RENDERER_LOG")
fi

main_out=$(strip_ansi < "$RUN_LOG")

fail=0
check() { # <description> <haystack> <needle>
  if grep -qF -- "$3" <<<"$2"; then
    printf '  \033[32mOK\033[0m   %s\n' "$1"
  else
    printf '  \033[31mFAIL\033[0m %s  (no se encontró: %s)\n' "$1" "$3"
    fail=1
  fi
}
refute() { # <description> <haystack> <needle>
  if grep -qF -- "$3" <<<"$2"; then
    printf '  \033[31mFAIL\033[0m %s  (apareció: %s)\n' "$1" "$3"
    fail=1
  else
    printf '  \033[32mOK\033[0m   %s\n' "$1"
  fi
}

echo "--- proceso principal"
check  "origen de Dofus resuelto"      "$main_out" "using dofus origin"
check  "actualización del juego"       "$main_out" "GAME UPDATE FINISH"
refute "sin diálogo de error"          "$main_out" "Failed to update game"

echo "--- renderer"
if [[ -z "$renderer_new" ]]; then
  printf '  \033[31mFAIL\033[0m el renderer no escribió nada (¿arrancó Electron?)\n'
  fail=1
else
  check "el bundle de Dofus ejecuta"   "$renderer_new" "initDofus done"
  check "los mods se inicializan"      "$renderer_new" "init mod"
fi

# The updater diffs game-base by the version recorded in manifest.json, so
# editing one of those files without bumping its version means the change is
# never copied out and simply does not take effect. That failure is invisible:
# the app runs, the smoke markers pass, and only the behaviour is missing. It
# went unnoticed once already, for the whole platform-identity work.
echo "--- game-base desplegado"
if [[ ! -d "$GAME_PATH" ]]; then
  printf '  \033[31mFAIL\033[0m no existe %s\n' "$GAME_PATH"
  fail=1
else
  if game_base_out=$(node "$APP_DIR/scripts/check-game-base.mjs" "$GAME_PATH" 2>&1); then
    printf '  \033[32mOK\033[0m   game-base desplegado coincide con el fuente\n'
  else
    printf '  \033[31mFAIL\033[0m game-base desplegado no coincide con el fuente\n'
    sed 's/^/       /' <<<"$game_base_out"
    fail=1
  fi

  check "la identidad de plataforma está enganchada" \
        "$(cat "$GAME_PATH/index.html" 2>/dev/null)" "installLindoPlatform"
fi

if [[ $fail -eq 0 ]]; then
  printf '\n\033[32m==> smoke OK\033[0m — la cadena completa sigue viva\n'
else
  printf '\n\033[31m==> smoke FAILED\033[0m — log del proceso principal:\n'
  tail -40 "$RUN_LOG" | strip_ansi | sed 's/^/    /'
fi
exit $fail

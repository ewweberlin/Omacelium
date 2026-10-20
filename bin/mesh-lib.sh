#!/bin/sh
# Common POSIX helper for the Omacelium launcher scripts (plan §2 extra:
# shared resolve/JSON logic so mesh-node and mesh-preflight stay in step).
# Sourced, not executed. Everything echoes machine-readable values; no
# secrets, no network calls.
#
# State: ~/.local/state/omarchy/ewweberlin.omacelium (0700, per plan).
OMACELIUM_PLUGIN_ID="ewweberlin.omacelium"
OMACELIUM_STATE_DIR="${MESH_LLM_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/omarchy/$OMACELIUM_PLUGIN_ID}"
OMACELIUM_CONSOLE_PORT="${MESH_LLM_CONSOLE_PORT:-3131}"
OMACELIUM_API_PORT="${MESH_LLM_API_PORT:-9337}"
OMACELIUM_PIN="${MESH_LLM_PIN:-0.78}"

# Resolve the mesh-llm binary: explicit env, PATH, then known locations.
# Never installs anything (plan constraint: installs are explicit user
# actions; the launcher only points at what is on disk).
omacelium_resolve_bin() {
  if [ -n "${MESH_LLM_BIN:-}" ] && [ -x "$MESH_LLM_BIN" ]; then
    printf '%s\n' "$MESH_LLM_BIN"
    return 0
  fi
  if command -v mesh-llm >/dev/null 2>&1; then
    command -v mesh-llm
    return 0
  fi
  for candidate in \
    "$HOME/.local/bin/mesh-llm" \
    /usr/local/bin/mesh-llm \
    /usr/bin/mesh-llm; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

omacelium_version() {
  "$1" --version </dev/null 2>/dev/null | awk 'NR==1{print $2; exit}'
}

# Bind-test a loopback port. Prints "free" when we can listen on it.
# Anything unbindable is treated as in use; the caller separates ours vs
# foreign by asking the management API, not by port magic.
omacelium_bind_test() {
  python3 - "$1" <<'PYEOF'
import socket, sys
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(("127.0.0.1", int(sys.argv[1])))
    print("free")
except OSError:
    print("inuse")
finally:
    s.close()
PYEOF
}

# "ours" / "foreign" / "no" — does the console port answer like our node?
omacelium_console_owner() {
  body=$(curl -fsS --max-time 2 "http://127.0.0.1:$OMACELIUM_CONSOLE_PORT/api/status" 2>/dev/null | head -c 200000)
  if [ -z "$body" ]; then
    printf 'no\n'
    return
  fi
  case $body in
    \{*) printf 'ours\n' ;;
    *) printf 'foreign\n' ;;
  esac
}

# POSIX-safe single-line JSON emit with python3 (base Omarchy has it).
omacelium_emit() {
  python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin), sort_keys=True, separators=(",",":")))'
}

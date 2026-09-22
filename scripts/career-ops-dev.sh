#!/bin/bash
# Start (or restart) the career-ops web UI and open it.
#
# Restart rather than start: a stale dev server on :3000 serving an old bundle
# is the confusing failure -- the page loads, so nothing looks broken, and the
# change you just made is simply absent. Always reclaim the port first.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$ROOT/web"
PORT="${CAREER_OPS_PORT:-3000}"
LOG="$ROOT/.dev-server.log"

echo "career-ops — $ROOT"

# Reclaim the port. SIGTERM first so Next can clean up; SIGKILL only if it hangs.
PIDS="$(lsof -ti:"$PORT" 2>/dev/null || true)"
if [ -n "$PIDS" ]; then
  echo "stopping what is on :$PORT ($(echo "$PIDS" | tr '\n' ' '))"
  echo "$PIDS" | xargs kill 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.3
    [ -z "$(lsof -ti:"$PORT" 2>/dev/null || true)" ] && break
  done
  REMAIN="$(lsof -ti:"$PORT" 2>/dev/null || true)"
  [ -n "$REMAIN" ] && echo "$REMAIN" | xargs kill -9 2>/dev/null || true
fi

# A Turbopack cache that predates a dependency change serves stale CSS for
# newly-added classes -- the symptom is a style that silently does not apply.
if [ "${1:-}" = "--clean" ]; then
  echo "clearing .next"
  rm -rf "$WEB/.next"
fi

cd "$WEB" || { echo "no web/ directory at $WEB"; exit 1; }
[ -d node_modules ] || { echo "installing dependencies (first run)"; npm install; }

echo "starting on :$PORT — log: $LOG"
npm run dev >"$LOG" 2>&1 &
SERVER=$!

for i in $(seq 1 60); do
  if curl -sf -o /dev/null "http://localhost:$PORT/api/version" 2>/dev/null; then
    echo "up after ${i}s — opening"
    open "http://localhost:$PORT"
    echo
    echo "Leave this window open; closing it stops the server."
    echo "  tail -f $LOG    # to watch it"
    wait $SERVER
    exit 0
  fi
  kill -0 $SERVER 2>/dev/null || { echo "server exited early:"; tail -20 "$LOG"; exit 1; }
  sleep 1
done

echo "did not come up within 60s. Last lines:"
tail -20 "$LOG"
exit 1

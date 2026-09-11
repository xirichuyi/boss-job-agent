#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "请以非 root 浏览器用户运行，不允许关闭 Chromium sandbox" >&2
  exit 1
fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
desktop_config="$(node "${SCRIPT_DIR}/desktop-config.ts")"
mapfile -t desktop_values <<< "${desktop_config}"
readonly BROWSER_BINARY="${desktop_values[0]}"
readonly CDP_PORT="${desktop_values[1]}"
readonly VNC_PORT="${desktop_values[2]}"
readonly WEB_PORT="${desktop_values[3]}"

readonly DISPLAY_NUMBER="${DISPLAY_NUMBER:-99}"
readonly DISPLAY_VALUE=":${DISPLAY_NUMBER}"
readonly SCREEN_SIZE="${SCREEN_SIZE:-1440x900x24}"
readonly DATA_DIR="${BOSS_RPA_DATA_DIR:-/var/lib/boss-rpa}"
readonly PROFILE_DIR="${DATA_DIR}/profile"
readonly LOG_DIR="${DATA_DIR}/logs"
readonly NOVNC_WEB_ROOT="${NOVNC_WEB_ROOT:-/usr/share/novnc}"
readonly START_URL="${START_URL:-https://www.zhipin.com/}"

mkdir -p "${PROFILE_DIR}" "${LOG_DIR}"
chmod 700 "${DATA_DIR}" "${PROFILE_DIR}"

child_pids=()

cleanup() {
  local pid
  for pid in "${child_pids[@]:-}"; do
    kill "${pid}" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

Xvfb "${DISPLAY_VALUE}" -screen 0 "${SCREEN_SIZE}" -nolisten tcp -ac \
  >"${LOG_DIR}/xvfb.log" 2>&1 &
child_pids+=("$!")

for _ in {1..50}; do
  if DISPLAY="${DISPLAY_VALUE}" xdpyinfo >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

if ! DISPLAY="${DISPLAY_VALUE}" xdpyinfo >/dev/null 2>&1; then
  echo "Xvfb did not become ready" >&2
  exit 1
fi

DISPLAY="${DISPLAY_VALUE}" fluxbox >"${LOG_DIR}/fluxbox.log" 2>&1 &
child_pids+=("$!")

x11vnc -display "${DISPLAY_VALUE}" -forever -shared -localhost \
  -rfbport "${VNC_PORT}" -nopw \
  >"${LOG_DIR}/x11vnc.log" 2>&1 &
child_pids+=("$!")

websockify --web="${NOVNC_WEB_ROOT}" "127.0.0.1:${WEB_PORT}" "127.0.0.1:${VNC_PORT}" \
  >"${LOG_DIR}/websockify.log" 2>&1 &
child_pids+=("$!")

export DISPLAY="${DISPLAY_VALUE}"
"${BROWSER_BINARY}" \
  --user-data-dir="${PROFILE_DIR}" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="${CDP_PORT}" \
  --no-first-run \
  --disable-default-apps \
  --disable-dev-shm-usage \
  --start-maximized \
  "${START_URL}" \
  >"${LOG_DIR}/chromium.log" 2>&1 &
browser_pid="$!"
child_pids+=("${browser_pid}")

wait "${browser_pid}"

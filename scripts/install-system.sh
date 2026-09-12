#!/usr/bin/env bash
# System prerequisites only. Never logs in or grants permission to contact HR.
set -Eeuo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
INSTALL_USER=bossagent
TOOLS_DIR=/opt/boss-job-agent-tools
STATE_DIR=/var/lib/boss-job-agent-bootstrap
CODEX_VERSION=latest
PLAN=false
REUSE_USER=false
while (($#)); do
  case "$1" in
    --plan) PLAN=true; shift ;;
    --reuse-user) REUSE_USER=true; shift ;;
    --user) INSTALL_USER="${2:?missing user}"; shift 2 ;;
    --codex-version) CODEX_VERSION="${2:?missing version}"; shift 2 ;;
    --help) echo 'sudo bash scripts/install-system.sh [--plan] [--user bossagent] [--reuse-user] [--codex-version VERSION]'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ "$INSTALL_USER" =~ ^[a-z_][a-z0-9_-]{0,30}$ && "$INSTALL_USER" != root ]] || { echo 'Invalid non-root user'; exit 2; }
[[ "$CODEX_VERSION" =~ ^(latest|[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?)$ ]] || { echo 'Invalid Codex version'; exit 2; }
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
[[ "$SOURCE_DIR" =~ ^/opt/[a-zA-Z0-9_./-]+$ ]] || { echo '请将项目放在 /opt 下，不要放在 /root 或带空格的目录'; exit 2; }
# shellcheck source=/dev/null
source /etc/os-release
ARCH="$(dpkg --print-architecture)"
case "$ID:$VERSION_ID:$ARCH" in
  debian:12:amd64|debian:13:amd64|debian:12:arm64|debian:13:arm64|ubuntu:22.04:amd64|ubuntu:24.04:amd64) ;;
  *) echo "暂支持 Debian 12/13 amd64/arm64、Ubuntu 22.04/24.04 amd64；当前 $ID $VERSION_ID $ARCH"; exit 2 ;;
esac
if $PLAN; then
  echo "代码：$SOURCE_DIR；运行用户：$INSTALL_USER"
  echo '安装缺失的系统依赖、Node 24、Codex、Chrome/Chromium、Xvfb/noVNC、PDF/Word转换工具。'
  echo '创建私密工作区和命令入口；安装服务，仅启动桌面。不会登录、修改防火墙或启用发送。'
  exit 0
fi
[[ $EUID == 0 ]] || { echo '请用 sudo bash scripts/install-system.sh 执行'; exit 2; }
[[ -d /run/systemd/system ]] || { echo '需要运行 systemd 的 Linux 主机；普通容器请使用手动安装'; exit 2; }
exec 9>/run/lock/boss-job-agent-install.lock
flock -n 9 || { echo '另一个安装器正在运行'; exit 1; }
STAGE=preflight
trap 'echo "安装失败于：$STAGE。修复报错后重跑同一命令；不清空已有资料。" >&2' ERR
if [[ -f "$STATE_DIR/owner" ]]; then
  [[ "$(<"$STATE_DIR/owner")" == "$INSTALL_USER:$SOURCE_DIR" ]] || { echo '已有安装绑定其他用户/源码目录，拒绝接管'; exit 1; }
  if systemctl is-active --quiet job-agent-scheduler.service; then
    echo '求职服务正在运行；先暂停、等待在途任务结束并停止服务，再安装依赖'; exit 1
  fi
else
  for unit in job-agent-desktop.service job-agent-scheduler.service; do
    [[ "$(systemctl show "$unit" -p LoadState --value)" == not-found ]] || { echo "已有 $unit，拒绝覆盖现有部署"; exit 1; }
  done
  [[ ! -e /usr/local/bin/boss-agent && ! -e "$TOOLS_DIR" && ! -e "$STATE_DIR" ]] || { echo '安装路径已占用，拒绝覆盖'; exit 1; }
  if id "$INSTALL_USER" >/dev/null 2>&1 && ! $REUSE_USER; then
    echo '运行用户已存在；确认复用本人用户后加 --reuse-user'; exit 1
  fi
  install -d -m 755 "$STATE_DIR"
  printf '%s\n' "$INSTALL_USER:$SOURCE_DIR" > "$STATE_DIR/owner"
fi
step() { STAGE="$1"; printf '\n[%s] %s\n' "$1" "$2"; }
step 1 '安装系统依赖（不执行全系统升级）'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git xz-utils util-linux \
  xvfb fluxbox x11vnc novnc websockify x11-utils fonts-noto-cjk \
  poppler-utils pandoc antiword iproute2
step 2 '准备非 root 运行用户'
if ! id "$INSTALL_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$INSTALL_USER"
fi
[[ "$(id -u "$INSTALL_USER")" != 0 ]] || { echo '不能使用 UID 0'; exit 1; }
USER_HOME="$(getent passwd "$INSTALL_USER" | cut -d: -f6)"
WORKSPACE="$USER_HOME/boss-install"
runuser -u "$INSTALL_USER" -- test -r "$SOURCE_DIR/scripts/install-agent.ts" || { echo '运行用户无法读取项目，请检查 /opt 目录权限'; exit 1; }
install -d -m 755 "$TOOLS_DIR"
step 3 '准备 Node.js 24（独立安装，不替换系统 Node）'
NODE_BINARY="$(command -v node || true)"
if [[ -z "$NODE_BINARY" ]] || ! runuser -u "$INSTALL_USER" -- "$NODE_BINARY" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' 2>/dev/null; then
  NODE_BINARY="$TOOLS_DIR/node/bin/node"
  if [[ ! -x "$NODE_BINARY" ]]; then
    download="$(mktemp -d "$STATE_DIR/node-download.XXXXXX")"
    node_arch=x64; [[ "$ARCH" == arm64 ]] && node_arch=arm64
    curl --fail --location --retry 3 --connect-timeout 15 --max-time 600 \
      https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$download/SHASUMS256.txt"
    archive="$(awk -v arch="$node_arch" '$2 ~ ("^node-v24\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") {print $2}' "$download/SHASUMS256.txt")"
    [[ "$archive" =~ ^node-v24\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.xz$ ]] || { echo '无法确定 Node 安装包'; exit 1; }
    curl --fail --location --retry 3 --connect-timeout 15 --max-time 600 \
      "https://nodejs.org/dist/latest-v24.x/$archive" -o "$download/$archive"
    (cd "$download"; awk -v file="$archive" '$2 == file' SHASUMS256.txt | sha256sum --check --strict)
    install -d "$download/unpacked"
    tar -xJf "$download/$archive" --strip-components=1 -C "$download/unpacked"
    [[ ! -e "$TOOLS_DIR/node" ]] || { echo 'Node 目录不完整，请人工检查'; exit 1; }
    mv "$download/unpacked" "$TOOLS_DIR/node"
  fi
fi
export PATH="$(dirname "$NODE_BINARY"):$TOOLS_DIR/codex/bin:$PATH"
step 4 '准备 Codex CLI（不复制登录凭据）'
CODEX_BINARY="$(command -v codex || true)"
if [[ -z "$CODEX_BINARY" ]] || ! runuser -u "$INSTALL_USER" -- env PATH="$PATH" "$CODEX_BINARY" --version >/dev/null 2>&1; then
  npm install --global --prefix "$TOOLS_DIR/codex" --ignore-scripts --no-audit --no-fund "@openai/codex@$CODEX_VERSION"
  CODEX_BINARY="$TOOLS_DIR/codex/bin/codex"
fi
runuser -u "$INSTALL_USER" -- env PATH="$PATH" "$CODEX_BINARY" --version
step 5 '准备浏览器'
BROWSER_BINARY=''
for binary in google-chrome-stable google-chrome chromium; do
  candidate="$(command -v "$binary" || true)"
  if [[ -n "$candidate" ]] && runuser -u "$INSTALL_USER" -- "$candidate" --version >/dev/null 2>&1; then
    BROWSER_BINARY="$candidate"; break
  fi
done
if [[ -z "$BROWSER_BINARY" ]]; then
  if [[ "$ID" == debian ]]; then
    apt-get install -y --no-install-recommends chromium chromium-sandbox
    BROWSER_BINARY=/usr/bin/chromium
  else
    chrome_download="$(mktemp -d "$STATE_DIR/chrome-download.XXXXXX")"
    curl --fail --location --retry 3 --connect-timeout 15 --max-time 600 \
      https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o "$chrome_download/chrome.deb"
    apt-get install -y --no-install-recommends "$chrome_download/chrome.deb"
    BROWSER_BINARY=/usr/bin/google-chrome-stable
  fi
fi
step 6 '安装项目依赖并检查'
cd "$SOURCE_DIR"
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
step 7 '创建工作区、桌面配置和服务模板'
as_user() { runuser -u "$INSTALL_USER" -- env -u CODEX_HOME -u BOSS_CONFIG_DIR -u BOSS_DATA_DIR -u BOSS_DESKTOP_CONFIG -u BOSS_RPA_DATA_DIR PATH="$PATH" "$@"; }
as_user "$NODE_BINARY" scripts/bootstrap-workspace.ts "$WORKSPACE" "$BROWSER_BINARY" "$CODEX_BINARY"
as_user "$NODE_BINARY" scripts/install-agent.ts services --workspace "$WORKSPACE"
step 8 '安装服务（不启动求职调度器）'
if ! systemctl is-active --quiet job-agent-desktop.service; then
  as_user "$NODE_BINARY" scripts/bootstrap-workspace.ts "$WORKSPACE" --ports
fi
for unit in job-agent-desktop.service job-agent-scheduler.service; do
  target="/etc/systemd/system/$unit"
  if [[ -e "$target" ]]; then
    cmp --silent "$WORKSPACE/units/$unit" "$target" || { echo "已有 $unit 与模板不同，拒绝覆盖"; exit 1; }
  else
    install -m 644 "$WORKSPACE/units/$unit" "$target"
  fi
done
"$NODE_BINARY" scripts/bootstrap-launcher.ts "$INSTALL_USER" "$WORKSPACE" "$NODE_BINARY" "$PATH"
systemctl daemon-reload
systemctl enable --now job-agent-desktop.service
step 9 '核验桌面可访问'
as_user "$NODE_BINARY" scripts/bootstrap-workspace.ts "$WORKSPACE" --health
printf '\n必需环境已安装，桌面已启动；求职尚未启用。\n'
echo '下一步：sudo boss-agent configure → sudo boss-agent profile --paste → sudo boss-agent initialize → sudo boss-agent login'
echo '查看状态：sudo boss-agent status'
echo '查看扫码入口：sudo boss-agent access --ssh 你现有的SSH用户@服务器地址'
echo '扫码、附件核对和真实验收完成后，再授权 activate 并由管理员启动 job-agent-scheduler.service。'

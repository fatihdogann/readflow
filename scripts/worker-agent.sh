#!/bin/bash
# Readflow remote worker'ı macOS launchd servisi olarak kurar/kaldırır.
#
#   pnpm worker:install     açılışta başlar, çökerse geri gelir
#   pnpm worker:uninstall   servisi durdurur ve kaldırır
#   pnpm worker:logs        canlı log
#
# Ortam değişkenleri ~/.readflow/worker.env dosyasından okunur (repo dışında,
# Git'e girmez). remote.ts zaten loadLocalEnv() çağırdığı için .env.local da
# okunur; worker.env ise makineye özgü değerler için ayrı ve kalıcı yerdir.
set -euo pipefail

LABEL="com.readflow.worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DATA_DIR="${READFLOW_DATA_DIR:-$HOME/.readflow}"
LOG_DIR="$DATA_DIR/logs"
ENV_FILE="$DATA_DIR/worker.env"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  echo "kullanım: $0 {install|uninstall|logs|status}" >&2
  exit 1
}

require_env_file() {
  if [ -f "$ENV_FILE" ]; then
    return
  fi
  mkdir -p "$DATA_DIR"
  cat > "$ENV_FILE" <<'TEMPLATE'
# Readflow remote worker ayarları — bu dosya Git'e girmez.
# Coolify'daki uygulamanın adresi:
READFLOW_SERVER_URL=https://readflow.ornek.com
# Sunucudaki WORKER_ENROLLMENT_SECRET ile birebir aynı olmalı:
READFLOW_WORKER_TOKEN=
# Yoklama aralığı (ms) — pil dostu için artırılabilir:
READFLOW_POLL_MS=3000
TEMPLATE
  chmod 600 "$ENV_FILE"
  echo "→ $ENV_FILE oluşturuldu. Doldurup komutu tekrar çalıştır." >&2
  exit 1
}

install_agent() {
  require_env_file
  # Şablon doldurulmadan servis kurulmasın: sessizce 401 döngüsüne girmesin.
  if ! grep -qE '^READFLOW_WORKER_TOKEN=.+' "$ENV_FILE"; then
    echo "hata: $ENV_FILE içinde READFLOW_WORKER_TOKEN boş" >&2
    exit 1
  fi

  local node_bin pnpm_bin
  node_bin="$(command -v node)" || { echo "hata: node PATH'te yok" >&2; exit 1; }
  pnpm_bin="$(command -v pnpm)" || { echo "hata: pnpm PATH'te yok" >&2; exit 1; }

  mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$pnpm_bin</string>
    <string>--dir</string>
    <string>$REPO_DIR</string>
    <string>worker:remote</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$node_bin"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>READFLOW_ENV_FILE</key><string>$ENV_FILE</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
    <key>NetworkState</key><true/>
  </dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/worker.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/worker.log</string>
</dict>
</plist>
PLIST_EOF

  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$PLIST"
  launchctl kickstart -k "gui/$UID/$LABEL"
  echo "✓ worker servisi kuruldu — Mac açılışında kendiliğinden başlar"
  echo "  log: $LOG_DIR/worker.log"
}

uninstall_agent() {
  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ worker servisi kaldırıldı (ayar dosyası ve loglar duruyor)"
}

case "${1:-}" in
  install) install_agent ;;
  uninstall) uninstall_agent ;;
  logs) tail -f "$LOG_DIR/worker.log" ;;
  status) launchctl print "gui/$UID/$LABEL" 2>/dev/null | head -20 || echo "servis kurulu değil" ;;
  *) usage ;;
esac

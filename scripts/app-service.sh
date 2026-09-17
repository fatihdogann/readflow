#!/bin/bash
# Readflow'u (production web + yerel worker) macOS launchd servisi olarak kurar/kaldırır.
#
#   pnpm app:install     açılışta başlar, çökerse geri gelir
#   pnpm app:uninstall   servisi durdurur ve kaldırır
#   pnpm app:logs        canlı log
#   pnpm app:status      servis durumu
#
# Ortam değişkenleri ~/.readflow/app.env dosyasından okunur (repo dışında,
# Git'e girmez) ve hem Next hem worker sürecine aktarılır. Web yalnız
# 127.0.0.1'i dinler; uzak erişim Tailscale Serve ile sağlanır.
set -euo pipefail

LABEL="com.readflow.app"
LEGACY_LABEL="com.readflow.worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DATA_DIR="${READFLOW_DATA_DIR:-$HOME/.readflow}"
LOG_DIR="$DATA_DIR/logs"
ENV_FILE="$DATA_DIR/app.env"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  echo "kullanım: $0 {install|uninstall|logs|status}" >&2
  exit 1
}

require_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    mkdir -p "$DATA_DIR"
    chmod 700 "$DATA_DIR"
    cat > "$ENV_FILE" <<'TEMPLATE'
# Readflow uygulama ayarları — bu dosya Git'e girmez, shell ile okunur:
# özel karakter içeren değerleri tek tırnak içine al.
READFLOW_AUTH_USERNAME=
READFLOW_AUTH_PASSWORD=
# Üret: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
READFLOW_SESSION_SECRET=
# Uzak worker değişkenleri (READFLOW_SERVER_URL / READFLOW_WORKER_TOKEN) BURAYA EKLENMEZ.
TEMPLATE
    chmod 600 "$ENV_FILE"
    echo "→ $ENV_FILE oluşturuldu. Doldurup komutu tekrar çalıştır." >&2
    exit 1
  fi
  local key
  for key in READFLOW_AUTH_USERNAME READFLOW_AUTH_PASSWORD READFLOW_SESSION_SECRET; do
    if ! grep -qE "^$key=.+" "$ENV_FILE"; then
      echo "hata: $ENV_FILE içinde $key boş" >&2
      exit 1
    fi
  done
  if grep -qE '^READFLOW_(SERVER_URL|WORKER_TOKEN)=' "$ENV_FILE"; then
    echo "hata: $ENV_FILE uzak worker değişkeni içeriyor; kaldır" >&2
    exit 1
  fi
}

install_agent() {
  require_env_file
  if [ ! -f "$REPO_DIR/.next/BUILD_ID" ]; then
    echo "hata: production build yok — önce: pnpm build" >&2
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
    <string>/bin/sh</string>
    <string>-c</string>
    <string>set -a; . "\$READFLOW_ENV_FILE"; set +a; exec "$pnpm_bin" --dir "$REPO_DIR" app:start</string>
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
  </dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/app.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/app.log</string>
</dict>
</plist>
PLIST_EOF

  # Eski uzak worker servisi aynı veri dizinine yazmasın.
  launchctl bootout "gui/$UID/$LEGACY_LABEL" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$LEGACY_LABEL.plist"

  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$PLIST"
  launchctl kickstart -k "gui/$UID/$LABEL"
  echo "✓ Readflow servisi kuruldu — http://127.0.0.1:3000"
  echo "  log: $LOG_DIR/app.log"
}

uninstall_agent() {
  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ Readflow servisi kaldırıldı (ayar dosyası ve loglar duruyor)"
}

case "${1:-}" in
  install) install_agent ;;
  uninstall) uninstall_agent ;;
  logs) tail -f "$LOG_DIR/app.log" ;;
  status) launchctl print "gui/$UID/$LABEL" 2>/dev/null | head -20 || echo "servis kurulu değil" ;;
  *) usage ;;
esac

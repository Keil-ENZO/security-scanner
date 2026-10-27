#!/usr/bin/env bash
# Scheduled audit, for cron, a systemd timer or an agent.
# Starts a batch, waits for it, then prints the summary on stdout.
# The token is read from a 0600 file, never passed on the command line:
#   printf 'Authorization: Bearer %s\n' "$NUXT_AUTOMATION_TOKEN" > ~/.config/security-scanner.header
#   chmod 600 ~/.config/security-scanner.header
# NOTIFY=1 also sends the summary to the channels configured on the scanner.
set -euo pipefail

URL=${SCANNER_URL:-http://127.0.0.1:3003}
HEADER=${SCANNER_HEADER:-$HOME/.config/security-scanner.header}
NOTIFY=${NOTIFY:-0}
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT

batch=$(curl -fsS -X POST -H @"$HEADER" "$URL/api/automation/scan")

# A full audit takes 10 to 15 min per site. Gives up after 3 h
for _ in $(seq 1 360); do
  code=$(curl -sS -o "$OUT" -w '%{http_code}' -H @"$HEADER" "$URL/api/automation/report?batch=$batch&notify=$NOTIFY")
  case "$code" in
    200) cat "$OUT"; exit 0 ;;
    202) sleep 30 ;;
    *) echo "🛡️ Scheduled audit: HTTP error $code"; exit 1 ;;
  esac
done
echo "🛡️ Scheduled audit: not finished after 3 h, see the interface"
exit 1

#!/usr/bin/env bash
# Cron Hermes du jeudi, mode --no-agent : la sortie part telle quelle sur Telegram.
# Le jeton est lu dans un fichier 0600, jamais passé sur la ligne de commande.
set -euo pipefail

URL=http://127.0.0.1:3003
HEADER="$HOME/.hermes/security-scanner.header"
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT

batch=$(curl -fsS -X POST -H @"$HEADER" "$URL/api/hermes/weekly")

# Un audit complet prend de 10 à 15 min par site. Plafond : 3 h
for _ in $(seq 1 360); do
  code=$(curl -sS -o "$OUT" -w '%{http_code}' -H @"$HEADER" "$URL/api/hermes/report?batch=$batch")
  case "$code" in
    200) cat "$OUT"; exit 0 ;;
    202) sleep 30 ;;
    *) echo "🛡️ Audit du jeudi : erreur HTTP $code"; exit 1 ;;
  esac
done
echo "🛡️ Audit du jeudi : pas fini au bout de 3 h, voir l'interface"
exit 1

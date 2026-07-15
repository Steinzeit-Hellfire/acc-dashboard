#!/bin/bash
# ============================================================
#  ACC Dashboard - Auto-Deploy Script
#  Holt automatisch die neueste Version von GitHub und startet neu
#  NUR wenn sich wirklich etwas geändert hat.
#
#  Einrichtung (einmalig):
#    chmod +x ~/acc-dashboard/scripts/auto-deploy.sh
#    crontab -e
#    */5 * * * * /home/detrees95/acc-dashboard/scripts/auto-deploy.sh
# ============================================================

REPO_DIR="/home/detrees95/acc-dashboard"
LOG_FILE="$REPO_DIR/deploy.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

cd "$REPO_DIR" || exit 1

# Aktuellen Commit-Hash merken
BEFORE=$(git rev-parse HEAD 2>/dev/null)

# Neueste Änderungen holen (ohne lokale Änderungen zu überschreiben, außer bewusst)
git fetch origin main --quiet

AFTER=$(git rev-parse origin/main 2>/dev/null)

if [ "$BEFORE" == "$AFTER" ]; then
    # Keine Änderungen - nichts zu tun
    exit 0
fi

echo "[$TIMESTAMP] Neue Version gefunden: $BEFORE -> $AFTER" >> "$LOG_FILE"

# Lokale Änderungen verwerfen und auf neuesten Stand bringen
git reset --hard origin/main --quiet
git clean -fd --quiet

echo "[$TIMESTAMP] Code aktualisiert" >> "$LOG_FILE"

# Python-Abhängigkeiten aktualisieren (falls requirements.txt sich geändert hat)
if [ -f "$REPO_DIR/venv/bin/pip" ]; then
    "$REPO_DIR/venv/bin/pip" install -r backend/requirements.txt -q >> "$LOG_FILE" 2>&1
fi

# Backend neu starten
sudo systemctl restart acc-backend

echo "[$TIMESTAMP] Backend neugestartet - Deploy fertig ✅" >> "$LOG_FILE"

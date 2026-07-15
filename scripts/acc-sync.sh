#!/bin/bash
# ACC Dashboard Sync Script - DYNAMISCH
# Holt automatisch ALLE Server-Ordner von accweb (keine hardcoded IDs mehr)

REMOTE_USER="HNeuzeit2026"
REMOTE_HOST="152.53.47.94"
REMOTE_BASE="/D:/Staff/ACCWEB/config"
LOCAL_PATH="/home/detrees95/acc-results"
LOCAL_CFG="/home/detrees95/acc-configs"
API_RELOAD_URL="http://localhost:8000/api/reload"
LOG_FILE="/home/detrees95/acc-dashboard/sync.log"
SSH_KEY="/home/detrees95/.ssh/acc_sync_key"
SSH_PORT="22"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

mkdir -p "$LOCAL_PATH" "$LOCAL_CFG"

SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes"

# ── Alle Server-Ordner dynamisch ermitteln ──
# Listet alle Unterordner in ACCWEB/config (jeder = ein Server)
FOLDERS=$(ssh -i "$SSH_KEY" -p "$SSH_PORT" $SSH_OPTS \
    "${REMOTE_USER}@${REMOTE_HOST}" \
    "powershell -Command \"Get-ChildItem -Path 'D:/Staff/ACCWEB/config' -Directory | Select-Object -ExpandProperty Name\"" 2>>"$LOG_FILE" | tr -d '\r')

if [ -z "$FOLDERS" ]; then
    echo "[$TIMESTAMP] WARNUNG: Keine Ordner gefunden, nutze Fallback" >> "$LOG_FILE"
    FOLDERS="1771270093 1779227984 1779414162 1780088048"
fi

echo "[$TIMESTAMP] Server-Ordner: $FOLDERS" >> "$LOG_FILE"

# ── Für jeden Server: Results + Config-Dateien holen ──
for FOLDER in $FOLDERS; do
    # Results
    scp -r -p -q -i "$SSH_KEY" -P "$SSH_PORT" $SSH_OPTS \
        "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_BASE}/${FOLDER}/results/." \
        "${LOCAL_PATH}/" >> "$LOG_FILE" 2>&1

    # Config-Dateien (Name, Port, Passwort, Strecke)
    for CFG in settings.json configuration.json event.json; do
        scp -p -q -i "$SSH_KEY" -P "$SSH_PORT" $SSH_OPTS \
            "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_BASE}/${FOLDER}/${CFG}" \
            "${LOCAL_CFG}/${FOLDER}_${CFG}" >> "$LOG_FILE" 2>&1
    done
done

# ── UTF-16 zu UTF-8 konvertieren ──
python3 -c "
import glob
for f in glob.glob('${LOCAL_PATH}/*.json') + glob.glob('${LOCAL_CFG}/*.json'):
    try:
        with open(f, 'rb') as rb:
            raw = rb.read(2)
        if raw == b'{\x00':
            with open(f, 'r', encoding='utf-16-le') as r:
                content = r.read()
            with open(f, 'w', encoding='utf-8') as w:
                w.write(content)
    except:
        pass
"

# ── Dashboard neu laden ──
curl -s -X POST "$API_RELOAD_URL" -o /dev/null
echo "[$TIMESTAMP] Sync + Reload OK" >> "$LOG_FILE"

# 🏎️ ACC Dashboard

> Assetto Corsa Competizione Rennzeiten-Dashboard für den Raspberry Pi 5
> Entwickelt von der Steinzeit-Hellfire Community

---

## 📸 Features

- 🏆 Bestzeiten & Leaderboard pro Strecke und Fahrzeugklasse
- 📊 Fahrer-Statistiken mit ELO-Rating
- 🔴 Live-Timing während aktiver Sessions
- 🏅 Meisterschaft mit F1-Punktesystem
- 👥 Team-Modus
- 🎮 ACC Connector – direkt zum Server verbinden
- ✍️ Manuelle Zeit-Eintragung (für verlorene Sessions)
- 📱 PWA – als App installierbar
- 🎨 iOS 26 Liquid Glass Design
- 📊 Matomo-Tracking (optional)

---

## 🚀 Installation

```bash
cd ~
git clone https://github.com/Steinzeit-Hellfire/acc-dashboard.git
cd acc-dashboard
chmod +x scripts/setup.sh
bash scripts/setup.sh
```

Details siehe [docs/INSTALL.md](docs/INSTALL.md)

---

## 🔄 Automatische Updates (Auto-Deploy)

Damit das Dashboard sich **automatisch** aktualisiert sobald neuer Code auf GitHub ist:

```bash
chmod +x ~/acc-dashboard/scripts/auto-deploy.sh
crontab -e
```

Diese Zeile hinzufügen (prüft alle 5 Minuten auf Updates):
```
*/5 * * * * /home/detrees95/acc-dashboard/scripts/auto-deploy.sh
```

**Wichtig:** Damit `sudo systemctl restart` ohne Passwort funktioniert:
```bash
sudo visudo
```
Diese Zeile am Ende hinzufügen:
```
detrees95 ALL=(ALL) NOPASSWD: /bin/systemctl restart acc-backend
```

Ab dann: Code wird committet → gepusht → **der Pi holt sich die Änderung automatisch** innerhalb von 5 Minuten, kein manueller Schritt mehr nötig.

---

## 📁 Struktur

```
acc-dashboard/
├── backend/main.py           # FastAPI Server
├── frontend/                 # HTML/CSS/JS
├── nginx/acc-dashboard.conf  # Webserver Config
├── scripts/
│   ├── setup.sh              # Einmalige Installation
│   ├── acc-sync.sh           # Sync von ACC Server
│   ├── auto-deploy.sh        # Auto-Update vom GitHub
│   └── zeit-eintragen.py     # CLI für manuelle Zeiten
└── docs/INSTALL.md
```

---

*Steinzeit-Hellfire Organization · Deutschland*

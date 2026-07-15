# Installationsanleitung – für absolute Anfänger

## 1. Repository holen
```bash
cd ~
git clone https://github.com/Steinzeit-Hellfire/acc-dashboard.git
cd acc-dashboard
```

## 2. Setup ausführen
```bash
chmod +x scripts/setup.sh
bash scripts/setup.sh
```

## 3. SSH Key auf Windows-Server eintragen
Der angezeigte Key kommt in: `C:\Users\<user>\.ssh\authorized_keys`

## 4. Sync konfigurieren
```bash
nano scripts/acc-sync.sh
```
`REMOTE_USER` und `REMOTE_HOST` anpassen.

## 5. Crontab für automatischen Sync + Deploy
```bash
crontab -e
```
```
*/2 * * * * /home/detrees95/acc-dashboard/scripts/acc-sync.sh
*/5 * * * * /home/detrees95/acc-dashboard/scripts/auto-deploy.sh
```

## 6. Dashboard aufrufen
```
http://<pi-ip>:8080
```

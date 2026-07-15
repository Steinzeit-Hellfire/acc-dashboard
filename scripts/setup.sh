#!/bin/bash
set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

DASHBOARD_USER="detrees95"
DASHBOARD_DIR="/home/$DASHBOARD_USER/acc-dashboard"
RESULTS_DIR="/home/$DASHBOARD_USER/acc-results"
VENV_DIR="$DASHBOARD_DIR/venv"

echo -e "${CYAN}=== ACC Dashboard Setup ===${NC}"

echo -e "${YELLOW}[1/6] System-Pakete...${NC}"
sudo apt-get update -qq
sudo apt-get install -y python3 python3-pip python3-venv nginx git curl -qq

echo -e "${YELLOW}[2/6] Ordner...${NC}"
mkdir -p "$RESULTS_DIR"

echo -e "${YELLOW}[3/6] Python-Umgebung...${NC}"
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"
pip install --upgrade pip -q
pip install -r "$DASHBOARD_DIR/backend/requirements.txt" -q

echo -e "${YELLOW}[4/6] Nginx...${NC}"
sudo cp "$DASHBOARD_DIR/nginx/acc-dashboard.conf" /etc/nginx/sites-available/acc-dashboard
sudo ln -sf /etc/nginx/sites-available/acc-dashboard /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx && sudo systemctl enable nginx

echo -e "${YELLOW}[5/6] Systemdienst...${NC}"
sudo cp "$DASHBOARD_DIR/scripts/acc-backend.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable acc-backend
sudo systemctl start acc-backend

echo -e "${YELLOW}[6/6] SSH Key für Sync...${NC}"
if [ ! -f "/home/$DASHBOARD_USER/.ssh/acc_sync_key" ]; then
    ssh-keygen -t ed25519 -f "/home/$DASHBOARD_USER/.ssh/acc_sync_key" -N "" -q
    echo -e "${CYAN}Public Key (auf Windows Server eintragen):${NC}"
    cat "/home/$DASHBOARD_USER/.ssh/acc_sync_key.pub"
fi

echo -e "${GREEN}=== Fertig! Dashboard: http://$(hostname -I | awk '{print $1}'):8080 ===${NC}"

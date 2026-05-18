#!/usr/bin/env bash
# Blindspot production setup guide.
# Run step by step as root or with sudo where indicated.
# This script PRINTS instructions — it does not run privileged commands automatically.
set -euo pipefail

BLINDSPOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOME/logs"

echo "======================================================"
echo " Blindspot — Production Setup"
echo " Working directory: $BLINDSPOT_DIR"
echo "======================================================"
echo ""

echo "--- Step 1: Create log directory ---"
mkdir -p "$LOG_DIR"
echo "Log directory: $LOG_DIR (created)"
echo ""

echo "--- Step 2: Install pm2 (if not present) ---"
if ! command -v pm2 &>/dev/null; then
  echo "  Run: sudo npm install -g pm2"
  echo "  (or: npm install -g pm2 if npm global is user-writeable)"
else
  echo "  pm2 already installed: $(pm2 --version)"
fi
echo ""

echo "--- Step 3: Verify .env file ---"
if [ ! -f "$BLINDSPOT_DIR/.env" ]; then
  echo "  ERROR: $BLINDSPOT_DIR/.env not found. Create it from .env.example before continuing."
  exit 1
else
  echo "  .env found ✓"
fi
echo ""

echo "--- Step 4: Start processes with pm2 ---"
echo "  cd $BLINDSPOT_DIR"
echo "  pm2 start ecosystem.config.cjs"
echo "  pm2 save"
echo ""

echo "--- Step 5: Enable pm2 on boot ---"
echo "  pm2 startup"
echo "  (copy and run the printed command with sudo)"
echo ""

echo "--- Step 6: Configure Nginx ---"
if command -v nginx &>/dev/null; then
  echo "  nginx found: $(nginx -v 2>&1)"
  echo ""
  echo "  Run:"
  echo "    sudo cp $BLINDSPOT_DIR/nginx/blindspot.conf /etc/nginx/sites-available/blindspot"
  echo "    sudo ln -sf /etc/nginx/sites-available/blindspot /etc/nginx/sites-enabled/blindspot"
  echo "    sudo nginx -t && sudo systemctl reload nginx"
else
  echo "  nginx not found. Install with:"
  echo "    sudo apt update && sudo apt install nginx"
  echo "  Then copy config and reload (see above)."
fi
echo ""

echo "--- Step 7: SSL certificate ---"
echo "  Option A — Let's Encrypt (production domain):"
echo "    sudo apt install certbot python3-certbot-nginx"
echo "    sudo certbot --nginx -d your.domain.com"
echo ""
echo "  Option B — Self-signed (local/staging):"
echo "    sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\"
echo "      -keyout /etc/ssl/private/blindspot.key \\"
echo "      -out /etc/ssl/certs/blindspot.crt \\"
echo "      -subj '/CN=blindspot.local'"
echo ""
echo "  Then reload nginx: sudo systemctl reload nginx"
echo ""

echo "--- Step 8: Verify services ---"
echo "  pm2 list"
echo "  pm2 logs blindspot-api --lines 20"
echo "  pm2 logs blindspot-core --lines 20"
echo "  curl -k https://localhost/health"
echo ""

echo "Setup guide complete. Follow the steps above in order."

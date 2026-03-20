#!/bin/bash
set -e

DOMAIN="n8n.rexxroofing.com"
EMAIL="office@rexxroofing.com"   # Change to your email for Let's Encrypt notifications
NGINX_CONF_SRC="$(dirname "$0")/../nginx/${DOMAIN}.conf"
NGINX_SITES_AVAILABLE="/etc/nginx/sites-available/${DOMAIN}"
NGINX_SITES_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"
SCRIPTS_DEST="/opt/roofle/scripts"

echo "==> Installing nginx and certbot..."
apt-get update -qq
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> Allowing ports 80 and 443 through ufw..."
ufw allow 80/tcp
ufw allow 443/tcp

echo "==> Writing HTTP-only bootstrap config (no SSL yet)..."
cat > "$NGINX_SITES_AVAILABLE" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://localhost:5678;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Enable site if not already enabled
if [ ! -L "$NGINX_SITES_ENABLED" ]; then
    ln -s "$NGINX_SITES_AVAILABLE" "$NGINX_SITES_ENABLED"
fi

# Disable default site if it exists
if [ -L /etc/nginx/sites-enabled/default ]; then
    rm /etc/nginx/sites-enabled/default
fi

echo "==> Testing nginx config..."
nginx -t

echo "==> Starting nginx..."
systemctl enable nginx
systemctl start nginx || systemctl reload nginx

echo "==> Obtaining SSL certificate via Certbot (will patch nginx config automatically)..."
certbot --nginx \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --redirect

echo "==> Reloading nginx with SSL config..."
systemctl reload nginx

echo "==> Replacing certbot-patched config with clean version..."
cp "$NGINX_CONF_SRC" "$NGINX_SITES_AVAILABLE"
nginx -t && systemctl reload nginx

echo "==> Copying renewal script..."
mkdir -p "$SCRIPTS_DEST"
cp "$(dirname "$0")/renew-ssl.sh" "$SCRIPTS_DEST/renew-ssl.sh"
chmod +x "$SCRIPTS_DEST/renew-ssl.sh"

echo "==> Setting up renewal cron (1st of every 3rd month at 3am)..."
CRON_JOB="0 3 1 */3 * $SCRIPTS_DEST/renew-ssl.sh >> /var/log/certbot-renew.log 2>&1"
# Add only if not already present
(crontab -l 2>/dev/null | grep -qF "renew-ssl.sh") || \
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -

echo ""
echo "Done! Test with:"
echo "  curl -I https://${DOMAIN}"
echo "  certbot renew --dry-run"

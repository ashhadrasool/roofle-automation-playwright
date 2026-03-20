#!/bin/bash
# SSL certificate renewal script
# Cron: 0 3 1 */3 * /opt/roofle/scripts/renew-ssl.sh >> /var/log/certbot-renew.log 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting SSL renewal..."

certbot renew --quiet --nginx

if [ $? -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Renewal succeeded, reloading nginx..."
    systemctl reload nginx
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Done."
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: certbot renew failed." >&2
    exit 1
fi

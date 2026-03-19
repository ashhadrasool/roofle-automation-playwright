# DigitalOcean VM Setup Guide

## Prerequisites

- DigitalOcean Droplet (Ubuntu 22.04+, minimum 4GB RAM / 2 vCPU recommended)
- SSH access to the VM
- Domain (optional, for n8n access)

## 1. SSH into your VM

```bash
ssh -i ~/.ssh/roofle root@162.243.205.89
```

## 2. Install system dependencies

```bash
# Update packages
apt update && apt upgrade -y

# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc

# Install Node.js 20


nvm use 20
nvm alias default 20

# Install Playwright system dependencies (Chromium needs these)
npx playwright install-deps chromium

# Install Docker (for n8n)
curl -fsSL https://get.docker.com | sh
```

## 3. Package and upload the Roofle Scraper

Run this on your **local machine**:

```bash
# Upload project files directly to the VM (excludes node_modules, logs, data, .env, .git)
rsync -avz --exclude='node_modules' --exclude='logs' --exclude='data' --exclude='.env' --exclude='.git' \
  -e "ssh -i ~/.ssh/roofle" \
  ~/projects/roofle-automation-service/ \
  root@162.243.205.89:/root/apps/roofle-automation-service/
```

Then on the **VM**:

```bash
cd /apps/roofle-automation-playwright

# Install dependencies
npm install

# Install Playwright Chromium browser
npx playwright install chromium

# Create .env file
cat > .env << 'EOF'
ROOFLE_EMAIL=your-email@example.com
ROOFLE_PASSWORD=your-password
HEADLESS=true
MAX_CONCURRENT=3
PORT=3000
LOG_LEVEL=info
EOF
```

Edit `.env` with your actual Roofle credentials:

```bash
nano .env
```

## 4. Run the scraper as a background service

Create a systemd service so it starts on boot and auto-restarts:

```bash
# Install pm2 globally
npm install -g pm2

# Start the scraper
cd /apps/roofle-automation-playwright
pm2 start npx --name roofle-scraper -- tsx src/server.ts

# Auto-start on reboot
pm2 startup
pm2 save

# Check status
pm2 status

# View logs
pm2 logs roofle-scraper
```

## 5. Set up n8n

See [N8N-SETUP.md](N8N-SETUP.md) for n8n installation and workflow configuration.

## 7. Verify everything works

```bash
# Check scraper is running
curl http://localhost:3000/health

# Test a single quote
curl -X POST http://localhost:3000/generate-quote \
  -H "Content-Type: application/json" \
  -d '{"address":"429 Walnut Grove Dr, Madison, WI","firstName":"Test","lastName":"User","phone":"5551234567","email":"test@example.com"}'

# Check n8n is running
curl http://localhost:5678/healthz
```

## 8. Firewall setup

```bash
# Allow SSH, n8n, and scraper API
ufw allow 22
ufw allow 5678
ufw allow 3000
ufw enable
```

If you only want n8n accessible externally (scraper stays internal):

```bash
ufw allow 22
ufw allow 5678
ufw enable
# Don't open 3000 — n8n reaches it via Docker host gateway
```

## Useful commands

```bash
# Restart scraper
pm2 restart roofle-scraper

# View scraper logs
pm2 logs roofle-scraper

# View scraper file logs
tail -f /apps/roofle-automation-playwright/logs/combined.log
tail -f /apps/roofle-automation-playwright/logs/error.log

# View scraper errors (API)
curl http://localhost:3000/errors

# View scraper results (API)
curl http://localhost:3000/results

# Update scraper code (run on local machine first):
# rsync -avz --exclude='node_modules' --exclude='logs' --exclude='data' --exclude='.env' --exclude='.git' \
#   -e "ssh -i ~/.ssh/roofle" \
#   ~/projects/roofle-automation-playwright/ \
#   root@162.243.205.89:/apps/roofle-automation-playwright/
# Then on VM:
cd /apps/roofle-automation-playwright
npm install
pm2 restart roofle-scraper
```

## Scaling

- **MAX_CONCURRENT** in `.env` controls how many browsers run in parallel
- Each browser uses ~300-500MB RAM
- For a 4GB VM: set `MAX_CONCURRENT=3`
- For an 8GB VM: set `MAX_CONCURRENT=6`
- n8n HTTP Request node batch size should match `MAX_CONCURRENT`

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Scraper won't start | Check `pm2 logs roofle-scraper` for errors |
| n8n can't reach scraper | See [N8N-SETUP.md](N8N-SETUP.md) troubleshooting |
| Browser crashes / OOM | Lower `MAX_CONCURRENT` in `.env` |
| Login fails | Check `.env` credentials, try `HEADLESS=false` locally |
| "Create Quote button not found" | Roofle UI may have changed — check selectors |

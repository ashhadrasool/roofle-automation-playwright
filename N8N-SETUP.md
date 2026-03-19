# n8n Setup Guide

## 1. Install n8n with Docker

```bash
# SSH into your VM
ssh -i ~/.ssh/roofle root@162.243.205.89

# Create n8n data directory and set permissions for n8n (runs as uid 1000)
mkdir -p ~/apps/n8n-data
sudo chown -R 1000:1000 ~/apps/n8n-data

# Navigate to the project directory (docker-compose.yml is already there)
cd /apps/roofle-automation-playwright

# Start n8n
docker compose up -d
```

n8n will be available at `http://162.243.205.89:5678`

## 2. Open firewall port

```bash
ufw allow 5678

```

## 3. Initial setup

1. Open `http://162.243.205.89:5678` in your browser
2. Create an account on first visit

## 4. Import the workflow

1. Go to **Workflows** > **Add Workflow** > **Import from File**
2. Upload `n8n-workflow.json` from this repo

## 5. Configure the workflow

### Generate Quote (API) node
Update the URL to point to the scraper running on the same VM:

```
http://172.17.0.1:3000/generate-quote
```

(`172.17.0.1` is Docker's host gateway — lets the n8n container reach the host machine's port 3000)

### Google Sheets nodes (Read + Update)
1. Click each Google Sheets node
2. Add your **Google Sheets OAuth2** credentials
3. Select your spreadsheet and sheet

### Update Google Sheet node
1. Set **Column to Match On** to `row_number`
2. Map these columns:
   - `row_number` → `={{ $('Map Columns').item.json.row_number }}`
   - `leadUrl` → `={{ $json.success ? $json.data.leadUrl : '' }}`
   - `quoteData` → `={{ $json.success ? JSON.stringify($json.data) : '' }}`
   - `status` → `={{ $json.success ? 'done' : 'error' }}`
   - `error` → `={{ $json.success ? '' : ($json.error?.message || $json.error || 'Unknown error') }}`

### HTTP Request node settings
- **Settings → On Error** → `Continue on Fail`
- **Settings → Batching → Batch Size** → `4` (match your `MAX_CONCURRENT` env var)
- **Timeout** → `120000` (2 minutes)

## 6. Google Sheet columns

Make sure your sheet has these columns (add them if missing):

| leadUrl | quoteData | status | error |
|---------|-----------|--------|-------|

## 7. Verify

```bash
# Check n8n is running
curl http://localhost:5678/healthz

# Check n8n can reach the scraper
docker exec n8n curl http://172.17.0.1:3000/health
```

## Useful commands

```bash
# Restart n8n
docker compose restart n8n

# View n8n logs
docker compose logs -f n8n

# Stop n8n
docker compose down

# Recreate n8n (data is preserved in volume)
cd /apps/roofle-automation-playwright
docker compose down
docker compose up -d

# Update n8n to latest
docker compose pull
docker compose up -d
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| n8n can't reach scraper | Use `http://172.17.0.1:3000` instead of `localhost` |
| Can't access n8n UI | Check `ufw allow 5678` and `docker ps` |
| Cookie/login issues | Make sure `N8N_SECURE_COOKIE=false` is set (needed for HTTP) |
| Google Sheets auth fails | Re-add OAuth2 credentials, check scopes |
| Workflow times out | Increase timeout in HTTP Request node (default 120s) |

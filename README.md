# DefAero Shared Deal Tracker

A lightweight web app for two users to track supplier offers and customer demand in one shared board.

## What is ready now

- Two-user login (session-based)
- Supplier + customer deal tracking (`supplier_offer`, `customer_need`, `matched_deal`)
- Excel import mapped to your workbook columns
- Safer default local binding (`HOST=127.0.0.1`)
- Deploy config for Render (`render.yaml`)

## Local Run (you only)

```bash
cd "/Users/billgeraghty/Documents/New project"
npm install
cp .env.example .env
```

Set values in `.env` (strong passwords, long secret), then run:

```bash
set -a
source .env
set +a
npm start
```

Open [http://localhost:3000](http://localhost:3000)

## Option 1: Partner in Pakistan via Render (recommended)

1. Push this folder to GitHub.
2. In Render, click **New +** -> **Blueprint**.
3. Select your repo. Render will read `render.yaml`.
4. In Render environment variables, set:
- `APP_USERS` example: `bill:VeryStrongPass1,partner:VeryStrongPass2`
- `SESSION_SECRET` (Render can auto-generate; keep it secret)
5. Deploy.
6. Share the HTTPS URL Render gives you.

Notes:
- SQLite data persists because `render.yaml` mounts disk at `/opt/render/project/src/data`.
- Keep passwords strong and unique.

## Option 2: Partner via Tailscale (private network)

1. Install Tailscale on your Mac and your partner's device.
2. Both sign in to the same Tailscale network.
3. Start app on your Mac with network bind:

```bash
cd "/Users/billgeraghty/Documents/New project"
set -a
source .env
set +a
HOST=0.0.0.0 npm start
```

4. Find your Tailscale IP from Tailscale app.
5. Partner opens `http://YOUR_TAILSCALE_IP:3000`.

This is private and usually safer than exposing a public port.

## Exact Excel Import Mapping (your current file)

File: `DefAero Sourcing & Deal Tracker (1).xlsx`  
Sheet: `Sourcing Tracker`  
Header row: row 4

Mapped columns:
- `Product ` -> `product`
- `Supplier` -> `supplier`
- `Price (Currency)` -> `supplier_price`
- `Incoterms` -> `incoterms`
- `Country of Origin (COO)` -> `country_of_origin`
- `Intermediary` -> `intermediary`
- `Who is involved in the deal` -> `deal_contacts`
- `Notes` -> `notes`

Defaults on import:
- `deal_type = supplier_offer`
- `status = open`
- `stage = sourcing`
- `owner = logged in user`

## Files

- `/Users/billgeraghty/Documents/New project/server.js`
- `/Users/billgeraghty/Documents/New project/render.yaml`
- `/Users/billgeraghty/Documents/New project/.env.example`
- `/Users/billgeraghty/Documents/New project/public/index.html`
- `/Users/billgeraghty/Documents/New project/public/app.js`
- `/Users/billgeraghty/Documents/New project/public/styles.css`

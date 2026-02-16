# DefAero Shared Deal Tracker

Shared deal tracker for supplier offers and customer demand with:
- login for 2+ users
- opportunity tracking + EUC field
- document upload/download/delete
- Excel import for your sourcing sheet

## Persistence on Free Render

This app now uses **Supabase Postgres** for persistent storage (opportunities + uploaded documents).

## Required Environment Variables

- `APP_USERS` example: `bill:StrongPass1,partner:StrongPass2`
- `SESSION_SECRET` long random string
- `DATABASE_URL` Supabase Postgres connection string
- `DATABASE_SSL=true`

## Supabase Setup

1. Create a Supabase project.
2. In Supabase dashboard go to `Settings -> Database`.
3. Copy the Postgres connection string.
4. Use that value for `DATABASE_URL` in Render.

## Render Setup

1. Deploy from repo using `render.yaml`.
2. In Render service `Environment`, set:
   - `APP_USERS`
   - `SESSION_SECRET`
   - `DATABASE_URL`
   - `DATABASE_SSL=true`
3. Deploy latest commit.

## Local Run

```bash
cd "/Users/billgeraghty/Documents/New project"
npm install
cp .env.example .env
# fill real values in .env
set -a
source .env
set +a
npm start
```

## Notes

- Free Render instance can sleep, but your data remains in Supabase.
- Uploaded documents are now stored in Postgres, not local disk.

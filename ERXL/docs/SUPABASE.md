# ERXL Supabase

Project: **ERXL**  
Project ref: `fganrvamurjqtbslaqys`  
Region: `eu-central-1`  
URL: `https://fganrvamurjqtbslaqys.supabase.co`

## Tables

- `public.analysis_runs`
- `public.findings`

Both tables have Row Level Security enabled. No browser/client policy is intentionally defined. ERXL is designed so only the server-side Cloudflare Worker writes analysis metadata and findings.

## Required Cloudflare secret

Set a server-side Supabase secret key in Cloudflare:

```bash
npx wrangler secret put SUPABASE_SECRET_KEY
```

Also set the URL:

```bash
npx wrangler secret put SUPABASE_URL
```

Never commit a Supabase secret/service-role key to GitHub.

## Current advisor notes

- RLS enabled with no policy: intentional for these server-only tables.
- Unused indexes: expected while the database contains no production analysis rows.

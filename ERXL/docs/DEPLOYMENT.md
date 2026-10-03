# ERXL deployment checklist

You are handling deployment. The code is designed so deployment does not require code edits.

## 1. Supabase

Existing project:

- name: `ERXL`
- project ref: `fganrvamurjqtbslaqys`
- region: `eu-central-1`

Apply migrations in this order:

```text
ERXL/supabase/migrations/001_initial_schema.sql
ERXL/supabase/migrations/002_semantic_testing.sql
ERXL/supabase/migrations/003_semantic_identity_reasoning.sql
ERXL/supabase/migrations/004_semantic_violation_groups.sql
ERXL/supabase/migrations/005_automatic_hypothesis_generation.sql
```

Do not add public RLS policies unless the access model changes. The current browser never talks directly to the ERXL tables.

## 2. Cloudflare secrets

Set these Worker secrets/variables:

```text
SUPABASE_URL=https://fganrvamurjqtbslaqys.supabase.co
SUPABASE_SECRET_KEY=<server-side Supabase secret key>
```

Never place `SUPABASE_SECRET_KEY` in client JavaScript or commit it to GitHub.

## 3. Install and verify locally

```bash
cd ERXL
npm install
npm run typecheck
npm test
```

## 4. Cloudflare deployment

From the `ERXL` directory:

```bash
npx wrangler deploy
```

Or manually dispatch:

```text
.github/workflows/erxl-deploy-cloudflare.yml
```

The deployment workflow requires GitHub repository secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

The Supabase values must still be configured as Worker secrets/variables.

## 5. Smoke tests

After deployment:

```text
GET /api/health
```

Expected service version:

```text
0.4.2
```

Then upload a small `.xlsx` workbook in the browser.

Verify that the result contains:

- structural findings
- semantic nodes
- semantic identity issue families
- generated hypotheses
- hypothesis experiments
- counterfactual tests
- execution statuses
- Supabase persistence status

## 6. Before public exposure

The MVP has no end-user authentication. For private testing, protect the deployment at the Cloudflare layer or otherwise restrict access.

Uploaded workbook bytes are not intentionally stored by ERXL, but financial models are sensitive data. Review your Cloudflare logging, analytics, access controls, and retention settings before accepting third-party workbooks.

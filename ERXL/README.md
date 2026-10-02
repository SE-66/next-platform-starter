# ERXL

ERXL is an early-stage error-finding engine for financial Excel models.

## MVP scope

Upload an `.xlsx` workbook and ERXL will:

- inventory sheets, formulas, and values
- build a formula dependency graph
- detect Excel error values such as `#REF!`, `#DIV/0!`, and `#VALUE!`
- detect suspicious hard-coded values inside formula-dense rows
- detect formula-pattern outliers
- detect circular formula references
- run a basic balance-sheet identity check when recognizable labels are present
- return findings ranked by severity
- optionally persist analysis metadata and findings to Supabase

This first version intentionally does **not** claim to prove a model is financially correct. It is the engine foundation for later semantic financial reasoning and counterfactual test synthesis.

## Stack

- Cloudflare Workers + Static Assets
- TypeScript
- SheetJS `xlsx` parser
- Supabase Postgres for analysis history
- GitHub Actions for Cloudflare deployment

## Local development

```bash
cd ERXL
npm install
npm run dev
```

Then open the local URL printed by Wrangler.

## Cloudflare secrets

After the Supabase project exists:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SECRET_KEY
```

For GitHub deployment add repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Supabase

Apply:

```
supabase/migrations/001_initial_schema.sql
```

The schema deliberately grants Data API access only to `service_role`; the browser never receives a Supabase secret key.

## Next invention milestone

The next layer is not another formula checker. It is:

1. infer semantic financial roles from labels/formulas;
2. form competing hypotheses about intended computation;
3. synthesize the smallest input perturbation that distinguishes those hypotheses;
4. execute the model;
5. localize the likely semantic defect.

That narrower mechanism is the part worth deeper prior-art investigation.

# ERXL

ERXL is an error-finding and counterfactual testing engine for financial Excel models.

## What ERXL does now

Upload an `.xlsx` workbook and ERXL will:

- inventory populated cells and formulas
- build a formula dependency graph
- detect explicit Excel error values
- detect circular formula references
- detect suspicious hard-coded values in formula-dense rows
- detect formula-pattern outliers
- run a basic balance-sheet identity check when recognizable labels exist
- infer supported financial roles from labels and workbook structure
- compare semantic dependency patterns across comparable periods
- generate targeted single-assumption counterfactual tests
- recalculate supported formula paths inside the Worker
- classify each executed counterfactual test as passed, failed, or unsupported
- turn failed financial-direction tests into high-severity findings
- persist analysis metadata, semantic nodes, tests, and outcomes to Supabase

ERXL does **not** claim that a workbook is correct when no issue is found.

## Current architecture

```text
Browser
  |
  v
Cloudflare Worker
  |
  +--> XLSX parser
  +--> structural checks
  +--> semantic-role inference
  +--> dependency graph
  +--> counterfactual test synthesis
  +--> deterministic formula evaluator
  |
  v
Supabase
  +--> analysis_runs
  +--> findings
  +--> semantic_nodes
  +--> counterfactual_tests
```

Uploaded workbook bytes are analyzed in memory. The current code stores analysis metadata and findings, not the workbook file itself.

## Counterfactual example

If ERXL recognizes:

```text
Interest Rate -> Interest Expense
```

and confirms a formula dependency path, it generates a one-cell test:

```text
Interest Rate +10%
Expected: Interest Expense increases
```

If the supported formula evaluator recalculates the model and Interest Expense decreases, ERXL records a `COUNTERFACTUAL_TEST_FAILURE`.

## Formula execution

ERXL's deterministic evaluator supports a bounded subset of common Excel behavior, including:

- arithmetic and comparisons
- direct cell references and normal rectangular ranges
- SUM, AVERAGE, MIN, MAX
- ABS, SQRT, POWER, MOD, SIGN
- ROUND, ROUNDUP, ROUNDDOWN
- IF, AND, OR, NOT
- SUMPRODUCT
- NPV, IRR, XNPV, XIRR
- INDEX, MATCH, XLOOKUP, VLOOKUP, CHOOSE
- SUMIF, COUNTIF, AVERAGEIF
- SUMIFS, COUNTIFS, AVERAGEIFS

Unsupported functions are explicitly marked `unsupported`; ERXL does not substitute cached Excel results for a perturbed calculation.

## Limits

- `.xlsx` only
- 12 MB upload limit
- 350,000 populated-cell analysis limit
- up to 24 generated tests are executed in-worker per analysis
- dynamic references, macros, external-workbook links, structured references, and many specialist Excel functions are not yet supported
- financial semantic inference is currently rule-based, not an LLM

## Development

```bash
cd ERXL
npm install
npm run typecheck
npm test
npm run dev
```

## Deployment

See `docs/DEPLOYMENT.md`.

Cloudflare deployment is intentionally manual-only. The GitHub workflow `.github/workflows/erxl-deploy-cloudflare.yml` runs only when manually dispatched.

## Database

Apply migrations in order:

```text
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_semantic_testing.sql
```

All public-schema ERXL tables have RLS enabled and intentionally expose no browser policies. The Cloudflare Worker uses a server-side Supabase secret key.

## Validation

GitHub Actions workflow `ERXL CI` runs:

```text
npm install --ignore-scripts
npm run typecheck
npm test
```

The test suite includes a synthetic valid interest-expense model and a deliberately reversed model that ERXL must flag through counterfactual execution.

## Technical direction

The most strategically interesting ERXL work remains:

1. broader semantic-role inference;
2. automatic competing-hypothesis generation for ambiguous formulas;
3. minimum discriminating perturbation synthesis;
4. better fault localization from failed counterfactual tests;
5. economic materiality ranking.

Those mechanisms are more important for patent strategy than the broad idea of "AI checks spreadsheets."

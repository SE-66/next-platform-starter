# ERXL

ERXL is a financial-model error-finding, semantic-reasoning, and counterfactual-testing engine for Excel.

## ERXL v0.3

Upload an `.xlsx` workbook and ERXL now performs four layers of analysis:

1. **Structural QA**
   - Excel error values
   - circular references
   - formula-pattern outliers
   - hardcodes embedded in formula sequences
   - basic balance-sheet reconciliation

2. **Financial semantic inference**
   - identifies supported concepts such as Revenue, Units, Price, COGS, SG&A, EBITDA, Debt, Cash, Interest Rate, Interest Expense, Enterprise Value, Equity Value, Exit Multiple, IRR, Capex, and Working Capital
   - constructs semantic dependency relationships between recognized cells

3. **Financial identity reasoning**
   - rewrites formulas into role-level semantic expressions
   - compares those expressions with canonical financial identities
   - scores competing hypotheses
   - can detect formulas that are copied consistently across all periods but use the wrong economic driver
   - examples:
     - `Enterprise Value = EBITDA × Exit Multiple`
     - `Revenue = Units × Price`
     - `Gross Profit = Revenue − COGS`
     - `EBITDA = Gross Profit − SG&A`
     - enterprise-to-equity value bridges
     - debt / interest-rate relationships
   - produces root-cause candidates and materiality estimates where a sufficiently exact identity is available

4. **Counterfactual execution**
   - generates targeted single-assumption perturbations
   - executes up to 40 generated tests with ERXL's deterministic formula evaluator
   - classifies tests as passed, failed, generated, or unsupported
   - measures absolute and relative output impact
   - localizes failed behavior back to violated semantic identities when possible

ERXL does **not** claim that a workbook is correct merely because no issue is found.

## Structurally consistent bug example

A spreadsheet may use this formula in every forecast period:

```text
Enterprise Value = Revenue × Exit Multiple
```

Traditional copy-pattern analysis sees a perfectly consistent row.

ERXL v0.3 instead recognizes:

```text
target role: enterprise_value
observed semantic expression: @revenue * @exit_multiple
canonical hypothesis: @ebitda * @exit_multiple
competing hypothesis: Revenue multiple substituted for EBITDA multiple
```

and raises a `SEMANTIC_IDENTITY_VIOLATION`.

## Architecture

```text
Browser
  |
  v
Cloudflare Worker
  |
  +--> XLSX parser
  +--> structural QA
  +--> semantic-role inference
  +--> dependency graph
  +--> financial identity / hypothesis engine
  +--> counterfactual test synthesis
  +--> deterministic formula evaluator
  +--> root-cause + materiality layer
  |
  v
Supabase
  +--> analysis_runs
  +--> findings
  +--> semantic_nodes
  +--> identity_assessments
  +--> counterfactual_tests
```

Uploaded workbook bytes are analyzed in memory. ERXL stores analysis metadata and results, not the uploaded workbook itself.

## Formula execution

The bounded deterministic evaluator supports common Excel behavior including:

- arithmetic and comparisons
- direct cell references and rectangular ranges
- SUM, AVERAGE, MIN, MAX
- ABS, SQRT, POWER, MOD, SIGN
- ROUND, ROUNDUP, ROUNDDOWN
- IF, AND, OR, NOT
- SUMPRODUCT
- NPV, IRR, XNPV, XIRR
- INDEX, MATCH, XLOOKUP, VLOOKUP, CHOOSE
- SUMIF, COUNTIF, AVERAGEIF
- SUMIFS, COUNTIFS, AVERAGEIFS

Unsupported functions remain explicit. ERXL does not pretend a cached Excel value has been recalculated after a perturbation.

## Limits

- `.xlsx` only
- 12 MB upload limit
- 350,000 populated-cell limit
- up to 40 counterfactual tests executed per analysis
- macros, external workbook links, dynamic references, structured references, and many specialist Excel functions are not yet supported
- semantic reasoning is currently deterministic/rule-driven rather than LLM-driven
- financial identities are contextual rules, not universal accounting assertions; ambiguous cases are reported as ambiguous rather than forced into a violation

## Development

```bash
cd ERXL
npm install
npm run typecheck
npm test
npm run dev
```

## Database

Migrations:

```text
001_initial_schema.sql
002_semantic_testing.sql
003_semantic_identity_reasoning.sql
```

All ERXL tables use RLS with no public browser policies. The Cloudflare Worker writes using the server-side Supabase secret.

## Validation

ERXL CI validates the same root path used by Cloudflare and runs a Wrangler dry-run bundle.

Regression coverage includes:

- correct and reversed interest-rate sensitivity
- wrong relative spreadsheet references
- embedded hardcodes
- circular references
- separated Dashboard formula bands
- cross-sheet formula parsing
- a structurally consistent `Revenue × Exit Multiple` Enterprise Value bug
- a structurally consistent interest-rate subtraction bug

## Next research milestone

The next patent-relevant step is **automatic hypothesis generation and minimum discriminating perturbation synthesis** rather than a hand-authored identity library. That should be prior-art searched before being treated as a filing candidate.

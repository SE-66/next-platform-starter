# ERXL

ERXL is a financial-model error-finding, semantic-reasoning, and counterfactual-testing engine for Excel.

## ERXL v0.4.2 — Subtraction Direction + Explanation Consistency

v0.4.2 fixes two weaknesses exposed by Test 7.

### Ordered subtraction reasoning

Subtraction candidates are no longer ranked as if `A - B` and `B - A` were interchangeable.

The ranker now adds:

- a soft **base-amount vs component** hierarchy for money bridges;
- ordered subtraction scoring that favors broader/base values on the left and deducted components on the right;
- soft sign sanity to penalize reversed subtraction when it flips the sign of an otherwise clearly signed workbook output;
- regression coverage requiring `Revenue - COGS` to outrank `COGS - Revenue` for Gross Profit.

This is a generic operator-direction heuristic, not a hard-coded Gross Profit formula.

### Experiment explanation consistency

An experiment may identify an implemented hypothesis different from ERXL's preferred hypothesis without crossing the mismatch threshold.

ERXL now reports that state explicitly:

`The workbook's observed response matches an alternative generated hypothesis, but the plausibility gap is below ERXL's mismatch threshold; no mismatch finding was raised.`

It can only say `consistent with the preferred generated hypothesis` when the implemented hypothesis ID actually equals the preferred hypothesis ID.

Regression tests enforce that invariant across multiple benchmark workbooks.

## ERXL v0.4.1 — Directional Ratio Ranking

v0.4.1 fixes the ratio-orientation weakness exposed by Test 6 without adding a hard-coded EBITDA-margin formula.

The automatic hypothesis ranker now adds:

- **ordered-role scoring**: for rate/margin targets, semantic overlap with the target is rewarded more strongly in the numerator than in the denominator;
- **generic base-vs-component scoring**: broader scale roles such as Revenue and Assets receive higher denominator-base scores than component measures such as EBITDA, COGS, SG&A, and interest expense;
- **ratio scale sanity**: decimal-sized rate hypotheses receive a small plausibility bonus, while extreme inverse ratios receive a soft penalty rather than being forbidden;
- regression coverage requiring `EBITDA ÷ Revenue` to outrank `Revenue ÷ EBITDA`;
- regression coverage preserving `Gross Profit ÷ Revenue` over `COGS ÷ Revenue`.

The implementation remains hypothesis-based and experimental: the preferred candidate is still verified against the workbook through a discriminating perturbation.

## ERXL v0.4 — Automatic Hypothesis Generation

v0.4 adds an experimental reasoning layer that does not require an exact hand-authored financial identity for every target.

For each supported semantic target, ERXL now:

1. gathers same-period semantic inputs from the workbook;
2. generates dimensionally valid candidate expressions from a generic grammar such as:
   - money ± money
   - money × rate
   - money × multiple
   - units × price
   - money ÷ money
   - three-term money bridges
   - average balance × rate
   - average balance × additive or subtractive rate components;
3. ranks candidates using dimensional validity, semantic-role affinity, simplicity, and workbook locality;
4. preserves lower-plausibility candidates that match the workbook's observed formula structure;
5. selects the smallest perturbation from 1%, 2%, 5%, and 10% that meaningfully separates competing candidate predictions;
6. executes that perturbation against the actual workbook formula;
7. determines which generated hypothesis best matches the observed response;
8. reports a mismatch when the implemented behavior matches a materially lower-plausibility hypothesis;
9. estimates materiality between the actual baseline result and the preferred generated hypothesis.

This layer produces `AUTOMATIC_HYPOTHESIS_MISMATCH` findings independently of the existing hand-authored identity rules.

A regression test demonstrates this on **Gross Margin**, which is not covered by the v0.3 identity rule table: ERXL generates `Gross Profit ÷ Revenue` and `COGS ÷ Revenue` as competing candidates, perturbs an input to distinguish them, observes that the workbook behaves like the lower-plausibility COGS-driven formula, and raises a mismatch.

The generator is deterministic and bounded. It is not yet an unrestricted symbolic-discovery or LLM reasoning system.

## ERXL v0.3.1

v0.3.1 improves semantic defect precision:

- recognizes formatted Debt and Cash labels such as `Debt ($mm)` and `Cash ($mm)`
- conclusively identifies `Revenue - Debt` as an invalid enterprise-to-equity bridge when the relevant roles are present
- aggregates repeated period-level semantic violations into one model-level issue family
- reports affected range, affected period count, representative root causes, and worst materiality
- persists issue families in Supabase

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
  +--> financial identity engine
  +--> automatic hypothesis grammar + ranking
  +--> minimum discriminating perturbation selector
  +--> hypothesis behavior matcher
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
  +--> identity_violation_groups
  +--> generated_hypotheses
  +--> hypothesis_experiments
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
004_semantic_violation_groups.sql
005_automatic_hypothesis_generation.sql
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
- automatically generated Enterprise Value hypotheses
- automatically generated enterprise-to-equity bridge hypotheses
- Gross Margin discovery beyond the hand-authored identity library
- directional ratio ranking for Gross Margin and EBITDA Margin
- subtraction direction ranking for money bridges
- experiment explanation consistency when implemented and preferred hypotheses differ

## Next research milestone

The automatic-hypothesis / discriminating-perturbation mechanism now exists as a working bounded prototype. The next patent-strategy step is a focused prior-art kill search on this specific pipeline before treating it as a filing candidate:

```text
semantic role inference
→ dimensionally valid hypothesis generation
→ hypothesis plausibility ranking
→ minimum discriminating perturbation selection
→ deterministic workbook execution
→ implemented-hypothesis identification
→ preferred-vs-implemented mismatch
→ root-cause and materiality output
```

The technical roadmap after that search is automatic grammar expansion, learned semantic affinities, multi-cell perturbations, and confidence calibration on independent real-world workbooks.

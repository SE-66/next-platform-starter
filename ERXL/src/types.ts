export type Severity = "critical" | "high" | "medium" | "low";

export type SemanticRole =
  | "revenue"
  | "units"
  | "price"
  | "cogs"
  | "sga"
  | "gross_profit"
  | "gross_margin"
  | "ebitda"
  | "ebitda_margin"
  | "cash"
  | "debt"
  | "interest_expense"
  | "interest_rate"
  | "assets"
  | "liabilities"
  | "equity"
  | "enterprise_value"
  | "equity_value"
  | "irr"
  | "exit_multiple"
  | "capex"
  | "working_capital"
  | "taxes"
  | "unknown";

export interface RootCauseCandidate {
  cellKey: string;
  score: number;
  reason: string;
}

export interface MaterialityEstimate {
  actual?: number;
  expected?: number;
  absoluteImpact?: number;
  relativeImpact?: number;
  rank: "critical" | "high" | "medium" | "low" | "unknown";
}

export interface Finding {
  id: string;
  severity: Severity;
  code:
    | "EXCEL_ERROR"
    | "FORMULA_OUTLIER"
    | "HARDCODE_IN_FORMULA_REGION"
    | "CIRCULAR_REFERENCE"
    | "BALANCE_SHEET_MISMATCH"
    | "SEMANTIC_DEPENDENCY_OUTLIER"
    | "SEMANTIC_IDENTITY_VIOLATION"
    | "COUNTERFACTUAL_TEST_FAILURE";
  title: string;
  sheet?: string;
  cell?: string;
  details: string;
  evidence?: Record<string, unknown>;
}

export interface SemanticNode {
  id: string;
  key: string;
  role: SemanticRole;
  sheet: string;
  cell: string;
  label?: string;
  confidence: number;
  value?: number | string | boolean | null;
  formula?: string;
}

export interface IdentityHypothesisScore {
  name: string;
  canonical: boolean;
  requiredRoles: SemanticRole[];
  score: number;
  matched: boolean;
}

export interface SemanticViolationGroup {
  id: string;
  identityName: string;
  targetRole: SemanticRole;
  sheet: string;
  affectedCells: string[];
  affectedRange: string;
  affectedCount: number;
  canonicalExpression: string;
  semanticExpression: string;
  explanation: string;
  confidence: number;
  hypotheses: IdentityHypothesisScore[];
  assessmentIds: string[];
  rootCauseCandidates: RootCauseCandidate[];
  worstMateriality?: MaterialityEstimate;
}

export interface SemanticIdentityAssessment {
  id: string;
  targetNodeId: string;
  targetKey: string;
  targetRole: SemanticRole;
  sheet: string;
  cell: string;
  identityName: string;
  canonicalExpression: string;
  semanticExpression: string;
  observedRoles: SemanticRole[];
  status: "confirmed" | "violated" | "ambiguous";
  confidence: number;
  hypotheses: IdentityHypothesisScore[];
  explanation: string;
  rootCauseCandidates: RootCauseCandidate[];
  materiality?: MaterialityEstimate;
}

export type ExpectedDirection =
  | "increase"
  | "decrease"
  | "not_increase"
  | "not_decrease";

export interface CounterfactualTest {
  id: string;
  title: string;
  input: {
    semanticNodeId: string;
    role: SemanticRole;
    sheet: string;
    cell: string;
    baselineValue?: number;
    perturbationPercent: number;
  };
  output: {
    semanticNodeId: string;
    role: SemanticRole;
    sheet: string;
    cell: string;
    expectedDirection: ExpectedDirection;
  };
  dependencyPath: string[];
  confidence: number;
  rationale: string;
  executionStatus: "generated" | "passed" | "failed" | "unsupported";
  baselineOutput?: number;
  perturbedInput?: number;
  perturbedOutput?: number;
  observedDirection?: "increase" | "decrease" | "unchanged";
  executionError?: string;
  absoluteImpact?: number;
  relativeImpact?: number;
  materialityRank?: "critical" | "high" | "medium" | "low";
}

export interface WorkbookSummary {
  sheets: number;
  populatedCells: number;
  formulaCells: number;
  findings: number;
  semanticNodes: number;
  identityChecks: number;
  identityViolations: number;
  identityViolationGroups: number;
  counterfactualTests: number;
  testsPassed: number;
  testsFailed: number;
  testsUnsupported: number;
}

export interface AnalysisResult {
  runId: string;
  fileName: string;
  createdAt: string;
  summary: WorkbookSummary;
  findings: Finding[];
  semanticNodes: SemanticNode[];
  identityAssessments: SemanticIdentityAssessment[];
  identityViolationGroups: SemanticViolationGroup[];
  counterfactualTests: CounterfactualTest[];
}

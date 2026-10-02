export type Severity = "critical" | "high" | "medium" | "low";

export type SemanticRole =
  | "revenue"
  | "units"
  | "price"
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

export interface Finding {
  id: string;
  severity: Severity;
  code:
    | "EXCEL_ERROR"
    | "FORMULA_OUTLIER"
    | "HARDCODE_IN_FORMULA_REGION"
    | "CIRCULAR_REFERENCE"
    | "BALANCE_SHEET_MISMATCH";
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
  executionStatus: "generated";
}

export interface WorkbookSummary {
  sheets: number;
  populatedCells: number;
  formulaCells: number;
  findings: number;
  semanticNodes: number;
  counterfactualTests: number;
}

export interface AnalysisResult {
  runId: string;
  fileName: string;
  createdAt: string;
  summary: WorkbookSummary;
  findings: Finding[];
  semanticNodes: SemanticNode[];
  counterfactualTests: CounterfactualTest[];
}

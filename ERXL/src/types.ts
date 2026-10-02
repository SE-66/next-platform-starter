export type Severity = "critical" | "high" | "medium" | "low";

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

export interface WorkbookSummary {
  sheets: number;
  populatedCells: number;
  formulaCells: number;
  findings: number;
}

export interface AnalysisResult {
  runId: string;
  fileName: string;
  createdAt: string;
  summary: WorkbookSummary;
  findings: Finding[];
}

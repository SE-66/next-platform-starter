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
    | "AUTOMATIC_HYPOTHESIS_MISMATCH"
    | "COUNTERFACTUAL_TEST_FAILURE";
  title: string;
  sheet?: string;
  cell?: string;
  details: string;
  evidence?: Record<string, unknown>;
}

export interface FindingIssueFamily {
  id: string;
  severity: Severity;
  title: string;
  details: string;
  sheet?: string;
  cell?: string;
  rootCauseCell?: string;
  detectorCodes: Finding["code"][];
  findingIds: string[];
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

export type HypothesisOperator =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "subtract_add"
  | "average_multiply"
  | "average_multiply_sum_rates"
  | "average_multiply_diff_rates";

export interface GeneratedHypothesis {
  id: string;
  targetNodeId: string;
  targetKey: string;
  targetRole: SemanticRole;
  sheet: string;
  cell: string;
  operator: HypothesisOperator;
  expression: string;
  semanticExpression: string;
  sourceNodeIds: string[];
  sourceKeys: string[];
  sourceRoles: SemanticRole[];
  dimensionalScore: number;
  semanticAffinityScore: number;
  simplicityScore: number;
  plausibilityScore: number;
  baselinePrediction?: number;
  generationBasis: string;
}

export interface HypothesisPrediction {
  hypothesisId: string;
  expression: string;
  baseline?: number;
  perturbed?: number;
  delta?: number;
  normalizedError?: number;
  error?: string;
}

export interface HypothesisPosterior {
  hypothesisId: string;
  expression: string;
  priorProbability: number;
  posteriorProbability: number;
}

export interface BehavioralProbe {
  semanticNodeId: string;
  key: string;
  role: SemanticRole;
  baselineValue: number;
  perturbationPercent: number;
  perturbedValue: number;
  expectedInformationGain: number;
  observedTarget?: number;
  predictedTargets: Array<{
    hypothesisId: string;
    predictedTarget: number;
  }>;
}

export interface HypothesisExperiment {
  id: string;
  targetNodeId: string;
  targetKey: string;
  targetRole: SemanticRole;
  sheet: string;
  cell: string;
  candidateIds: string[];
  preferredHypothesisId: string;
  implementedHypothesisId?: string;
  preferredExpression: string;
  implementedExpression?: string;
  perturbation?: {
    semanticNodeId: string;
    key: string;
    role: SemanticRole;
    baselineValue: number;
    perturbationPercent: number;
    perturbedValue: number;
  };
  baselineTarget?: number;
  observedTarget?: number;
  predictions: HypothesisPrediction[];
  probes?: BehavioralProbe[];
  posterior?: HypothesisPosterior[];
  posteriorConfidence?: number;
  entropyReduction?: number;
  stopReason?: "identified" | "poor_fit" | "max_probes" | "no_informative_probe" | "abstained" | "unsupported";
  status: "executed" | "ambiguous" | "unsupported" | "abstained";
  preferredPlausibilityScore?: number;
  mismatch: boolean;
  implementedMatchScore?: number;
  plausibilityGap?: number;
  explanation: string;
  materiality?: MaterialityEstimate;
}

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
  findingIssueFamilies: number;
  semanticNodes: number;
  identityChecks: number;
  identityViolations: number;
  identityViolationGroups: number;
  generatedHypotheses: number;
  hypothesisExperiments: number;
  hypothesisAbstentions: number;
  hypothesisMismatches: number;
  adaptiveProbes: number;
  multiProbeExperiments: number;
  counterfactualTests: number;
  testsPassed: number;
  testsFailed: number;
  testsUnsupported: number;
}

export interface BuildProvenance {
  version: string;
  commit: string;
  builtAt: string;
}

export interface AnalysisResult {
  runId: string;
  fileName: string;
  createdAt: string;
  build?: BuildProvenance;
  summary: WorkbookSummary;
  findings: Finding[];
  findingIssueFamilies: FindingIssueFamily[];
  semanticNodes: SemanticNode[];
  identityAssessments: SemanticIdentityAssessment[];
  identityViolationGroups: SemanticViolationGroup[];
  generatedHypotheses: GeneratedHypothesis[];
  hypothesisExperiments: HypothesisExperiment[];
  counterfactualTests: CounterfactualTest[];
}

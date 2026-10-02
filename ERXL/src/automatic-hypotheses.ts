import * as XLSX from "xlsx";
import { WorkbookEvaluator } from "./formula-evaluator";
import type {
  GeneratedHypothesis,
  HypothesisExperiment,
  HypothesisOperator,
  MaterialityEstimate,
  SemanticNode,
  SemanticRole
} from "./types";

type Dimension = "money" | "rate" | "multiple" | "units" | "price" | "unknown";

const MONEY_ROLES = new Set<SemanticRole>([
  "revenue",
  "cogs",
  "sga",
  "gross_profit",
  "ebitda",
  "cash",
  "debt",
  "interest_expense",
  "assets",
  "liabilities",
  "equity",
  "enterprise_value",
  "equity_value",
  "capex",
  "working_capital",
  "taxes"
]);

const RATE_ROLES = new Set<SemanticRole>([
  "interest_rate",
  "gross_margin",
  "ebitda_margin",
  "irr"
]);

const AFFINITY: Partial<
  Record<SemanticRole, Partial<Record<SemanticRole, number>>>
> = {
  revenue: {
    units: 0.98,
    price: 0.98,
    gross_margin: 0.35,
    ebitda_margin: 0.3
  },
  gross_profit: {
    revenue: 0.98,
    cogs: 0.98,
    gross_margin: 0.9,
    sga: 0.25,
    ebitda: 0.3
  },
  ebitda: {
    gross_profit: 0.98,
    sga: 0.95,
    revenue: 0.8,
    ebitda_margin: 0.92,
    cogs: 0.35,
    gross_margin: 0.4
  },
  enterprise_value: {
    ebitda: 0.98,
    exit_multiple: 0.98,
    gross_profit: 0.62,
    revenue: 0.55,
    debt: 0.2,
    cash: 0.15,
    equity_value: 0.25
  },
  equity_value: {
    enterprise_value: 0.98,
    debt: 0.95,
    cash: 0.92,
    revenue: 0.35,
    ebitda: 0.35,
    exit_multiple: 0.35
  },
  interest_expense: {
    debt: 0.98,
    interest_rate: 0.98,
    cash: 0.15
  },
  gross_margin: {
    gross_profit: 0.95,
    revenue: 0.95,
    cogs: 0.55
  },
  ebitda_margin: {
    ebitda: 0.95,
    revenue: 0.95,
    gross_profit: 0.55
  },
  price: {
    revenue: 0.88,
    units: 0.88
  },
  units: {
    revenue: 0.88,
    price: 0.88
  }
};

function id(prefix: string): string {
  return prefix + "_" + crypto.randomUUID();
}

function dimension(role: SemanticRole): Dimension {
  if (MONEY_ROLES.has(role)) return "money";
  if (RATE_ROLES.has(role)) return "rate";
  if (role === "exit_multiple") return "multiple";
  if (role === "units") return "units";
  if (role === "price") return "price";
  return "unknown";
}

function resultDimension(
  operator: HypothesisOperator,
  sourceDimensions: Dimension[]
): Dimension {
  if (operator === "add" || operator === "subtract" || operator === "subtract_add") {
    if (sourceDimensions.every(item => item === sourceDimensions[0])) {
      return sourceDimensions[0];
    }
    return "unknown";
  }

  if (operator === "multiply") {
    const [a, b] = sourceDimensions;
    if (
      (a === "money" && (b === "rate" || b === "multiple")) ||
      (b === "money" && (a === "rate" || a === "multiple"))
    ) {
      return "money";
    }
    if (
      (a === "units" && b === "price") ||
      (a === "price" && b === "units")
    ) {
      return "money";
    }
    return "unknown";
  }

  if (operator === "divide") {
    const [a, b] = sourceDimensions;
    if (a === "money" && b === "money") return "rate";
    if (a === "money" && b === "units") return "price";
    if (a === "money" && b === "price") return "units";
    return "unknown";
  }

  if (
    operator === "average_multiply" ||
    operator === "average_multiply_sum_rates" ||
    operator === "average_multiply_diff_rates"
  ) {
    return "money";
  }

  return "unknown";
}

function affinity(target: SemanticRole, source: SemanticRole): number {
  if (target === source) return 0.2;
  return AFFINITY[target]?.[source] ?? 0.32;
}

function label(node: SemanticNode): string {
  if (node.label?.trim()) return node.label.replace(/s*([^)]*)s*$/, "").trim();
  return node.role.replace(/_/g, " ");
}


function normalizeSheetName(sheet: string): string {
  return sheet.replace(/^'/, "").replace(/'$/, "").replace(/''/g, "'");
}

function semanticizeObservedFormula(
  formula: string,
  currentSheet: string,
  byKey: Map<string, SemanticNode>
): string {
  const refRe =
    /(?:(?:'([^']+(?:''[^']+)*)'|([A-Za-z_][A-Za-z0-9_. -]*))!)?\$?([A-Z]{1,3})\$?(\d+)/g;

  let output = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = refRe.exec(formula)) !== null) {
    output += formula.slice(cursor, match.index);

    const sheet = normalizeSheetName(
      match[1] || match[2] || currentSheet
    ).trim();
    const key = sheet + "!" + match[3].toUpperCase() + match[4];
    const role = byKey.get(key)?.role;

    output += role && role !== "unknown" ? "@" + role : "@cell";
    cursor = match.index + match[0].length;
  }

  output += formula.slice(cursor);

  return output
    .replace(/^=/, "")
    .replace(/\b\d+(?:\.\d+)?\b/g, "num")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function expressionFor(
  operator: HypothesisOperator,
  sources: SemanticNode[]
): { expression: string; semanticExpression: string } {
  const names = sources.map(label);
  const roles = sources.map(node => "@" + node.role);

  switch (operator) {
    case "add":
      return {
        expression: names[0] + " + " + names[1],
        semanticExpression: roles[0] + "+" + roles[1]
      };
    case "subtract":
      return {
        expression: names[0] + " − " + names[1],
        semanticExpression: roles[0] + "-" + roles[1]
      };
    case "multiply":
      return {
        expression: names[0] + " × " + names[1],
        semanticExpression: roles[0] + "*" + roles[1]
      };
    case "divide":
      return {
        expression: names[0] + " ÷ " + names[1],
        semanticExpression: roles[0] + "/" + roles[1]
      };
    case "subtract_add":
      return {
        expression: names[0] + " − " + names[1] + " + " + names[2],
        semanticExpression: roles[0] + "-" + roles[1] + "+" + roles[2]
      };
    case "average_multiply":
      return {
        expression:
          "Average(" + names[0] + ", " + names[1] + ") × " + names[2],
        semanticExpression:
          "average(" + roles[0] + "," + roles[1] + ")*" + roles[2]
      };
    case "average_multiply_sum_rates":
      return {
        expression:
          "Average(" +
          names[0] +
          ", " +
          names[1] +
          ") × (" +
          names[2] +
          " + " +
          names[3] +
          ")",
        semanticExpression:
          "average(" +
          roles[0] +
          "," +
          roles[1] +
          ")*(" +
          roles[2] +
          "+" +
          roles[3] +
          ")"
      };
    case "average_multiply_diff_rates":
      return {
        expression:
          "Average(" +
          names[0] +
          ", " +
          names[1] +
          ") × (" +
          names[2] +
          " − " +
          names[3] +
          ")",
        semanticExpression:
          "average(" +
          roles[0] +
          "," +
          roles[1] +
          ")*(" +
          roles[2] +
          "-" +
          roles[3] +
          ")"
      };
  }
}

function operatorBonus(
  target: SemanticRole,
  operator: HypothesisOperator,
  sources: SemanticNode[]
): number {
  const roles = sources.map(source => source.role);

  if (
    target === "revenue" &&
    operator === "multiply" &&
    roles.includes("units") &&
    roles.includes("price")
  ) {
    return 0.08;
  }

  if (
    target === "enterprise_value" &&
    operator === "multiply" &&
    roles.includes("exit_multiple")
  ) {
    return 0.08;
  }

  if (target === "equity_value" && operator === "subtract_add") {
    return 0.08;
  }

  if (
    (target === "gross_profit" || target === "ebitda") &&
    operator === "subtract"
  ) {
    return 0.05;
  }

  if (target === "interest_expense") {
    if (operator === "average_multiply_sum_rates") return 0.1;
    if (operator === "average_multiply") return 0.06;
    if (operator === "multiply") return 0.03;
    if (operator === "average_multiply_diff_rates") return -0.08;
  }

  return 0;
}

function hypothesisScore(
  target: SemanticNode,
  operator: HypothesisOperator,
  sources: SemanticNode[]
): {
  dimensionalScore: number;
  semanticAffinityScore: number;
  simplicityScore: number;
  plausibilityScore: number;
} {
  const targetDimension = dimension(target.role);
  const candidateDimension = resultDimension(
    operator,
    sources.map(source => dimension(source.role))
  );
  const dimensionalScore =
    targetDimension !== "unknown" && candidateDimension === targetDimension
      ? 1
      : 0;

  const semanticAffinityScore =
    sources.reduce(
      (sum, source) => sum + affinity(target.role, source.role),
      0
    ) / sources.length;

  const simplicityScore =
    sources.length <= 2 ? 1 : sources.length === 3 ? 0.85 : 0.75;

  const sameSheetScore =
    sources.filter(source => source.sheet === target.sheet).length /
    sources.length;

  const plausibilityScore = Math.max(
    0,
    Math.min(
      0.99,
      0.3 * dimensionalScore +
        0.45 * semanticAffinityScore +
        0.12 * simplicityScore +
        0.05 * sameSheetScore +
        operatorBonus(target.role, operator, sources)
    )
  );

  return {
    dimensionalScore,
    semanticAffinityScore,
    simplicityScore,
    plausibilityScore
  };
}

function evaluateCandidate(
  candidate: GeneratedHypothesis,
  byId: Map<string, SemanticNode>,
  evaluator: WorkbookEvaluator,
  overrides: Map<string, number> = new Map()
): number {
  const values = candidate.sourceNodeIds.map(sourceId => {
    const node = byId.get(sourceId);
    if (!node) throw new Error("Missing hypothesis source node.");

    if (overrides.has(node.key)) return overrides.get(node.key)!;
    return evaluator.evaluateNumber(node.key);
  });

  switch (candidate.operator) {
    case "add":
      return values[0] + values[1];
    case "subtract":
      return values[0] - values[1];
    case "multiply":
      return values[0] * values[1];
    case "divide":
      return values[0] / values[1];
    case "subtract_add":
      return values[0] - values[1] + values[2];
    case "average_multiply":
      return ((values[0] + values[1]) / 2) * values[2];
    case "average_multiply_sum_rates":
      return ((values[0] + values[1]) / 2) * (values[2] + values[3]);
    case "average_multiply_diff_rates":
      return ((values[0] + values[1]) / 2) * (values[2] - values[3]);
  }
}

function candidateKey(
  target: SemanticNode,
  operator: HypothesisOperator,
  sources: SemanticNode[]
): string {
  return [
    target.key,
    operator,
    ...sources.map(source => source.key)
  ].join("|");
}

function makeCandidate(
  target: SemanticNode,
  operator: HypothesisOperator,
  sources: SemanticNode[],
  evaluator: WorkbookEvaluator,
  byId: Map<string, SemanticNode>,
  basis: string
): GeneratedHypothesis | undefined {
  const scored = hypothesisScore(target, operator, sources);
  if (!scored.dimensionalScore) return undefined;

  const rendered = expressionFor(operator, sources);

  const candidate: GeneratedHypothesis = {
    id: id("hypothesis"),
    targetNodeId: target.id,
    targetKey: target.key,
    targetRole: target.role,
    sheet: target.sheet,
    cell: target.cell,
    operator,
    expression: rendered.expression,
    semanticExpression: rendered.semanticExpression,
    sourceNodeIds: sources.map(source => source.id),
    sourceKeys: sources.map(source => source.key),
    sourceRoles: sources.map(source => source.role),
    dimensionalScore: scored.dimensionalScore,
    semanticAffinityScore: Number(scored.semanticAffinityScore.toFixed(2)),
    simplicityScore: scored.simplicityScore,
    plausibilityScore: Number(scored.plausibilityScore.toFixed(2)),
    generationBasis: basis
  };

  try {
    const baselinePrediction = evaluateCandidate(
      candidate,
      byId,
      evaluator
    );

    if (!Number.isFinite(baselinePrediction)) return undefined;
    candidate.baselinePrediction = baselinePrediction;
    return candidate;
  } catch {
    return undefined;
  }
}

function numericPeers(
  target: SemanticNode,
  nodes: SemanticNode[],
  evaluator: WorkbookEvaluator
): SemanticNode[] {
  const targetColumn = XLSX.utils.decode_cell(target.cell).c;

  return nodes
    .filter(node => {
      if (node.id === target.id || node.role === "unknown") return false;
      if (XLSX.utils.decode_cell(node.cell).c !== targetColumn) return false;

      try {
        return Number.isFinite(evaluator.evaluateNumber(node.key));
      } catch {
        return false;
      }
    })
    .sort((a, b) => {
      const sameSheetDelta =
        Number(b.sheet === target.sheet) - Number(a.sheet === target.sheet);
      if (sameSheetDelta) return sameSheetDelta;

      const affinityDelta =
        affinity(target.role, b.role) - affinity(target.role, a.role);
      if (affinityDelta) return affinityDelta;

      return b.confidence - a.confidence;
    });
}

export function generateAutomaticHypotheses(
  workbook: XLSX.WorkBook,
  nodes: SemanticNode[],
  maxPerTarget = 12
): GeneratedHypothesis[] {
  const evaluator = new WorkbookEvaluator(workbook);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const all: GeneratedHypothesis[] = [];

  for (const target of nodes) {
    if (!target.formula || target.role === "unknown") continue;
    if (dimension(target.role) === "unknown") continue;

    const peers = numericPeers(target, nodes, evaluator).slice(0, 10);
    if (peers.length < 2) continue;

    const candidates = new Map<string, GeneratedHypothesis>();
    const push = (
      operator: HypothesisOperator,
      sources: SemanticNode[],
      basis: string
    ) => {
      if (new Set(sources.map(source => source.id)).size !== sources.length) {
        return;
      }

      const key = candidateKey(target, operator, sources);
      if (candidates.has(key)) return;

      const candidate = makeCandidate(
        target,
        operator,
        sources,
        evaluator,
        byId,
        basis
      );
      if (candidate) candidates.set(key, candidate);
    };

    for (let i = 0; i < peers.length; i++) {
      for (let j = i + 1; j < peers.length; j++) {
        const a = peers[i];
        const b = peers[j];

        push(
          "add",
          [a, b],
          "Generated from dimensionally compatible same-period semantic inputs."
        );
        push(
          "subtract",
          [a, b],
          "Generated from dimensionally compatible same-period semantic inputs."
        );
        push(
          "subtract",
          [b, a],
          "Generated from dimensionally compatible same-period semantic inputs."
        );
        push(
          "multiply",
          [a, b],
          "Generated from generic dimensional multiplication rules."
        );
        push(
          "divide",
          [a, b],
          "Generated from generic dimensional ratio rules."
        );
        push(
          "divide",
          [b, a],
          "Generated from generic dimensional ratio rules."
        );
      }
    }

    const moneyPeers = peers
      .filter(peer => dimension(peer.role) === "money")
      .slice(0, 6);

    for (let i = 0; i < moneyPeers.length; i++) {
      for (let j = 0; j < moneyPeers.length; j++) {
        if (j === i) continue;
        for (let k = 0; k < moneyPeers.length; k++) {
          if (k === i || k === j) continue;
          push(
            "subtract_add",
            [moneyPeers[i], moneyPeers[j], moneyPeers[k]],
            "Generated from a generic three-term money bridge grammar."
          );
        }
      }
    }

    const debtPeers = peers.filter(peer => peer.role === "debt").slice(0, 4);
    const ratePeers = peers
      .filter(peer => peer.role === "interest_rate")
      .slice(0, 4);

    for (let i = 0; i < debtPeers.length; i++) {
      for (let j = i + 1; j < debtPeers.length; j++) {
        for (const rate of ratePeers) {
          push(
            "average_multiply",
            [debtPeers[i], debtPeers[j], rate],
            "Generated from a generic average-balance × rate grammar."
          );
        }

        for (let r1 = 0; r1 < ratePeers.length; r1++) {
          for (let r2 = r1 + 1; r2 < ratePeers.length; r2++) {
            push(
              "average_multiply_sum_rates",
              [debtPeers[i], debtPeers[j], ratePeers[r1], ratePeers[r2]],
              "Generated from a generic average-balance × additive-rate-components grammar."
            );
            push(
              "average_multiply_diff_rates",
              [debtPeers[i], debtPeers[j], ratePeers[r1], ratePeers[r2]],
              "Generated as a competing average-balance × subtractive-rate-components hypothesis."
            );
            push(
              "average_multiply_diff_rates",
              [debtPeers[i], debtPeers[j], ratePeers[r2], ratePeers[r1]],
              "Generated as a competing average-balance × subtractive-rate-components hypothesis."
            );
          }
        }
      }
    }

    const ranked = [...candidates.values()]
      .sort((a, b) => {
        const scoreDelta = b.plausibilityScore - a.plausibilityScore;
        if (scoreDelta) return scoreDelta;
        return a.sourceNodeIds.length - b.sourceNodeIds.length;
      })
      .slice(0, maxPerTarget);

    all.push(...ranked);
  }

  return all;
}

function rankMateriality(relative?: number): MaterialityEstimate["rank"] {
  if (relative === undefined || !Number.isFinite(relative)) return "unknown";
  if (relative >= 0.2) return "critical";
  if (relative >= 0.1) return "high";
  if (relative >= 0.02) return "medium";
  return "low";
}

function chooseDiscriminatingPerturbation(
  target: SemanticNode,
  candidates: GeneratedHypothesis[],
  byId: Map<string, SemanticNode>,
  evaluator: WorkbookEvaluator,
  baselineTarget: number
):
  | {
      node: SemanticNode;
      baselineValue: number;
      perturbationPercent: number;
      perturbedValue: number;
    }
  | undefined {
  const sourceIds = [
    ...new Set(candidates.flatMap(candidate => candidate.sourceNodeIds))
  ];
  const percentages = [0.01, 0.02, 0.05, 0.1];

  let fallback:
    | {
        node: SemanticNode;
        baselineValue: number;
        perturbationPercent: number;
        perturbedValue: number;
        separation: number;
      }
    | undefined;

  for (const perturbationPercent of percentages) {
    let bestAtThisSize:
      | {
          node: SemanticNode;
          baselineValue: number;
          perturbationPercent: number;
          perturbedValue: number;
          separation: number;
        }
      | undefined;

    for (const sourceId of sourceIds) {
      const node = byId.get(sourceId);
      if (!node || node.key === target.key) continue;

      let baselineValue: number;
      try {
        baselineValue = evaluator.evaluateNumber(node.key);
      } catch {
        continue;
      }

      if (!Number.isFinite(baselineValue)) continue;

      const step =
        Math.abs(baselineValue) > 1e-9
          ? baselineValue * perturbationPercent
          : perturbationPercent;
      const perturbedValue = baselineValue + step;
      const overrides = new Map<string, number>([[node.key, perturbedValue]]);

      const deltas: number[] = [];
      for (const candidate of candidates) {
        try {
          const baseline =
            candidate.baselinePrediction ??
            evaluateCandidate(candidate, byId, evaluator);
          const perturbed = evaluateCandidate(
            candidate,
            byId,
            evaluator,
            overrides
          );
          deltas.push(perturbed - baseline);
        } catch {
          // Candidate is simply omitted from this discriminating comparison.
        }
      }

      if (deltas.length < 2) continue;
      const separation =
        (Math.max(...deltas) - Math.min(...deltas)) /
        Math.max(Math.abs(baselineTarget), 1);

      const item = {
        node,
        baselineValue,
        perturbationPercent,
        perturbedValue,
        separation
      };

      if (!fallback || item.separation > fallback.separation) fallback = item;
      if (!bestAtThisSize || item.separation > bestAtThisSize.separation) {
        bestAtThisSize = item;
      }
    }

    if (bestAtThisSize && bestAtThisSize.separation >= 0.005) {
      return bestAtThisSize;
    }
  }

  return fallback;
}

export function runAutomaticHypothesisExperiments(
  workbook: XLSX.WorkBook,
  nodes: SemanticNode[],
  hypotheses: GeneratedHypothesis[],
  maxCandidatesPerExperiment = 6
): HypothesisExperiment[] {
  const evaluator = new WorkbookEvaluator(workbook);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const hypothesesByTarget = new Map<string, GeneratedHypothesis[]>();

  for (const hypothesis of hypotheses) {
    if (!hypothesesByTarget.has(hypothesis.targetNodeId)) {
      hypothesesByTarget.set(hypothesis.targetNodeId, []);
    }
    hypothesesByTarget.get(hypothesis.targetNodeId)!.push(hypothesis);
  }

  const experiments: HypothesisExperiment[] = [];

  for (const [targetNodeId, targetHypotheses] of hypothesesByTarget) {
    const target = byId.get(targetNodeId);
    if (!target || !target.formula) continue;

    const rankedCandidates = [...targetHypotheses]
      .sort((a, b) => b.plausibilityScore - a.plausibilityScore);

    const byKey = new Map(nodes.map(node => [node.key, node]));
    const observedSemanticExpression = semanticizeObservedFormula(
      target.formula,
      target.sheet,
      byKey
    );

    const observedShapeCandidates = rankedCandidates.filter(
      candidate =>
        candidate.semanticExpression.toLowerCase() ===
        observedSemanticExpression
    );

    const candidates = [
      ...rankedCandidates.slice(0, Math.max(2, maxCandidatesPerExperiment - 2)),
      ...observedShapeCandidates
    ]
      .filter(
        (candidate, index, array) =>
          array.findIndex(item => item.id === candidate.id) === index
      )
      .slice(0, maxCandidatesPerExperiment + 2);

    if (candidates.length < 2) continue;

    const preferred = candidates[0];
    let baselineTarget: number;

    try {
      baselineTarget = evaluator.evaluateNumber(target.key);
    } catch (error) {
      experiments.push({
        id: id("hypothesis_experiment"),
        targetNodeId: target.id,
        targetKey: target.key,
        targetRole: target.role,
        sheet: target.sheet,
        cell: target.cell,
        candidateIds: candidates.map(candidate => candidate.id),
        preferredHypothesisId: preferred.id,
        preferredExpression: preferred.expression,
        predictions: [],
        status: "unsupported",
        mismatch: false,
        explanation:
          error instanceof Error
            ? error.message
            : "Target could not be evaluated."
      });
      continue;
    }

    const perturbation = chooseDiscriminatingPerturbation(
      target,
      candidates,
      byId,
      evaluator,
      baselineTarget
    );

    if (!perturbation) {
      experiments.push({
        id: id("hypothesis_experiment"),
        targetNodeId: target.id,
        targetKey: target.key,
        targetRole: target.role,
        sheet: target.sheet,
        cell: target.cell,
        candidateIds: candidates.map(candidate => candidate.id),
        preferredHypothesisId: preferred.id,
        preferredExpression: preferred.expression,
        baselineTarget,
        predictions: [],
        status: "ambiguous",
        mismatch: false,
        explanation:
          "ERXL generated competing hypotheses but could not find a perturbation that separates their predictions."
      });
      continue;
    }

    const overrides = new Map<string, number>([
      [perturbation.node.key, perturbation.perturbedValue]
    ]);

    let observedTarget: number;
    try {
      observedTarget = evaluator.evaluateNumber(target.key, overrides);
    } catch (error) {
      experiments.push({
        id: id("hypothesis_experiment"),
        targetNodeId: target.id,
        targetKey: target.key,
        targetRole: target.role,
        sheet: target.sheet,
        cell: target.cell,
        candidateIds: candidates.map(candidate => candidate.id),
        preferredHypothesisId: preferred.id,
        preferredExpression: preferred.expression,
        perturbation: {
          semanticNodeId: perturbation.node.id,
          key: perturbation.node.key,
          role: perturbation.node.role,
          baselineValue: perturbation.baselineValue,
          perturbationPercent: perturbation.perturbationPercent,
          perturbedValue: perturbation.perturbedValue
        },
        baselineTarget,
        predictions: [],
        status: "unsupported",
        mismatch: false,
        explanation:
          error instanceof Error
            ? error.message
            : "The discriminating perturbation could not be executed."
      });
      continue;
    }

    const predictions = candidates.map(candidate => {
      try {
        const baseline =
          candidate.baselinePrediction ??
          evaluateCandidate(candidate, byId, evaluator);
        const perturbed = evaluateCandidate(
          candidate,
          byId,
          evaluator,
          overrides
        );
        const normalizedError =
          Math.abs(perturbed - observedTarget) /
          Math.max(Math.abs(observedTarget), 1);

        return {
          hypothesisId: candidate.id,
          expression: candidate.expression,
          baseline,
          perturbed,
          delta: perturbed - baseline,
          normalizedError
        };
      } catch (error) {
        return {
          hypothesisId: candidate.id,
          expression: candidate.expression,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });

    const rankedMatches = predictions
      .filter(
        prediction =>
          prediction.normalizedError !== undefined &&
          Number.isFinite(prediction.normalizedError)
      )
      .sort(
        (a, b) =>
          (a.normalizedError as number) - (b.normalizedError as number)
      );

    if (!rankedMatches.length) {
      experiments.push({
        id: id("hypothesis_experiment"),
        targetNodeId: target.id,
        targetKey: target.key,
        targetRole: target.role,
        sheet: target.sheet,
        cell: target.cell,
        candidateIds: candidates.map(candidate => candidate.id),
        preferredHypothesisId: preferred.id,
        preferredExpression: preferred.expression,
        perturbation: {
          semanticNodeId: perturbation.node.id,
          key: perturbation.node.key,
          role: perturbation.node.role,
          baselineValue: perturbation.baselineValue,
          perturbationPercent: perturbation.perturbationPercent,
          perturbedValue: perturbation.perturbedValue
        },
        baselineTarget,
        observedTarget,
        predictions,
        status: "unsupported",
        mismatch: false,
        explanation:
          "Candidate predictions could not be evaluated under the discriminating perturbation."
      });
      continue;
    }

    const bestMatch = rankedMatches[0];
    const secondMatch = rankedMatches[1];
    const implemented = candidates.find(
      candidate => candidate.id === bestMatch.hypothesisId
    );
    const bestError = bestMatch.normalizedError as number;
    const secondError =
      secondMatch?.normalizedError === undefined
        ? Number.POSITIVE_INFINITY
        : (secondMatch.normalizedError as number);

    const isAmbiguous =
      bestError > 0.12 ||
      (Number.isFinite(secondError) && secondError - bestError < 0.02);

    const plausibilityGap = implemented
      ? preferred.plausibilityScore - implemented.plausibilityScore
      : 0;

    const mismatch =
      !isAmbiguous &&
      Boolean(implemented) &&
      implemented!.id !== preferred.id &&
      bestError <= 0.08 &&
      plausibilityGap >= 0.08;

    const expected = preferred.baselinePrediction;
    const relativeImpact =
      expected === undefined
        ? undefined
        : Math.abs(baselineTarget - expected) /
          Math.max(Math.abs(expected), 1e-9);

    const materiality: MaterialityEstimate | undefined =
      expected === undefined
        ? undefined
        : {
            actual: baselineTarget,
            expected,
            absoluteImpact: Math.abs(baselineTarget - expected),
            relativeImpact,
            rank: rankMateriality(relativeImpact)
          };

    const status: HypothesisExperiment["status"] = isAmbiguous
      ? "ambiguous"
      : "executed";

    experiments.push({
      id: id("hypothesis_experiment"),
      targetNodeId: target.id,
      targetKey: target.key,
      targetRole: target.role,
      sheet: target.sheet,
      cell: target.cell,
      candidateIds: candidates.map(candidate => candidate.id),
      preferredHypothesisId: preferred.id,
      implementedHypothesisId: implemented?.id,
      preferredExpression: preferred.expression,
      implementedExpression: implemented?.expression,
      perturbation: {
        semanticNodeId: perturbation.node.id,
        key: perturbation.node.key,
        role: perturbation.node.role,
        baselineValue: perturbation.baselineValue,
        perturbationPercent: perturbation.perturbationPercent,
        perturbedValue: perturbation.perturbedValue
      },
      baselineTarget,
      observedTarget,
      predictions,
      status,
      mismatch,
      implementedMatchScore: Number(
        Math.max(0, 1 - Math.min(bestError, 1)).toFixed(2)
      ),
      plausibilityGap: Number(plausibilityGap.toFixed(2)),
      explanation: isAmbiguous
        ? "The perturbation did not separate the leading candidate hypotheses strongly enough."
        : mismatch
          ? "The workbook's observed response matches a lower-plausibility generated hypothesis more closely than ERXL's preferred hypothesis."
          : "The workbook's observed response is consistent with the preferred generated hypothesis.",
      materiality
    });
  }

  return experiments.sort((a, b) => {
    if (a.mismatch !== b.mismatch) return a.mismatch ? -1 : 1;
    const aMateriality = a.materiality?.relativeImpact || 0;
    const bMateriality = b.materiality?.relativeImpact || 0;
    return bMateriality - aMateriality;
  });
}

import * as XLSX from "xlsx";
import { WorkbookEvaluator } from "./formula-evaluator";
import type {
  GeneratedHypothesis,
  HypothesisExperiment,
  HypothesisOperator,
  HypothesisPrediction,
  MaterialityEstimate,
  SemanticNode,
  SemanticRole
} from "./types";

type Dimension = "money" | "rate" | "multiple" | "units" | "price" | "unknown";

const MIN_GENERATED_PRIOR = 0.64;
const MIN_PREFERRED_PRIOR = 0.72;

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
  const raw = node.label?.trim();
  if (raw) return raw;
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

const RATIO_BASE_SCORE: Partial<Record<SemanticRole, number>> = {
  revenue: 1,
  assets: 0.82,
  debt: 0.72,
  enterprise_value: 0.7,
  equity_value: 0.66,
  liabilities: 0.62,
  gross_profit: 0.5,
  cogs: 0.5,
  ebitda: 0.45,
  working_capital: 0.42,
  cash: 0.38,
  sga: 0.35,
  capex: 0.32,
  interest_expense: 0.3,
  taxes: 0.3
};

function roleTokens(role: SemanticRole): string[] {
  const generic = new Set([
    "margin",
    "rate",
    "value",
    "expense",
    "total",
    "net",
    "ending",
    "closing"
  ]);

  return role
    .split("_")
    .filter(token => token && !generic.has(token));
}

function orderedRoleOverlap(
  target: SemanticRole,
  source: SemanticRole
): number {
  const targetTokens = new Set(roleTokens(target));
  const sourceTokens = roleTokens(source);

  if (!targetTokens.size || !sourceTokens.length) return 0;

  const overlap = sourceTokens.filter(token => targetTokens.has(token)).length;
  return overlap / Math.max(targetTokens.size, sourceTokens.length);
}

function ratioOrientationAdjustment(
  target: SemanticNode,
  operator: HypothesisOperator,
  sources: SemanticNode[]
): number {
  if (operator !== "divide" || sources.length !== 2) return 0;

  const [numerator, denominator] = sources;
  if (
    dimension(target.role) !== "rate" ||
    dimension(numerator.role) !== "money" ||
    dimension(denominator.role) !== "money"
  ) {
    return 0;
  }

  // For named financial ratios, the numerator usually carries the semantic
  // concept named by the target (EBITDA margin -> EBITDA; gross margin ->
  // gross profit), while the denominator is typically the broader scale base.
  // This is generic ordered-role scoring, not an exact formula lookup.
  const numeratorAlignment = orderedRoleOverlap(
    target.role,
    numerator.role
  );
  const denominatorAlignment = orderedRoleOverlap(
    target.role,
    denominator.role
  );

  const numeratorBase = RATIO_BASE_SCORE[numerator.role] ?? 0.4;
  const denominatorBase = RATIO_BASE_SCORE[denominator.role] ?? 0.4;

  return (
    0.08 * (numeratorAlignment - denominatorAlignment) +
    0.05 * (denominatorBase - numeratorBase)
  );
}

function ratioScaleAdjustment(
  target: SemanticNode,
  operator: HypothesisOperator,
  baselinePrediction: number
): number {
  if (
    operator !== "divide" ||
    dimension(target.role) !== "rate" ||
    !Number.isFinite(baselinePrediction)
  ) {
    return 0;
  }

  const magnitude = Math.abs(baselinePrediction);

  // Financial rates/margins are commonly represented as decimal fractions.
  // This is intentionally soft: extreme but valid rates are not rejected.
  if (magnitude <= 1.5) return 0.025;
  if (magnitude > 5) return -0.08;
  if (magnitude > 2) return -0.035;
  return 0;
}


const SUBTRACTION_BASE_SCORE: Partial<Record<SemanticRole, number>> = {
  revenue: 1,
  enterprise_value: 0.96,
  assets: 0.94,
  gross_profit: 0.9,
  ebitda: 0.84,
  equity_value: 0.82,
  debt: 0.72,
  liabilities: 0.7,
  cash: 0.62,
  working_capital: 0.58,
  cogs: 0.46,
  sga: 0.38,
  capex: 0.36,
  interest_expense: 0.32,
  taxes: 0.3
};

function subtractionOrientationAdjustment(
  target: SemanticNode,
  operator: HypothesisOperator,
  sources: SemanticNode[]
): number {
  if (operator !== "subtract" || sources.length !== 2) return 0;

  const [minuend, subtrahend] = sources;
  if (
    dimension(target.role) !== "money" ||
    dimension(minuend.role) !== "money" ||
    dimension(subtrahend.role) !== "money"
  ) {
    return 0;
  }

  // Subtraction is directional. In financial bridges, the left-hand amount
  // is commonly the broader/base amount and the right-hand amount a component
  // being removed. This is a soft role hierarchy, not an exact identity rule.
  const minuendBase = SUBTRACTION_BASE_SCORE[minuend.role] ?? 0.5;
  const subtrahendBase = SUBTRACTION_BASE_SCORE[subtrahend.role] ?? 0.5;

  return 0.09 * (minuendBase - subtrahendBase);
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
        operatorBonus(target.role, operator, sources) +
        ratioOrientationAdjustment(target, operator, sources) +
        subtractionOrientationAdjustment(target, operator, sources)
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
    semanticAffinityScore: scored.semanticAffinityScore,
    simplicityScore: scored.simplicityScore,
    plausibilityScore: scored.plausibilityScore,
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
    candidate.plausibilityScore = Math.max(
      0,
      Math.min(
        0.99,
        candidate.plausibilityScore +
          ratioScaleAdjustment(target, operator, baselinePrediction)
      )
    );

    if (operator === "divide" && dimension(target.role) === "rate") {
      candidate.generationBasis +=
        " Ordered ratio orientation and scale sanity were included in ranking.";
    }

    if (operator === "subtract" && dimension(target.role) === "money") {
      candidate.generationBasis +=
        " Ordered subtraction orientation was included in prior ranking; observed target behavior is not used to score the prior.";
    }

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

function compareHypotheses(
  a: GeneratedHypothesis,
  b: GeneratedHypothesis
): number {
  const scoreDelta = b.plausibilityScore - a.plausibilityScore;
  if (Math.abs(scoreDelta) > 1e-12) return scoreDelta;

  const affinityDelta = b.semanticAffinityScore - a.semanticAffinityScore;
  if (Math.abs(affinityDelta) > 1e-12) return affinityDelta;

  const simplicityDelta = b.simplicityScore - a.simplicityScore;
  if (Math.abs(simplicityDelta) > 1e-12) return simplicityDelta;

  const sourceCountDelta = a.sourceNodeIds.length - b.sourceNodeIds.length;
  if (sourceCountDelta) return sourceCountDelta;

  const semanticDelta = a.semanticExpression.localeCompare(
    b.semanticExpression
  );
  if (semanticDelta) return semanticDelta;

  return a.expression.localeCompare(b.expression);
}

export function generateAutomaticHypotheses(
  workbook: XLSX.WorkBook,
  nodes: SemanticNode[],
  maxPerTarget = 8
): GeneratedHypothesis[] {
  const evaluator = new WorkbookEvaluator(workbook);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const byKey = new Map(nodes.map(node => [node.key, node]));
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

    const fullyRanked = [...candidates.values()].sort(compareHypotheses);

    const observedSemanticExpression = semanticizeObservedFormula(
      target.formula,
      target.sheet,
      byKey
    );
    const observedShapeCandidates = fullyRanked.filter(
      candidate =>
        candidate.semanticExpression.toLowerCase() ===
        observedSemanticExpression
    );

    const plausibleCandidates = fullyRanked.filter(
      candidate => candidate.plausibilityScore >= MIN_GENERATED_PRIOR
    );

    const retained = [
      ...plausibleCandidates.slice(0, Math.max(2, maxPerTarget - 2)),
      ...observedShapeCandidates
    ]
      .filter(
        (candidate, index, array) =>
          array.findIndex(item => item.id === candidate.id) === index
      )
      .slice(0, maxPerTarget);

    all.push(...retained);
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

function normalizeProbabilities(values: number[]): number[] {
  const safe = values.map(value => Number.isFinite(value) && value > 0 ? value : 0);
  const total = safe.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return safe.map(() => 1 / Math.max(1, safe.length));
  return safe.map(value => value / total);
}

function entropy(probabilities: number[]): number {
  return probabilities.reduce(
    (sum, probability) =>
      probability > 0 ? sum - probability * Math.log2(probability) : sum,
    0
  );
}

function likelihood(
  observed: number,
  predicted: number,
  scale: number
): number {
  const sigma = Math.max(Math.abs(scale) * 0.03, 1e-6);
  const z = (observed - predicted) / sigma;
  return Math.exp(-0.5 * z * z);
}

function updatePosterior(
  prior: number[],
  predicted: number[],
  observed: number,
  scale: number
): number[] {
  return normalizeProbabilities(
    prior.map((probability, index) =>
      probability * likelihood(observed, predicted[index], scale)
    )
  );
}

function expectedInformationGain(
  prior: number[],
  predicted: number[],
  scale: number
): number {
  if (predicted.length < 2) return 0;
  const before = entropy(prior);
  let expectedAfter = 0;

  for (let i = 0; i < predicted.length; i++) {
    const posterior = updatePosterior(prior, predicted, predicted[i], scale);
    expectedAfter += prior[i] * entropy(posterior);
  }

  return Math.max(0, before - expectedAfter);
}

function chooseAdaptiveProbe(
  target: SemanticNode,
  candidates: GeneratedHypothesis[],
  byId: Map<string, SemanticNode>,
  evaluator: WorkbookEvaluator,
  posterior: number[],
  baselineTarget: number,
  used: Set<string>
):
  | {
      node: SemanticNode;
      baselineValue: number;
      perturbationPercent: number;
      perturbedValue: number;
      expectedInformationGain: number;
      predictions: number[];
    }
  | undefined {
  const sourceIds = [
    ...new Set(candidates.flatMap(candidate => candidate.sourceNodeIds))
  ];

  // Deterministic bounded search. v0.5 optimizes expected information gain
  // over a continuous-like probe grid rather than accepting the first
  // separating perturbation size.
  const percentages = [
    -0.1, -0.075, -0.05, -0.03, -0.02, -0.01,
     0.01,  0.02,   0.03,  0.05,  0.075, 0.1
  ];

  let best:
    | {
        node: SemanticNode;
        baselineValue: number;
        perturbationPercent: number;
        perturbedValue: number;
        expectedInformationGain: number;
        predictions: number[];
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

    for (const perturbationPercent of percentages) {
      const signature = node.key + "|" + perturbationPercent;
      if (used.has(signature)) continue;

      const step =
        Math.abs(baselineValue) > 1e-9
          ? baselineValue * perturbationPercent
          : perturbationPercent;
      const perturbedValue = baselineValue + step;
      const overrides = new Map<string, number>([[node.key, perturbedValue]]);

      const predictions: number[] = [];
      let valid = true;

      for (const candidate of candidates) {
        try {
          const predicted = evaluateCandidate(
            candidate,
            byId,
            evaluator,
            overrides
          );
          if (!Number.isFinite(predicted)) {
            valid = false;
            break;
          }
          predictions.push(predicted);
        } catch {
          valid = false;
          break;
        }
      }

      if (!valid || predictions.length !== candidates.length) continue;

      const infoGain = expectedInformationGain(
        posterior,
        predictions,
        Math.max(Math.abs(baselineTarget), 1)
      );

      if (
        !best ||
        infoGain > best.expectedInformationGain + 1e-12 ||
        (
          Math.abs(infoGain - best.expectedInformationGain) <= 1e-12 &&
          Math.abs(perturbationPercent) < Math.abs(best.perturbationPercent)
        )
      ) {
        best = {
          node,
          baselineValue,
          perturbationPercent,
          perturbedValue,
          expectedInformationGain: infoGain,
          predictions
        };
      }
    }
  }

  return best && best.expectedInformationGain >= 0.002 ? best : undefined;
}

export function runAutomaticHypothesisExperiments(
  workbook: XLSX.WorkBook,
  nodes: SemanticNode[],
  hypotheses: GeneratedHypothesis[],
  maxCandidatesPerExperiment = 6
): HypothesisExperiment[] {
  const evaluator = new WorkbookEvaluator(workbook);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const byKey = new Map(nodes.map(node => [node.key, node]));
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

    const rankedCandidates = [...targetHypotheses].sort(compareHypotheses);
    const observedSemanticExpression = semanticizeObservedFormula(
      target.formula,
      target.sheet,
      byKey
    );
    const observedShapeCandidates = rankedCandidates.filter(
      candidate =>
        candidate.semanticExpression.toLowerCase() === observedSemanticExpression
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

    if (!candidates.length) continue;

    const preferred = candidates[0];
    const common = {
      id: id("hypothesis_experiment"),
      targetNodeId: target.id,
      targetKey: target.key,
      targetRole: target.role,
      sheet: target.sheet,
      cell: target.cell,
      candidateIds: candidates.map(candidate => candidate.id),
      preferredHypothesisId: preferred.id,
      preferredExpression: preferred.expression,
      preferredPlausibilityScore: preferred.plausibilityScore
    };

    if (preferred.plausibilityScore < MIN_PREFERRED_PRIOR) {
      experiments.push({
        ...common,
        predictions: [],
        probes: [],
        posterior: candidates.map(candidate => ({
          hypothesisId: candidate.id,
          expression: candidate.expression,
          priorProbability: 0,
          posteriorProbability: 0
        })),
        status: "abstained",
        stopReason: "abstained",
        mismatch: false,
        explanation:
          "ERXL abstained because no generated hypothesis cleared the minimum prior-plausibility threshold."
      });
      continue;
    }

    if (candidates.length < 2) {
      experiments.push({
        ...common,
        predictions: [],
        probes: [],
        posterior: [],
        status: "abstained",
        stopReason: "abstained",
        mismatch: false,
        explanation:
          "ERXL abstained because only one sufficiently plausible candidate remained after pruning."
      });
      continue;
    }

    let baselineTarget: number;
    try {
      baselineTarget = evaluator.evaluateNumber(target.key);
    } catch (error) {
      experiments.push({
        ...common,
        predictions: [],
        probes: [],
        posterior: [],
        status: "unsupported",
        stopReason: "unsupported",
        mismatch: false,
        explanation:
          error instanceof Error ? error.message : "Target could not be evaluated."
      });
      continue;
    }

    const priors = normalizeProbabilities(
      candidates.map(candidate =>
        Math.max(1e-6, candidate.plausibilityScore) ** 3
      )
    );

    // Prior plausibility remains purely semantic/dimensional. Behavioral
    // evidence begins here with the already-observed baseline target value,
    // before any active intervention is selected.
    const baselinePredictions = candidates.map(candidate =>
      candidate.baselinePrediction ??
      evaluateCandidate(candidate, byId, evaluator)
    );
    let posterior = updatePosterior(
      priors,
      baselinePredictions,
      baselineTarget,
      Math.max(Math.abs(baselineTarget), 1)
    );

    const initialEntropy = entropy(priors);
    const evidenceErrors: number[][] = candidates.map((candidate, index) => [
      Math.abs(baselinePredictions[index] - baselineTarget) /
        Math.max(Math.abs(baselineTarget), 1)
    ]);
    const probes: NonNullable<HypothesisExperiment["probes"]> = [];
    const used = new Set<string>();
    let lastPredictions: HypothesisPrediction[] = [];
    let lastObservedTarget: number | undefined;
    let stopReason: HypothesisExperiment["stopReason"] = "max_probes";

    for (let probeIndex = 0; probeIndex < 3; probeIndex++) {
      const topBefore = Math.max(...posterior);
      if (probeIndex > 0 && topBefore >= 0.92) {
        stopReason = "identified";
        break;
      }

      const probe = chooseAdaptiveProbe(
        target,
        candidates,
        byId,
        evaluator,
        probeIndex === 0 ? priors : posterior,
        baselineTarget,
        used
      );

      if (!probe) {
        stopReason = probeIndex === 0 ? "no_informative_probe" : "identified";
        break;
      }

      used.add(probe.node.key + "|" + probe.perturbationPercent);
      const overrides = new Map<string, number>([
        [probe.node.key, probe.perturbedValue]
      ]);

      let observedTarget: number;
      try {
        observedTarget = evaluator.evaluateNumber(target.key, overrides);
      } catch {
        stopReason = "unsupported";
        break;
      }

      lastObservedTarget = observedTarget;
      lastPredictions = candidates.map((candidate, index) => {
        const predicted = probe.predictions[index];
        const baseline =
          candidate.baselinePrediction ??
          evaluateCandidate(candidate, byId, evaluator);
        return {
          hypothesisId: candidate.id,
          expression: candidate.expression,
          baseline,
          perturbed: predicted,
          delta: predicted - baseline,
          normalizedError:
            Math.abs(predicted - observedTarget) /
            Math.max(Math.abs(observedTarget), 1)
        };
      });

      for (let index = 0; index < candidates.length; index++) {
        evidenceErrors[index].push(
          Math.abs(probe.predictions[index] - observedTarget) /
            Math.max(Math.abs(observedTarget), 1)
        );
      }

      posterior = updatePosterior(
        posterior,
        probe.predictions,
        observedTarget,
        Math.max(Math.abs(baselineTarget), 1)
      );

      probes.push({
        semanticNodeId: probe.node.id,
        key: probe.node.key,
        role: probe.node.role,
        baselineValue: probe.baselineValue,
        perturbationPercent: probe.perturbationPercent,
        perturbedValue: probe.perturbedValue,
        expectedInformationGain: probe.expectedInformationGain,
        observedTarget,
        predictedTargets: candidates.map((candidate, index) => ({
          hypothesisId: candidate.id,
          predictedTarget: probe.predictions[index]
        }))
      });

      const topAfter = Math.max(...posterior);
      const rankedPosterior = [...posterior].sort((a, b) => b - a);
      const margin = topAfter - (rankedPosterior[1] ?? 0);

      if (topAfter >= 0.92 && margin >= 0.2) {
        stopReason = "identified";
        break;
      }
    }

    const posteriorRows = candidates
      .map((candidate, index) => ({
        hypothesisId: candidate.id,
        expression: candidate.expression,
        priorProbability: priors[index],
        posteriorProbability: posterior[index]
      }))
      .sort((a, b) => b.posteriorProbability - a.posteriorProbability);

    const behavioralRanking = candidates
      .map((candidate, index) => ({
        candidate,
        averageError:
          evidenceErrors[index].reduce((sum, error) => sum + error, 0) /
          Math.max(1, evidenceErrors[index].length),
        posteriorProbability: posterior[index]
      }))
      .sort(
        (a, b) =>
          a.averageError - b.averageError ||
          b.posteriorProbability - a.posteriorProbability
      );

    const bestBehavior = behavioralRanking[0];
    const secondBehavior = behavioralRanking[1];
    const implemented = bestBehavior?.candidate;
    const posteriorConfidence = bestBehavior?.posteriorProbability ?? 0;
    const entropyReduction = Math.max(0, initialEntropy - entropy(posterior));
    const bestError = bestBehavior?.averageError ?? Number.POSITIVE_INFINITY;
    const secondError =
      secondBehavior?.averageError ?? Number.POSITIVE_INFINITY;

    const poorFit = bestError > 0.12;

    if (poorFit && stopReason !== "unsupported") {
      stopReason = "poor_fit";
    } else if (!poorFit && stopReason === "max_probes" && posteriorConfidence >= 0.75) {
      stopReason = "identified";
    }

    const isAmbiguous =
      !implemented ||
      poorFit ||
      (
        Number.isFinite(secondError) &&
        secondError - bestError < 0.015 &&
        posteriorConfidence < 0.75
      ) ||
      probes.length === 0;

    const plausibilityGap = implemented
      ? preferred.plausibilityScore - implemented.plausibilityScore
      : 0;

    const mismatch =
      !isAmbiguous &&
      implemented!.id !== preferred.id &&
      posteriorConfidence >= 0.65 &&
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

    const status: HypothesisExperiment["status"] =
      stopReason === "unsupported"
        ? "unsupported"
        : isAmbiguous
          ? "ambiguous"
          : "executed";

    const firstProbe = probes[0];

    experiments.push({
      ...common,
      implementedHypothesisId: implemented?.id,
      implementedExpression: implemented?.expression,
      perturbation: firstProbe
        ? {
            semanticNodeId: firstProbe.semanticNodeId,
            key: firstProbe.key,
            role: firstProbe.role,
            baselineValue: firstProbe.baselineValue,
            perturbationPercent: firstProbe.perturbationPercent,
            perturbedValue: firstProbe.perturbedValue
          }
        : undefined,
      baselineTarget,
      observedTarget: lastObservedTarget,
      predictions: lastPredictions,
      probes,
      posterior: posteriorRows,
      posteriorConfidence,
      entropyReduction,
      stopReason,
      status,
      mismatch,
      implementedMatchScore: Number(
        Math.max(0, Math.min(1, posteriorConfidence)).toFixed(4)
      ),
      plausibilityGap: Number(plausibilityGap.toFixed(4)),
      explanation:
        stopReason === "unsupported"
          ? "ERXL could not execute one of the adaptive behavioral probes."
          : probes.length === 0
            ? "ERXL generated competing hypotheses but found no probe with enough expected information gain."
            : stopReason === "poor_fit"
              ? "The posterior concentrated on one candidate, but that candidate does not reproduce the workbook behavior closely enough; ERXL therefore keeps the result ambiguous."
              : isAmbiguous
                ? "Adaptive probing reduced uncertainty, but the posterior evidence was not strong enough to identify one implemented hypothesis conclusively."
              : implemented?.id === preferred.id
                ? "Adaptive behavioral probing identified the preferred generated hypothesis as the workbook's implemented behavior."
                : mismatch
                  ? "Adaptive behavioral probing identified a lower-prior hypothesis as the workbook's implemented behavior with high posterior confidence."
                  : "Adaptive behavioral probing identified an alternative hypothesis, but the prior-plausibility gap is below ERXL's mismatch threshold.",
      materiality
    });
  }

  return experiments.sort((a, b) => {
    if (a.mismatch !== b.mismatch) return a.mismatch ? -1 : 1;
    const aConfidence = a.posteriorConfidence || 0;
    const bConfidence = b.posteriorConfidence || 0;
    if (aConfidence !== bConfidence) return bConfidence - aConfidence;
    const aMateriality = a.materiality?.relativeImpact || 0;
    const bMateriality = b.materiality?.relativeImpact || 0;
    return bMateriality - aMateriality;
  });
}

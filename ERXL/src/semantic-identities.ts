import * as XLSX from "xlsx";
import { WorkbookEvaluator } from "./formula-evaluator";
import type {
  IdentityHypothesisScore,
  MaterialityEstimate,
  RootCauseCandidate,
  SemanticIdentityAssessment,
  SemanticNode,
  SemanticViolationGroup,
  SemanticRole
} from "./types";

interface Hypothesis {
  name: string;
  canonical: boolean;
  requiredRoles: SemanticRole[];
}

interface IdentityRule {
  targetRole: SemanticRole;
  identityName: string;
  canonicalExpression: string;
  confidence: number;
  hypotheses: Hypothesis[];
  antiPattern?: (semanticExpression: string) => string | undefined;
  materiality?: (
    evaluator: WorkbookEvaluator,
    target: SemanticNode,
    nodes: SemanticNode[]
  ) => MaterialityEstimate | undefined;
}

function id(prefix: string): string {
  return prefix + "_" + crypto.randomUUID();
}

function normalizeSheetName(sheet: string): string {
  return sheet.replace(/^'/, "").replace(/'$/, "").replace(/''/g, "'");
}

function semanticizeFormula(
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
    .replace(/\b\d+(?:\.\d+)?\b/g, "NUM")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function scoreHypothesis(
  observed: Set<SemanticRole>,
  hypothesis: Hypothesis
): IdentityHypothesisScore {
  const matchedCount = hypothesis.requiredRoles.filter(role =>
    observed.has(role)
  ).length;

  const score = hypothesis.requiredRoles.length
    ? matchedCount / hypothesis.requiredRoles.length
    : 0;

  return {
    name: hypothesis.name,
    canonical: hypothesis.canonical,
    requiredRoles: hypothesis.requiredRoles,
    score: Number(score.toFixed(2)),
    matched: matchedCount === hypothesis.requiredRoles.length
  };
}

function cellColumn(node: SemanticNode): number {
  return XLSX.utils.decode_cell(node.cell).c;
}

function findPeer(
  role: SemanticRole,
  target: SemanticNode,
  nodes: SemanticNode[]
): SemanticNode | undefined {
  const targetCol = cellColumn(target);
  const candidates = nodes.filter(
    node =>
      node.role === role &&
      node.key !== target.key &&
      cellColumn(node) === targetCol
  );

  return candidates.sort((a, b) => {
    const sameSheetA = a.sheet === target.sheet ? 1 : 0;
    const sameSheetB = b.sheet === target.sheet ? 1 : 0;
    if (sameSheetB !== sameSheetA) return sameSheetB - sameSheetA;
    return b.confidence - a.confidence;
  })[0];
}

function rankMateriality(relative?: number): MaterialityEstimate["rank"] {
  if (relative === undefined || !Number.isFinite(relative)) return "unknown";
  if (relative >= 0.2) return "critical";
  if (relative >= 0.1) return "high";
  if (relative >= 0.02) return "medium";
  return "low";
}

function exactProductMateriality(
  leftRole: SemanticRole,
  rightRole: SemanticRole
) {
  return (
    evaluator: WorkbookEvaluator,
    target: SemanticNode,
    nodes: SemanticNode[]
  ): MaterialityEstimate | undefined => {
    const left = findPeer(leftRole, target, nodes);
    const right = findPeer(rightRole, target, nodes);
    if (!left || !right) return undefined;

    try {
      const actual = evaluator.evaluateNumber(target.key);
      const expected =
        evaluator.evaluateNumber(left.key) * evaluator.evaluateNumber(right.key);

      if (!Number.isFinite(actual) || !Number.isFinite(expected)) return undefined;

      const absoluteImpact = Math.abs(actual - expected);
      const relativeImpact =
        absoluteImpact / Math.max(Math.abs(expected), 1e-9);

      return {
        actual,
        expected,
        absoluteImpact,
        relativeImpact,
        rank: rankMateriality(relativeImpact)
      };
    } catch {
      return undefined;
    }
  };
}


function equityBridgeMateriality(
  evaluator: WorkbookEvaluator,
  target: SemanticNode,
  nodes: SemanticNode[]
): MaterialityEstimate | undefined {
  const enterpriseValue = findPeer("enterprise_value", target, nodes);
  const debt = findPeer("debt", target, nodes);
  const cash = findPeer("cash", target, nodes);

  if (!enterpriseValue || !debt) return undefined;

  try {
    const actual = evaluator.evaluateNumber(target.key);
    const expected =
      evaluator.evaluateNumber(enterpriseValue.key) -
      evaluator.evaluateNumber(debt.key) +
      (cash ? evaluator.evaluateNumber(cash.key) : 0);

    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return undefined;

    const absoluteImpact = Math.abs(actual - expected);
    const relativeImpact =
      absoluteImpact / Math.max(Math.abs(expected), 1e-9);

    return {
      actual,
      expected,
      absoluteImpact,
      relativeImpact,
      rank: rankMateriality(relativeImpact)
    };
  } catch {
    return undefined;
  }
}

function materialityRankValue(rank: MaterialityEstimate["rank"] | undefined): number {
  return {
    unknown: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4
  }[rank || "unknown"];
}

function compactAffectedRange(cells: string[]): string {
  if (!cells.length) return "";

  const decoded = cells
    .map(cell => ({ cell, pos: XLSX.utils.decode_cell(cell) }))
    .sort((a, b) => a.pos.r - b.pos.r || a.pos.c - b.pos.c);

  const sameRow = decoded.every(item => item.pos.r === decoded[0].pos.r);
  const sameCol = decoded.every(item => item.pos.c === decoded[0].pos.c);

  if (decoded.length > 1 && (sameRow || sameCol)) {
    const first = decoded[0];
    const last = decoded[decoded.length - 1];
    const contiguous = decoded.every((item, index) => {
      if (index === 0) return true;
      const previous = decoded[index - 1].pos;
      return sameRow
        ? item.pos.c === previous.c + 1
        : item.pos.r === previous.r + 1;
    });

    if (contiguous) return first.cell + ":" + last.cell;
  }

  return decoded.map(item => item.cell).join(", ");
}

export function groupSemanticIdentityViolations(
  assessments: SemanticIdentityAssessment[]
): SemanticViolationGroup[] {
  const buckets = new Map<string, SemanticIdentityAssessment[]>();

  for (const assessment of assessments) {
    if (assessment.status !== "violated") continue;

    const bestCompeting = [...assessment.hypotheses]
      .filter(hypothesis => !hypothesis.canonical)
      .sort((a, b) => b.score - a.score)[0];

    const key = [
      assessment.sheet,
      assessment.targetRole,
      assessment.identityName,
      assessment.semanticExpression,
      bestCompeting?.name || ""
    ].join("|");

    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(assessment);
  }

  const groups: SemanticViolationGroup[] = [];

  for (const bucket of buckets.values()) {
    const sorted = [...bucket].sort((a, b) => {
      const left = XLSX.utils.decode_cell(a.cell);
      const right = XLSX.utils.decode_cell(b.cell);
      return left.r - right.r || left.c - right.c;
    });

    const worstMateriality = sorted
      .map(item => item.materiality)
      .filter((item): item is MaterialityEstimate => Boolean(item))
      .sort((a, b) => {
        const rankDelta =
          materialityRankValue(b.rank) - materialityRankValue(a.rank);
        if (rankDelta) return rankDelta;
        return (b.relativeImpact || 0) - (a.relativeImpact || 0);
      })[0];

    const uniqueCauses = new Map<string, RootCauseCandidate>();
    for (const assessment of sorted) {
      for (const cause of assessment.rootCauseCandidates) {
        const prior = uniqueCauses.get(cause.cellKey);
        if (!prior || cause.score > prior.score) {
          uniqueCauses.set(cause.cellKey, cause);
        }
      }
    }

    const confidence =
      sorted.reduce((sum, item) => sum + item.confidence, 0) / sorted.length;

    groups.push({
      id: id("identity_group"),
      identityName: sorted[0].identityName,
      targetRole: sorted[0].targetRole,
      sheet: sorted[0].sheet,
      affectedCells: sorted.map(item => item.cell),
      affectedRange: compactAffectedRange(sorted.map(item => item.cell)),
      affectedCount: sorted.length,
      canonicalExpression: sorted[0].canonicalExpression,
      semanticExpression: sorted[0].semanticExpression,
      explanation: sorted[0].explanation,
      confidence: Number(confidence.toFixed(2)),
      hypotheses: sorted[0].hypotheses,
      assessmentIds: sorted.map(item => item.id),
      rootCauseCandidates: [...uniqueCauses.values()].sort(
        (a, b) => b.score - a.score
      ),
      worstMateriality
    });
  }

  return groups.sort((a, b) => {
    const materialityDelta =
      materialityRankValue(b.worstMateriality?.rank) -
      materialityRankValue(a.worstMateriality?.rank);
    if (materialityDelta) return materialityDelta;
    if (b.affectedCount !== a.affectedCount) return b.affectedCount - a.affectedCount;
    return b.confidence - a.confidence;
  });
}

const IDENTITY_RULES: IdentityRule[] = [
  {
    targetRole: "enterprise_value",
    identityName: "Exit-multiple enterprise value",
    canonicalExpression: "Enterprise Value = EBITDA × Exit Multiple",
    confidence: 0.96,
    hypotheses: [
      {
        name: "EBITDA multiple",
        canonical: true,
        requiredRoles: ["ebitda", "exit_multiple"]
      },
      {
        name: "Revenue multiple substituted for EBITDA multiple",
        canonical: false,
        requiredRoles: ["revenue", "exit_multiple"]
      }
    ],
    materiality: exactProductMateriality("ebitda", "exit_multiple")
  },
  {
    targetRole: "revenue",
    identityName: "Unit-price revenue",
    canonicalExpression: "Revenue = Units × Price",
    confidence: 0.9,
    hypotheses: [
      {
        name: "Units × Price",
        canonical: true,
        requiredRoles: ["units", "price"]
      }
    ],
    materiality: exactProductMateriality("units", "price")
  },
  {
    targetRole: "gross_profit",
    identityName: "Gross profit bridge",
    canonicalExpression:
      "Gross Profit = Revenue − COGS, or Revenue × Gross Margin",
    confidence: 0.9,
    hypotheses: [
      {
        name: "Revenue less COGS",
        canonical: true,
        requiredRoles: ["revenue", "cogs"]
      },
      {
        name: "Revenue × Gross Margin",
        canonical: true,
        requiredRoles: ["revenue", "gross_margin"]
      },
      {
        name: "SG&A substituted for COGS",
        canonical: false,
        requiredRoles: ["revenue", "sga"]
      }
    ]
  },
  {
    targetRole: "ebitda",
    identityName: "EBITDA construction",
    canonicalExpression:
      "EBITDA = Gross Profit − SG&A, or Revenue × EBITDA Margin",
    confidence: 0.88,
    hypotheses: [
      {
        name: "Gross Profit less SG&A",
        canonical: true,
        requiredRoles: ["gross_profit", "sga"]
      },
      {
        name: "Revenue × EBITDA Margin",
        canonical: true,
        requiredRoles: ["revenue", "ebitda_margin"]
      },
      {
        name: "Gross profit calculation substituted for EBITDA",
        canonical: false,
        requiredRoles: ["revenue", "cogs"]
      }
    ]
  },
  {
    targetRole: "equity_value",
    identityName: "Enterprise-to-equity bridge",
    canonicalExpression:
      "Equity Value = Enterprise Value − Debt + Cash (or Enterprise Value − Net Debt)",
    confidence: 0.86,
    hypotheses: [
      {
        name: "EV less debt plus cash",
        canonical: true,
        requiredRoles: ["enterprise_value", "debt", "cash"]
      },
      {
        name: "EV less net debt",
        canonical: true,
        requiredRoles: ["enterprise_value", "debt"]
      },
      {
        name: "Revenue substituted for enterprise value",
        canonical: false,
        requiredRoles: ["revenue", "debt"]
      }
    ],
    materiality: equityBridgeMateriality
  },
  {
    targetRole: "interest_expense",
    identityName: "Debt interest calculation",
    canonicalExpression:
      "Interest Expense should increase with Debt and Interest Rate; rate components should not be subtracted unless explicitly modeling a hedge/offset",
    confidence: 0.94,
    hypotheses: [
      {
        name: "Debt × Interest Rate",
        canonical: true,
        requiredRoles: ["debt", "interest_rate"]
      }
    ],
    antiPattern: expression => {
      if (
        expression.includes("@interest_rate-@interest_rate") ||
        expression.includes("(-@interest_rate") ||
        expression.includes("*-@interest_rate")
      ) {
        return "The formula subtracts one recognized interest-rate component from another, which can reverse normal rate sensitivity.";
      }
      return undefined;
    }
  }
];

export function analyzeSemanticIdentities(
  workbook: XLSX.WorkBook,
  nodes: SemanticNode[],
  extractRefs: (formula: string, currentSheet: string) => string[]
): SemanticIdentityAssessment[] {
  const byKey = new Map(nodes.map(node => [node.key, node]));
  const evaluator = new WorkbookEvaluator(workbook);
  const assessments: SemanticIdentityAssessment[] = [];

  for (const target of nodes) {
    if (!target.formula) continue;

    const rule = IDENTITY_RULES.find(
      candidate => candidate.targetRole === target.role
    );
    if (!rule) continue;

    const directRefs = extractRefs(target.formula, target.sheet);
    const observedRoles = [
      ...new Set(
        directRefs
          .map(ref => byKey.get(ref)?.role)
          .filter((role): role is SemanticRole => Boolean(role))
          .filter(role => role !== "unknown")
      )
    ];

    if (!observedRoles.length) continue;

    const observed = new Set(observedRoles);
    const hypotheses = rule.hypotheses.map(hypothesis =>
      scoreHypothesis(observed, hypothesis)
    );

    const canonicalMatches = hypotheses.filter(
      hypothesis => hypothesis.canonical && hypothesis.matched
    );
    const competingMatches = hypotheses.filter(
      hypothesis => !hypothesis.canonical && hypothesis.matched
    );

    const semanticExpression = semanticizeFormula(
      target.formula,
      target.sheet,
      byKey
    );
    const antiPatternReason = rule.antiPattern?.(semanticExpression);

    let status: SemanticIdentityAssessment["status"] = "ambiguous";
    let explanation =
      "The formula could not be conclusively classified against the current identity library.";

    if (antiPatternReason) {
      status = "violated";
      explanation = antiPatternReason;
    } else if (canonicalMatches.length) {
      status = "confirmed";
      explanation =
        "The formula directly uses roles consistent with the canonical financial identity.";
    } else if (competingMatches.length) {
      status = "violated";
      explanation =
        "The formula matches a competing non-canonical financial hypothesis more closely than the canonical identity.";
    }

    const confidence =
      status === "violated"
        ? Math.min(
            0.99,
            rule.confidence *
              target.confidence *
              (antiPatternReason ? 1 : 0.95)
          )
        : rule.confidence * target.confidence;

    const rootCauseCandidates: RootCauseCandidate[] =
      status === "violated"
        ? [
            {
              cellKey: target.key,
              score: Number(confidence.toFixed(2)),
              reason:
                "This is the formula cell whose semantic expression conflicts with the expected financial identity."
            }
          ]
        : [];

    const materiality =
      status === "violated" && rule.materiality
        ? rule.materiality(evaluator, target, nodes)
        : undefined;

    assessments.push({
      id: id("identity"),
      targetNodeId: target.id,
      targetKey: target.key,
      targetRole: target.role,
      sheet: target.sheet,
      cell: target.cell,
      identityName: rule.identityName,
      canonicalExpression: rule.canonicalExpression,
      semanticExpression,
      observedRoles,
      status,
      confidence: Number(confidence.toFixed(2)),
      hypotheses,
      explanation,
      rootCauseCandidates,
      materiality
    });
  }

  return assessments.sort((a, b) => {
    const statusRank = { violated: 3, ambiguous: 2, confirmed: 1 };
    const statusDelta = statusRank[b.status] - statusRank[a.status];
    if (statusDelta) return statusDelta;
    return b.confidence - a.confidence;
  });
}

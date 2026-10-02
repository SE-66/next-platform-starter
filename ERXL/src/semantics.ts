import type {
  CounterfactualTest,
  ExpectedDirection,
  SemanticNode,
  SemanticRole
} from "./types";

export interface SemanticCell {
  key: string;
  sheet: string;
  address: string;
  row: number;
  col: number;
  formula?: string;
  value?: unknown;
}

interface RelationshipRule {
  input: SemanticRole;
  output: SemanticRole;
  expectedDirection: ExpectedDirection;
  confidence: number;
  perturbationPercent: number;
  rationale: string;
}

const ROLE_PATTERNS: Array<{
  role: SemanticRole;
  patterns: RegExp[];
  confidence: number;
}> = [
  { role: "interest_rate", confidence: 0.98, patterns: [/\binterest rate\b/i, /\bcoupon rate\b/i, /\bbase rate\b/i, /\bsofr\b/i, /\beuribor\b/i] },
  { role: "interest_expense", confidence: 0.98, patterns: [/\binterest expense\b/i, /\bfinance cost/i, /\binterest cost/i] },
  { role: "exit_multiple", confidence: 0.98, patterns: [/\bexit multiple\b/i, /\bexit ebitda multiple\b/i, /\bterminal multiple\b/i] },
  { role: "enterprise_value", confidence: 0.96, patterns: [/\benterprise value\b/i, /^ev$/i] },
  { role: "equity_value", confidence: 0.96, patterns: [/\bequity value\b/i, /\bequity proceeds\b/i, /\bsponsor proceeds\b/i] },
  { role: "ebitda_margin", confidence: 0.96, patterns: [/\bebitda margin\b/i] },
  { role: "gross_margin", confidence: 0.96, patterns: [/\bgross margin\b/i] },
  { role: "gross_profit", confidence: 0.96, patterns: [/\bgross profit\b/i] },
  { role: "working_capital", confidence: 0.94, patterns: [/\bnet working capital\b/i, /\bworking capital\b/i, /^nwc$/i] },
  { role: "revenue", confidence: 0.94, patterns: [/^revenue(?:\s*\([^)]*\))?$/i, /^net sales(?:\s*\([^)]*\))?$/i, /^sales(?:\s*\([^)]*\))?$/i, /^turnover(?:\s*\([^)]*\))?$/i] },
  { role: "ebitda", confidence: 0.94, patterns: [/\bebitda\b/i] },
  { role: "cash", confidence: 0.93, patterns: [/\bending cash\b/i, /\bclosing cash\b/i, /^cash$/i, /\bcash balance\b/i] },
  { role: "debt", confidence: 0.93, patterns: [/\bending debt\b/i, /\bclosing debt\b/i, /^debt$/i, /\btotal debt\b/i, /\bnet debt\b/i] },
  { role: "assets", confidence: 0.92, patterns: [/\btotal assets\b/i] },
  { role: "liabilities", confidence: 0.92, patterns: [/\btotal liabilities\b/i] },
  { role: "equity", confidence: 0.92, patterns: [/\btotal equity\b/i, /\bshareholders.? equity\b/i, /\bstockholders.? equity\b/i] },
  { role: "irr", confidence: 0.92, patterns: [/\birr\b/i, /\binternal rate of return\b/i] },
  { role: "capex", confidence: 0.9, patterns: [/\bcapex\b/i, /\bcapital expenditure/i] },
  { role: "taxes", confidence: 0.9, patterns: [/\bcash taxes\b/i, /\btax expense\b/i, /^taxes$/i] },
  { role: "units", confidence: 0.88, patterns: [/\bunits sold\b/i, /^units$/i, /\bvolume\b/i] },
  { role: "price", confidence: 0.88, patterns: [/\baverage selling price\b/i, /^price$/i, /\bunit price\b/i, /^asp$/i] }
];

const RELATIONSHIP_RULES: RelationshipRule[] = [
  {
    input: "interest_rate",
    output: "interest_expense",
    expectedDirection: "increase",
    confidence: 0.97,
    perturbationPercent: 10,
    rationale: "Holding other modeled drivers constant, a higher interest rate should increase interest expense."
  },
  {
    input: "interest_rate",
    output: "cash",
    expectedDirection: "decrease",
    confidence: 0.75,
    perturbationPercent: 10,
    rationale: "Higher modeled interest cost generally consumes cash when the dependency path is direct."
  },
  {
    input: "interest_rate",
    output: "irr",
    expectedDirection: "decrease",
    confidence: 0.65,
    perturbationPercent: 10,
    rationale: "For a leveraged return model, higher borrowing cost generally reduces sponsor returns when other assumptions are unchanged."
  },
  {
    input: "units",
    output: "revenue",
    expectedDirection: "increase",
    confidence: 0.93,
    perturbationPercent: 10,
    rationale: "Increasing modeled unit volume should increase revenue when a direct dependency path exists."
  },
  {
    input: "price",
    output: "revenue",
    expectedDirection: "increase",
    confidence: 0.93,
    perturbationPercent: 10,
    rationale: "Increasing modeled unit price should increase revenue when a direct dependency path exists."
  },
  {
    input: "gross_margin",
    output: "gross_profit",
    expectedDirection: "increase",
    confidence: 0.95,
    perturbationPercent: 10,
    rationale: "A higher gross margin should increase gross profit at a fixed revenue level."
  },
  {
    input: "gross_margin",
    output: "ebitda",
    expectedDirection: "increase",
    confidence: 0.84,
    perturbationPercent: 10,
    rationale: "A higher gross margin generally increases EBITDA when the workbook directly links the two."
  },
  {
    input: "ebitda_margin",
    output: "ebitda",
    expectedDirection: "increase",
    confidence: 0.95,
    perturbationPercent: 10,
    rationale: "A higher EBITDA margin should increase EBITDA at a fixed revenue level."
  },
  {
    input: "exit_multiple",
    output: "enterprise_value",
    expectedDirection: "increase",
    confidence: 0.98,
    perturbationPercent: 10,
    rationale: "A higher exit multiple should increase enterprise value in a multiple-based valuation."
  },
  {
    input: "exit_multiple",
    output: "equity_value",
    expectedDirection: "increase",
    confidence: 0.94,
    perturbationPercent: 10,
    rationale: "A higher exit multiple should increase exit equity value when debt and other variables are unchanged."
  },
  {
    input: "exit_multiple",
    output: "irr",
    expectedDirection: "increase",
    confidence: 0.9,
    perturbationPercent: 10,
    rationale: "A higher exit multiple should increase modeled sponsor IRR when other assumptions are unchanged."
  },
  {
    input: "debt",
    output: "interest_expense",
    expectedDirection: "increase",
    confidence: 0.82,
    perturbationPercent: 10,
    rationale: "Higher debt principal generally increases interest expense along a direct modeled path."
  },
  {
    input: "capex",
    output: "cash",
    expectedDirection: "decrease",
    confidence: 0.86,
    perturbationPercent: 10,
    rationale: "Higher capital expenditure generally reduces cash when the workbook links capex to cash flow."
  },
  {
    input: "working_capital",
    output: "cash",
    expectedDirection: "decrease",
    confidence: 0.68,
    perturbationPercent: 10,
    rationale: "An increase in modeled net working capital generally consumes cash; this rule is lower confidence because sign conventions vary."
  },
  {
    input: "taxes",
    output: "cash",
    expectedDirection: "decrease",
    confidence: 0.82,
    perturbationPercent: 10,
    rationale: "Higher cash taxes generally reduce cash when a direct dependency path exists."
  }
];

function normalizeLabel(value: string): string {
  return value
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function roleForLabel(label: string):
  | { role: SemanticRole; confidence: number }
  | undefined {
  const normalized = normalizeLabel(label);
  for (const candidate of ROLE_PATTERNS) {
    if (candidate.patterns.some(pattern => pattern.test(normalized))) {
      return { role: candidate.role, confidence: candidate.confidence };
    }
  }
  return undefined;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function inferSemanticNodes(cells: SemanticCell[]): SemanticNode[] {
  const bySheetRow = new Map<string, SemanticCell[]>();
  for (const cell of cells) {
    const key = `${cell.sheet}:${cell.row}`;
    if (!bySheetRow.has(key)) bySheetRow.set(key, []);
    bySheetRow.get(key)!.push(cell);
  }

  const nodes: SemanticNode[] = [];
  const usedKeys = new Set<string>();

  for (const rowCells of bySheetRow.values()) {
    const sorted = [...rowCells].sort((a, b) => a.col - b.col);
    const stringCells = sorted.filter(c => typeof c.value === "string");

    for (const cell of sorted) {
      if (cell.formula === undefined && typeof cell.value !== "number") continue;

      const leftLabels = stringCells
        .filter(labelCell => labelCell.col < cell.col && cell.col - labelCell.col <= 5)
        .sort((a, b) => b.col - a.col);

      let match:
        | { role: SemanticRole; confidence: number; label: string; distance: number }
        | undefined;

      for (const labelCell of leftLabels) {
        const label = String(labelCell.value);
        const candidate = roleForLabel(label);
        if (candidate) {
          match = {
            ...candidate,
            label,
            distance: cell.col - labelCell.col
          };
          break;
        }
      }

      if (!match || usedKeys.has(cell.key)) continue;
      usedKeys.add(cell.key);

      const distancePenalty = Math.min(0.18, Math.max(0, match.distance - 1) * 0.03);
      nodes.push({
        id: id("semantic"),
        key: cell.key,
        role: match.role,
        sheet: cell.sheet,
        cell: cell.address,
        label: match.label,
        confidence: Math.max(0.5, Number((match.confidence - distancePenalty).toFixed(2))),
        value:
          typeof cell.value === "number" ||
          typeof cell.value === "string" ||
          typeof cell.value === "boolean" ||
          cell.value === null
            ? cell.value
            : undefined,
        formula: cell.formula
      });
    }
  }

  return nodes.sort((a, b) => b.confidence - a.confidence);
}

export function buildForwardDependencyGraph(
  cells: SemanticCell[],
  extractRefs: (formula: string, currentSheet: string) => string[]
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const existing = new Set(cells.map(c => c.key));

  for (const cell of cells) {
    if (!graph.has(cell.key)) graph.set(cell.key, new Set());
    if (!cell.formula) continue;

    for (const precedent of extractRefs(cell.formula, cell.sheet)) {
      if (!existing.has(precedent)) continue;
      if (!graph.has(precedent)) graph.set(precedent, new Set());
      graph.get(precedent)!.add(cell.key);
    }
  }

  return graph;
}

function shortestPath(
  graph: Map<string, Set<string>>,
  start: string,
  goal: string,
  maxDepth = 18
): string[] | undefined {
  if (start === goal) return [start];

  const queue: Array<{ key: string; path: string[] }> = [
    { key: start, path: [start] }
  ];
  const visited = new Set<string>([start]);

  while (queue.length) {
    const current = queue.shift()!;
    if (current.path.length > maxDepth) continue;

    for (const next of graph.get(current.key) || []) {
      if (visited.has(next)) continue;
      const path = [...current.path, next];
      if (next === goal) return path;
      visited.add(next);
      queue.push({ key: next, path });
    }
  }

  return undefined;
}

export function synthesizeCounterfactualTests(
  semanticNodes: SemanticNode[],
  graph: Map<string, Set<string>>
): CounterfactualTest[] {
  const inputs = semanticNodes.filter(
    node => typeof node.value === "number" && !node.formula
  );
  const outputs = semanticNodes.filter(node => Boolean(node.formula));
  const tests: CounterfactualTest[] = [];
  const signatures = new Set<string>();

  for (const rule of RELATIONSHIP_RULES) {
    const candidateInputs = inputs.filter(node => node.role === rule.input);
    const candidateOutputs = outputs.filter(node => node.role === rule.output);

    for (const input of candidateInputs) {
      for (const output of candidateOutputs) {
        const path = shortestPath(graph, input.key, output.key);
        if (!path || path.length < 2) continue;

        const signature = `${input.key}|${output.key}|${rule.expectedDirection}`;
        if (signatures.has(signature)) continue;
        signatures.add(signature);

        const pathConfidence = Math.max(0.65, 1 - (path.length - 2) * 0.025);
        const confidence = Number(
          (
            rule.confidence *
            input.confidence *
            output.confidence *
            pathConfidence
          ).toFixed(2)
        );

        tests.push({
          id: id("test"),
          title: `${input.role} +${rule.perturbationPercent}% → ${output.role} should ${rule.expectedDirection}`,
          input: {
            semanticNodeId: input.id,
            role: input.role,
            sheet: input.sheet,
            cell: input.cell,
            baselineValue: input.value as number,
            perturbationPercent: rule.perturbationPercent
          },
          output: {
            semanticNodeId: output.id,
            role: output.role,
            sheet: output.sheet,
            cell: output.cell,
            expectedDirection: rule.expectedDirection
          },
          dependencyPath: path,
          confidence,
          rationale:
            `${rule.rationale} ERXL selected a single assumption cell with a verified formula-dependency path to the target output, minimizing unrelated perturbations.`,
          executionStatus: "generated"
        });
      }
    }
  }

  return tests
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.dependencyPath.length - b.dependencyPath.length;
    })
    .slice(0, 40);
}

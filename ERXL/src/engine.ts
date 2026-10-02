import * as XLSX from "xlsx";
import {
  buildForwardDependencyGraph,
  inferSemanticNodes,
  synthesizeCounterfactualTests,
  type SemanticCell
} from "./semantics";
import type { AnalysisResult, Finding, Severity } from "./types";

const ERROR_VALUES = new Set([
  "#REF!",
  "#DIV/0!",
  "#VALUE!",
  "#NAME?",
  "#N/A",
  "#NUM!",
  "#NULL!"
]);

interface CellNode extends SemanticCell {}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function severityRank(s: Severity): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[s];
}

function normalizeFormula(formula: string): string {
  return formula
    .toUpperCase()
    .replace(/'[^']+'!/g, "SHEET!")
    .replace(/\$?[A-Z]{1,3}\$?\d+/g, "REF")
    .replace(/\b\d+(?:\.\d+)?\b/g, "NUM")
    .replace(/\s+/g, "");
}

function normalizeSheetName(sheet: string): string {
  return sheet.replace(/^'/, "").replace(/'$/, "").replace(/''/g, "'");
}

function expandRange(
  sheet: string,
  startCol: string,
  startRow: number,
  endCol: string,
  endRow: number,
  maxCells = 250
): string[] {
  const start = XLSX.utils.decode_cell(`${startCol}${startRow}`);
  const end = XLSX.utils.decode_cell(`${endCol}${endRow}`);
  const rowCount = Math.abs(end.r - start.r) + 1;
  const colCount = Math.abs(end.c - start.c) + 1;

  if (rowCount * colCount > maxCells) {
    return [
      `${sheet}!${startCol}${startRow}`,
      `${sheet}!${endCol}${endRow}`
    ];
  }

  const refs: string[] = [];
  const r0 = Math.min(start.r, end.r);
  const r1 = Math.max(start.r, end.r);
  const c0 = Math.min(start.c, end.c);
  const c1 = Math.max(start.c, end.c);

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      refs.push(`${sheet}!${XLSX.utils.encode_cell({ r, c })}`);
    }
  }
  return refs;
}

export function extractRefs(formula: string, currentSheet: string): string[] {
  const refs: string[] = [];
  const protectedRanges: Array<{ start: number; end: number }> = [];

  const rangeRe =
    /(?:(?:'([^']+(?:''[^']+)*)'|([A-Za-z0-9_ .-]+))!)?\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)/g;

  let rangeMatch: RegExpExecArray | null;
  while ((rangeMatch = rangeRe.exec(formula)) !== null) {
    const sheet = normalizeSheetName(
      rangeMatch[1] || rangeMatch[2] || currentSheet
    ).trim();

    refs.push(
      ...expandRange(
        sheet,
        rangeMatch[3],
        Number(rangeMatch[4]),
        rangeMatch[5],
        Number(rangeMatch[6])
      )
    );
    protectedRanges.push({
      start: rangeMatch.index,
      end: rangeMatch.index + rangeMatch[0].length
    });
  }

  const cellRe =
    /(?:(?:'([^']+(?:''[^']+)*)'|([A-Za-z0-9_ .-]+))!)?\$?([A-Z]{1,3})\$?(\d+)/g;

  let cellMatch: RegExpExecArray | null;
  while ((cellMatch = cellRe.exec(formula)) !== null) {
    const insideRange = protectedRanges.some(
      span => cellMatch!.index >= span.start && cellMatch!.index < span.end
    );
    if (insideRange) continue;

    const sheet = normalizeSheetName(
      cellMatch[1] || cellMatch[2] || currentSheet
    ).trim();
    refs.push(`${sheet}!${cellMatch[3]}${cellMatch[4]}`);
  }

  return [...new Set(refs)];
}

function detectCycles(nodes: CellNode[]): Finding[] {
  const formulaKeys = new Set(nodes.filter(n => n.formula).map(n => n.key));
  const graph = new Map<string, string[]>();

  for (const n of nodes) {
    if (!n.formula) continue;
    graph.set(
      n.key,
      extractRefs(n.formula, n.sheet).filter(k => formulaKeys.has(k))
    );
  }

  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const found = new Set<string>();
  const findings: Finding[] = [];

  const visit = (key: string) => {
    const s = state.get(key) || 0;
    if (s === 1) {
      const start = stack.indexOf(key);
      const cycle = [...stack.slice(start), key];
      const signature = [...new Set(cycle)].sort().join("|");
      if (!found.has(signature)) {
        found.add(signature);
        findings.push({
          id: id("finding"),
          severity: "critical",
          code: "CIRCULAR_REFERENCE",
          title: "Circular formula dependency",
          details: cycle.join(" → "),
          evidence: { cycle }
        });
      }
      return;
    }
    if (s === 2) return;

    state.set(key, 1);
    stack.push(key);
    for (const next of graph.get(key) || []) visit(next);
    stack.pop();
    state.set(key, 2);
  };

  for (const key of graph.keys()) visit(key);
  return findings;
}

function detectFormulaOutliers(nodes: CellNode[]): Finding[] {
  const findings: Finding[] = [];
  const bySheetRow = new Map<string, CellNode[]>();

  for (const n of nodes) {
    const key = `${n.sheet}:${n.row}`;
    if (!bySheetRow.has(key)) bySheetRow.set(key, []);
    bySheetRow.get(key)!.push(n);
  }

  for (const cells of bySheetRow.values()) {
    const formulas = cells.filter(c => c.formula);
    if (formulas.length < 4) continue;

    const counts = new Map<string, number>();
    for (const c of formulas) {
      const pattern = normalizeFormula(c.formula!);
      counts.set(pattern, (counts.get(pattern) || 0) + 1);
    }

    const [modalPattern, modalCount] =
      [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];

    if (!modalPattern || modalCount < 3) continue;

    for (const c of formulas) {
      const pattern = normalizeFormula(c.formula!);
      if (pattern !== modalPattern && (counts.get(pattern) || 0) === 1) {
        findings.push({
          id: id("finding"),
          severity: "medium",
          code: "FORMULA_OUTLIER",
          title: "Formula pattern differs from neighboring row formulas",
          sheet: c.sheet,
          cell: c.address,
          details:
            "This formula is a one-off pattern inside a row dominated by another formula structure.",
          evidence: { formula: c.formula, dominantPattern: modalPattern }
        });
      }
    }
  }

  return findings;
}

function detectHardcodes(nodes: CellNode[]): Finding[] {
  const findings: Finding[] = [];
  const bySheetRow = new Map<string, CellNode[]>();

  for (const n of nodes) {
    const key = `${n.sheet}:${n.row}`;
    if (!bySheetRow.has(key)) bySheetRow.set(key, []);
    bySheetRow.get(key)!.push(n);
  }

  for (const cells of bySheetRow.values()) {
    const populated = cells.filter(c => c.formula || c.value !== undefined);
    const formulaCount = populated.filter(c => c.formula).length;
    if (formulaCount < 4) continue;

    for (const c of populated) {
      if (!c.formula && typeof c.value === "number") {
        findings.push({
          id: id("finding"),
          severity: "low",
          code: "HARDCODE_IN_FORMULA_REGION",
          title: "Numeric hardcode inside formula-dense row",
          sheet: c.sheet,
          cell: c.address,
          details:
            "A numeric constant appears inside a row where neighboring populated cells are mostly formulas. This may be intentional, but it deserves review.",
          evidence: { value: c.value, formulaCount }
        });
      }
    }
  }

  return findings;
}

function findLabelValue(
  sheet: XLSX.WorkSheet,
  labels: RegExp[]
): { address: string; value: number } | undefined {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[address];
      if (!cell || typeof cell.v !== "string") continue;

      const text = cell.v.trim();
      if (!labels.some(re => re.test(text))) continue;

      for (let offset = 1; offset <= 8; offset++) {
        const valueAddress = XLSX.utils.encode_cell({ r, c: c + offset });
        const value = sheet[valueAddress]?.v;
        if (typeof value === "number") {
          return { address: valueAddress, value };
        }
      }
    }
  }

  return undefined;
}

function detectBalanceSheetMismatch(workbook: XLSX.WorkBook): Finding[] {
  const findings: Finding[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const assets = findLabelValue(sheet, [/^total\s+assets$/i]);
    const liabilities = findLabelValue(sheet, [/^total\s+liabilit(?:y|ies)$/i]);
    const equity = findLabelValue(sheet, [
      /^total\s+(?:shareholders'?\s+)?equity$/i,
      /^total\s+stockholders'?\s+equity$/i
    ]);

    if (!assets || !liabilities || !equity) continue;

    const difference = assets.value - (liabilities.value + equity.value);
    const scale = Math.max(1, Math.abs(assets.value));

    if (Math.abs(difference) / scale > 0.0001) {
      findings.push({
        id: id("finding"),
        severity: "high",
        code: "BALANCE_SHEET_MISMATCH",
        title: "Balance sheet identity does not reconcile",
        sheet: sheetName,
        details:
          "Recognized total assets do not equal recognized total liabilities plus total equity.",
        evidence: {
          assets,
          liabilities,
          equity,
          difference
        }
      });
    }
  }

  return findings;
}


function detectSemanticDependencyOutliers(
  semanticNodes: ReturnType<typeof inferSemanticNodes>
): Finding[] {
  const findings: Finding[] = [];
  const semanticByKey = new Map(semanticNodes.map(node => [node.key, node]));
  const groups = new Map<string, typeof semanticNodes>();

  for (const node of semanticNodes) {
    if (!node.formula) continue;
    const groupKey = `${node.sheet}|${node.role}|${(node.label || "").toLowerCase()}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(node);
  }

  for (const nodes of groups.values()) {
    if (nodes.length < 4) continue;

    const signatures = new Map<string, number>();
    const signatureByNode = new Map<string, string>();

    for (const node of nodes) {
      const roles = extractRefs(node.formula!, node.sheet)
        .map(ref => semanticByKey.get(ref)?.role)
        .filter((role): role is NonNullable<typeof role> => Boolean(role))
        .filter(role => role !== "unknown");

      const signature = [...new Set(roles)].sort().join("+") || "unresolved";
      signatureByNode.set(node.id, signature);
      signatures.set(signature, (signatures.get(signature) || 0) + 1);
    }

    const [modalSignature, modalCount] =
      [...signatures.entries()].sort((a, b) => b[1] - a[1])[0] || [];

    if (!modalSignature || modalSignature === "unresolved" || modalCount < 3) {
      continue;
    }

    for (const node of nodes) {
      const signature = signatureByNode.get(node.id) || "unresolved";
      if (
        signature !== "unresolved" &&
        signature !== modalSignature &&
        (signatures.get(signature) || 0) === 1
      ) {
        findings.push({
          id: id("finding"),
          severity: "high",
          code: "SEMANTIC_DEPENDENCY_OUTLIER",
          title: "Financial dependency pattern changes in one period",
          sheet: node.sheet,
          cell: node.cell,
          details:
            `This ${node.role} formula depends on financial roles [${signature}], while comparable periods primarily depend on [${modalSignature}].`,
          evidence: {
            role: node.role,
            label: node.label,
            observedDependencyRoles: signature.split("+"),
            dominantDependencyRoles: modalSignature.split("+"),
            formula: node.formula
          }
        });
      }
    }
  }

  return findings;
}

function errorDisplayValue(cell: XLSX.CellObject): string | undefined {
  if (typeof cell.v === "string" && ERROR_VALUES.has(cell.v.toUpperCase())) {
    return cell.v.toUpperCase();
  }

  if (cell.t === "e" && typeof cell.w === "string") {
    return cell.w;
  }

  return undefined;
}

export function analyzeWorkbook(
  bytes: ArrayBuffer,
  fileName: string
): AnalysisResult {
  const workbook = XLSX.read(bytes, {
    type: "array",
    cellFormula: true,
    cellText: true
  });

  const nodes: CellNode[] = [];
  const findings: Finding[] = [];
  let populatedCells = 0;
  let formulaCells = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const ref = sheet["!ref"];
    if (!ref) continue;

    const range = XLSX.utils.decode_range(ref);

    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const address = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[address];
        if (!cell) continue;

        populatedCells++;

        const formula =
          typeof cell.f === "string" && cell.f.length ? cell.f : undefined;

        if (formula) formulaCells++;

        const node: CellNode = {
          key: `${sheetName}!${address}`,
          sheet: sheetName,
          address,
          row: r,
          col: c,
          formula,
          value: cell.v
        };

        nodes.push(node);

        const excelError = errorDisplayValue(cell);
        if (excelError) {
          findings.push({
            id: id("finding"),
            severity: "critical",
            code: "EXCEL_ERROR",
            title: `Excel error value ${excelError}`,
            sheet: sheetName,
            cell: address,
            details: "The workbook contains an explicit Excel error value.",
            evidence: { value: excelError, formula }
          });
        }
      }
    }
  }

  findings.push(
    ...detectCycles(nodes),
    ...detectFormulaOutliers(nodes),
    ...detectHardcodes(nodes),
    ...detectBalanceSheetMismatch(workbook)
  );

  const semanticNodes = inferSemanticNodes(nodes);
  findings.push(...detectSemanticDependencyOutliers(semanticNodes));

  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  const dependencyGraph = buildForwardDependencyGraph(nodes, extractRefs);
  const counterfactualTests = synthesizeCounterfactualTests(
    semanticNodes,
    dependencyGraph
  );

  return {
    runId: id("run"),
    fileName,
    createdAt: new Date().toISOString(),
    summary: {
      sheets: workbook.SheetNames.length,
      populatedCells,
      formulaCells,
      findings: findings.length,
      semanticNodes: semanticNodes.length,
      counterfactualTests: counterfactualTests.length
    },
    findings,
    semanticNodes,
    counterfactualTests
  };
}

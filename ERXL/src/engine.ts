import * as XLSX from "xlsx";
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

interface CellNode {
  key: string;
  sheet: string;
  address: string;
  row: number;
  col: number;
  formula?: string;
  value?: unknown;
}

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

function extractRefs(formula: string, currentSheet: string): string[] {
  const refs: string[] = [];
  const re = /(?:(?:'([^']+)'|([A-Za-z0-9_ .-]+))!)?\$?([A-Z]{1,3})\$?(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) {
    const sheet = (m[1] || m[2] || currentSheet).trim();
    refs.push(`${sheet}!${m[3]}${m[4]}`);
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
    const k = `${n.sheet}:${n.row}`;
    if (!bySheetRow.has(k)) bySheetRow.set(k, []);
    bySheetRow.get(k)!.push(n);
  }

  for (const cells of bySheetRow.values()) {
    const formulas = cells.filter(c => c.formula);
    if (formulas.length < 4) continue;

    const counts = new Map<string, number>();
    for (const c of formulas) {
      const p = normalizeFormula(c.formula!);
      counts.set(p, (counts.get(p) || 0) + 1);
    }
    const [modalPattern, modalCount] =
      [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];

    if (!modalPattern || modalCount < 3) continue;

    for (const c of formulas) {
      const p = normalizeFormula(c.formula!);
      if (p !== modalPattern && (counts.get(p) || 0) === 1) {
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
    const k = `${n.sheet}:${n.row}`;
    if (!bySheetRow.has(k)) bySheetRow.set(k, []);
    bySheetRow.get(k)!.push(n);
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
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell || typeof cell.v !== "string") continue;
      const text = cell.v.trim();
      if (!labels.some(re => re.test(text))) continue;

      for (let offset = 1; offset <= 8; offset++) {
        const vAddr = XLSX.utils.encode_cell({ r, c: c + offset });
        const v = sheet[vAddr]?.v;
        if (typeof v === "number") return { address: vAddr, value: v };
      }
    }
  }
  return undefined;
}

function detectBalanceSheetMismatch(
  workbook: XLSX.WorkBook
): Finding[] {
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

    const diff = assets.value - (liabilities.value + equity.value);
    const scale = Math.max(1, Math.abs(assets.value));
    if (Math.abs(diff) / scale > 0.0001) {
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
          difference: diff
        }
      });
    }
  }

  return findings;
}

export function analyzeWorkbook(
  bytes: ArrayBuffer,
  fileName: string
): AnalysisResult {
  const workbook = XLSX.read(bytes, {
    type: "array",
    cellFormula: true,
    cellText: false
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

        if (
          typeof cell.v === "string" &&
          ERROR_VALUES.has(cell.v.toUpperCase())
        ) {
          findings.push({
            id: id("finding"),
            severity: "critical",
            code: "EXCEL_ERROR",
            title: `Excel error value ${cell.v}`,
            sheet: sheetName,
            cell: address,
            details: "The workbook contains an explicit Excel error value.",
            evidence: { value: cell.v, formula }
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

  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  return {
    runId: id("run"),
    fileName,
    createdAt: new Date().toISOString(),
    summary: {
      sheets: workbook.SheetNames.length,
      populatedCells,
      formulaCells,
      findings: findings.length
    },
    findings
  };
}

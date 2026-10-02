import * as XLSX from "xlsx";
import {
  buildForwardDependencyGraph,
  inferSemanticNodes,
  synthesizeCounterfactualTests,
  type SemanticCell
} from "./semantics";
import { executeCounterfactualTests } from "./counterfactual-executor";
import {
  analyzeSemanticIdentities,
  groupSemanticIdentityViolations
} from "./semantic-identities";
import {
  generateAutomaticHypotheses,
  runAutomaticHypothesisExperiments
} from "./automatic-hypotheses";
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

function normalizeFormula(formula: string, current: CellNode): string {
  const refRe =
    /(?:(?:'([^']+(?:''[^']+)*)'|([A-Za-z_][A-Za-z0-9_. -]*))!)?(\$?)([A-Z]{1,3})(\$?)(\d+)/g;

  let output = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  const normalizeText = (text: string) =>
    text
      .toUpperCase()
      .replace(/\b\d+(?:\.\d+)?\b/g, "NUM")
      .replace(/\s+/g, "");

  while ((match = refRe.exec(formula)) !== null) {
    output += normalizeText(formula.slice(cursor, match.index));

    const sheet = normalizeSheetName(
      match[1] || match[2] || current.sheet
    ).trim();
    const target = XLSX.utils.decode_cell(match[4] + match[6]);
    const sheetToken = sheet === current.sheet ? "SELF" : "SHEET:" + sheet.toUpperCase();
    const colToken = match[3]
      ? "C$" + target.c
      : "C" + (target.c - current.col);
    const rowToken = match[5]
      ? "R$" + target.r
      : "R" + (target.r - current.row);

    output += "[" + sheetToken + ":" + colToken + ":" + rowToken + "]";
    cursor = match.index + match[0].length;
  }

  output += normalizeText(formula.slice(cursor));
  return output;
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

  for (const rowCells of bySheetRow.values()) {
    const formulas = rowCells
      .filter(c => c.formula)
      .sort((a, b) => a.col - b.col);

    if (formulas.length < 4) continue;

    // Compare only contiguous formula bands. This prevents a summary KPI at B4
    // from being compared with a separate chart series at E4:J4.
    const bands: CellNode[][] = [];
    let currentBand: CellNode[] = [];

    for (const cell of formulas) {
      const previous = currentBand[currentBand.length - 1];
      if (!previous || cell.col - previous.col <= 1) {
        currentBand.push(cell);
      } else {
        if (currentBand.length) bands.push(currentBand);
        currentBand = [cell];
      }
    }
    if (currentBand.length) bands.push(currentBand);

    for (const band of bands) {
      if (band.length < 4) continue;

      const counts = new Map<string, number>();
      for (const c of band) {
        const pattern = normalizeFormula(c.formula!, c);
        counts.set(pattern, (counts.get(pattern) || 0) + 1);
      }

      const [modalPattern, modalCount] =
        [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];

      if (!modalPattern || modalCount < 3) continue;

      for (const c of band) {
        const pattern = normalizeFormula(c.formula!, c);
        if (pattern !== modalPattern && (counts.get(pattern) || 0) === 1) {
          findings.push({
            id: id("finding"),
            severity: "medium",
            code: "FORMULA_OUTLIER",
            title: "Formula pattern differs from neighboring row formulas",
            sheet: c.sheet,
            cell: c.address,
            details:
              "This formula is a one-off pattern inside a contiguous formula sequence dominated by another relative-reference structure.",
            evidence: { formula: c.formula, dominantPattern: modalPattern }
          });
        }
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

    const formulaColumns = populated
      .filter(c => c.formula)
      .map(c => c.col)
      .sort((a, b) => a - b);

    for (const c of populated) {
      if (c.formula || typeof c.value !== "number") continue;

      const hasFormulaLeft = formulaColumns.some(col => col < c.col);
      const hasFormulaRight = formulaColumns.some(col => col > c.col);

      // A base-year input at the left edge of a forecast row is normal.
      // Flag only constants embedded inside a formula run.
      if (!hasFormulaLeft || !hasFormulaRight) continue;

      findings.push({
        id: id("finding"),
        severity: "medium",
        code: "HARDCODE_IN_FORMULA_REGION",
        title: "Numeric hardcode interrupts a formula sequence",
        sheet: c.sheet,
        cell: c.address,
        details:
          "A numeric constant appears between formula-driven periods in the same row. This is more suspicious than a normal historical/base-year input.",
        evidence: { value: c.value, formulaCount }
      });
    }
  }

  return findings;
}

function findLabelValue(
  sheet: XLSX.WorkSheet,
  labels: RegExp[]
): { address: string; value: number } | undefined {
  const addresses = Object.keys(sheet).filter(key => !key.startsWith("!"));

  for (const address of addresses) {
    const cell = sheet[address];
    if (!cell || typeof cell.v !== "string") continue;

    const text = cell.v.trim();
    if (!labels.some(re => re.test(text))) continue;

    const decoded = XLSX.utils.decode_cell(address);
    for (let offset = 1; offset <= 8; offset++) {
      const valueAddress = XLSX.utils.encode_cell({
        r: decoded.r,
        c: decoded.c + offset
      });
      const value = sheet[valueAddress]?.v;
      if (typeof value === "number") {
        return { address: valueAddress, value };
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
    cellText: true,
    sheetStubs: true
  });

  const nodes: CellNode[] = [];
  const findings: Finding[] = [];
  let populatedCells = 0;
  let formulaCells = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const addresses = Object.keys(sheet).filter(key => !key.startsWith("!"));

    for (const address of addresses) {
      const cell = sheet[address];
      if (!cell) continue;

      populatedCells++;
      if (populatedCells > 350000) {
        throw new Error(
          "Workbook exceeds ERXL's 350,000 populated-cell analysis limit."
        );
      }

      const decoded = XLSX.utils.decode_cell(address);
      const formula =
        typeof cell.f === "string" && cell.f.length ? cell.f : undefined;

      if (formula) formulaCells++;

      const node: CellNode = {
        key: `${sheetName}!${address}`,
        sheet: sheetName,
        address,
        row: decoded.r,
        col: decoded.c,
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

  findings.push(
    ...detectCycles(nodes),
    ...detectFormulaOutliers(nodes),
    ...detectHardcodes(nodes),
    ...detectBalanceSheetMismatch(workbook)
  );

  const semanticNodes = inferSemanticNodes(nodes);
  findings.push(...detectSemanticDependencyOutliers(semanticNodes));

  const identityAssessments = analyzeSemanticIdentities(
    workbook,
    semanticNodes,
    extractRefs
  );
  const identityViolationGroups =
    groupSemanticIdentityViolations(identityAssessments);

  for (const group of identityViolationGroups) {
    const materialityRank = group.worstMateriality?.rank;
    const severity: Severity =
      materialityRank && materialityRank !== "unknown"
        ? materialityRank
        : group.confidence >= 0.85
          ? "high"
          : "medium";

    findings.push({
      id: id("finding"),
      severity,
      code: "SEMANTIC_IDENTITY_VIOLATION",
      title: "Financial identity defect repeated across model periods",
      sheet: group.sheet,
      cell: group.affectedRange,
      details:
        group.explanation +
        " Expected identity: " +
        group.canonicalExpression +
        ". Affected cells: " +
        group.affectedRange +
        " (" +
        group.affectedCount +
        " period" +
        (group.affectedCount === 1 ? "" : "s") +
        ").",
      evidence: {
        identityViolationGroupId: group.id,
        identityAssessmentIds: group.assessmentIds,
        identityName: group.identityName,
        semanticExpression: group.semanticExpression,
        affectedCells: group.affectedCells,
        affectedRange: group.affectedRange,
        affectedCount: group.affectedCount,
        hypotheses: group.hypotheses,
        rootCauseCandidates: group.rootCauseCandidates,
        materiality: group.worstMateriality
      }
    });
  }

  const generatedHypotheses = generateAutomaticHypotheses(
    workbook,
    semanticNodes
  );
  const hypothesisExperiments = runAutomaticHypothesisExperiments(
    workbook,
    semanticNodes,
    generatedHypotheses
  );

  const hypothesisById = new Map(
    generatedHypotheses.map(hypothesis => [hypothesis.id, hypothesis])
  );
  const mismatchBuckets = new Map<
    string,
    typeof hypothesisExperiments
  >();

  for (const experiment of hypothesisExperiments) {
    if (!experiment.mismatch) continue;

    const preferred = hypothesisById.get(experiment.preferredHypothesisId);
    const implemented = experiment.implementedHypothesisId
      ? hypothesisById.get(experiment.implementedHypothesisId)
      : undefined;

    const key = [
      experiment.sheet,
      experiment.targetRole,
      preferred?.semanticExpression || experiment.preferredExpression,
      implemented?.semanticExpression || experiment.implementedExpression || ""
    ].join("|");

    if (!mismatchBuckets.has(key)) mismatchBuckets.set(key, []);
    mismatchBuckets.get(key)!.push(experiment);
  }

  for (const bucket of mismatchBuckets.values()) {
    const sorted = [...bucket].sort((a, b) => {
      const left = XLSX.utils.decode_cell(a.cell);
      const right = XLSX.utils.decode_cell(b.cell);
      return left.r - right.r || left.c - right.c;
    });

    const first = sorted[0];
    const preferred = hypothesisById.get(first.preferredHypothesisId);
    const implemented = first.implementedHypothesisId
      ? hypothesisById.get(first.implementedHypothesisId)
      : undefined;

    const cells = sorted.map(item => item.cell);
    const decoded = cells.map(cell => ({
      cell,
      pos: XLSX.utils.decode_cell(cell)
    }));
    const sameRow = decoded.every(item => item.pos.r === decoded[0].pos.r);
    const sameCol = decoded.every(item => item.pos.c === decoded[0].pos.c);
    const ordered = decoded.sort(
      (a, b) => a.pos.r - b.pos.r || a.pos.c - b.pos.c
    );
    const contiguous =
      ordered.length > 1 &&
      (sameRow || sameCol) &&
      ordered.every((item, index) => {
        if (index === 0) return true;
        const previous = ordered[index - 1].pos;
        return sameRow
          ? item.pos.c === previous.c + 1
          : item.pos.r === previous.r + 1;
      });
    const affectedRange = contiguous
      ? ordered[0].cell + ":" + ordered[ordered.length - 1].cell
      : ordered.map(item => item.cell).join(", ");

    const worstMateriality = sorted
      .map(item => item.materiality)
      .filter(
        (
          item
        ): item is NonNullable<
          (typeof hypothesisExperiments)[number]["materiality"]
        > => Boolean(item)
      )
      .sort(
        (a, b) =>
          (b.relativeImpact || 0) - (a.relativeImpact || 0)
      )[0];

    const severity: Severity =
      worstMateriality?.rank && worstMateriality.rank !== "unknown"
        ? worstMateriality.rank
        : "high";

    findings.push({
      id: id("finding"),
      severity,
      code: "AUTOMATIC_HYPOTHESIS_MISMATCH",
      title: "Generated financial hypothesis conflicts with implemented behavior",
      sheet: first.sheet,
      cell: affectedRange,
      details:
        "ERXL generated competing formulas from the workbook's semantic roles and dimensional grammar, then used a discriminating perturbation to identify the formula behavior actually implemented. Preferred hypothesis: " +
        (preferred?.expression || first.preferredExpression) +
        ". Implemented behavior most closely matched: " +
        (implemented?.expression || first.implementedExpression || "unknown") +
        ". Affected cells: " +
        affectedRange +
        " (" +
        sorted.length +
        " period" +
        (sorted.length === 1 ? "" : "s") +
        ").",
      evidence: {
        experimentIds: sorted.map(item => item.id),
        preferredHypothesis: preferred || null,
        implementedHypothesis: implemented || null,
        affectedCells: cells,
        affectedRange,
        affectedCount: sorted.length,
        perturbations: sorted.map(item => item.perturbation),
        implementedMatchScores: sorted.map(
          item => item.implementedMatchScore
        ),
        plausibilityGaps: sorted.map(item => item.plausibilityGap),
        rootCauseCandidates: sorted.map(item => ({
          cellKey: item.targetKey,
          score: item.implementedMatchScore || 0,
          reason:
            "This target formula reproduced the lower-plausibility generated hypothesis under a discriminating perturbation."
        })),
        materiality: worstMateriality
      }
    });
  }

  const dependencyGraph = buildForwardDependencyGraph(nodes, extractRefs);
  const generatedTests = synthesizeCounterfactualTests(
    semanticNodes,
    dependencyGraph
  );
  const counterfactualTests = executeCounterfactualTests(
    workbook,
    generatedTests
  );

  for (const test of counterfactualTests) {
    if (test.executionStatus !== "failed") continue;

    findings.push({
      id: id("finding"),
      severity: "high",
      code: "COUNTERFACTUAL_TEST_FAILURE",
      title: "Counterfactual financial behavior violated",
      sheet: test.output.sheet,
      cell: test.output.cell,
      details:
        "Changing " +
        test.input.role +
        " at " +
        test.input.sheet +
        "!" +
        test.input.cell +
        " produced a " +
        test.observedDirection +
        " in " +
        test.output.role +
        ", while ERXL expected " +
        test.output.expectedDirection +
        ".",
      evidence: {
        testId: test.id,
        input: test.input,
        output: test.output,
        baselineOutput: test.baselineOutput,
        perturbedInput: test.perturbedInput,
        perturbedOutput: test.perturbedOutput,
        observedDirection: test.observedDirection,
        dependencyPath: test.dependencyPath,
        materiality: {
          absoluteImpact: test.absoluteImpact,
          relativeImpact: test.relativeImpact,
          rank: test.materialityRank
        },
        rootCauseCandidates: (() => {
          const path = new Set(test.dependencyPath);
          const semanticCauses = identityAssessments
            .filter(
              assessment =>
                assessment.status === "violated" &&
                path.has(assessment.targetKey)
            )
            .flatMap(assessment => assessment.rootCauseCandidates);

          if (semanticCauses.length) {
            return semanticCauses.sort((a, b) => b.score - a.score);
          }

          const fallback: Array<{
            cellKey: string;
            score: number;
            reason: string;
          }> = [];

          const prior = test.dependencyPath[test.dependencyPath.length - 2];
          if (prior) {
            fallback.push({
              cellKey: prior,
              score: 0.7,
              reason:
                "This is the last upstream formula before the failing output on the verified dependency path."
            });
          }

          fallback.push({
            cellKey: test.output.sheet + "!" + test.output.cell,
            score: 0.5,
            reason:
              "This is the output formula where the counterfactual behavior becomes observable."
          });

          return fallback;
        })()
      }
    });
  }

  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  const identityViolations = identityAssessments.filter(
    assessment => assessment.status === "violated"
  ).length;

  const hypothesisMismatches = hypothesisExperiments.filter(
    experiment => experiment.mismatch
  ).length;

  const testsPassed = counterfactualTests.filter(
    test => test.executionStatus === "passed"
  ).length;
  const testsFailed = counterfactualTests.filter(
    test => test.executionStatus === "failed"
  ).length;
  const testsUnsupported = counterfactualTests.filter(
    test => test.executionStatus === "unsupported"
  ).length;

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
      identityChecks: identityAssessments.length,
      identityViolations,
      identityViolationGroups: identityViolationGroups.length,
      generatedHypotheses: generatedHypotheses.length,
      hypothesisExperiments: hypothesisExperiments.length,
      hypothesisMismatches,
      counterfactualTests: counterfactualTests.length,
      testsPassed,
      testsFailed,
      testsUnsupported
    },
    findings,
    semanticNodes,
    identityAssessments,
    identityViolationGroups,
    generatedHypotheses,
    hypothesisExperiments,
    counterfactualTests
  };
}

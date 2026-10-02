import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { analyzeWorkbook } from "../src/engine";
import { WorkbookEvaluator } from "../src/formula-evaluator";

function workbookBytes(broken = false): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Interest Rate", 0.1],
    ["Debt", 100],
    ["Interest Expense", 10],
    ["Cash", 990]
  ]);

  sheet.B3 = {
    t: "n",
    f: broken ? "100-B1*B2" : "B1*B2",
    v: broken ? 90 : 10
  };

  sheet.B4 = {
    t: "n",
    f: "1000-B3",
    v: broken ? 910 : 990
  };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Model");

  return XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx"
  }) as ArrayBuffer;
}

describe("ERXL counterfactual engine", () => {
  it("executes a supported financial direction test", () => {
    const result = analyzeWorkbook(workbookBytes(false), "valid.xlsx");

    const test = result.counterfactualTests.find(
      item =>
        item.input.role === "interest_rate" &&
        item.output.role === "interest_expense"
    );

    expect(test).toBeDefined();
    expect(test?.executionStatus).toBe("passed");
    expect(test?.baselineOutput).toBeCloseTo(10, 8);
    expect(test?.perturbedOutput).toBeCloseTo(11, 8);
    expect(result.summary.testsPassed).toBeGreaterThanOrEqual(1);
  });

  it("surfaces a counterfactual failure when financial direction is reversed", () => {
    const result = analyzeWorkbook(workbookBytes(true), "broken.xlsx");

    const test = result.counterfactualTests.find(
      item =>
        item.input.role === "interest_rate" &&
        item.output.role === "interest_expense"
    );

    expect(test).toBeDefined();
    expect(test?.executionStatus).toBe("failed");
    expect(test?.observedDirection).toBe("decrease");
    expect(
      result.findings.some(
        finding => finding.code === "COUNTERFACTUAL_TEST_FAILURE"
      )
    ).toBe(true);
    expect(result.summary.testsFailed).toBeGreaterThanOrEqual(1);
  });
});


function anomalyWorkbookBytes(): ArrayBuffer {
  const operating = XLSX.utils.aoa_to_sheet([
    ["Metric", "2026A", "2027E", "2028E", "2029E", "2030E", "2031E"],
    ["Revenue", 420, null, null, null, null, null],
    ["Units", 10, 11, 12, 13, 14, 15],
    ["Price", 42, 43, 44, 45, 46, 47],
    ["EBITDA", 100, null, null, null, 160, null]
  ]);

  operating.C2 = { t: "n", f: "C3*C4", v: 473 };
  operating.D2 = { t: "n", f: "D3*D4", v: 528 };
  operating.E2 = { t: "n", f: "E3*E4", v: 585 };
  operating.F2 = { t: "n", f: "F3*E4", v: 630 };
  operating.G2 = { t: "n", f: "G3*G4", v: 705 };

  operating.C5 = { t: "n", f: "C2*0.25", v: 118.25 };
  operating.D5 = { t: "n", f: "D2*0.25", v: 132 };
  operating.E5 = { t: "n", f: "E2*0.25", v: 146.25 };
  operating.G5 = { t: "n", f: "G2*0.25", v: 176.25 };

  const checks = XLSX.utils.aoa_to_sheet([
    ["Cycle A", null],
    ["Cycle B", null]
  ]);
  checks.B1 = { t: "n", f: "B2+1", v: 1 };
  checks.B2 = { t: "n", f: "B1-1" };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, operating, "Operating_Model");
  XLSX.utils.book_append_sheet(workbook, checks, "Checks");

  return XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx"
  }) as ArrayBuffer;
}

describe("ERXL anomaly precision", () => {
  it("detects wrong relative references in an otherwise similar row", () => {
    const result = analyzeWorkbook(anomalyWorkbookBytes(), "anomalies.xlsx");

    expect(
      result.findings.some(
        finding =>
          finding.code === "FORMULA_OUTLIER" &&
          finding.sheet === "Operating_Model" &&
          finding.cell === "F2"
      )
    ).toBe(true);
  });

  it("flags only an interior hardcode, not the historical base-year value", () => {
    const result = analyzeWorkbook(anomalyWorkbookBytes(), "anomalies.xlsx");

    const hardcodes = result.findings.filter(
      finding => finding.code === "HARDCODE_IN_FORMULA_REGION"
    );

    expect(
      hardcodes.some(
        finding =>
          finding.sheet === "Operating_Model" &&
          finding.cell === "F5"
      )
    ).toBe(true);

    expect(
      hardcodes.some(
        finding =>
          finding.sheet === "Operating_Model" &&
          finding.cell === "B5"
      )
    ).toBe(false);
  });

  it("detects a circular formula dependency", () => {
    const result = analyzeWorkbook(anomalyWorkbookBytes(), "anomalies.xlsx");

    expect(
      result.findings.some(
        finding => finding.code === "CIRCULAR_REFERENCE"
      )
    ).toBe(true);
  });
});

describe("ERXL formula evaluator", () => {
  it("parses subtraction between unquoted cross-sheet references", () => {
    const operating = XLSX.utils.aoa_to_sheet([
      ["EBITDA", 100],
      ["Capex", 20]
    ]);
    const workingCapital = XLSX.utils.aoa_to_sheet([
      ["Change in NWC", 10]
    ]);
    const debt = XLSX.utils.aoa_to_sheet([
      ["Paydown", null]
    ]);

    debt.B1 = {
      t: "n",
      f: "MAX(0,(Operating_Model!B1-Operating_Model!B2-Working_Capital!B1)*0.35)",
      v: 24.5
    };

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, operating, "Operating_Model");
    XLSX.utils.book_append_sheet(workbook, workingCapital, "Working_Capital");
    XLSX.utils.book_append_sheet(workbook, debt, "Debt_Schedule");

    const evaluator = new WorkbookEvaluator(workbook);
    expect(evaluator.evaluateNumber("Debt_Schedule!B1")).toBeCloseTo(24.5, 8);
  });
});


function dashboardWorkbookBytes(): ArrayBuffer {
  const dashboard = XLSX.utils.aoa_to_sheet([
    ["", "", "", "Metric", "2026A", "2027E", "2028E", "2029E", "2030E", "2031E"],
    ["KPI", 100, "", "Revenue", null, null, null, null, null, null]
  ]);

  dashboard.B2 = { t: "n", f: "Model!G1", v: 600 };
  for (const [cell, ref, value] of [
    ["E2", "Model!B1", 100],
    ["F2", "Model!C1", 200],
    ["G2", "Model!D1", 300],
    ["H2", "Model!E1", 400],
    ["I2", "Model!F1", 500],
    ["J2", "Model!G1", 600]
  ] as Array<[string, string, number]>) {
    dashboard[cell] = { t: "n", f: ref, v: value };
  }

  const model = XLSX.utils.aoa_to_sheet([[100, 200, 300, 400, 500, 600]]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, model, "Model");
  XLSX.utils.book_append_sheet(workbook, dashboard, "Dashboard");

  return XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx"
  }) as ArrayBuffer;
}

describe("ERXL formula-band precision", () => {
  it("does not compare a separated dashboard KPI with a chart formula band", () => {
    const result = analyzeWorkbook(dashboardWorkbookBytes(), "dashboard.xlsx");

    expect(
      result.findings.some(
        finding =>
          finding.code === "FORMULA_OUTLIER" &&
          finding.sheet === "Dashboard" &&
          finding.cell === "B2"
      )
    ).toBe(false);
  });
});


function semanticIdentityWorkbookBytes(): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Metric", "2027E", "2028E", "2029E", "2030E", "2031E"],
    ["Revenue", 100, 110, 120, 130, 140],
    ["EBITDA", 20, 22, 24, 26, 28],
    ["Exit Multiple", 8, 8, 8, 8, 8],
    ["Enterprise Value", null, null, null, null, null]
  ]);

  for (const col of ["B", "C", "D", "E", "F"]) {
    const revenue = sheet[col + "2"]?.v as number;
    const multiple = sheet[col + "4"]?.v as number;
    sheet[col + "5"] = {
      t: "n",
      f: col + "2*" + col + "4",
      v: revenue * multiple
    };
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Valuation");

  return XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx"
  }) as ArrayBuffer;
}

function semanticInterestWorkbookBytes(): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Metric", "2027E", "2028E", "2029E", "2030E"],
    ["Debt", 100, 100, 100, 100],
    ["SOFR / Base Rate", 0.05, 0.05, 0.05, 0.05],
    ["Debt Spread", 0.03, 0.03, 0.03, 0.03],
    ["Interest Expense", null, null, null, null]
  ]);

  for (const col of ["B", "C", "D", "E"]) {
    sheet[col + "5"] = {
      t: "n",
      f: col + "2*(" + col + "4-" + col + "3)",
      v: -2
    };
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Debt_Schedule");

  return XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx"
  }) as ArrayBuffer;
}

describe("ERXL v0.3 semantic identity reasoning", () => {
  it("detects a consistently copied Revenue × Exit Multiple valuation bug", () => {
    const result = analyzeWorkbook(
      semanticIdentityWorkbookBytes(),
      "semantic-valuation.xlsx"
    );

    const violations = result.identityAssessments.filter(
      assessment =>
        assessment.targetRole === "enterprise_value" &&
        assessment.status === "violated"
    );

    expect(violations.length).toBe(5);
    expect(
      result.findings.some(
        finding => finding.code === "SEMANTIC_IDENTITY_VIOLATION"
      )
    ).toBe(true);

    expect(
      result.findings.some(
        finding =>
          finding.code === "FORMULA_OUTLIER" &&
          finding.sheet === "Valuation"
      )
    ).toBe(false);

    const sample = violations[0];
    expect(sample.hypotheses.some(
      hypothesis =>
        !hypothesis.canonical &&
        hypothesis.name.includes("Revenue multiple") &&
        hypothesis.matched
    )).toBe(true);
    expect(sample.materiality?.relativeImpact).toBeGreaterThan(1);
  });

  it("detects a consistently copied rate-subtraction interest bug", () => {
    const result = analyzeWorkbook(
      semanticInterestWorkbookBytes(),
      "semantic-interest.xlsx"
    );

    expect(
      result.identityAssessments.some(
        assessment =>
          assessment.targetRole === "interest_expense" &&
          assessment.status === "violated" &&
          assessment.semanticExpression.includes(
            "@interest_rate-@interest_rate"
          )
      )
    ).toBe(true);
  });
});

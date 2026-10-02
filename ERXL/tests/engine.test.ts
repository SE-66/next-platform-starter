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
  checks.B2 = { t: "n", f: "B1-1", v: 0 };

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

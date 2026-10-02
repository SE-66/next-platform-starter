import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { analyzeWorkbook } from "../src/engine";

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

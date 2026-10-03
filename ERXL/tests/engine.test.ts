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

    expect(result.identityViolationGroups).toHaveLength(1);
    expect(result.identityViolationGroups[0].affectedRange).toBe("B5:F5");
    expect(result.identityViolationGroups[0].affectedCount).toBe(5);

    const semanticFindings = result.findings.filter(
      finding => finding.code === "SEMANTIC_IDENTITY_VIOLATION"
    );
    expect(semanticFindings).toHaveLength(1);
    expect(semanticFindings[0].cell).toBe("B5:F5");
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


function semanticEquityBridgeWorkbookBytes(): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Metric", "2027E", "2028E", "2029E", "2030E", "2031E"],
    ["Revenue ($mm)", 500, 550, 600, 650, 700],
    ["EBITDA ($mm)", 100, 110, 120, 130, 140],
    ["Exit Multiple", 8, 8, 8, 8, 8],
    ["Enterprise Value ($mm)", null, null, null, null, null],
    ["Debt ($mm)", 300, 260, 220, 180, 140],
    ["Cash ($mm)", 25, 30, 35, 40, 45],
    ["Equity Value ($mm)", null, null, null, null, null]
  ]);

  for (const col of ["B", "C", "D", "E", "F"]) {
    const ebitda = sheet[col + "3"]?.v as number;
    const multiple = sheet[col + "4"]?.v as number;
    const revenue = sheet[col + "2"]?.v as number;
    const debt = sheet[col + "6"]?.v as number;

    sheet[col + "5"] = {
      t: "n",
      f: col + "3*" + col + "4",
      v: ebitda * multiple
    };

    // Deliberately wrong in every period: Revenue - Debt.
    sheet[col + "8"] = {
      t: "n",
      f: col + "2-" + col + "6",
      v: revenue - debt
    };
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Valuation");

  return XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx"
  }) as ArrayBuffer;
}

describe("ERXL v0.3.1 grouped semantic defects", () => {
  it("conclusively detects Revenue - Debt as an equity-value driver substitution", () => {
    const result = analyzeWorkbook(
      semanticEquityBridgeWorkbookBytes(),
      "semantic-equity.xlsx"
    );

    const violations = result.identityAssessments.filter(
      assessment =>
        assessment.targetRole === "equity_value" &&
        assessment.status === "violated"
    );

    expect(violations).toHaveLength(5);
    expect(
      violations.every(assessment =>
        assessment.semanticExpression.includes("@revenue-@debt")
      )
    ).toBe(true);

    expect(
      violations.every(assessment =>
        assessment.hypotheses.some(
          hypothesis =>
            !hypothesis.canonical &&
            hypothesis.name.includes("Revenue substituted") &&
            hypothesis.matched
        )
      )
    ).toBe(true);

    const equityGroups = result.identityViolationGroups.filter(
      group => group.targetRole === "equity_value"
    );

    expect(equityGroups).toHaveLength(1);
    expect(equityGroups[0].affectedRange).toBe("B8:F8");
    expect(equityGroups[0].affectedCount).toBe(5);
    expect(equityGroups[0].worstMateriality?.rank).toBe("critical");

    const equityFindings = result.findings.filter(
      finding =>
        finding.code === "SEMANTIC_IDENTITY_VIOLATION" &&
        finding.sheet === "Valuation" &&
        finding.cell === "B8:F8"
    );

    expect(equityFindings).toHaveLength(1);

    expect(
      result.findings.some(
        finding =>
          finding.code === "FORMULA_OUTLIER" &&
          finding.sheet === "Valuation" &&
          ["B8", "C8", "D8", "E8", "F8"].includes(finding.cell || "")
      )
    ).toBe(false);
  });
});


describe("ERXL v0.4 automatic hypothesis generation", () => {
  it("generates competing enterprise-value hypotheses and experimentally identifies the wrong implemented driver", () => {
    const result = analyzeWorkbook(
      semanticIdentityWorkbookBytes(),
      "auto-hypothesis-valuation.xlsx"
    );

    const experiment = result.hypothesisExperiments.find(
      item =>
        item.targetRole === "enterprise_value" &&
        item.sheet === "Valuation" &&
        item.cell === "B5"
    );

    expect(experiment).toBeDefined();
    expect(experiment?.status).toBe("executed");
    expect(experiment?.mismatch).toBe(true);
    expect(experiment?.preferredExpression.toLowerCase()).toContain("ebitda");
    expect(experiment?.preferredExpression.toLowerCase()).toContain("exit multiple");
    expect(experiment?.implementedExpression?.toLowerCase()).toContain("revenue");
    expect(experiment?.implementedExpression?.toLowerCase()).toContain("exit multiple");
    expect(experiment?.perturbation).toBeDefined();
    expect(experiment?.implementedMatchScore).toBeGreaterThan(0.9);

    const generatedForTarget = result.generatedHypotheses.filter(
      hypothesis =>
        hypothesis.targetRole === "enterprise_value" &&
        hypothesis.sheet === "Valuation" &&
        hypothesis.cell === "B5"
    );

    expect(
      generatedForTarget.some(
        hypothesis =>
          hypothesis.semanticExpression.includes("@ebitda") &&
          hypothesis.semanticExpression.includes("@exit_multiple")
      )
    ).toBe(true);

    expect(
      generatedForTarget.some(
        hypothesis =>
          hypothesis.semanticExpression.includes("@revenue") &&
          hypothesis.semanticExpression.includes("@exit_multiple")
      )
    ).toBe(true);

    expect(
      result.findings.some(
        finding =>
          finding.code === "AUTOMATIC_HYPOTHESIS_MISMATCH" &&
          finding.sheet === "Valuation"
      )
    ).toBe(true);
  });

  it("generates and distinguishes enterprise-to-equity bridge hypotheses without relying on a copied-formula anomaly", () => {
    const result = analyzeWorkbook(
      semanticEquityBridgeWorkbookBytes(),
      "auto-hypothesis-equity.xlsx"
    );

    const experiment = result.hypothesisExperiments.find(
      item =>
        item.targetRole === "equity_value" &&
        item.sheet === "Valuation" &&
        item.cell === "B8"
    );

    expect(experiment).toBeDefined();
    expect(experiment?.status).toBe("executed");
    expect(experiment?.mismatch).toBe(true);
    expect(experiment?.preferredExpression.toLowerCase()).toContain(
      "enterprise value"
    );
    expect(experiment?.preferredExpression.toLowerCase()).toContain("debt");
    expect(experiment?.preferredExpression.toLowerCase()).toContain("cash");
    expect(experiment?.implementedExpression?.toLowerCase()).toContain("revenue");
    expect(experiment?.implementedExpression?.toLowerCase()).toContain("debt");

    const mismatchFindings = result.findings.filter(
      finding =>
        finding.code === "AUTOMATIC_HYPOTHESIS_MISMATCH" &&
        finding.sheet === "Valuation"
    );

    expect(mismatchFindings.length).toBeGreaterThanOrEqual(1);
    expect(
      mismatchFindings.some(finding => finding.cell === "B8:F8")
    ).toBe(true);
  });
});


function automaticMarginWorkbookBytes(): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Metric", "2027E", "2028E", "2029E", "2030E", "2031E"],
    ["Revenue ($mm)", 500, 550, 600, 650, 700],
    ["COGS ($mm)", 300, 325, 350, 375, 400],
    ["Gross Profit ($mm)", null, null, null, null, null],
    ["Gross Margin", null, null, null, null, null]
  ]);

  for (const col of ["B", "C", "D", "E", "F"]) {
    const revenue = sheet[col + "2"]?.v as number;
    const cogs = sheet[col + "3"]?.v as number;
    const grossProfit = revenue - cogs;

    sheet[col + "4"] = {
      t: "n",
      f: col + "2-" + col + "3",
      v: grossProfit
    };

    // Deliberately wrong in every period. There is no hand-authored
    // gross-margin identity rule in v0.3.x; v0.4 must generate candidates.
    sheet[col + "5"] = {
      t: "n",
      f: col + "3/" + col + "2",
      v: cogs / revenue
    };
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Margins");

  return XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx"
  }) as ArrayBuffer;
}

describe("ERXL v0.4 discovery beyond the hand-authored identity library", () => {
  it("discovers a gross-margin driver substitution using generated hypotheses", () => {
    const result = analyzeWorkbook(
      automaticMarginWorkbookBytes(),
      "automatic-margin.xlsx"
    );

    expect(
      result.identityAssessments.some(
        assessment => assessment.targetRole === "gross_margin"
      )
    ).toBe(false);

    const experiment = result.hypothesisExperiments.find(
      item =>
        item.targetRole === "gross_margin" &&
        item.sheet === "Margins" &&
        item.cell === "B5"
    );

    expect(experiment).toBeDefined();
    expect(experiment?.status).toBe("executed");
    expect(experiment?.mismatch).toBe(true);
    expect(experiment?.preferredExpression.toLowerCase()).toContain(
      "gross profit"
    );
    expect(experiment?.preferredExpression.toLowerCase()).toContain("revenue");
    expect(experiment?.implementedExpression?.toLowerCase()).toContain("cogs");
    expect(experiment?.implementedExpression?.toLowerCase()).toContain("revenue");

    expect(
      result.findings.some(
        finding =>
          finding.code === "AUTOMATIC_HYPOTHESIS_MISMATCH" &&
          finding.sheet === "Margins" &&
          finding.cell === "B5:F5"
      )
    ).toBe(true);
  });
});


function directionalRatioWorkbookBytes(): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Metric", "2027E", "2028E", "2029E", "2030E", "2031E"],
    ["Revenue ($mm)", 500, 550, 605, 665.5, 732.05],
    ["COGS ($mm)", 300, 327, 356, 388, 423],
    ["SG&A ($mm)", 70, 74, 78, 82, 87],
    ["Gross Profit ($mm)", null, null, null, null, null],
    ["EBITDA ($mm)", null, null, null, null, null],
    ["Gross Margin", null, null, null, null, null],
    ["EBITDA Margin", null, null, null, null, null]
  ]);

  for (const col of ["B", "C", "D", "E", "F"]) {
    const revenue = sheet[col + "2"]?.v as number;
    const cogs = sheet[col + "3"]?.v as number;
    const sga = sheet[col + "4"]?.v as number;
    const grossProfit = revenue - cogs;
    const ebitda = grossProfit - sga;

    sheet[col + "5"] = {
      t: "n",
      f: col + "2-" + col + "3",
      v: grossProfit
    };

    sheet[col + "6"] = {
      t: "n",
      f: col + "5-" + col + "4",
      v: ebitda
    };

    // Wrong but consistently copied formulas from the v0.4 benchmark.
    sheet[col + "7"] = {
      t: "n",
      f: col + "3/" + col + "2",
      v: cogs / revenue
    };

    sheet[col + "8"] = {
      t: "n",
      f: col + "5/" + col + "2",
      v: grossProfit / revenue
    };
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Operating_Model");

  return XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx"
  }) as ArrayBuffer;
}

describe("ERXL v0.4.1 directional ratio ranking", () => {
  it("prefers EBITDA divided by Revenue over the inverse ratio", () => {
    const result = analyzeWorkbook(
      directionalRatioWorkbookBytes(),
      "directional-ratio.xlsx"
    );

    const experiment = result.hypothesisExperiments.find(
      item =>
        item.targetRole === "ebitda_margin" &&
        item.sheet === "Operating_Model" &&
        item.cell === "B8"
    );

    expect(experiment).toBeDefined();
    expect(experiment?.status).toBe("executed");
    expect(experiment?.mismatch).toBe(true);
    expect(experiment?.preferredExpression.toLowerCase()).toContain("ebitda");
    expect(experiment?.preferredExpression.toLowerCase()).toContain("revenue");
    expect(experiment?.preferredExpression.indexOf("EBITDA")).toBeLessThan(
      experiment?.preferredExpression.indexOf("Revenue") ?? -1
    );
    expect(experiment?.implementedExpression?.toLowerCase()).toContain(
      "gross profit"
    );
    expect(experiment?.implementedExpression?.toLowerCase()).toContain(
      "revenue"
    );

    const candidates = result.generatedHypotheses.filter(
      hypothesis =>
        hypothesis.targetRole === "ebitda_margin" &&
        hypothesis.sheet === "Operating_Model" &&
        hypothesis.cell === "B8" &&
        hypothesis.operator === "divide"
    );

    const correct = candidates.find(
      hypothesis =>
        hypothesis.semanticExpression === "@ebitda/@revenue"
    );
    const inverse = candidates.find(
      hypothesis =>
        hypothesis.semanticExpression === "@revenue/@ebitda"
    );

    expect(correct).toBeDefined();
    expect(
      inverse === undefined ||
        correct!.plausibilityScore > inverse.plausibilityScore
    ).toBe(true);
    expect(correct!.baselinePrediction).toBeLessThan(1);
    if (inverse) {
      expect(inverse.baselinePrediction).toBeGreaterThan(1);
    }
  });

  it("keeps Gross Profit divided by Revenue above COGS divided by Revenue", () => {
    const result = analyzeWorkbook(
      directionalRatioWorkbookBytes(),
      "directional-gross-margin.xlsx"
    );

    const experiment = result.hypothesisExperiments.find(
      item =>
        item.targetRole === "gross_margin" &&
        item.sheet === "Operating_Model" &&
        item.cell === "B7"
    );

    expect(experiment).toBeDefined();
    expect(experiment?.status).toBe("executed");
    expect(experiment?.mismatch).toBe(true);
    expect(experiment?.preferredExpression.toLowerCase()).toContain(
      "gross profit"
    );
    expect(experiment?.preferredExpression.toLowerCase()).toContain("revenue");
    expect(experiment?.implementedExpression?.toLowerCase()).toContain("cogs");
    expect(experiment?.implementedExpression?.toLowerCase()).toContain(
      "revenue"
    );
  });
});


describe("ERXL v0.4.2 subtraction direction and explanation consistency", () => {
  it("prefers Revenue minus COGS over the reversed subtraction for Gross Profit", () => {
    const result = analyzeWorkbook(
      directionalRatioWorkbookBytes(),
      "subtraction-direction.xlsx"
    );

    const experiment = result.hypothesisExperiments.find(
      item =>
        item.targetRole === "gross_profit" &&
        item.sheet === "Operating_Model" &&
        item.cell === "B5"
    );

    expect(experiment).toBeDefined();
    expect(experiment?.status).toBe("executed");
    expect(experiment?.mismatch).toBe(false);
    expect(experiment?.preferredExpression.toLowerCase()).toContain("revenue");
    expect(experiment?.preferredExpression.toLowerCase()).toContain("cogs");
    expect(experiment?.preferredExpression.indexOf("Revenue")).toBeLessThan(
      experiment?.preferredExpression.indexOf("COGS") ?? -1
    );
    expect(experiment?.implementedExpression).toBe(
      experiment?.preferredExpression
    );
    expect(experiment?.explanation).toBe(
      "The workbook's observed response is consistent with the preferred generated hypothesis."
    );

    const candidates = result.generatedHypotheses.filter(
      hypothesis =>
        hypothesis.targetRole === "gross_profit" &&
        hypothesis.sheet === "Operating_Model" &&
        hypothesis.cell === "B5" &&
        hypothesis.operator === "subtract"
    );

    const correct = candidates.find(
      hypothesis =>
        hypothesis.semanticExpression === "@revenue-@cogs"
    );
    const reversed = candidates.find(
      hypothesis =>
        hypothesis.semanticExpression === "@cogs-@revenue"
    );

    expect(correct).toBeDefined();
    expect(reversed).toBeDefined();
    expect(correct!.plausibilityScore).toBeGreaterThan(
      reversed!.plausibilityScore
    );
    expect(correct!.baselinePrediction).toBeGreaterThan(0);
    expect(reversed!.baselinePrediction).toBeLessThan(0);
  });

  it("never describes a different implemented hypothesis as consistent with preferred", () => {
    const workbooks = [
      directionalRatioWorkbookBytes(),
      semanticEquityBridgeWorkbookBytes(),
      semanticIdentityWorkbookBytes()
    ];

    const experiments = workbooks.flatMap((bytes, index) =>
      analyzeWorkbook(bytes, "explanation-consistency-" + index + ".xlsx")
        .hypothesisExperiments
    );

    expect(experiments.length).toBeGreaterThan(0);

    for (const experiment of experiments) {
      if (
        experiment.status === "executed" &&
        experiment.implementedHypothesisId &&
        experiment.implementedHypothesisId !== experiment.preferredHypothesisId
      ) {
        expect(experiment.explanation).not.toBe(
          "The workbook's observed response is consistent with the preferred generated hypothesis."
        );

        if (!experiment.mismatch) {
          expect(experiment.explanation.toLowerCase()).toContain(
            "alternative generated hypothesis"
          );
          expect(experiment.explanation.toLowerCase()).toContain(
            "below erxl's mismatch threshold"
          );
        }
      }
    }
  });
});


function reversedGrossProfitWorkbookBytes(): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Metric", "2027E", "2028E", "2029E"],
    ["Revenue ($mm)", 500, 550, 605],
    ["COGS ($mm)", 300, 327, 356],
    ["Gross Profit ($mm)", null, null, null]
  ]);

  for (const col of ["B", "C", "D"]) {
    const revenue = sheet[col + "2"]?.v as number;
    const cogs = sheet[col + "3"]?.v as number;

    // Deliberately reversed implementation. The prior must still prefer
    // Revenue - COGS without using the observed target sign as evidence.
    sheet[col + "4"] = {
      t: "n",
      f: col + "3-" + col + "2",
      v: cogs - revenue
    };
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Operating_Model");

  return XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx"
  }) as ArrayBuffer;
}

describe("ERXL v0.4.3 prior ranking isolation and precision", () => {
  it("keeps prior subtraction ranking independent of implemented target sign", () => {
    const result = analyzeWorkbook(
      reversedGrossProfitWorkbookBytes(),
      "prior-isolation.xlsx"
    );

    const experiment = result.hypothesisExperiments.find(
      item =>
        item.targetRole === "gross_profit" &&
        item.sheet === "Operating_Model" &&
        item.cell === "B4"
    );

    expect(experiment).toBeDefined();
    expect(experiment?.preferredExpression).toContain("Revenue ($mm) − COGS ($mm)");
    expect(experiment?.implementedExpression).toContain("COGS ($mm) − Revenue ($mm)");
    expect(experiment?.preferredHypothesisId).not.toBe(
      experiment?.implementedHypothesisId
    );

    const candidates = result.generatedHypotheses.filter(
      hypothesis =>
        hypothesis.targetRole === "gross_profit" &&
        hypothesis.sheet === "Operating_Model" &&
        hypothesis.cell === "B4" &&
        hypothesis.operator === "subtract"
    );

    const preferredPrior = candidates.find(
      hypothesis => hypothesis.semanticExpression === "@revenue-@cogs"
    );
    const implementedPrior = candidates.find(
      hypothesis => hypothesis.semanticExpression === "@cogs-@revenue"
    );

    expect(preferredPrior).toBeDefined();
    expect(implementedPrior).toBeDefined();
    expect(preferredPrior!.plausibilityScore).toBeGreaterThan(
      implementedPrior!.plausibilityScore
    );
    expect(preferredPrior!.generationBasis).toContain(
      "observed target behavior is not used to score the prior"
    );
  });

  it("preserves sub-percent score precision internally", () => {
    const result = analyzeWorkbook(
      directionalRatioWorkbookBytes(),
      "score-precision.xlsx"
    );

    const preciseCandidate = result.generatedHypotheses.find(
      hypothesis =>
        Math.abs(
          hypothesis.plausibilityScore * 100 -
            Math.round(hypothesis.plausibilityScore * 100)
        ) > 1e-8
    );

    expect(preciseCandidate).toBeDefined();
  });
});


function lowPriorWorkingCapitalWorkbookBytes(): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Metric", "2027E", "2028E", "2029E", "2030E", "2031E"],
    ["Revenue ($mm)", 500, 550, 605, 665.5, 732.05],
    ["Capex ($mm)", 25, 28, 31, 34, 37],
    ["Working Capital ($mm)", null, null, null, null, null]
  ]);

  for (const col of ["B", "C", "D", "E", "F"]) {
    const revenue = sheet[col + "2"]?.v as number;
    const capex = sheet[col + "3"]?.v as number;
    sheet[col + "4"] = {
      t: "n",
      f: col + "2-" + col + "3",
      v: revenue - capex
    };
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Operating_Model");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function multiDetectorWorkbookBytes(): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Metric", "2027E", "2028E", "2029E", "2030E", "2031E"],
    ["Revenue ($mm)", 500, 550, 605, 665.5, 732.05],
    ["COGS ($mm)", 300, 327, 356, 388, 423],
    ["SG&A ($mm)", 70, 74, 78, 82, 87],
    ["Gross Profit ($mm)", null, null, null, null, null]
  ]);

  for (const col of ["B", "C", "D", "E", "F"]) {
    const revenue = sheet[col + "2"]?.v as number;
    const cogs = sheet[col + "3"]?.v as number;
    const sga = sheet[col + "4"]?.v as number;
    const wrong = col === "D";
    sheet[col + "5"] = {
      t: "n",
      f: wrong ? col + "2-" + col + "4" : col + "2-" + col + "3",
      v: wrong ? revenue - sga : revenue - cogs
    };
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Operating_Model");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("ERXL v0.4.5 pruning, abstention, and issue consolidation", () => {
  it("abstains instead of promoting a weak working-capital prior", () => {
    const result = analyzeWorkbook(
      lowPriorWorkingCapitalWorkbookBytes(),
      "weak-prior.xlsx"
    );

    const assessments = result.hypothesisExperiments.filter(
      item => item.targetRole === "working_capital"
    );

    expect(assessments.length).toBeGreaterThan(0);
    expect(assessments.every(item => item.status === "abstained")).toBe(true);
    expect(
      assessments.every(
        item =>
          (item.preferredPlausibilityScore ?? 1) < 0.72 &&
          item.mismatch === false
      )
    ).toBe(true);
    expect(result.summary.hypothesisAbstentions).toBeGreaterThan(0);
  });

  it("keeps strong ratio mismatch experiments active after pruning", () => {
    const result = analyzeWorkbook(
      directionalRatioWorkbookBytes(),
      "pruning-regression.xlsx"
    );

    const grossMargin = result.hypothesisExperiments.find(
      item =>
        item.targetRole === "gross_margin" &&
        item.sheet === "Operating_Model" &&
        item.cell === "B7"
    );
    const ebitdaMargin = result.hypothesisExperiments.find(
      item =>
        item.targetRole === "ebitda_margin" &&
        item.sheet === "Operating_Model" &&
        item.cell === "B8"
    );

    expect(grossMargin?.status).toBe("executed");
    expect(grossMargin?.mismatch).toBe(true);
    expect(ebitdaMargin?.status).toBe("executed");
    expect(ebitdaMargin?.mismatch).toBe(true);
  });

  it("consolidates multiple detector findings around the same defective cell", () => {
    const result = analyzeWorkbook(
      multiDetectorWorkbookBytes(),
      "multi-detector.xlsx"
    );

    const family = result.findingIssueFamilies.find(
      item =>
        item.sheet === "Operating_Model" &&
        item.cell === "D5"
    );

    expect(family).toBeDefined();
    expect(family!.detectorCodes.length).toBeGreaterThanOrEqual(2);
    expect(family!.findingIds.length).toBeGreaterThanOrEqual(2);
    expect(result.findingIssueFamilies.length).toBeLessThan(result.findings.length);
    expect(result.summary.findings).toBe(result.findingIssueFamilies.length);
  });
});


function boundaryInitializationWorkbookBytes(): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Metric", "2027E", "2028E", "2029E", "2030E", "2031E"],
    ["PP&E ($mm)", null, null, null, null, null],
    ["Capex ($mm)", 26, 28, 31, 33, 36],
    ["D&A ($mm)", 19, 21, 22, 25, 26]
  ]);

  sheet.B2 = { t: "n", f: "220+B3-B4", v: 227 };
  sheet.C2 = { t: "n", f: "B2+C3-C4", v: 234 };
  sheet.D2 = { t: "n", f: "C2+D3-D4", v: 243 };
  sheet.E2 = { t: "n", f: "D2+E3-E4", v: 251 };
  sheet.F2 = { t: "n", f: "E2+F3-F4", v: 261 };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Balance_Sheet");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("ERXL v0.4.6 boundary-period formula reasoning", () => {
  it("treats a first-period initialization followed by a clean recurrence as normal", () => {
    const result = analyzeWorkbook(
      boundaryInitializationWorkbookBytes(),
      "boundary-initialization.xlsx"
    );

    expect(
      result.findings.some(
        finding =>
          finding.code === "FORMULA_OUTLIER" &&
          finding.sheet === "Balance_Sheet" &&
          finding.cell === "B2"
      )
    ).toBe(false);
  });

  it("still catches an interior one-off reference defect", () => {
    const result = analyzeWorkbook(anomalyWorkbookBytes(), "interior-outlier.xlsx");

    expect(
      result.findings.some(
        finding =>
          finding.code === "FORMULA_OUTLIER" &&
          finding.sheet === "Operating_Model" &&
          finding.cell === "F2"
      )
    ).toBe(true);
  });
});

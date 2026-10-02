import * as XLSX from "xlsx";
import {
  UnsupportedFormulaError,
  WorkbookEvaluator
} from "./formula-evaluator";
import type {
  CounterfactualTest,
  ExpectedDirection
} from "./types";

function perturbedValue(baseline: number, percent: number): number {
  const delta = Math.max(Math.abs(baseline) * (percent / 100), 0.0001);
  return baseline + delta;
}

function observedDirection(
  baseline: number,
  perturbed: number
): "increase" | "decrease" | "unchanged" {
  const tolerance = Math.max(1e-9, Math.abs(baseline) * 1e-8);
  const difference = perturbed - baseline;

  if (Math.abs(difference) <= tolerance) return "unchanged";
  return difference > 0 ? "increase" : "decrease";
}

function passesExpectation(
  expected: ExpectedDirection,
  observed: "increase" | "decrease" | "unchanged"
): boolean {
  if (expected === "increase") return observed === "increase";
  if (expected === "decrease") return observed === "decrease";
  if (expected === "not_increase") return observed !== "increase";
  return observed !== "decrease";
}

export function executeCounterfactualTests(
  workbook: XLSX.WorkBook,
  tests: CounterfactualTest[],
  maxExecuted = 24
): CounterfactualTest[] {
  const evaluator = new WorkbookEvaluator(workbook);

  return tests.map((test, index) => {
    if (index >= maxExecuted) return test;
    if (test.input.baselineValue === undefined) return test;

    const inputKey = test.input.sheet + "!" + test.input.cell;
    const outputKey = test.output.sheet + "!" + test.output.cell;
    const changedInput = perturbedValue(
      test.input.baselineValue,
      test.input.perturbationPercent
    );

    try {
      const baselineOutput = evaluator.evaluateNumber(outputKey);
      const perturbedOutput = evaluator.evaluateNumber(
        outputKey,
        new Map([[inputKey, changedInput]])
      );

      if (!Number.isFinite(baselineOutput) || !Number.isFinite(perturbedOutput)) {
        throw new UnsupportedFormulaError(
          "The target calculation produced a non-finite result."
        );
      }

      const direction = observedDirection(
        baselineOutput,
        perturbedOutput
      );

      return {
        ...test,
        executionStatus: passesExpectation(
          test.output.expectedDirection,
          direction
        )
          ? "passed"
          : "failed",
        baselineOutput,
        perturbedInput: changedInput,
        perturbedOutput,
        observedDirection: direction
      };
    } catch (error) {
      return {
        ...test,
        executionStatus: "unsupported",
        executionError:
          error instanceof Error
            ? error.message.slice(0, 300)
            : String(error).slice(0, 300)
      };
    }
  });
}

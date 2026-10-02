import type {
  AnalysisResult,
  CounterfactualTest,
  SemanticNode
} from "./types";

export interface SupabaseEnv {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}

async function post(
  env: SupabaseEnv,
  table: string,
  body: unknown
): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return;

  const res = await fetch(
    `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}`,
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Supabase write failed (${res.status}): ${detail}`);
  }
}

function semanticRows(runId: string, nodes: SemanticNode[]) {
  return nodes.map(node => ({
    id: node.id,
    analysis_run_id: runId,
    cell_key: node.key,
    role: node.role,
    sheet_name: node.sheet,
    cell_address: node.cell,
    label: node.label ?? null,
    confidence: node.confidence,
    scalar_value:
      typeof node.value === "number" ? node.value : null,
    text_value:
      typeof node.value === "string" ? node.value : null,
    formula: node.formula ?? null
  }));
}

function testRows(runId: string, tests: CounterfactualTest[]) {
  return tests.map(test => ({
    id: test.id,
    analysis_run_id: runId,
    title: test.title,
    input_semantic_node_id: test.input.semanticNodeId,
    output_semantic_node_id: test.output.semanticNodeId,
    input_role: test.input.role,
    output_role: test.output.role,
    input_sheet_name: test.input.sheet,
    input_cell_address: test.input.cell,
    output_sheet_name: test.output.sheet,
    output_cell_address: test.output.cell,
    baseline_value: test.input.baselineValue ?? null,
    perturbation_percent: test.input.perturbationPercent,
    expected_direction: test.output.expectedDirection,
    dependency_path: test.dependencyPath,
    confidence: test.confidence,
    rationale: test.rationale,
    execution_status: test.executionStatus,
    baseline_output: test.baselineOutput ?? null,
    perturbed_input: test.perturbedInput ?? null,
    perturbed_output: test.perturbedOutput ?? null,
    observed_direction: test.observedDirection ?? null,
    execution_error: test.executionError ?? null
  }));
}

export async function persistAnalysis(
  env: SupabaseEnv,
  result: AnalysisResult
): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return;

  await post(env, "analysis_runs", {
    id: result.runId,
    file_name: result.fileName,
    created_at: result.createdAt,
    sheet_count: result.summary.sheets,
    populated_cell_count: result.summary.populatedCells,
    formula_cell_count: result.summary.formulaCells,
    finding_count: result.summary.findings,
    semantic_node_count: result.summary.semanticNodes,
    counterfactual_test_count: result.summary.counterfactualTests,
    tests_passed: result.summary.testsPassed,
    tests_failed: result.summary.testsFailed,
    tests_unsupported: result.summary.testsUnsupported
  });

  if (result.findings.length) {
    await post(
      env,
      "findings",
      result.findings.map(f => ({
        id: f.id,
        analysis_run_id: result.runId,
        severity: f.severity,
        code: f.code,
        title: f.title,
        sheet_name: f.sheet ?? null,
        cell_address: f.cell ?? null,
        details: f.details,
        evidence: f.evidence ?? {}
      }))
    );
  }

  if (result.semanticNodes.length) {
    await post(env, "semantic_nodes", semanticRows(result.runId, result.semanticNodes));
  }

  if (result.counterfactualTests.length) {
    await post(
      env,
      "counterfactual_tests",
      testRows(result.runId, result.counterfactualTests)
    );
  }
}

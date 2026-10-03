import type {
  AnalysisResult,
  CounterfactualTest,
  FindingIssueFamily,
  GeneratedHypothesis,
  HypothesisExperiment,
  SemanticIdentityAssessment,
  SemanticNode,
  SemanticViolationGroup
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
    execution_error: test.executionError ?? null,
    absolute_impact: test.absoluteImpact ?? null,
    relative_impact: test.relativeImpact ?? null,
    materiality_rank: test.materialityRank ?? null
  }));
}


function identityRows(
  runId: string,
  assessments: SemanticIdentityAssessment[]
) {
  return assessments.map(assessment => ({
    id: assessment.id,
    analysis_run_id: runId,
    target_semantic_node_id: assessment.targetNodeId,
    target_key: assessment.targetKey,
    target_role: assessment.targetRole,
    sheet_name: assessment.sheet,
    cell_address: assessment.cell,
    identity_name: assessment.identityName,
    canonical_expression: assessment.canonicalExpression,
    semantic_expression: assessment.semanticExpression,
    observed_roles: assessment.observedRoles,
    status: assessment.status,
    confidence: assessment.confidence,
    hypotheses: assessment.hypotheses,
    explanation: assessment.explanation,
    root_cause_candidates: assessment.rootCauseCandidates,
    materiality: assessment.materiality ?? null
  }));
}


function violationGroupRows(
  runId: string,
  groups: SemanticViolationGroup[]
) {
  return groups.map(group => ({
    id: group.id,
    analysis_run_id: runId,
    identity_name: group.identityName,
    target_role: group.targetRole,
    sheet_name: group.sheet,
    affected_cells: group.affectedCells,
    affected_range: group.affectedRange,
    affected_count: group.affectedCount,
    canonical_expression: group.canonicalExpression,
    semantic_expression: group.semanticExpression,
    explanation: group.explanation,
    confidence: group.confidence,
    hypotheses: group.hypotheses,
    assessment_ids: group.assessmentIds,
    root_cause_candidates: group.rootCauseCandidates,
    worst_materiality: group.worstMateriality ?? null
  }));
}


function hypothesisRows(
  runId: string,
  hypotheses: GeneratedHypothesis[]
) {
  return hypotheses.map(hypothesis => ({
    id: hypothesis.id,
    analysis_run_id: runId,
    target_semantic_node_id: hypothesis.targetNodeId,
    target_key: hypothesis.targetKey,
    target_role: hypothesis.targetRole,
    sheet_name: hypothesis.sheet,
    cell_address: hypothesis.cell,
    operator: hypothesis.operator,
    expression: hypothesis.expression,
    semantic_expression: hypothesis.semanticExpression,
    source_node_ids: hypothesis.sourceNodeIds,
    source_keys: hypothesis.sourceKeys,
    source_roles: hypothesis.sourceRoles,
    dimensional_score: hypothesis.dimensionalScore,
    semantic_affinity_score: hypothesis.semanticAffinityScore,
    simplicity_score: hypothesis.simplicityScore,
    plausibility_score: hypothesis.plausibilityScore,
    baseline_prediction: hypothesis.baselinePrediction ?? null,
    generation_basis: hypothesis.generationBasis
  }));
}

function hypothesisExperimentRows(
  runId: string,
  experiments: HypothesisExperiment[]
) {
  return experiments.map(experiment => ({
    id: experiment.id,
    analysis_run_id: runId,
    target_semantic_node_id: experiment.targetNodeId,
    target_key: experiment.targetKey,
    target_role: experiment.targetRole,
    sheet_name: experiment.sheet,
    cell_address: experiment.cell,
    candidate_ids: experiment.candidateIds,
    preferred_hypothesis_id: experiment.preferredHypothesisId,
    implemented_hypothesis_id: experiment.implementedHypothesisId ?? null,
    preferred_expression: experiment.preferredExpression,
    preferred_plausibility_score:
      experiment.preferredPlausibilityScore ?? null,
    implemented_expression: experiment.implementedExpression ?? null,
    perturbation: experiment.perturbation ?? null,
    baseline_target: experiment.baselineTarget ?? null,
    observed_target: experiment.observedTarget ?? null,
    predictions: experiment.predictions,
    status: experiment.status,
    mismatch: experiment.mismatch,
    implemented_match_score: experiment.implementedMatchScore ?? null,
    plausibility_gap: experiment.plausibilityGap ?? null,
    explanation: experiment.explanation,
    materiality: experiment.materiality ?? null
  }));
}


function issueFamilyRows(
  runId: string,
  families: FindingIssueFamily[]
) {
  return families.map(family => ({
    id: family.id,
    analysis_run_id: runId,
    severity: family.severity,
    title: family.title,
    details: family.details,
    sheet_name: family.sheet ?? null,
    cell_address: family.cell ?? null,
    root_cause_cell: family.rootCauseCell ?? null,
    detector_codes: family.detectorCodes,
    finding_ids: family.findingIds,
    evidence: family.evidence ?? {}
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
    finding_issue_family_count: result.summary.findingIssueFamilies,
    semantic_node_count: result.summary.semanticNodes,
    identity_check_count: result.summary.identityChecks,
    identity_violation_count: result.summary.identityViolations,
    identity_violation_group_count: result.summary.identityViolationGroups,
    generated_hypothesis_count: result.summary.generatedHypotheses,
    hypothesis_experiment_count: result.summary.hypothesisExperiments,
    hypothesis_abstention_count: result.summary.hypothesisAbstentions,
    hypothesis_mismatch_count: result.summary.hypothesisMismatches,
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

  if (result.findingIssueFamilies.length) {
    await post(
      env,
      "finding_issue_families",
      issueFamilyRows(result.runId, result.findingIssueFamilies)
    );
  }

  if (result.semanticNodes.length) {
    await post(env, "semantic_nodes", semanticRows(result.runId, result.semanticNodes));
  }

  if (result.identityAssessments.length) {
    await post(
      env,
      "identity_assessments",
      identityRows(result.runId, result.identityAssessments)
    );
  }

  if (result.identityViolationGroups.length) {
    await post(
      env,
      "identity_violation_groups",
      violationGroupRows(result.runId, result.identityViolationGroups)
    );
  }

  if (result.generatedHypotheses.length) {
    await post(
      env,
      "generated_hypotheses",
      hypothesisRows(result.runId, result.generatedHypotheses)
    );
  }

  if (result.hypothesisExperiments.length) {
    await post(
      env,
      "hypothesis_experiments",
      hypothesisExperimentRows(result.runId, result.hypothesisExperiments)
    );
  }

  if (result.counterfactualTests.length) {
    await post(
      env,
      "counterfactual_tests",
      testRows(result.runId, result.counterfactualTests)
    );
  }
}

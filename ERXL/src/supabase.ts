import type { AnalysisResult } from "./types";

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
    finding_count: result.summary.findings
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
}

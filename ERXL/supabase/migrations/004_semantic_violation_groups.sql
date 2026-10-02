alter table public.analysis_runs
  add column if not exists identity_violation_group_count integer not null default 0;

create table if not exists public.identity_violation_groups (
  id text primary key,
  analysis_run_id text not null references public.analysis_runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  identity_name text not null,
  target_role text not null,
  sheet_name text not null,
  affected_cells jsonb not null default '[]'::jsonb,
  affected_range text not null,
  affected_count integer not null,
  canonical_expression text not null,
  semantic_expression text not null,
  explanation text not null,
  confidence double precision not null,
  hypotheses jsonb not null default '[]'::jsonb,
  assessment_ids jsonb not null default '[]'::jsonb,
  root_cause_candidates jsonb not null default '[]'::jsonb,
  worst_materiality jsonb
);

create index if not exists identity_violation_groups_run_idx
  on public.identity_violation_groups (analysis_run_id);

create index if not exists identity_violation_groups_role_idx
  on public.identity_violation_groups (target_role);

alter table public.identity_violation_groups enable row level security;

revoke all on public.identity_violation_groups from anon, authenticated;
grant select, insert, update, delete on public.identity_violation_groups to service_role;

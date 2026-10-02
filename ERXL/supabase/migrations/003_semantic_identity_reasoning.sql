alter table public.analysis_runs
  add column if not exists identity_check_count integer not null default 0,
  add column if not exists identity_violation_count integer not null default 0;

alter table public.counterfactual_tests
  add column if not exists absolute_impact double precision,
  add column if not exists relative_impact double precision,
  add column if not exists materiality_rank text
    check (
      materiality_rank is null or
      materiality_rank in ('critical','high','medium','low')
    );

create table if not exists public.identity_assessments (
  id text primary key,
  analysis_run_id text not null references public.analysis_runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  target_semantic_node_id text not null,
  target_key text not null,
  target_role text not null,
  sheet_name text not null,
  cell_address text not null,
  identity_name text not null,
  canonical_expression text not null,
  semantic_expression text not null,
  observed_roles jsonb not null default '[]'::jsonb,
  status text not null
    check (status in ('confirmed','violated','ambiguous')),
  confidence double precision not null,
  hypotheses jsonb not null default '[]'::jsonb,
  explanation text not null,
  root_cause_candidates jsonb not null default '[]'::jsonb,
  materiality jsonb
);

create index if not exists identity_assessments_run_idx
  on public.identity_assessments (analysis_run_id);

create index if not exists identity_assessments_status_idx
  on public.identity_assessments (status);

create index if not exists identity_assessments_role_idx
  on public.identity_assessments (target_role);

alter table public.identity_assessments enable row level security;

revoke all on public.identity_assessments from anon, authenticated;
grant select, insert, update, delete on public.identity_assessments to service_role;

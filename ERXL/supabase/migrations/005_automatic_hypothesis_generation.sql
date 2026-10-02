alter table public.analysis_runs
  add column if not exists generated_hypothesis_count integer not null default 0,
  add column if not exists hypothesis_experiment_count integer not null default 0,
  add column if not exists hypothesis_mismatch_count integer not null default 0;

create table if not exists public.generated_hypotheses (
  id text primary key,
  analysis_run_id text not null references public.analysis_runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  target_semantic_node_id text not null,
  target_key text not null,
  target_role text not null,
  sheet_name text not null,
  cell_address text not null,
  operator text not null,
  expression text not null,
  semantic_expression text not null,
  source_node_ids jsonb not null default '[]'::jsonb,
  source_keys jsonb not null default '[]'::jsonb,
  source_roles jsonb not null default '[]'::jsonb,
  dimensional_score double precision not null,
  semantic_affinity_score double precision not null,
  simplicity_score double precision not null,
  plausibility_score double precision not null,
  baseline_prediction double precision,
  generation_basis text not null
);

create index if not exists generated_hypotheses_run_idx
  on public.generated_hypotheses (analysis_run_id);

create index if not exists generated_hypotheses_target_idx
  on public.generated_hypotheses (target_role, target_key);

create table if not exists public.hypothesis_experiments (
  id text primary key,
  analysis_run_id text not null references public.analysis_runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  target_semantic_node_id text not null,
  target_key text not null,
  target_role text not null,
  sheet_name text not null,
  cell_address text not null,
  candidate_ids jsonb not null default '[]'::jsonb,
  preferred_hypothesis_id text not null,
  implemented_hypothesis_id text,
  preferred_expression text not null,
  implemented_expression text,
  perturbation jsonb,
  baseline_target double precision,
  observed_target double precision,
  predictions jsonb not null default '[]'::jsonb,
  status text not null
    check (status in ('executed','ambiguous','unsupported')),
  mismatch boolean not null default false,
  implemented_match_score double precision,
  plausibility_gap double precision,
  explanation text not null,
  materiality jsonb
);

create index if not exists hypothesis_experiments_run_idx
  on public.hypothesis_experiments (analysis_run_id);

create index if not exists hypothesis_experiments_mismatch_idx
  on public.hypothesis_experiments (mismatch);

create index if not exists hypothesis_experiments_target_idx
  on public.hypothesis_experiments (target_role, target_key);

alter table public.generated_hypotheses enable row level security;
alter table public.hypothesis_experiments enable row level security;

revoke all on public.generated_hypotheses from anon, authenticated;
revoke all on public.hypothesis_experiments from anon, authenticated;

grant select, insert, update, delete on public.generated_hypotheses to service_role;
grant select, insert, update, delete on public.hypothesis_experiments to service_role;

alter table public.analysis_runs
  add column if not exists semantic_node_count integer not null default 0,
  add column if not exists counterfactual_test_count integer not null default 0,
  add column if not exists tests_passed integer not null default 0,
  add column if not exists tests_failed integer not null default 0,
  add column if not exists tests_unsupported integer not null default 0;

create table if not exists public.semantic_nodes (
  id text primary key,
  analysis_run_id text not null references public.analysis_runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  cell_key text not null,
  role text not null,
  sheet_name text not null,
  cell_address text not null,
  label text,
  confidence double precision not null,
  scalar_value double precision,
  text_value text,
  formula text
);

create table if not exists public.counterfactual_tests (
  id text primary key,
  analysis_run_id text not null references public.analysis_runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  title text not null,
  input_semantic_node_id text not null,
  output_semantic_node_id text not null,
  input_role text not null,
  output_role text not null,
  input_sheet_name text not null,
  input_cell_address text not null,
  output_sheet_name text not null,
  output_cell_address text not null,
  baseline_value double precision,
  perturbation_percent double precision not null,
  expected_direction text not null
    check (expected_direction in ('increase','decrease','not_increase','not_decrease')),
  dependency_path jsonb not null default '[]'::jsonb,
  confidence double precision not null,
  rationale text not null,
  execution_status text not null default 'generated'
    check (execution_status in ('generated','passed','failed','unsupported')),
  baseline_output double precision,
  perturbed_input double precision,
  perturbed_output double precision,
  observed_direction text
    check (observed_direction is null or observed_direction in ('increase','decrease','unchanged')),
  execution_error text
);

create index if not exists semantic_nodes_run_idx
  on public.semantic_nodes (analysis_run_id);

create index if not exists semantic_nodes_role_idx
  on public.semantic_nodes (role);

create index if not exists counterfactual_tests_run_idx
  on public.counterfactual_tests (analysis_run_id);

create index if not exists counterfactual_tests_confidence_idx
  on public.counterfactual_tests (confidence desc);

alter table public.semantic_nodes enable row level security;
alter table public.counterfactual_tests enable row level security;

revoke all on public.semantic_nodes from anon, authenticated;
revoke all on public.counterfactual_tests from anon, authenticated;

grant select, insert, update, delete on public.semantic_nodes to service_role;
grant select, insert, update, delete on public.counterfactual_tests to service_role;

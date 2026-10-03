alter table public.analysis_runs
  add column if not exists finding_issue_family_count integer not null default 0,
  add column if not exists hypothesis_abstention_count integer not null default 0;

alter table public.hypothesis_experiments
  add column if not exists preferred_plausibility_score double precision;

alter table public.hypothesis_experiments
  drop constraint if exists hypothesis_experiments_status_check;

alter table public.hypothesis_experiments
  add constraint hypothesis_experiments_status_check
  check (status in ('executed','ambiguous','unsupported','abstained'));

create table if not exists public.finding_issue_families (
  id text primary key,
  analysis_run_id text not null references public.analysis_runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  severity text not null,
  title text not null,
  details text not null,
  sheet_name text,
  cell_address text,
  root_cause_cell text,
  detector_codes jsonb not null default '[]'::jsonb,
  finding_ids jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb
);

create index if not exists finding_issue_families_run_idx
  on public.finding_issue_families (analysis_run_id);

alter table public.finding_issue_families enable row level security;
revoke all on public.finding_issue_families from anon, authenticated;
grant select, insert, update, delete on public.finding_issue_families to service_role;

create table if not exists public.analysis_runs (
  id text primary key,
  file_name text not null,
  created_at timestamptz not null default now(),
  sheet_count integer not null default 0,
  populated_cell_count integer not null default 0,
  formula_cell_count integer not null default 0,
  finding_count integer not null default 0
);

create table if not exists public.findings (
  id text primary key,
  analysis_run_id text not null references public.analysis_runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  severity text not null check (severity in ('critical','high','medium','low')),
  code text not null,
  title text not null,
  sheet_name text,
  cell_address text,
  details text not null,
  evidence jsonb not null default '{}'::jsonb
);

create index if not exists findings_analysis_run_id_idx
  on public.findings (analysis_run_id);

create index if not exists findings_severity_idx
  on public.findings (severity);

alter table public.analysis_runs enable row level security;
alter table public.findings enable row level security;

revoke all on public.analysis_runs from anon, authenticated;
revoke all on public.findings from anon, authenticated;

grant select, insert, update, delete on public.analysis_runs to service_role;
grant select, insert, update, delete on public.findings to service_role;

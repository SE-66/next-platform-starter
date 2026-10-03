alter table public.analysis_runs
  add column if not exists adaptive_probe_count integer not null default 0,
  add column if not exists multi_probe_experiment_count integer not null default 0;

alter table public.hypothesis_experiments
  add column if not exists probes jsonb not null default '[]'::jsonb,
  add column if not exists posterior jsonb not null default '[]'::jsonb,
  add column if not exists posterior_confidence double precision,
  add column if not exists entropy_reduction double precision,
  add column if not exists stop_reason text;

alter table public.hypothesis_experiments
  drop constraint if exists hypothesis_experiments_stop_reason_check;

alter table public.hypothesis_experiments
  add constraint hypothesis_experiments_stop_reason_check
  check (
    stop_reason is null or
    stop_reason in ('identified','max_probes','no_informative_probe','abstained','unsupported')
  );

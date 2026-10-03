alter table public.hypothesis_experiments
  drop constraint if exists hypothesis_experiments_stop_reason_check;

alter table public.hypothesis_experiments
  add constraint hypothesis_experiments_stop_reason_check
  check (
    stop_reason is null or
    stop_reason in ('identified','poor_fit','max_probes','no_informative_probe','abstained','unsupported')
  );

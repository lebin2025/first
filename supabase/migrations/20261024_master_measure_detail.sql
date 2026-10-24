-- 自定义衡量标准：为已部署的总计划表补充字段
alter table public.master_plans
  add column if not exists measure_detail text not null default '';

-- 可选：限制长度（已有字段不会被 add column 覆盖时，手动补约束）
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'master_plans_measure_detail_len'
  ) then
    alter table public.master_plans
      add constraint master_plans_measure_detail_len
      check (char_length(measure_detail) <= 120);
  end if;
end
$$;

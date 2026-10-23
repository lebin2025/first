-- ============================================================================
-- 拾光 · Picked Light —— Supabase 数据库初始化脚本
--
-- 使用方法：
--   1. 打开 Supabase Dashboard → SQL Editor → New query
--   2. 粘贴本文件全部内容并 Run（可重复执行，不会重复建表）
--   3. 到 Authentication → Providers 确认 Email 已启用
--
-- 数据模型：MasterPlan（总计划）→ SubPlan（分计划）→ Task（任务）
--           StudyLog（学习记录，用于效率系数与统计）
-- 约束：所有表启用 RLS；分计划截止日期不得晚于总计划；总计划状态由
--       视图 / 前端计算（表中 status 列仅作占位，不参与业务判断）。
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. 表结构
-- ----------------------------------------------------------------------------

create table if not exists public.master_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  deadline date not null,
  measure_type text not null default 'other'
    check (measure_type in ('exam', 'artifact', 'level', 'other')),
  description text not null default '',
  -- 仅作占位：真实状态由 master_plan_progress 视图 / 前端根据进度与截止日计算
  status text not null default 'active'
    check (status in ('active', 'completed', 'overdue')),
  created_at timestamptz not null default now()
);

create table if not exists public.sub_plans (
  id uuid primary key default gen_random_uuid(),
  master_plan_id uuid not null references public.master_plans (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  deadline date not null,
  weekday_minutes integer not null default 60
    check (weekday_minutes between 0 and 720),
  weekend_minutes integer not null default 90
    check (weekend_minutes between 0 and 720),
  buffer_days integer not null default 1
    check (buffer_days between 0 and 2),
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  sub_plan_id uuid not null references public.sub_plans (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  est_minutes integer not null check (est_minutes between 1 and 1440),
  measure_standard text not null default 'understand'
    check (measure_standard in ('recall', 'restate', 'solve', 'operate', 'understand')),
  focus_block integer not null default 25
    check (focus_block in (15, 25, 45)),
  status text not null default 'pending'
    check (status in ('pending', 'done', 'partial', 'skipped')),
  actual_minutes integer not null default 0
    check (actual_minutes between 0 and 1440),
  scheduled_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.study_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  planned_minutes integer not null default 0 check (planned_minutes >= 0),
  actual_minutes integer not null default 0 check (actual_minutes >= 0),
  status text not null check (status in ('done', 'partial', 'skipped')),
  logged_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. 索引
-- ----------------------------------------------------------------------------

create index if not exists master_plans_user_deadline_idx
  on public.master_plans (user_id, deadline);

create index if not exists sub_plans_master_idx
  on public.sub_plans (master_plan_id, deadline);

create index if not exists sub_plans_user_idx
  on public.sub_plans (user_id);

create index if not exists tasks_sub_plan_idx
  on public.tasks (sub_plan_id, scheduled_date);

create index if not exists tasks_user_date_idx
  on public.tasks (user_id, scheduled_date);

create index if not exists study_logs_user_time_idx
  on public.study_logs (user_id, logged_at desc);

create index if not exists study_logs_task_idx
  on public.study_logs (task_id);

-- ----------------------------------------------------------------------------
-- 3. 业务约束（触发器）
--    3.1 分计划截止日期 <= 所属总计划截止日期
--    3.2 总计划缩短截止日期时，不得早于已有分计划的最晚截止日期
--    3.3 子记录的 user_id 必须与父记录属主一致（防止越权写入他人计划）
-- ----------------------------------------------------------------------------

create or replace function public.enforce_sub_plan_deadline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  master_deadline date;
begin
  select mp.deadline into master_deadline
  from public.master_plans mp
  where mp.id = new.master_plan_id;

  if master_deadline is null then
    raise exception '所属总计划不存在（master_plan_id=%）', new.master_plan_id
      using errcode = '23503';
  end if;

  if new.deadline > master_deadline then
    raise exception '分计划截止日期（%）不能晚于总计划截止日期（%）', new.deadline, master_deadline
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists sub_plans_deadline_guard on public.sub_plans;
create trigger sub_plans_deadline_guard
  before insert or update of deadline, master_plan_id on public.sub_plans
  for each row execute function public.enforce_sub_plan_deadline();

create or replace function public.enforce_master_plan_deadline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  latest_sub_deadline date;
  conflicting_name text;
begin
  select sp.deadline, sp.name
    into latest_sub_deadline, conflicting_name
  from public.sub_plans sp
  where sp.master_plan_id = new.id
  order by sp.deadline desc
  limit 1;

  if latest_sub_deadline is not null and new.deadline < latest_sub_deadline then
    raise exception '总计划截止日期不能早于其分计划「%」的截止日期（%）', conflicting_name, latest_sub_deadline
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists master_plans_deadline_guard on public.master_plans;
create trigger master_plans_deadline_guard
  before update of deadline on public.master_plans
  for each row execute function public.enforce_master_plan_deadline();

create or replace function public.enforce_sub_plan_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  master_owner uuid;
begin
  select mp.user_id into master_owner
  from public.master_plans mp
  where mp.id = new.master_plan_id;

  if master_owner is null or master_owner <> new.user_id then
    raise exception '分计划的 user_id 必须与所属总计划一致'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists sub_plans_owner_guard on public.sub_plans;
create trigger sub_plans_owner_guard
  before insert or update of user_id, master_plan_id on public.sub_plans
  for each row execute function public.enforce_sub_plan_owner();

create or replace function public.enforce_task_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sub_owner uuid;
begin
  select sp.user_id into sub_owner
  from public.sub_plans sp
  where sp.id = new.sub_plan_id;

  if sub_owner is null or sub_owner <> new.user_id then
    raise exception '任务的 user_id 必须与所属分计划一致'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_owner_guard on public.tasks;
create trigger tasks_owner_guard
  before insert or update of user_id, sub_plan_id on public.tasks
  for each row execute function public.enforce_task_owner();

create or replace function public.enforce_study_log_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  task_owner uuid;
begin
  if new.task_id is null then
    return new;
  end if;

  select t.user_id into task_owner
  from public.tasks t
  where t.id = new.task_id;

  if task_owner is null or task_owner <> new.user_id then
    raise exception '学习记录的 user_id 必须与任务属主一致'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists study_logs_owner_guard on public.study_logs;
create trigger study_logs_owner_guard
  before insert or update of user_id, task_id on public.study_logs
  for each row execute function public.enforce_study_log_owner();

-- ----------------------------------------------------------------------------
-- 4. 行级安全（RLS）：每个用户只能访问自己的数据
-- ----------------------------------------------------------------------------

alter table public.master_plans enable row level security;
alter table public.sub_plans enable row level security;
alter table public.tasks enable row level security;
alter table public.study_logs enable row level security;

-- master_plans
drop policy if exists "master_plans_select_own" on public.master_plans;
create policy "master_plans_select_own" on public.master_plans
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "master_plans_insert_own" on public.master_plans;
create policy "master_plans_insert_own" on public.master_plans
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "master_plans_update_own" on public.master_plans;
create policy "master_plans_update_own" on public.master_plans
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "master_plans_delete_own" on public.master_plans;
create policy "master_plans_delete_own" on public.master_plans
  for delete to authenticated
  using (auth.uid() = user_id);

-- sub_plans
drop policy if exists "sub_plans_select_own" on public.sub_plans;
create policy "sub_plans_select_own" on public.sub_plans
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "sub_plans_insert_own" on public.sub_plans;
create policy "sub_plans_insert_own" on public.sub_plans
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.master_plans mp
      where mp.id = master_plan_id and mp.user_id = auth.uid()
    )
  );

drop policy if exists "sub_plans_update_own" on public.sub_plans;
create policy "sub_plans_update_own" on public.sub_plans
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "sub_plans_delete_own" on public.sub_plans;
create policy "sub_plans_delete_own" on public.sub_plans
  for delete to authenticated
  using (auth.uid() = user_id);

-- tasks
drop policy if exists "tasks_select_own" on public.tasks;
create policy "tasks_select_own" on public.tasks
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "tasks_insert_own" on public.tasks;
create policy "tasks_insert_own" on public.tasks
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.sub_plans sp
      where sp.id = sub_plan_id and sp.user_id = auth.uid()
    )
  );

drop policy if exists "tasks_update_own" on public.tasks;
create policy "tasks_update_own" on public.tasks
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_delete_own" on public.tasks
  for delete to authenticated
  using (auth.uid() = user_id);

-- study_logs
drop policy if exists "study_logs_select_own" on public.study_logs;
create policy "study_logs_select_own" on public.study_logs
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "study_logs_insert_own" on public.study_logs;
create policy "study_logs_insert_own" on public.study_logs
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "study_logs_update_own" on public.study_logs;
create policy "study_logs_update_own" on public.study_logs
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "study_logs_delete_own" on public.study_logs;
create policy "study_logs_delete_own" on public.study_logs
  for delete to authenticated
  using (auth.uid() = user_id);

-- 权限：只给 authenticated，匿名角色无法读写业务表
revoke all on public.master_plans from anon;
revoke all on public.sub_plans from anon;
revoke all on public.tasks from anon;
revoke all on public.study_logs from anon;

grant select, insert, update, delete on public.master_plans to authenticated;
grant select, insert, update, delete on public.sub_plans to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.study_logs to authenticated;

-- ----------------------------------------------------------------------------
-- 4.5 资料 / 自习室房间 / 房间成员（社交模块）
-- ----------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null default ''
    check (char_length(nickname) <= 40),
  bio text not null default ''
    check (char_length(bio) <= 240),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  name text not null default '拾光自习室'
    check (char_length(btrim(name)) between 1 and 60),
  invite_code text not null unique
    default upper(substr(md5(random()::text), 1, 6)),
  max_members integer not null default 6
    check (max_members between 1 and 10),
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists rooms_created_idx
  on public.rooms (created_at desc);

create index if not exists room_members_user_idx
  on public.room_members (user_id);

-- 新用户自动建立一条 profile（昵称可从注册 metadata 带入）
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, nickname)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nickname', ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- 房间人数上限：数据库层兜底，防止前端绕过 max_members
create or replace function public.enforce_room_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  room_limit integer;
  current_count integer;
begin
  select max_members into room_limit
  from public.rooms
  where id = new.room_id
  for update;

  if room_limit is null then
    raise exception '房间不存在（room_id=%）', new.room_id
      using errcode = '23503';
  end if;

  select count(*) into current_count
  from public.room_members
  where room_id = new.room_id;

  if current_count >= room_limit then
    raise exception '房间已满（上限 % 人）', room_limit
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists room_members_capacity_guard on public.room_members;
create trigger room_members_capacity_guard
  before insert on public.room_members
  for each row execute function public.enforce_room_capacity();

-- 成员删除后自动回收空房间，数据库层兜底（不依赖前端）
create or replace function public.cleanup_empty_room_after_member_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.room_members
    where room_id = old.room_id
  ) then
    delete from public.rooms where id = old.room_id;
  end if;
  return old;
end;
$$;

drop trigger if exists room_members_cleanup_empty_room on public.room_members;
create trigger room_members_cleanup_empty_room
  after delete on public.room_members
  for each row execute function public.cleanup_empty_room_after_member_delete();

-- profile updated_at
create or replace function public.touch_profile_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_profile_updated_at();

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;

-- profiles：昵称/简介可被其他登录用户读取，用于房间成员展示；只允许改自己
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated
  using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- rooms：大厅列表公开给登录用户；只有房主能改/删
drop policy if exists "rooms_select_authenticated" on public.rooms;
create policy "rooms_select_authenticated" on public.rooms
  for select to authenticated
  using (true);

drop policy if exists "rooms_insert_host" on public.rooms;
create policy "rooms_insert_host" on public.rooms
  for insert to authenticated
  with check (auth.uid() = host_id);

drop policy if exists "rooms_update_host" on public.rooms;
create policy "rooms_update_host" on public.rooms
  for update to authenticated
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id);

drop policy if exists "rooms_delete_host" on public.rooms;
create policy "rooms_delete_host" on public.rooms
  for delete to authenticated
  using (auth.uid() = host_id);

-- 最后一位成员离开后，允许任意已登录用户删除空房间（GC）
drop policy if exists "rooms_delete_empty" on public.rooms;
create policy "rooms_delete_empty" on public.rooms
  for delete to authenticated
  using (
    not exists (
      select 1 from public.room_members m
      where m.room_id = rooms.id
    )
  );

-- room_members：登录用户可读取座位；只能插入自己；自己或房主可移除
drop policy if exists "room_members_select_authenticated" on public.room_members;
create policy "room_members_select_authenticated" on public.room_members
  for select to authenticated
  using (true);

drop policy if exists "room_members_insert_self" on public.room_members;
create policy "room_members_insert_self" on public.room_members
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.rooms r where r.id = room_id)
  );

drop policy if exists "room_members_delete_self_or_host" on public.room_members;
create policy "room_members_delete_self_or_host" on public.room_members
  for delete to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.rooms r
      where r.id = room_id and r.host_id = auth.uid()
    )
  );

revoke all on public.profiles from anon;
revoke all on public.rooms from anon;
revoke all on public.room_members from anon;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.rooms to authenticated;
grant select, insert, delete on public.room_members to authenticated;

-- ----------------------------------------------------------------------------
-- 4.6 房间消息（Realtime Chat）
-- ----------------------------------------------------------------------------

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists messages_room_created_idx
  on public.messages (room_id, created_at asc);

alter table public.messages enable row level security;

drop policy if exists "messages_select_room_members" on public.messages;
create policy "messages_select_room_members" on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.room_members m
      where m.room_id = messages.room_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "messages_insert_room_members" on public.messages;
create policy "messages_insert_room_members" on public.messages
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.room_members m
      where m.room_id = messages.room_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own" on public.messages
  for delete to authenticated
  using (auth.uid() = user_id);

revoke all on public.messages from anon;
grant select, insert, delete on public.messages to authenticated;

-- 加入 Realtime publication（幂等）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 5. 总计划进度视图（状态与进度均为计算值，不可手动修改）
--    security_invoker = true 让视图继承底层表的 RLS
-- ----------------------------------------------------------------------------

create or replace view public.master_plan_progress
with (security_invoker = true) as
select
  base.master_plan_id,
  base.user_id,
  base.name,
  base.deadline,
  base.total_minutes,
  base.earned_minutes,
  case
    when base.total_minutes > 0
      then round(base.earned_minutes::numeric / base.total_minutes, 4)
    else 0
  end as progress,
  case
    when base.total_minutes > 0 and base.earned_minutes >= base.total_minutes then 'completed'
    when base.deadline < current_date then 'overdue'
    else 'active'
  end as status
from (
  select
    mp.id as master_plan_id,
    mp.user_id,
    mp.name,
    mp.deadline,
    coalesce(sum(t.est_minutes), 0) as total_minutes,
    coalesce(
      sum(
        case
          when t.status = 'done' then t.est_minutes
          when t.status = 'partial' then least(t.est_minutes, t.actual_minutes)
          else 0
        end
      ),
      0
    ) as earned_minutes
  from public.master_plans mp
  left join public.sub_plans sp on sp.master_plan_id = mp.id
  left join public.tasks t on t.sub_plan_id = sp.id
  group by mp.id, mp.user_id, mp.name, mp.deadline
) base;

grant select on public.master_plan_progress to authenticated;

-- ============================================================================
-- 完成。下一步：
--   1. 注册一个账号（或在 Authentication → Users 手动创建）
--   2. 复制 .env.example 为 .env.local，填入 URL 与 publishable key
--   3. npm install && npm run dev
-- ============================================================================

# 拾光 · Picked Light —— 最终业务流、实时通信与 UI 降噪

> 完整代码快照。运行前请先在 Supabase SQL Editor 重新执行 `supabase/schema.sql`。
> 三主题水彩与 Glassmorphism 设计系统保持不变。

## `supabase/schema.sql`

```sql
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
```

## `src/stores/room.ts`

```ts
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import { useAuthStore } from '@/stores/auth'

export interface Room {
  id: string
  hostId: string
  name: string
  inviteCode: string
  maxMembers: number
  createdAt: string
  memberCount: number
}

export interface RoomSeat {
  userId: string
  nickname: string
  bio: string
  avatarUrl: string | null
  joinedAt: string
  status: 'focus' | 'idle'
}

interface RoomRow {
  id: string
  host_id: string
  name: string
  invite_code: string
  max_members: number
  created_at: string
}

interface MemberRow {
  room_id: string
  user_id: string
  joined_at: string
}

interface ProfileRow {
  user_id: string
  nickname: string | null
  bio: string | null
  avatar_url: string | null
}

const DEFAULT_ROOM_NAME = '拾光自习室'

function mapRoom(row: RoomRow, memberCount = 0): Room {
  return {
    id: row.id,
    hostId: row.host_id,
    name: row.name,
    inviteCode: row.invite_code,
    maxMembers: row.max_members,
    createdAt: row.created_at,
    memberCount,
  }
}

function fallbackName(profile: ProfileRow | undefined, userId: string): string {
  return profile?.nickname?.trim() || `同学 ${userId.slice(0, 4)}`
}

function initialsOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '·'
}

/**
 * 真实自习室大厅 + 房间状态。
 * 所有写操作都在 Promise resolve 后才返回 roomId，页面只在成功后再导航。
 */
export const useRoomStore = defineStore('room', () => {
  const auth = useAuthStore()

  const rooms = ref<Room[]>([])
  const roomId = ref('')
  const roomName = ref(DEFAULT_ROOM_NAME)
  const hostId = ref('')
  const inviteCode = ref('')
  const maxMembers = ref(6)
  const members = ref<RoomSeat[]>([])
  const loading = ref(false)
  const error = ref('')
  const focusingIds = ref<Set<string>>(new Set())

  const joined = computed(() => Boolean(roomId.value && members.value.some((m) => m.userId === auth.userId)))
  const memberCount = computed(() => members.value.length)
  const onlineCount = computed(() => members.value.length)
  const focusingCount = computed(() => members.value.filter((m) => m.status === 'focus').length)

  function clearError(): void {
    error.value = ''
  }

  function reset(): void {
    roomId.value = ''
    roomName.value = DEFAULT_ROOM_NAME
    hostId.value = ''
    inviteCode.value = ''
    maxMembers.value = 6
    members.value = []
    focusingIds.value = new Set()
  }

  async function fetchRooms(): Promise<Room[]> {
    loading.value = true
    error.value = ''
    try {
      const { data: roomRows, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(40)
      if (roomError) {
        error.value = describeError(roomError)
        return []
      }

      const rows = (roomRows ?? []) as unknown as RoomRow[]
      if (rows.length === 0) {
        rooms.value = []
        return []
      }

      const ids = rows.map((row) => row.id)
      const { data: memberRows, error: memberError } = await supabase
        .from('room_members')
        .select('room_id, user_id')
        .in('room_id', ids)
      if (memberError) {
        error.value = describeError(memberError)
        return []
      }

      const counts = ((memberRows ?? []) as Array<{ room_id: string }>).reduce<Record<string, number>>(
        (acc, row) => {
          acc[row.room_id] = (acc[row.room_id] ?? 0) + 1
          return acc
        },
        {},
      )

      rooms.value = rows.map((row) => mapRoom(row, counts[row.id] ?? 0))
      return rooms.value
    } catch (cause) {
      error.value = describeError(cause)
      return []
    } finally {
      loading.value = false
    }
  }

  async function fetchRoom(nextRoomId: string): Promise<Room | null> {
    loading.value = true
    error.value = ''
    try {
      const { data: roomRow, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', nextRoomId)
        .maybeSingle()
      if (roomError) {
        error.value = describeError(roomError)
        return null
      }
      if (!roomRow) {
        error.value = '房间不存在，或已被房主删除。'
        return null
      }

      const room = mapRoom(roomRow as unknown as RoomRow)
      const { data: memberRows, error: memberError } = await supabase
        .from('room_members')
        .select('room_id, user_id, joined_at')
        .eq('room_id', nextRoomId)
        .order('joined_at', { ascending: true })
      if (memberError) {
        error.value = describeError(memberError)
        return null
      }

      const rows = (memberRows ?? []) as unknown as MemberRow[]
      const userIds = rows.map((row) => row.user_id)
      let profileRows: ProfileRow[] = []
      if (userIds.length > 0) {
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('user_id, nickname, bio, avatar_url')
          .in('user_id', userIds)
        if (profileError) {
          error.value = describeError(profileError)
          return null
        }
        profileRows = (profileData ?? []) as unknown as ProfileRow[]
      }
      const profileMap = new Map(profileRows.map((profile) => [profile.user_id, profile]))

      const seats = rows.map<RoomSeat>((row) => {
        const profile = profileMap.get(row.user_id)
        return {
          userId: row.user_id,
          nickname: fallbackName(profile, row.user_id),
          bio: profile?.bio?.trim() ?? '',
          avatarUrl: profile?.avatar_url ?? null,
          joinedAt: row.joined_at,
          status: focusingIds.value.has(row.user_id) ? 'focus' : 'idle',
        }
      })

      roomId.value = room.id
      roomName.value = room.name
      hostId.value = room.hostId
      inviteCode.value = room.inviteCode
      maxMembers.value = room.maxMembers
      members.value = seats
      return { ...room, memberCount: seats.length }
    } catch (cause) {
      error.value = describeError(cause)
      return null
    } finally {
      loading.value = false
    }
  }

  async function createRoom(name: string, limit: number): Promise<string | null> {
    error.value = ''
    if (!auth.userId) {
      error.value = '请先登录'
      return null
    }
    const safeName = name.trim().slice(0, 60) || DEFAULT_ROOM_NAME
    const safeLimit = Math.min(10, Math.max(1, Math.round(limit) || 6))
    loading.value = true

    try {
      const { data: roomRow, error: createError } = await supabase
        .from('rooms')
        .insert({
          host_id: auth.userId,
          name: safeName,
          max_members: safeLimit,
        })
        .select()
        .single()
      if (createError) {
        error.value = describeError(createError)
        return null
      }

      const room = mapRoom(roomRow as unknown as RoomRow)
      const { error: joinError } = await supabase.from('room_members').insert({
        room_id: room.id,
        user_id: auth.userId,
      })
      if (joinError) {
        // 房主入座失败时清理空房间，避免留下不可进入的幽灵房间
        await supabase.from('rooms').delete().eq('id', room.id)
        error.value = describeError(joinError)
        return null
      }

      const loaded = await fetchRoom(room.id)
      if (!loaded) return null
      return room.id
    } catch (cause) {
      error.value = describeError(cause)
      return null
    } finally {
      loading.value = false
    }
  }

  async function joinRoom(code: string): Promise<string | null> {
    error.value = ''
    if (!auth.userId) {
      error.value = '请先登录'
      return null
    }
    const normalized = code.trim().toUpperCase()
    if (!normalized) {
      error.value = '请输入邀请码'
      return null
    }
    loading.value = true

    try {
      const { data: roomRow, error: findError } = await supabase
        .from('rooms')
        .select('*')
        .eq('invite_code', normalized)
        .maybeSingle()
      if (findError) {
        error.value = describeError(findError)
        return null
      }
      if (!roomRow) {
        error.value = '邀请码无效，或房间已关闭。'
        return null
      }

      const room = mapRoom(roomRow as unknown as RoomRow)
      const { error: joinError } = await supabase.from('room_members').insert({
        room_id: room.id,
        user_id: auth.userId,
      })
      // 23505 = 已在房间，按成功处理
      if (joinError && joinError.code !== '23505') {
        error.value = describeError(joinError)
        return null
      }

      const loaded = await fetchRoom(room.id)
      if (!loaded) return null
      return room.id
    } catch (cause) {
      error.value = describeError(cause)
      return null
    } finally {
      loading.value = false
    }
  }

  async function leaveRoom(): Promise<void> {
    if (!roomId.value || !auth.userId) return
    const leavingId = roomId.value
    try {
      await supabase
        .from('room_members')
        .delete()
        .eq('room_id', leavingId)
        .eq('user_id', auth.userId)
      await cleanupIfEmpty(leavingId)
    } catch {
      // 离开房间失败不阻塞导航
    } finally {
      reset()
    }
  }

  /**
   * 生命周期 GC：房间人数为 0 时删除 rooms 行。
   * 由 leaveRoom 和 StudyRoomView 的 onUnmounted 共同调用。
   */
  async function cleanupIfEmpty(targetRoomId: string): Promise<boolean> {
    if (!targetRoomId) return false
    try {
      const { count, error: countError } = await supabase
        .from('room_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('room_id', targetRoomId)
      if (countError) {
        error.value = describeError(countError)
        return false
      }
      if ((count ?? 0) > 0) return false

      const { error: deleteError } = await supabase
        .from('rooms')
        .delete()
        .eq('id', targetRoomId)
      if (deleteError) {
        error.value = describeError(deleteError)
        return false
      }
      return true
    } catch (cause) {
      error.value = describeError(cause)
      return false
    }
  }

  /** 当前页计时器状态只影响自己的座位灯，不伪造其他用户状态 */
  function setFocusing(userId: string, active: boolean): void {
    const next = new Set(focusingIds.value)
    if (active) next.add(userId)
    else next.delete(userId)
    focusingIds.value = next
    members.value = members.value.map((member) =>
      member.userId === userId ? { ...member, status: active ? 'focus' : 'idle' } : member,
    )
  }

  return {
    rooms,
    roomId,
    roomName,
    hostId,
    inviteCode,
    maxMembers,
    members,
    loading,
    error,
    joined,
    memberCount,
    onlineCount,
    focusingCount,
    initialsOf,
    clearError,
    reset,
    fetchRooms,
    fetchRoom,
    createRoom,
    joinRoom,
    leaveRoom,
    cleanupIfEmpty,
    setFocusing,
  }
})
```

## `src/stores/chat.ts`

```ts
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import { useAuthStore } from '@/stores/auth'

export interface ChatMessage {
  id: string
  roomId: string
  userId: string
  nickname: string
  content: string
  createdAt: string
  pending?: boolean
  failed?: boolean
}

interface MessageRow {
  id: string
  room_id: string
  user_id: string
  content: string
  created_at: string
}

interface ProfileRow {
  user_id: string
  nickname: string | null
}

/**
 * 房间 Realtime 聊天：
 * - load：拉最近 100 条 + profiles 昵称；
 * - subscribe：postgres_changes INSERT 实时追加；
 * - send：先乐观插入，写入失败回滚并给出错误。
 */
export const useChatStore = defineStore('chat', () => {
  const auth = useAuthStore()
  const roomId = ref('')
  const messages = ref<ChatMessage[]>([])
  const loading = ref(false)
  const sending = ref(false)
  const error = ref('')

  let channel: RealtimeChannel | null = null
  const nicknameCache = new Map<string, string>()

  function fallbackNickname(userId: string): string {
    if (userId === auth.userId) {
      return auth.profile?.nickname?.trim() || auth.email.split('@')[0] || '我'
    }
    return `同学 ${userId.slice(0, 4)}`
  }

  async function resolveNickname(userId: string): Promise<string> {
    const cached = nicknameCache.get(userId)
    if (cached) return cached
    if (userId === auth.userId) {
      const own = fallbackNickname(userId)
      nicknameCache.set(userId, own)
      return own
    }
    try {
      const { data } = await supabase
        .from('profiles')
        .select('nickname')
        .eq('user_id', userId)
        .maybeSingle()
      const nickname = (data as ProfileRow | null)?.nickname?.trim() || fallbackNickname(userId)
      nicknameCache.set(userId, nickname)
      return nickname
    } catch {
      const fallback = fallbackNickname(userId)
      nicknameCache.set(userId, fallback)
      return fallback
    }
  }

  function toMessage(row: MessageRow, nickname: string): ChatMessage {
    return {
      id: row.id,
      roomId: row.room_id,
      userId: row.user_id,
      nickname,
      content: row.content,
      createdAt: row.created_at,
    }
  }

  async function load(nextRoomId: string): Promise<void> {
    roomId.value = nextRoomId
    loading.value = true
    error.value = ''
    try {
      const { data, error: loadError } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', nextRoomId)
        .order('created_at', { ascending: true })
        .limit(100)
      if (loadError) {
        error.value = describeError(loadError)
        return
      }

      const rows = (data ?? []) as unknown as MessageRow[]
      const userIds = [...new Set(rows.map((row) => row.user_id))]
      const names = new Map<string, string>()
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, nickname')
          .in('user_id', userIds)
        for (const profile of (profiles ?? []) as ProfileRow[]) {
          names.set(profile.user_id, profile.nickname?.trim() || '')
        }
      }

      messages.value = rows.map((row) =>
        toMessage(row, names.get(row.user_id) || fallbackNickname(row.user_id)),
      )
    } catch (cause) {
      error.value = describeError(cause)
    } finally {
      loading.value = false
    }
  }

  function subscribe(nextRoomId: string): void {
    unsubscribe()
    channel = supabase
      .channel(`room-chat:${nextRoomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `room_id=eq.${nextRoomId}`,
        },
        async (payload) => {
          const row = payload.new as MessageRow
          if (!row?.id || messages.value.some((message) => message.id === row.id)) return
          const nickname = await resolveNickname(row.user_id)
          messages.value = [...messages.value, toMessage(row, nickname)]
        },
      )
      .subscribe()
  }

  function unsubscribe(): void {
    if (channel) {
      void supabase.removeChannel(channel)
      channel = null
    }
  }

  async function send(content: string): Promise<boolean> {
    const text = content.trim().slice(0, 1000)
    if (!text || !roomId.value || !auth.userId) return false
    if (sending.value) return false

    sending.value = true
    error.value = ''
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic: ChatMessage = {
      id: tempId,
      roomId: roomId.value,
      userId: auth.userId,
      nickname: fallbackNickname(auth.userId),
      content: text,
      createdAt: new Date().toISOString(),
      pending: true,
    }
    messages.value = [...messages.value, optimistic]

    try {
      const { data, error: sendError } = await supabase
        .from('messages')
        .insert({
          room_id: roomId.value,
          user_id: auth.userId,
          content: text,
        })
        .select()
        .single()

      if (sendError) {
        messages.value = messages.value.filter((message) => message.id !== tempId)
        error.value = describeError(sendError)
        return false
      }

      const saved = data as unknown as MessageRow
      const nickname = fallbackNickname(auth.userId)
      messages.value = messages.value.filter((message) => message.id !== tempId)
      if (!messages.value.some((message) => message.id === saved.id)) {
        messages.value = [...messages.value, toMessage(saved, nickname)]
      }
      return true
    } catch (cause) {
      messages.value = messages.value.filter((message) => message.id !== tempId)
      error.value = describeError(cause)
      return false
    } finally {
      sending.value = false
    }
  }

  function reset(): void {
    unsubscribe()
    roomId.value = ''
    messages.value = []
    error.value = ''
    nicknameCache.clear()
  }

  return {
    roomId,
    messages,
    loading,
    sending,
    error,
    load,
    subscribe,
    unsubscribe,
    send,
    reset,
  }
})
```

## `src/stores/cascade.ts`

```ts
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import {
  mapMasterPlan,
  mapSubPlan,
  mapTask,
  type MasterPlan,
  type MasterPlanRow,
  type SubPlan,
  type SubPlanRow,
  type Task,
  type TaskRow,
} from '@/types/models'

/**
 * 首页快速沉浸的三段式级联状态机：
 * 总计划 -> 分计划 -> 任务（只保留非 done）。
 * 与分计划详情页的 TaskSelectionModal 完全解耦。
 */
export const useCascadeStore = defineStore('cascade', () => {
  const stage = ref<1 | 2 | 3>(1)
  const masters = ref<MasterPlan[]>([])
  const subPlans = ref<SubPlan[]>([])
  const tasks = ref<Task[]>([])
  const selectedMaster = ref<MasterPlan | null>(null)
  const selectedSub = ref<SubPlan | null>(null)
  const loading = ref(false)
  const error = ref('')

  function reset(): void {
    stage.value = 1
    masters.value = []
    subPlans.value = []
    tasks.value = []
    selectedMaster.value = null
    selectedSub.value = null
    loading.value = false
    error.value = ''
  }

  async function loadMasters(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('master_plans')
        .select('*')
        .order('deadline', { ascending: true })
      if (queryError) {
        error.value = describeError(queryError)
        return
      }
      masters.value = ((data ?? []) as unknown as MasterPlanRow[])
        .map(mapMasterPlan)
        .filter((plan) => plan.status !== 'completed')
    } catch (cause) {
      error.value = describeError(cause)
    } finally {
      loading.value = false
    }
  }

  async function chooseMaster(master: MasterPlan): Promise<void> {
    selectedMaster.value = master
    selectedSub.value = null
    subPlans.value = []
    tasks.value = []
    stage.value = 2
    loading.value = true
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('sub_plans')
        .select('*')
        .eq('master_plan_id', master.id)
        .order('deadline', { ascending: true })
      if (queryError) {
        error.value = describeError(queryError)
        return
      }
      subPlans.value = ((data ?? []) as unknown as SubPlanRow[]).map(mapSubPlan)
    } catch (cause) {
      error.value = describeError(cause)
    } finally {
      loading.value = false
    }
  }

  async function chooseSub(sub: SubPlan): Promise<void> {
    selectedSub.value = sub
    tasks.value = []
    stage.value = 3
    loading.value = true
    error.value = ''
    try {
      const { data, error: queryError } = await supabase
        .from('tasks')
        .select('*')
        .eq('sub_plan_id', sub.id)
        .neq('status', 'done')
        .order('scheduled_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
      if (queryError) {
        error.value = describeError(queryError)
        return
      }
      tasks.value = ((data ?? []) as unknown as TaskRow[])
        .map(mapTask)
        .filter((task) => task.status !== 'done')
    } catch (cause) {
      error.value = describeError(cause)
    } finally {
      loading.value = false
    }
  }

  function back(): void {
    if (stage.value === 3) {
      stage.value = 2
      tasks.value = []
      selectedSub.value = null
    } else if (stage.value === 2) {
      stage.value = 1
      subPlans.value = []
      selectedMaster.value = null
    }
  }

  return {
    stage,
    masters,
    subPlans,
    tasks,
    selectedMaster,
    selectedSub,
    loading,
    error,
    reset,
    loadMasters,
    chooseMaster,
    chooseSub,
    back,
  }
})
```

## `src/stores/focus.ts`

```ts
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import {
  mapMasterPlan,
  mapSubPlan,
  mapTask,
  type MasterPlan,
  type MasterPlanRow,
  type SubPlan,
  type SubPlanRow,
  type Task,
  type TaskRow,
} from '@/types/models'

export type FocusSource = 'dashboard' | 'sub-plan' | 'today' | 'task'

/**
 * 全局专注入口的共享状态。
 * 首页「快速沉浸」不再依赖今日任务池，而是从当前用户全部 pending 任务中
 * 按所属分计划的截止日期（同日期再看任务排期）挑最近的一个。
 */
export const useFocusStore = defineStore('focus', () => {
  const source = ref<FocusSource>('today')
  const task = ref<Task | null>(null)
  const subPlan = ref<SubPlan | null>(null)
  const masterPlan = ref<MasterPlan | null>(null)
  const selectedTaskId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref('')

  function selectTask(taskId: string): void {
    selectedTaskId.value = taskId
    source.value = 'task'
  }

  function clearSelection(): void {
    selectedTaskId.value = null
  }

  function clear(): void {
    task.value = null
    subPlan.value = null
    masterPlan.value = null
    error.value = ''
  }

  async function prepareDashboard(): Promise<Task | null> {
    loading.value = true
    error.value = ''
    clear()

    try {
      const { data: taskData, error: taskError } = await supabase
        .from('tasks')
        .select('*')
        .neq('status', 'done')
      if (taskError) {
        error.value = describeError(taskError)
        return null
      }

      const pending = ((taskData ?? []) as unknown as TaskRow[]).map(mapTask)
      if (pending.length === 0) {
        error.value = '还没有未完成任务，先拆一个分计划吧。'
        return null
      }

      const subPlanIds = [...new Set(pending.map((item) => item.subPlanId))]
      const { data: subData, error: subError } = await supabase
        .from('sub_plans')
        .select('*')
        .in('id', subPlanIds)
      if (subError) {
        error.value = describeError(subError)
        return null
      }
      const subPlans = ((subData ?? []) as unknown as SubPlanRow[]).map(mapSubPlan)
      const subMap = new Map(subPlans.map((plan) => [plan.id, plan]))

      const sorted = pending
        .filter((item) => subMap.has(item.subPlanId))
        .sort((a, b) => {
          const aPlan = subMap.get(a.subPlanId)
          const bPlan = subMap.get(b.subPlanId)
          if (aPlan && bPlan && aPlan.deadline !== bPlan.deadline) {
            return aPlan.deadline < bPlan.deadline ? -1 : 1
          }
          const aDate = a.scheduledDate ?? '9999-12-31'
          const bDate = b.scheduledDate ?? '9999-12-31'
          if (aDate !== bDate) return aDate < bDate ? -1 : 1
          return a.createdAt < b.createdAt ? -1 : 1
        })

      const picked = sorted[0]
      if (!picked) {
        error.value = '还没有未完成任务，先拆一个分计划吧。'
        return null
      }
      const pickedSubPlan = subMap.get(picked.subPlanId)
      if (!pickedSubPlan) {
        error.value = '任务所属的分计划不存在。'
        return null
      }

      const { data: masterData, error: masterError } = await supabase
        .from('master_plans')
        .select('*')
        .eq('id', pickedSubPlan.masterPlanId)
        .maybeSingle()
      if (masterError) {
        error.value = describeError(masterError)
        return null
      }

      source.value = 'dashboard'
      task.value = picked
      subPlan.value = pickedSubPlan
      masterPlan.value = masterData
        ? mapMasterPlan(masterData as unknown as MasterPlanRow)
        : null
      return picked
    } catch (cause) {
      error.value = describeError(cause)
      return null
    } finally {
      loading.value = false
    }
  }

  return {
    source,
    task,
    subPlan,
    masterPlan,
    selectedTaskId,
    loading,
    error,
    selectTask,
    clearSelection,
    clear,
    prepareDashboard,
  }
})
```

## `src/stores/auth.ts`

```ts
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'

/**
 * 认证状态（Pinia）。
 * - initialize() 幂等：路由守卫、main.ts、页面都可以调用；
 * - 通过 onAuthStateChange 同步刷新 session（含 token 自动续期、跨标签页登出）。
 */
export interface Profile {
  userId: string
  nickname: string
  bio: string
  avatarUrl: string | null
}

export const useAuthStore = defineStore('auth', () => {
  const session = ref<Session | null>(null)
  const user = ref<User | null>(null)
  const profile = ref<Profile | null>(null)
  const initializing = ref(true)
  const loading = ref(false)
  const error = ref('')

  let initPromise: Promise<void> | null = null
  let subscribed = false

  const isAuthenticated = computed(() => session.value !== null)
  const email = computed(() => user.value?.email ?? '')
  const userId = computed(() => user.value?.id ?? '')

  function applySession(next: Session | null): void {
    session.value = next
    user.value = next?.user ?? null
    if (!next) profile.value = null
  }

  function fallbackNickname(): string {
    const metadata = user.value?.user_metadata as { nickname?: string } | undefined
    if (metadata?.nickname && metadata.nickname.trim()) return metadata.nickname.trim()
    return email.value.split('@')[0] || '拾光同学'
  }

  async function loadProfile(): Promise<boolean> {
    if (!user.value) return false
    try {
      const { data, error: loadError } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.value.id)
        .maybeSingle()
      if (loadError) {
        error.value = describeError(loadError)
        return false
      }
      if (data) {
        profile.value = {
          userId: data.user_id,
          nickname: data.nickname ?? '',
          bio: data.bio ?? '',
          avatarUrl: data.avatar_url ?? null,
        }
        return true
      }

      const { data: created, error: createError } = await supabase
        .from('profiles')
        .insert({
          user_id: user.value.id,
          nickname: fallbackNickname(),
          bio: '',
        })
        .select()
        .single()
      if (createError) {
        error.value = describeError(createError)
        return false
      }
      profile.value = {
        userId: created.user_id,
        nickname: created.nickname ?? '',
        bio: created.bio ?? '',
        avatarUrl: created.avatar_url ?? null,
      }
      return true
    } catch (cause) {
      error.value = describeError(cause)
      return false
    }
  }

  async function updateProfile(nickname: string, bio: string): Promise<boolean> {
    if (!user.value) return false
    loading.value = true
    error.value = ''
    try {
      const safeNickname = nickname.trim().slice(0, 40)
      const safeBio = bio.trim().slice(0, 240)
      const { data, error: updateError } = await supabase
        .from('profiles')
        .upsert(
          {
            user_id: user.value.id,
            nickname: safeNickname || fallbackNickname(),
            bio: safeBio,
          },
          { onConflict: 'user_id' },
        )
        .select()
        .single()
      if (updateError) {
        error.value = describeError(updateError)
        return false
      }
      profile.value = {
        userId: data.user_id,
        nickname: data.nickname ?? '',
        bio: data.bio ?? '',
        avatarUrl: data.avatar_url ?? null,
      }
      return true
    } catch (cause) {
      error.value = describeError(cause)
      return false
    } finally {
      loading.value = false
    }
  }

  /** 恢复登录态；重复调用共享同一个 Promise */
  function initialize(): Promise<void> {
    if (initPromise) return initPromise
    initPromise = (async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) error.value = describeError(sessionError)
        applySession(data.session)
      } catch (cause) {
        error.value = describeError(cause)
      } finally {
        initializing.value = false
      }

      if (!subscribed) {
        subscribed = true
        supabase.auth.onAuthStateChange((_event, nextSession) => {
          applySession(nextSession)
          initializing.value = false
        })
      }
    })()
    return initPromise
  }

  async function signIn(emailInput: string, password: string): Promise<boolean> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: emailInput.trim(),
        password,
      })
      if (signInError) {
        error.value = describeError(signInError)
        return false
      }
      applySession(data.session)
      return true
    } catch (cause) {
      error.value = describeError(cause)
      return false
    } finally {
      loading.value = false
    }
  }

  async function signUp(
    emailInput: string,
    password: string,
  ): Promise<{ ok: boolean; needsConfirmation: boolean }> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: emailInput.trim(),
        password,
      })
      if (signUpError) {
        error.value = describeError(signUpError)
        return { ok: false, needsConfirmation: false }
      }
      applySession(data.session)
      // 项目开启「邮箱确认」时，session 为空，需要用户去收件箱点确认链接
      return { ok: true, needsConfirmation: data.session === null }
    } catch (cause) {
      error.value = describeError(cause)
      return { ok: false, needsConfirmation: false }
    } finally {
      loading.value = false
    }
  }

  async function signOut(): Promise<void> {
    loading.value = true
    try {
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) error.value = describeError(signOutError)
    } finally {
      applySession(null)
      loading.value = false
    }
  }

  /** 发送重置密码邮件（设置页可选能力） */
  async function sendPasswordReset(emailInput: string): Promise<boolean> {
    loading.value = true
    error.value = ''
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(emailInput.trim(), {
        redirectTo: `${window.location.origin}/login`,
      })
      if (resetError) {
        error.value = describeError(resetError)
        return false
      }
      return true
    } finally {
      loading.value = false
    }
  }

  function clearError(): void {
    error.value = ''
  }

  return {
    session,
    user,
    profile,
    initializing,
    loading,
    error,
    isAuthenticated,
    email,
    userId,
    initialize,
    signIn,
    signUp,
    signOut,
    sendPasswordReset,
    loadProfile,
    updateProfile,
    clearError,
  }
})
```

## `src/views/StudyRoomLobbyView.vue`

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useRoomStore } from '@/stores/room'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const room = useRoomStore()
const toast = useToast()

const roomName = ref('')
const maxMembers = ref(6)
const inviteCode = ref('')
const creating = ref(false)
const joining = ref(false)
const joiningId = ref('')
const matching = ref(false)

async function loadRooms(): Promise<void> {
  await room.fetchRooms()
}

async function createRoom(): Promise<void> {
  if (creating.value) return
  creating.value = true
  const nextId = await room.createRoom(roomName.value, maxMembers.value)
  creating.value = false
  if (!nextId) {
    toast.warning(room.error || '创建房间失败')
    return
  }
  toast.success('房间已创建')
  await router.push(`/study-room/${nextId}`)
}

async function joinByCode(code = inviteCode.value): Promise<void> {
  if (joining.value) return
  joining.value = true
  joiningId.value = code
  const nextId = await room.joinRoom(code)
  joining.value = false
  joiningId.value = ''
  if (!nextId) {
    toast.warning(room.error || '加入房间失败')
    return
  }
  toast.success('已加入房间')
  await router.push(`/study-room/${nextId}`)
}

function roomFull(capacity: number, count: number): boolean {
  return count >= capacity
}

/** 真实随机匹配：从开放房间里选一个还有空位的，不创建硬编码大世界 */
async function randomMatch(): Promise<void> {
  if (matching.value || joining.value) return
  matching.value = true
  const list = await room.fetchRooms()
  const candidate = list.find((item) => item.memberCount < item.maxMembers)
  matching.value = false
  if (!candidate) {
    toast.warning('暂时没有空位，先创建一个房间吧')
    return
  }
  await joinByCode(candidate.inviteCode)
}

onMounted(loadRooms)
</script>

<template>
  <AppShell>
    <div class="page-wrap">
      <header class="page-head">
        <div class="page-head__text">
          <p class="eyebrow">一起专注</p>
          <h1>自习室大厅</h1>
          <p class="muted">创建一张桌子，或凭邀请码加入一个正在专注的房间。</p>
        </div>
        <div class="lobby-refresh">
          <button type="button" class="btn btn--ghost btn--sm" :disabled="matching" @click="randomMatch">
            {{ matching ? '匹配中…' : '随机匹配' }}
          </button>
          <button type="button" class="btn btn--ghost btn--sm" :disabled="room.loading" @click="loadRooms">
            {{ room.loading ? '刷新中…' : '刷新房间' }}
          </button>
        </div>
      </header>

      <div class="lobby-controls">
        <GlassCard class="lobby-card">
          <div class="lobby-card__head">
            <span class="section__title">创建房间</span>
            <span class="tiny faint">最多 10 人</span>
          </div>

          <div class="lobby-field">
            <label class="lobby-label" for="lobby-name">房间名称</label>
            <input id="lobby-name" v-model="roomName" class="lobby-input" maxlength="60" placeholder="例如：雨夜书房" />
          </div>

          <div class="lobby-field">
            <label class="lobby-label" for="lobby-limit">人数上限</label>
            <input id="lobby-limit" v-model.number="maxMembers" class="lobby-input" type="number" min="1" max="10" />
          </div>

          <button type="button" class="lobby-primary" :disabled="creating" @click="createRoom">
            {{ creating ? '创建中…' : '创建并进入' }}
          </button>
        </GlassCard>

        <GlassCard class="lobby-card">
          <div class="lobby-card__head">
            <span class="section__title">邀请码加入</span>
            <span class="tiny faint">6 位代码</span>
          </div>

          <div class="lobby-field">
            <label class="lobby-label" for="lobby-code">邀请码</label>
            <input
              id="lobby-code"
              v-model="inviteCode"
              class="lobby-input lobby-input--code"
              maxlength="12"
              placeholder="例如：A1B2C3"
              @keyup.enter="joinByCode()"
            />
          </div>

          <button type="button" class="lobby-secondary" :disabled="joining" @click="joinByCode()">
            {{ joining && !joiningId ? '加入中…' : '凭邀请码加入' }}
          </button>
        </GlassCard>
      </div>

      <section class="room-list-section">
        <div class="section__head">
          <span class="section__title">正在开放的自习室</span>
          <span class="tiny faint">{{ room.rooms.length }} 间</span>
        </div>

        <GlassCard v-if="room.error" class="state-card">
          <p class="error-text">{{ room.error }}</p>
          <button type="button" class="btn btn--ghost btn--sm" @click="loadRooms">重新加载</button>
        </GlassCard>

        <GlassCard v-else-if="!room.loading && room.rooms.length === 0" class="state-card">
          <EmptyState title="还没有开放的房间" description="创建第一个房间，把朋友们叫来一起专注。">
            <button type="button" class="btn btn--ghost btn--sm" @click="roomName = '拾光自习室'">
              填入默认名称
            </button>
          </EmptyState>
        </GlassCard>

        <div v-else class="room-grid">
          <GlassCard v-for="item in room.rooms" :key="item.id" class="room-card" interactive>
            <div class="room-card__top">
              <span class="room-card__date">{{ dayjs(item.createdAt).format('MM-DD HH:mm') }}</span>
              <span class="room-card__capacity numeric">{{ item.memberCount }}/{{ item.maxMembers }}</span>
            </div>

            <strong class="room-card__name">{{ item.name }}</strong>
            <span class="room-card__meta">
              {{ roomFull(item.maxMembers, item.memberCount) ? '房间已满' : '还有空位' }}
            </span>

            <button
              type="button"
              class="room-card__join"
              :disabled="joining || roomFull(item.maxMembers, item.memberCount)"
              @click="joinByCode(item.inviteCode)"
            >
              {{ joiningId === item.inviteCode ? '加入中…' : '加入房间' }}
            </button>
          </GlassCard>
        </div>
      </section>
    </div>
  </AppShell>
</template>

<style scoped>
.lobby-refresh {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.lobby-controls {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.lobby-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.lobby-card__head,
.room-list-section .section__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.lobby-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lobby-label {
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--text-tertiary);
}

.lobby-input {
  width: 100%;
  padding: 8px 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}

.lobby-input:focus {
  border-bottom-color: var(--accent);
  box-shadow: 0 1px 0 var(--accent);
}

.lobby-input--code {
  font-family: var(--font-mono);
  letter-spacing: 0.14em;
}

.lobby-primary,
.lobby-secondary {
  min-height: 40px;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
  background: linear-gradient(140deg, var(--accent), var(--accent-strong));
  color: var(--accent-contrast);
  font-size: 12px;
  cursor: pointer;
  transition:
    transform var(--dur-base) var(--ease-spring),
    box-shadow var(--dur-base) var(--ease-out);
}

.lobby-secondary {
  border-color: var(--glass-border);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
}

.lobby-primary:hover {
  transform: translateY(-1px);
  background: rgba(15, 23, 42, 0.2);
  color: var(--accent-contrast);
  box-shadow: 0 12px 26px -16px var(--accent-strong);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  transition: all 0.3s ease;
}

.lobby-secondary:hover {
  transform: translateY(-1px);
  background: rgba(15, 23, 42, 0.2);
  color: var(--text-primary);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  transition: all 0.3s ease;
}

.room-list-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.room-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: var(--space-4);
}

.room-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-height: 174px;
}

.room-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.room-card__date {
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
}

.room-card__capacity {
  font-size: 10px;
  color: var(--text-tertiary);
}

.room-card__name {
  font-size: 18px;
  font-weight: 620;
  color: var(--text-strong);
}

.room-card__meta {
  font-size: 10px;
  color: var(--text-tertiary);
}

.room-card__join {
  margin-top: auto;
  min-height: 34px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
  font-size: 11px;
  cursor: pointer;
}

.room-card__join:hover:not(:disabled) {
  background: var(--glass-bg);
}

.room-card__join:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

@media (max-width: 760px) {
  .lobby-controls {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
```

## `src/views/StudyRoomView.vue`

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import ZenTimer from '@/components/focus/ZenTimer.vue'
import RoomChat from '@/components/focus/RoomChat.vue'
import { useAmbientAudio, type AmbientSound } from '@/composables/useAmbientAudio'
import { useRoomStore, type RoomSeat } from '@/stores/room'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const auth = useAuthStore()
const room = useRoomStore()
const audio = useAmbientAudio()

const focusMinutes = ref(25)
const timerRunning = ref(false)
const loadingError = ref('')
let activeRoomId = ''

const soundOptions: Array<{ id: AmbientSound; label: string; icon: string }> = [
  { id: 'rain', label: '轻柔雨声', icon: '☂' },
  { id: 'river', label: '缓慢河流', icon: '≈' },
  { id: 'fire', label: '烧火白噪', icon: '♨' },
]

const roomId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))

/** 严格按 max_members 生成定长座位槽；有成员渲染卡片，无成员渲染空位 */
const seatSlots = computed<Array<RoomSeat | null>>(() => {
  const total = Math.max(1, room.maxMembers)
  return Array.from({ length: total }, (_, index) => room.members[index] ?? null)
})

const activeSoundLabel = computed(
  () => soundOptions.find((option) => option.id === audio.sound.value)?.label ?? '环境音',
)

function statusLabel(member: RoomSeat): string {
  return member.userId === auth.userId && timerRunning.value ? '正在专注' : '在线'
}

function onTimerRunning(value: boolean): void {
  timerRunning.value = value
  if (auth.userId) room.setFocusing(auth.userId, value)
}

async function loadRoom(): Promise<void> {
  loadingError.value = ''
  activeRoomId = roomId.value
  const loaded = await room.fetchRoom(roomId.value)
  if (!loaded) {
    loadingError.value = room.error || '房间不存在'
    toast.warning(loadingError.value)
    await router.replace('/study-room')
  }
}

async function leaveRoom(): Promise<void> {
  await room.leaveRoom()
  await router.push('/study-room')
}

async function chooseSound(next: AmbientSound): Promise<void> {
  if (audio.sound.value === next) {
    if (!audio.enabled.value) await audio.toggle()
    return
  }
  await audio.selectSound(next)
  if (!audio.enabled.value) await audio.toggle()
}

function onComplete(): void {
  toast.success('这一轮专注完成，去喝口水吧')
}

function updateVolume(event: Event): void {
  audio.setVolume(Number((event.target as HTMLInputElement).value) / 100)
}

watch(roomId, loadRoom)
onMounted(loadRoom)

onBeforeUnmount(() => {
  if (auth.userId) room.setFocusing(auth.userId, false)
})

onUnmounted(() => {
  // 生命周期 GC：如果最后一个成员已经离开，清理空房间
  if (activeRoomId) void room.cleanupIfEmpty(activeRoomId)
})
</script>

<template>
  <AppShell>
    <div class="page-wrap">
      <GlassCard v-if="loadingError" class="state-card">
        <p class="error-text">{{ loadingError }}</p>
        <RouterLink class="btn btn--ghost btn--sm" to="/study-room">回到大厅</RouterLink>
      </GlassCard>

      <template v-else>
        <header class="room-head">
          <div>
            <p class="eyebrow">ROOM / {{ room.inviteCode || '--------' }}</p>
            <h1>{{ room.roomName }}</h1>
            <p class="muted">
              {{ room.memberCount }}/{{ room.maxMembers }} 人在座 · 邀请码
              <span class="room-code">{{ room.inviteCode || '--------' }}</span>
            </p>
          </div>

          <div class="room-head__actions">
            <button type="button" class="btn btn--ghost btn--sm" @click="leaveRoom">离开房间</button>
            <RouterLink class="btn btn--ghost btn--sm" to="/study-room">大厅</RouterLink>
          </div>
        </header>

        <div class="seat-strip" role="list" aria-label="虚拟座位">
          <template v-for="(seat, index) in seatSlots" :key="seat?.userId ?? `empty-${index}`">
            <div
              v-if="seat"
              class="seat"
              :class="{ 'seat--focus': seat.userId === auth.userId && timerRunning }"
              role="listitem"
            >
              <span class="seat__avatar">
                <img v-if="seat.avatarUrl" :src="seat.avatarUrl" alt="" />
                <template v-else>{{ room.initialsOf(seat.nickname) }}</template>
              </span>
              <span class="seat__body">
                <strong>{{ seat.nickname }}</strong>
                <small>{{ statusLabel(seat) }}</small>
              </span>
              <span
                v-if="seat.userId === auth.userId && timerRunning"
                class="seat__lamp"
                aria-hidden="true"
              ></span>
              <span v-if="seat.bio" class="seat__bio">{{ seat.bio }}</span>
            </div>

            <div v-else class="seat seat--empty" role="listitem">
              <span class="seat__avatar seat__avatar--empty">+</span>
              <span class="seat__body">
                <strong>空位</strong>
                <small>等待同学加入</small>
              </span>
            </div>
          </template>
        </div>

        <GlassCard class="stage-panel">
          <div class="stage-panel__head">
            <span class="section__title">专注台</span>
            <span class="tiny faint">ZEN TIMER · {{ focusMinutes }} MIN</span>
          </div>

          <ZenTimer
            v-model:minutes="focusMinutes"
            @update:running="onTimerRunning"
            @complete="onComplete"
          />

          <div class="audio-panel">
            <div class="audio-panel__head">
              <div>
                <span class="audio-panel__title">
                  <span class="audio-panel__pulse" :class="{ 'is-on': audio.enabled.value }" aria-hidden="true"></span>
                  {{ audio.enabled.value ? activeSoundLabel : '环境音已关闭' }}
                </span>
                <span class="audio-panel__sub tiny faint">纯净粉红噪音 / 白噪音 · 无音频文件</span>
              </div>

              <button
                type="button"
                class="audio-panel__toggle"
                :class="{ 'is-on': audio.enabled.value }"
                :aria-pressed="audio.enabled.value"
                @click="audio.toggle"
              >
                {{ audio.enabled.value ? '停止' : '开启' }}
              </button>
            </div>

            <div class="sound-radio" role="radiogroup" aria-label="选择环境音">
              <button
                v-for="option in soundOptions"
                :key="option.id"
                type="button"
                class="sound-radio__option"
                :class="{ 'is-active': audio.sound.value === option.id }"
                role="radio"
                :aria-checked="audio.sound.value === option.id"
                @click="chooseSound(option.id)"
              >
                <span class="sound-radio__icon" aria-hidden="true">{{ option.icon }}</span>
                <span>{{ option.label }}</span>
              </button>
            </div>

            <div class="audio-panel__slider-row">
              <span class="tiny faint">音量</span>
              <input
                class="audio-panel__slider"
                type="range"
                min="0"
                max="100"
                :value="Math.round(audio.volume.value * 100)"
                :disabled="!audio.enabled.value"
                aria-label="环境音音量"
                @input="updateVolume"
              />
              <span class="tiny numeric">{{ Math.round(audio.volume.value * 100) }}%</span>
            </div>
          </div>
        </GlassCard>
      </template>
    </div>

    <RoomChat :room-id="roomId" />
  </AppShell>
</template>

<style scoped>
.room-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.room-head__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.room-code {
  font-family: var(--font-mono);
  letter-spacing: 0.12em;
  color: var(--text-secondary);
}

.seat-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 2px 10px;
  margin-bottom: var(--space-4);
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
}

.seat {
  position: relative;
  flex: 0 0 158px;
  min-height: 66px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border-soft);
  background: var(--glass-bg-soft);
  scroll-snap-align: start;
  transition:
    transform var(--dur-base) var(--ease-spring),
    background-color var(--dur-fast) var(--ease-out);
}

.seat:hover {
  transform: translateY(-2px);
  background: var(--glass-bg);
}

.seat--focus {
  border-color: var(--accent-soft);
  background: var(--accent-softer);
}

.seat--empty {
  opacity: 0.5;
  border-style: dashed;
}

.seat__avatar {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  font-size: 12px;
  font-weight: 650;
  color: var(--text-strong);
  background: var(--glass-bg-strong);
}

.seat__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.seat__avatar--empty {
  color: var(--text-tertiary);
  font-weight: 400;
}

.seat__body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.seat__body strong {
  max-width: 88px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-strong);
}

.seat__body small {
  font-size: 8px;
  color: var(--text-tertiary);
}

.seat__lamp {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  animation: seat-lamp 2.4s ease-out infinite;
}

.seat__bio {
  position: absolute;
  left: 10px;
  bottom: 6px;
  max-width: 132px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 7px;
  color: var(--text-tertiary);
}

.stage-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding-bottom: clamp(18px, 3vw, 30px);
}

.stage-panel__head {
  width: 100%;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.audio-panel {
  width: min(680px, 100%);
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 13px 15px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
}

.audio-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.audio-panel__head > div {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.audio-panel__title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: var(--text-primary);
}

.audio-panel__sub {
  padding-left: 15px;
  font-size: 9px;
}

.audio-panel__pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-tertiary);
}

.audio-panel__pulse.is-on {
  background: var(--success);
  animation: audio-pulse 1.8s ease-out infinite;
}

.audio-panel__toggle {
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text-primary);
  font-size: 10px;
  cursor: pointer;
}

.audio-panel__toggle.is-on {
  border-color: var(--accent);
  color: var(--accent);
  box-shadow: 0 0 14px var(--accent-soft);
}

.sound-radio {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
}

.sound-radio__option {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 6px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.audio-panel__toggle:hover {
  background: rgba(15, 23, 42, 0.2);
  color: var(--text-primary);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  transition: all 0.3s ease;
}

.sound-radio__option:hover {
  background: rgba(15, 23, 42, 0.2);
  color: var(--text-primary);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  transition: all 0.3s ease;
}

.sound-radio__option.is-active {
  border-color: var(--accent-soft);
  background: var(--accent-softer);
  color: var(--text-primary);
}

.sound-radio__icon {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  border: 1px solid var(--glass-border-soft);
  font-size: 11px;
}

.audio-panel__slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.audio-panel__slider {
  flex: 1;
  height: 3px;
  accent-color: var(--accent);
  cursor: pointer;
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

@keyframes seat-lamp {
  0% { box-shadow: 0 0 0 0 var(--success-soft); }
  70% { box-shadow: 0 0 0 8px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}

@keyframes audio-pulse {
  0% { box-shadow: 0 0 0 0 var(--success-soft); }
  70% { box-shadow: 0 0 0 8px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}

@media (max-width: 860px) {
  .seat {
    flex-basis: 146px;
  }
}

@media (max-width: 560px) {
  .sound-radio__option {
    flex-direction: column;
    gap: 2px;
    font-size: 9px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .seat__lamp,
  .audio-panel__pulse {
    animation: none;
  }

  .seat:hover {
    transform: none;
  }
}
</style>
```

## `src/components/focus/RoomChat.vue`

```vue
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'

const props = defineProps<{ roomId: string }>()

const auth = useAuthStore()
const chat = useChatStore()
const open = ref(false)
const draft = ref('')
const listRef = ref<HTMLElement | null>(null)

const canSend = computed(() => draft.value.trim().length > 0 && !chat.sending)

async function scrollToBottom(): Promise<void> {
  await nextTick()
  const list = listRef.value
  if (list) list.scrollTop = list.scrollHeight
}

async function init(): Promise<void> {
  if (!props.roomId) return
  await chat.load(props.roomId)
  chat.subscribe(props.roomId)
  await scrollToBottom()
}

async function send(): Promise<void> {
  if (!canSend.value) return
  const content = draft.value
  draft.value = ''
  const ok = await chat.send(content)
  if (!ok) draft.value = content
  await scrollToBottom()
}

function toggle(): void {
  open.value = !open.value
  if (open.value) void scrollToBottom()
}

watch(
  () => chat.messages.length,
  () => {
    if (open.value) void scrollToBottom()
  },
)

watch(
  () => props.roomId,
  () => void init(),
)

onMounted(init)
onBeforeUnmount(() => chat.reset())
</script>

<template>
  <div class="chat-dock">
    <Transition name="chat-panel">
      <aside v-if="open" class="chat-panel" aria-label="房间聊天">
        <header class="chat-panel__head">
          <div>
            <span class="chat-panel__eyebrow">ROOM CHAT</span>
            <strong>房间消息</strong>
          </div>
          <button type="button" class="chat-panel__close" aria-label="收起聊天" @click="open = false">
            <span></span><span></span>
          </button>
        </header>

        <div ref="listRef" class="chat-list" aria-live="polite">
          <p v-if="chat.loading" class="chat-empty">正在读取消息…</p>
          <p v-else-if="chat.messages.length === 0" class="chat-empty">还没有消息，打个招呼吧。</p>

          <div
            v-for="message in chat.messages"
            :key="message.id"
            class="chat-message"
            :class="{ 'is-own': message.userId === auth.userId, 'is-pending': message.pending }"
          >
            <span class="chat-message__name">{{ message.nickname }}</span>
            <span class="chat-message__bubble">{{ message.content }}</span>
            <span class="chat-message__time">{{ dayjs(message.createdAt).format('HH:mm') }}</span>
          </div>
        </div>

        <p v-if="chat.error" class="chat-error" role="alert">{{ chat.error }}</p>

        <form class="chat-form" @submit.prevent="send">
          <input
            v-model="draft"
            class="chat-input"
            type="text"
            maxlength="1000"
            placeholder="说点什么…"
            aria-label="聊天消息"
          />
          <button type="submit" class="chat-send" :disabled="!canSend">发送</button>
        </form>
      </aside>
    </Transition>

    <button
      type="button"
      class="chat-fab"
      :class="{ 'is-open': open }"
      :aria-expanded="open"
      aria-label="打开房间聊天"
      @click="toggle"
    >
      <span class="chat-fab__icon" aria-hidden="true">✦</span>
      <span>聊天</span>
      <span v-if="chat.messages.length" class="chat-fab__count">{{ chat.messages.length }}</span>
    </button>
  </div>
</template>

<style scoped>
.chat-dock {
  position: fixed;
  left: clamp(14px, 2vw, 24px);
  bottom: clamp(14px, 2vw, 24px);
  z-index: 45;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.chat-fab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 40px;
  padding: 0 14px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  color: var(--text-primary);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(var(--glass-blur));
  backdrop-filter: blur(var(--glass-blur));
  font-size: 11px;
  cursor: pointer;
  transition:
    transform var(--dur-base) var(--ease-spring),
    background-color var(--dur-fast) var(--ease-out);
}

.chat-fab:hover {
  transform: translateY(-2px);
  background: var(--glass-bg-hover);
}

.chat-fab__icon {
  color: var(--accent);
}

.chat-fab__count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 8px;
}

.chat-panel {
  width: min(330px, calc(100vw - 28px));
  max-height: min(560px, calc(100vh - 120px));
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 20px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(24px) saturate(145%);
  backdrop-filter: blur(24px) saturate(145%);
}

.chat-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.chat-panel__head > div {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.chat-panel__eyebrow {
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.16em;
  color: var(--text-tertiary);
}

.chat-panel__head strong {
  font-size: 14px;
  color: var(--text-strong);
}

.chat-panel__close {
  position: relative;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid var(--glass-border-soft);
  background: var(--glass-bg-soft);
  cursor: pointer;
}

.chat-panel__close span {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 1.3px;
  background: var(--text-primary);
}

.chat-panel__close span:first-child {
  transform: translate(-50%, -50%) rotate(45deg);
}

.chat-panel__close span:last-child {
  transform: translate(-50%, -50%) rotate(-45deg);
}

.chat-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-height: 120px;
  max-height: 380px;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 3px 2px;
  scrollbar-width: none;
}

.chat-list::-webkit-scrollbar {
  display: none;
}

.chat-empty {
  margin: auto;
  font-size: 10px;
  color: var(--text-tertiary);
  text-align: center;
}

.chat-message {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  max-width: 90%;
}

.chat-message.is-own {
  align-self: flex-end;
  align-items: flex-end;
}

.chat-message__name {
  font-size: 8px;
  color: var(--text-tertiary);
}

.chat-message__bubble {
  padding: 7px 10px;
  border-radius: 13px;
  border: 1px solid var(--glass-border-soft);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
  font-size: 11px;
  line-height: 1.5;
  word-break: break-word;
}

.chat-message.is-own .chat-message__bubble {
  border-color: var(--accent-soft);
  background: var(--accent-softer);
}

.chat-message.is-pending .chat-message__bubble {
  opacity: 0.55;
}

.chat-message__time {
  font-size: 8px;
  color: var(--text-tertiary);
}

.chat-error {
  font-size: 9px;
  color: var(--danger);
}

.chat-form {
  display: flex;
  align-items: center;
  gap: 6px;
}

.chat-input {
  flex: 1;
  min-width: 0;
  padding: 7px 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: var(--text-primary);
  font-size: 11px;
  outline: none;
}

.chat-input:focus {
  border-bottom-color: var(--accent);
  box-shadow: 0 1px 0 var(--accent);
}

.chat-send {
  min-height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
  font-size: 10px;
  cursor: pointer;
}

.chat-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-panel-enter-active,
.chat-panel-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-base) var(--ease-spring);
}

.chat-panel-enter-from,
.chat-panel-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.97);
}

@media (prefers-reduced-motion: reduce) {
  .chat-panel-enter-active,
  .chat-panel-leave-active,
  .chat-fab {
    transition: none;
  }
}
</style>
```

## `src/components/focus/ZenTimer.vue`

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import debounce from 'lodash.debounce'
import { formatClock } from '@/lib/date'

/**
 * 可复用的禅意计时器：环形进度 + 呼吸光晕。
 * 提供内置开始/暂停/重置，也可以通过 defineExpose 由父组件控制。
 */
const props = withDefaults(
  defineProps<{
    minutes?: number
    autoStart?: boolean
  }>(),
  { minutes: 25, autoStart: false },
)

const emit = defineEmits<{
  (event: 'complete'): void
  (event: 'update:minutes', value: number): void
  (event: 'update:running', value: boolean): void
}>()

const radius = 94
const circumference = 2 * Math.PI * radius
const duration = computed(() => Math.max(60, Math.round(props.minutes * 60)))
const elapsed = ref(0)
const running = ref(false)
const durationOpen = ref(false)
const minuteOptions = [15, 25, 45]
const customMinutes = ref(props.minutes)

let ticker: number | null = null
let anchor = 0
let baseElapsed = 0

const remaining = computed(() => Math.max(0, duration.value - elapsed.value))
const progress = computed(() => Math.min(1, elapsed.value / duration.value))
const dashOffset = computed(() => circumference * (1 - progress.value))
const display = computed(() => formatClock(remaining.value))

function clearTicker(): void {
  if (ticker !== null) {
    window.clearInterval(ticker)
    ticker = null
  }
}

function tick(): void {
  elapsed.value = Math.min(duration.value, baseElapsed + (performance.now() - anchor) / 1000)
  if (elapsed.value >= duration.value) {
    clearTicker()
    running.value = false
    emit('update:running', false)
    emit('complete')
  }
}

function start(): void {
  if (running.value) return
  if (elapsed.value >= duration.value) elapsed.value = 0
  anchor = performance.now()
  baseElapsed = elapsed.value
  running.value = true
  emit('update:running', true)
  clearTicker()
  ticker = window.setInterval(tick, 200)
}

function pause(): void {
  if (!running.value) return
  clearTicker()
  baseElapsed = elapsed.value
  running.value = false
  emit('update:running', false)
}

function toggle(): void {
  if (running.value) pause()
  else start()
}

function reset(): void {
  clearTicker()
  running.value = false
  elapsed.value = 0
  baseElapsed = 0
  emit('update:running', false)
}

function chooseMinutes(value: number): void {
  customMinutes.value = value
  emit('update:minutes', value)
  durationOpen.value = false
}

const commitCustomMinutes = debounce((value: number) => {
  const safe = Math.min(180, Math.max(1, Math.round(value) || 25))
  customMinutes.value = safe
  emit('update:minutes', safe)
}, 500)

function onCustomInput(): void {
  commitCustomMinutes(Number(customMinutes.value))
}

watch(
  () => props.minutes,
  () => {
    customMinutes.value = props.minutes
    reset()
  },
)

if (props.autoStart) start()

defineExpose({ start, pause, reset, running, remaining })
onBeforeUnmount(() => {
  clearTicker()
  commitCustomMinutes.cancel()
})
</script>

<template>
  <section class="zen-timer" aria-label="自习室计时器" @keydown.esc="durationOpen = false">
    <div class="zen-timer__halo" aria-hidden="true"></div>

    <div class="zen-timer__dial">
      <svg class="zen-timer__svg" viewBox="0 0 220 220" aria-hidden="true">
        <defs>
          <linearGradient id="zen-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="var(--accent)" />
            <stop offset="0.55" stop-color="var(--accent-strong)" />
            <stop offset="1" stop-color="var(--accent)" />
          </linearGradient>
        </defs>
        <circle class="zen-timer__track" cx="110" cy="110" :r="radius" />
        <circle
          class="zen-timer__progress"
          cx="110"
          cy="110"
          :r="radius"
          :stroke-dasharray="circumference"
          :stroke-dashoffset="dashOffset"
          transform="rotate(-90 110 110)"
        />
      </svg>

      <div class="zen-timer__glass">
        <span class="zen-timer__label">{{ running ? '正在专注' : '准备开始' }}</span>
        <strong class="zen-timer__digits numeric">{{ display }}</strong>

        <div class="zen-timer__target-wrap">
          <button
            type="button"
            class="zen-timer__target"
            aria-haspopup="listbox"
            :aria-expanded="durationOpen"
            @click.stop="durationOpen = !durationOpen"
          >
            目标 {{ minutes }} 分钟
            <span aria-hidden="true">⌄</span>
          </button>

          <Transition name="time-pop">
            <div v-if="durationOpen" class="zen-time-pop" role="listbox" aria-label="选择专注时长">
              <button
                v-for="option in minuteOptions"
                :key="option"
                type="button"
                class="zen-time-pop__option"
                :class="{ 'is-active': option === minutes }"
                role="option"
                :aria-selected="option === minutes"
                @click.stop="chooseMinutes(option)"
              >
                {{ option }} min
              </button>

              <label class="zen-time-pop__custom">
                <span>自定义</span>
                <input
                  v-model.number="customMinutes"
                  type="number"
                  min="1"
                  max="180"
                  inputmode="numeric"
                  aria-label="自定义专注分钟数"
                  @input="onCustomInput"
                  @keydown.enter.prevent="commitCustomMinutes.flush()"
                />
              </label>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <div class="zen-timer__controls">
      <button type="button" class="zen-timer__btn zen-timer__btn--primary" @click="toggle">
        {{ running ? '暂停' : elapsed > 0 ? '继续' : '开始专注' }}
      </button>
      <button type="button" class="zen-timer__btn" @click="reset">重置</button>
    </div>
  </section>
</template>

<style scoped>
.zen-timer {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  padding: 10px clamp(12px, 2vw, 24px);
}

.zen-timer__halo {
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(48vw, 300px);
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent-soft) 0%, transparent 68%);
  filter: blur(20px);
  transform: translate(-50%, -50%);
  animation: zen-breathe 5.6s ease-in-out infinite;
  pointer-events: none;
}

.zen-timer__dial {
  position: relative;
  width: min(48vw, 300px);
  aspect-ratio: 1;
  display: grid;
  place-items: center;
}

.zen-timer__svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  animation: zen-ring-breathe 5.6s ease-in-out infinite;
}

.zen-timer__track {
  fill: none;
  stroke: var(--line);
  stroke-width: 1.2;
}

.zen-timer__progress {
  fill: none;
  stroke: url(#zen-ring);
  stroke-width: 2.2;
  stroke-linecap: round;
  filter: drop-shadow(0 0 6px var(--accent-soft));
  transition: stroke-dashoffset var(--dur-slow) var(--ease-out);
}

.zen-timer__glass {
  width: 76%;
  height: 76%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  box-shadow:
    var(--glass-shadow),
    inset 0 1px 0 var(--glass-highlight);
  -webkit-backdrop-filter: blur(var(--glass-blur-strong));
  backdrop-filter: blur(var(--glass-blur-strong));
}

.zen-timer__label {
  font-size: 9px;
  letter-spacing: 0.2em;
  color: var(--text-tertiary);
}

.zen-timer__digits {
  font-size: clamp(42px, 8vw, 64px);
  font-weight: 300;
  letter-spacing: 0.02em;
  line-height: 1;
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
}

.zen-timer__target {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-tertiary);
  font-size: 10px;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.zen-timer__target:hover {
  background: var(--glass-bg-soft);
  color: var(--text-secondary);
}

.zen-timer__target-wrap {
  position: relative;
  z-index: 5;
}

.zen-time-pop {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  z-index: 20;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  width: 190px;
  padding: 7px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(var(--glass-blur));
  backdrop-filter: blur(var(--glass-blur));
  transform: translateX(-50%);
}

.zen-time-pop__option {
  padding: 7px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.zen-time-pop__option:hover,
.zen-time-pop__option.is-active {
  border-color: var(--glass-border);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
}

.zen-time-pop__custom {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 3px;
  padding: 7px 3px 2px;
  border-top: 1px solid var(--line-soft);
  font-size: 9px;
  color: var(--text-tertiary);
}

.zen-time-pop__custom input {
  width: 64px;
  padding: 5px 7px;
  border: 1px solid var(--glass-border-soft);
  border-radius: var(--radius-xs);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
  font-size: 10px;
  text-align: center;
  outline: none;
}

.zen-time-pop__custom input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.time-pop-enter-active,
.time-pop-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-base) var(--ease-spring);
}

.time-pop-enter-from,
.time-pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px) scale(0.94);
}

.zen-timer__controls {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.zen-timer__btn {
  min-height: 40px;
  padding: 0 22px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  -webkit-backdrop-filter: blur(var(--glass-blur));
  backdrop-filter: blur(var(--glass-blur));
  transition:
    transform var(--dur-base) var(--ease-spring),
    background-color var(--dur-fast) var(--ease-out);
}

.zen-timer__btn:hover {
  transform: translateY(-1px);
  background: rgba(15, 23, 42, 0.2);
  color: var(--text-primary);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  transition: all 0.3s ease;
}

.zen-timer__btn--primary:hover {
  color: var(--accent-contrast);
}

.zen-timer__btn--primary {
  border-color: transparent;
  background: linear-gradient(140deg, var(--accent), var(--accent-strong));
  color: var(--accent-contrast);
}

@keyframes zen-breathe {
  0%,
  100% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0.5;
  }
  35% {
    transform: translate(-50%, -50%) scale(1.06);
    opacity: 0.85;
  }
  75% {
    transform: translate(-50%, -50%) scale(1.02);
    opacity: 0.62;
  }
}

@keyframes zen-ring-breathe {
  0%,
  100% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.015);
  }
}

@media (prefers-reduced-motion: reduce) {
  .zen-timer__halo,
  .zen-timer__svg {
    animation: none;
  }

  .zen-timer__btn:hover {
    transform: none;
  }
}
</style>
```

## `src/composables/useAmbientAudio.ts`

```ts
import { onBeforeUnmount, ref } from 'vue'

export type AmbientSound = 'rain' | 'river' | 'fire'

interface AudioChain {
  source: AudioBufferSourceNode
  gain: GainNode
}

/**
 * 3 套纯净环境音：
 * - rain：粉红噪音 + 高通/低通，轻柔雨声；
 * - river：粉红噪音 + 更低低通，缓慢河流；
 * - fire：白噪音 + 低通/高通，烧火的白噪音底。
 *
 * 所有切换都通过独立 GainNode 淡入淡出，避免 AudioBufferSourceNode 切换时爆音。
 */
export function useAmbientAudio() {
  const enabled = ref(false)
  const volume = ref(0.55)
  const sound = ref<AmbientSound>('rain')

  let context: AudioContext | null = null
  let master: GainNode | null = null
  let current: AudioChain | null = null
  let pinkBuffer: AudioBuffer | null = null
  let whiteBuffer: AudioBuffer | null = null

  function makePinkBuffer(audio: AudioContext): AudioBuffer {
    const length = Math.floor(audio.sampleRate * 2)
    const buffer = audio.createBuffer(1, length, audio.sampleRate)
    const data = buffer.getChannelData(0)
    let b0 = 0
    let b1 = 0
    let b2 = 0
    let b3 = 0
    let b4 = 0
    let b5 = 0
    let b6 = 0

    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1
      b0 = 0.99886 * b0 + white * 0.0555179
      b1 = 0.99332 * b1 + white * 0.0750759
      b2 = 0.969 * b2 + white * 0.153852
      b3 = 0.8665 * b3 + white * 0.3104856
      b4 = 0.55 * b4 + white * 0.5329522
      b5 = -0.7616 * b5 - white * 0.016898
      data[index] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.09
      b6 = white * 0.115926
    }
    return buffer
  }

  function makeWhiteBuffer(audio: AudioContext): AudioBuffer {
    const length = Math.floor(audio.sampleRate * 2)
    const buffer = audio.createBuffer(1, length, audio.sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * 0.22
    }
    return buffer
  }

  function ensureContext(): AudioContext {
    if (context) return context
    const audio = new AudioContext()
    context = audio
    master = audio.createGain()
    master.gain.value = volume.value * 0.45
    master.connect(audio.destination)
    pinkBuffer = makePinkBuffer(audio)
    whiteBuffer = makeWhiteBuffer(audio)
    return audio
  }

  function buildChain(audio: AudioContext, nextSound: AmbientSound): AudioChain {
    const source = audio.createBufferSource()
    source.buffer =
      nextSound === 'fire' ? whiteBuffer ?? makeWhiteBuffer(audio) : pinkBuffer ?? makePinkBuffer(audio)
    source.loop = true

    const gain = audio.createGain()
    gain.gain.setValueAtTime(0, audio.currentTime)

    const lowpass = audio.createBiquadFilter()
    lowpass.type = 'lowpass'
    const highpass = audio.createBiquadFilter()
    highpass.type = 'highpass'

    if (nextSound === 'rain') {
      lowpass.frequency.value = 9000
      highpass.frequency.value = 700
      lowpass.Q.value = 0.6
      highpass.Q.value = 0.5
    } else if (nextSound === 'river') {
      lowpass.frequency.value = 760
      highpass.frequency.value = 90
      lowpass.Q.value = 0.8
      highpass.Q.value = 0.4
    } else {
      lowpass.frequency.value = 1500
      highpass.frequency.value = 55
      lowpass.Q.value = 0.7
      highpass.Q.value = 0.3
    }

    source.connect(highpass).connect(lowpass).connect(gain).connect(master!)
    return { source, gain }
  }

  function fadeOut(chain: AudioChain | null, duration: number, audio: AudioContext): void {
    if (!chain) return
    const now = audio.currentTime
    chain.gain.gain.cancelScheduledValues(now)
    chain.gain.gain.setValueAtTime(chain.gain.gain.value, now)
    chain.gain.gain.linearRampToValueAtTime(0, now + duration)
    try {
      chain.source.stop(now + duration + 0.06)
    } catch {
      // 已经停止
    }
  }

  function startCurrent(nextSound: AmbientSound): void {
    const audio = ensureContext()
    const next = buildChain(audio, nextSound)
    current = next
    next.source.start()
    const now = audio.currentTime
    next.gain.gain.setValueAtTime(0, now)
    next.gain.gain.linearRampToValueAtTime(1, now + 0.45)
  }

  async function start(): Promise<void> {
    const audio = ensureContext()
    await audio.resume()
    enabled.value = true
    startCurrent(sound.value)
  }

  function stop(): void {
    if (!context) {
      enabled.value = false
      return
    }
    fadeOut(current, 0.28, context)
    current = null
    enabled.value = false
  }

  async function toggle(): Promise<void> {
    if (enabled.value) stop()
    else await start()
  }

  async function selectSound(next: AmbientSound): Promise<void> {
    if (sound.value === next) return
    sound.value = next
    if (!enabled.value) return
    const audio = ensureContext()
    await audio.resume()
    fadeOut(current, 0.22, audio)
    startCurrent(next)
  }

  function setVolume(next: number): void {
    volume.value = Math.max(0, Math.min(1, next))
    if (master && context) {
      master.gain.cancelScheduledValues(context.currentTime)
      master.gain.setTargetAtTime(volume.value * 0.45, context.currentTime, 0.08)
    }
  }

  onBeforeUnmount(() => {
    if (current && context) fadeOut(current, 0.08, context)
    void context?.close()
    context = null
    current = null
    master = null
  })

  return {
    enabled,
    volume,
    sound,
    toggle,
    start,
    stop,
    selectSound,
    setVolume,
  }
}
```

## `src/components/focus/TaskCascadeModal.vue`

```vue
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { formatCN } from '@/lib/date'
import { useFocusStore } from '@/stores/focus'
import { useCascadeStore } from '@/stores/cascade'
import type { Task } from '@/types/models'

/**
 * 首页「快速沉浸」的级联选择器：
 * 级联状态在 useCascadeStore；本组件只负责弹窗、渲染与最终跳转。
 */
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()

const router = useRouter()
const focusStore = useFocusStore()
const cascade = useCascadeStore()
const panelRef = ref<HTMLElement | null>(null)

const stageTitle = computed(() => {
  if (cascade.stage === 1) return '先选一个总计划'
  if (cascade.stage === 2) return '再选一个分计划'
  return '最后选这次要做的任务'
})

function close(): void {
  emit('update:modelValue', false)
}

function open(): void {
  cascade.reset()
  void cascade.loadMasters()
}

async function chooseTask(task: Task): Promise<void> {
  focusStore.selectTask(task.id)
  close()
  await router.push('/focus')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

watch(
  () => props.modelValue,
  async (openState) => {
    if (openState) {
      document.body.style.overflow = 'hidden'
      document.addEventListener('keydown', onKeydown)
      await nextTick()
      panelRef.value?.focus()
      open()
    } else {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeydown)
    }
  },
)

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="cascade">
      <div v-if="modelValue" class="cascade-modal" @click.self="close">
        <div ref="panelRef" class="cascade-panel" role="dialog" aria-modal="true" tabindex="-1">
          <header class="cascade-head">
            <div>
              <span class="cascade-eyebrow">QUICK FOCUS / 快速沉浸</span>
              <h2>{{ stageTitle }}</h2>
              <p>{{ cascade.selectedMaster?.name || '总计划' }} <template v-if="cascade.selectedSub">/ {{ cascade.selectedSub.name }}</template></p>
            </div>
            <button type="button" class="cascade-close" aria-label="关闭" @click="close">×</button>
          </header>

          <div class="cascade-steps" aria-label="选择进度">
            <span :class="{ 'is-active': cascade.stage >= 1 }">01 总计划</span>
            <span :class="{ 'is-active': cascade.stage >= 2 }">02 分计划</span>
            <span :class="{ 'is-active': cascade.stage >= 3 }">03 任务</span>
          </div>

          <p v-if="cascade.error" class="cascade-error" role="alert">{{ cascade.error }}</p>
          <p v-if="cascade.loading" class="cascade-loading">正在读取…</p>

          <div v-else class="cascade-list">
            <template v-if="cascade.stage === 1">
              <button
                v-for="master in cascade.masters"
                :key="master.id"
                type="button"
                class="cascade-item"
                @click="cascade.chooseMaster(master)"
              >
                <span class="cascade-item__body">
                  <strong>{{ master.name }}</strong>
                  <small>{{ formatCN(master.deadline) }} 截止</small>
                </span>
                <span class="cascade-item__arrow">→</span>
              </button>
              <p v-if="cascade.masters.length === 0" class="cascade-empty">还没有未完成的总计划。</p>
            </template>

            <template v-else-if="cascade.stage === 2">
              <button
                v-for="sub in cascade.subPlans"
                :key="sub.id"
                type="button"
                class="cascade-item"
                @click="cascade.chooseSub(sub)"
              >
                <span class="cascade-item__body">
                  <strong>{{ sub.name }}</strong>
                  <small>{{ formatCN(sub.deadline) }} 截止 · 每周 {{ sub.bufferDays }} 天缓冲</small>
                </span>
                <span class="cascade-item__arrow">→</span>
              </button>
              <p v-if="cascade.subPlans.length === 0" class="cascade-empty">这个总计划下还没有分计划。</p>
            </template>

            <template v-else>
              <button
                v-for="task in cascade.tasks"
                :key="task.id"
                type="button"
                class="cascade-item"
                @click="chooseTask(task)"
              >
                <span class="cascade-item__body">
                  <strong>{{ task.name }}</strong>
                  <small>
                    {{ task.estMinutes }} 分钟 · {{ task.scheduledDate ? formatCN(task.scheduledDate) : '未排期' }}
                  </small>
                </span>
                <span class="cascade-item__arrow">→</span>
              </button>
              <p v-if="cascade.tasks.length === 0" class="cascade-empty">这个分计划下没有可专注的任务。</p>
            </template>
          </div>

          <footer class="cascade-foot">
            <button v-if="cascade.stage > 1" type="button" class="cascade-back" @click="cascade.back">← 上一步</button>
            <span class="tiny faint">只显示未完成（status !== done）的实体</span>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cascade-modal {
  position: fixed;
  inset: 0;
  z-index: 1150;
  display: grid;
  place-items: center;
  padding: var(--space-4);
  background: color-mix(in srgb, var(--overlay) 58%, transparent);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

.cascade-panel {
  width: min(520px, 94vw);
  max-height: min(720px, 88vh);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: clamp(20px, 3vw, 28px);
  border-radius: 24px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-highlight);
  -webkit-backdrop-filter: blur(26px) saturate(145%);
  backdrop-filter: blur(26px) saturate(145%);
}

.cascade-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.cascade-eyebrow {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--text-tertiary);
}

.cascade-head h2 {
  margin-top: 4px;
  font-size: 22px;
}

.cascade-head p {
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-secondary);
}

.cascade-close {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
  font-size: 17px;
  cursor: pointer;
}

.cascade-steps {
  display: flex;
  gap: 6px;
  font-size: 9px;
  color: var(--text-tertiary);
}

.cascade-steps span {
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--line-soft);
}

.cascade-steps span.is-active {
  border-color: var(--accent-soft);
  background: var(--accent-softer);
  color: var(--accent-strong);
}

.cascade-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 120px;
  max-height: 390px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
}

.cascade-list::-webkit-scrollbar {
  display: none;
}

.cascade-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border-soft);
  background: var(--glass-bg-soft);
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--dur-base) var(--ease-spring),
    background-color var(--dur-fast) var(--ease-out);
}

.cascade-item:hover {
  transform: translateX(5px);
  background: var(--glass-bg);
}

.cascade-item__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.cascade-item__body strong {
  font-size: 14px;
  color: var(--text-strong);
}

.cascade-item__body small {
  font-size: 10px;
  color: var(--text-tertiary);
}

.cascade-item__arrow {
  color: var(--accent);
}

.cascade-empty,
.cascade-loading,
.cascade-error {
  margin: auto;
  padding: var(--space-4);
  font-size: 11px;
  color: var(--text-secondary);
  text-align: center;
}

.cascade-error {
  color: var(--danger);
}

.cascade-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--line-soft);
}

.cascade-back {
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.cascade-enter-active,
.cascade-leave-active {
  transition: opacity var(--dur-base) var(--ease-out);
}

.cascade-enter-active .cascade-panel,
.cascade-leave-active .cascade-panel {
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.cascade-enter-from,
.cascade-leave-to {
  opacity: 0;
}

.cascade-enter-from .cascade-panel,
.cascade-leave-to .cascade-panel {
  transform: translateY(12px) scale(0.96);
}
</style>
```

## `src/components/focus/TaskSelectionModal.vue`

```vue
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { formatCN } from '@/lib/date'
import type { Task } from '@/types/models'

/**
 * 任务选择弹窗：只展示 pending，点击任务 -> Pinia 存 taskId -> /focus。
 */
const props = withDefaults(
  defineProps<{
    modelValue: boolean
    tasks: Task[]
    title?: string
    subtitle?: string
  }>(),
  {
    title: '选择这次要专注的任务',
    subtitle: '从非「已完成」任务里挑一个，进入后只保留眼前这一块。',
  },
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'select', task: Task): void
}>()

const panelRef = ref<HTMLElement | null>(null)
const closeButtonRef = ref<HTMLButtonElement | null>(null)
let lastActive: HTMLElement | null = null

const pendingTasks = computed(() => props.tasks.filter((task) => task.status !== 'done'))

function close(): void {
  emit('update:modelValue', false)
}

function choose(task: Task): void {
  emit('select', task)
  close()
}

function getFocusable(): HTMLElement[] {
  const panel = panelRef.value
  if (!panel) return []
  return Array.from(
    panel.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  ).filter((element) => element.offsetParent !== null)
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.modelValue) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = getFocusable()
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (!first || !last) return
  if (event.shiftKey && (active === first || active === panelRef.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      lastActive = document.activeElement instanceof HTMLElement ? document.activeElement : null
      document.body.style.overflow = 'hidden'
      document.addEventListener('keydown', onKeydown)
      await nextTick()
      closeButtonRef.value?.focus()
    } else {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeydown)
      lastActive?.focus()
      lastActive = null
    }
  },
)

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="task-modal">
      <div v-if="modelValue" class="task-modal" role="presentation" @click.self="close">
        <div
          ref="panelRef"
          class="task-modal__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-modal-title"
          tabindex="-1"
        >
          <header class="task-modal__head">
            <div>
              <span class="task-modal__eyebrow">FOCUS / 选择任务</span>
              <h2 id="task-modal-title">{{ title }}</h2>
              <p>{{ subtitle }}</p>
            </div>
            <button ref="closeButtonRef" type="button" class="task-modal__close" aria-label="关闭" @click="close">
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
            </button>
          </header>

          <div v-if="pendingTasks.length === 0" class="task-modal__empty">
            <p>这个分计划暂时没有未完成任务。</p>
            <button type="button" class="btn btn--ghost btn--sm" @click="close">返回分计划</button>
          </div>

          <ul v-else class="task-modal__list">
            <li v-for="task in pendingTasks" :key="task.id">
              <button type="button" class="task-choice" @click="choose(task)">
                <span class="task-choice__dot" aria-hidden="true"></span>
                <span class="task-choice__body">
                  <strong>{{ task.name }}</strong>
                  <small>
                    {{ task.estMinutes }} 分钟 · 每块 {{ task.focusBlock }} 分钟 ·
                    {{ task.scheduledDate ? formatCN(task.scheduledDate) : '未排期' }}
                  </small>
                </span>
                <span class="task-choice__arrow" aria-hidden="true">→</span>
              </button>
            </li>
          </ul>

          <footer class="task-modal__foot">
            <span class="tiny faint">进入后会自动开始倒计时 · 可随时暂停</span>
            <button type="button" class="btn btn--ghost btn--sm" @click="close">取消</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.task-modal {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  padding: var(--space-4);
  overflow: hidden;
  background: color-mix(in srgb, var(--overlay) 58%, transparent);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

.task-modal__panel {
  width: min(560px, 94vw);
  max-height: min(760px, 88vh);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  overflow: hidden;
  padding: clamp(20px, 3vw, 30px);
  border-radius: 24px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  box-shadow:
    var(--glass-shadow),
    inset 0 1px 0 var(--glass-highlight);
  -webkit-backdrop-filter: blur(26px) saturate(145%);
  backdrop-filter: blur(26px) saturate(145%);
}

.task-modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.task-modal__eyebrow {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--text-tertiary);
}

.task-modal__head h2 {
  margin-top: 4px;
  font-size: clamp(20px, 3vw, 24px);
}

.task-modal__head p {
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-secondary);
}

.task-modal__close {
  position: relative;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
  cursor: pointer;
}

.task-modal__close span {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 12px;
  height: 1.4px;
  border-radius: 2px;
  background: var(--text-primary);
}

.task-modal__close span:first-child {
  transform: translate(-50%, -50%) rotate(45deg);
}

.task-modal__close span:last-child {
  transform: translate(-50%, -50%) rotate(-45deg);
}

.task-modal__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  padding-right: 2px;
}

.task-modal__list::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.task-choice {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border-soft);
  background: var(--glass-bg-soft);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--dur-base) var(--ease-spring),
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.task-choice:hover,
.task-choice:focus-visible {
  outline: none;
  transform: translateX(6px);
  border-color: var(--accent-soft);
  background: var(--glass-bg);
}

.task-choice__dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-softer);
}

.task-choice__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.task-choice__body strong {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
}

.task-choice__body small {
  font-size: 10px;
  color: var(--text-tertiary);
}

.task-choice__arrow {
  color: var(--text-tertiary);
  transition: transform var(--dur-base) var(--ease-spring);
}

.task-choice:hover .task-choice__arrow {
  color: var(--accent);
  transform: translate(3px, -3px);
}

.task-modal__empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4) 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.task-modal__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--line-soft);
}

.task-modal-enter-active,
.task-modal-leave-active {
  transition: opacity var(--dur-base) var(--ease-out);
}

.task-modal-enter-active .task-modal__panel,
.task-modal-leave-active .task-modal__panel {
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.task-modal-enter-from,
.task-modal-leave-to {
  opacity: 0;
}

.task-modal-enter-from .task-modal__panel,
.task-modal-leave-to .task-modal__panel {
  transform: translateY(12px) scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
  .task-modal-enter-active .task-modal__panel,
  .task-modal-leave-active .task-modal__panel {
    transition: none;
  }

  .task-choice:hover,
  .task-choice:focus-visible {
    transform: none;
  }
}
</style>
```

## `src/composables/useSmartBack.ts`

```ts
import { computed } from 'vue'
import { useRouter } from 'vue-router'

/**
 * 智能返回：
 * - 优先检查 Vue Router 4 的 history.state.back；
 * - 直接访问/新标签页（没有上级路由）回退到首页；
 * - 其余情况执行 router.back()，保留浏览器真实来路。
 */
export function useSmartBack(fallback = '/') {
  const router = useRouter()

  const canGoBack = computed(() => {
    if (typeof window === 'undefined') return false
    const state = router.options.history.state as { back?: string | null } | undefined
    return Boolean(state?.back) || window.history.length > 1
  })

  function goBack(): void {
    if (typeof window === 'undefined') return
    const state = router.options.history.state as { back?: string | null } | undefined
    if (state?.back || window.history.length > 1) {
      router.back()
      return
    }
    void router.push(fallback)
  }

  return {
    canGoBack,
    goBack,
  }
}
```

## `src/views/master/MasterPlanListView.vue`

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import SpriteButton from '@/components/ui/SpriteButton.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import TaskCascadeModal from '@/components/focus/TaskCascadeModal.vue'
import { useMasterPlans } from '@/composables/useMasterPlans'
import { useSubPlans } from '@/composables/useSubPlans'
import { useTasks } from '@/composables/useTasks'
import { useSampleData } from '@/composables/useSampleData'
import { useToast } from '@/composables/useToast'
import { buildMasterPlanSummary } from '@/lib/summaries'
import { diffDays, formatCN, todayISO } from '@/lib/date'
import { MEASURE_TYPE_LABELS, type MasterPlanSummary } from '@/types/models'

/** 总计划列表：登录后的落地页（/），也是「总计划 → 分计划 → 专注」的起点 */
const router = useRouter()
const masterApi = useMasterPlans()
const subApi = useSubPlans()
const taskApi = useTasks()
const sample = useSampleData()
const toast = useToast()

const loading = ref(true)
const error = ref('')
const creatingSample = ref(false)
const summaries = ref<MasterPlanSummary[]>([])
const today = todayISO()
const heroPhrase = ref('Shoot for the moon.')
const cascadeOpen = ref(false)

const hasPlans = computed(() => summaries.value.length > 0)

function remainingDays(deadline: string): number {
  return Math.max(0, diffDays(today, deadline))
}

function statusTone(status: MasterPlanSummary['status']): 'accent' | 'success' | 'danger' {
  if (status === 'completed') return 'success'
  if (status === 'overdue') return 'danger'
  return 'accent'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [masters, subs, tasks] = await Promise.all([
      masterApi.fetchAll(),
      subApi.fetchAll(),
      taskApi.fetchAll(),
    ])
    error.value = masterApi.error.value || subApi.error.value || taskApi.error.value
    summaries.value = masters.map((master) => buildMasterPlanSummary(master, subs, tasks, today))
  } finally {
    loading.value = false
  }
}

/** 空状态的一次性示例：生成总计划 + 分计划 + 任务，便于直接体验完整层级 */
async function createSample(): Promise<void> {
  if (creatingSample.value) return
  creatingSample.value = true
  const ok = await sample.createSample()
  creatingSample.value = false
  if (!ok) {
    error.value = sample.error.value || '示例数据生成失败'
    return
  }
  toast.success('示例计划已生成')
  await load()
}

onMounted(load)
</script>

<template>
  <AppShell>
    <div class="page-wrap">
      <header class="page-head">
        <div class="page-head__text">
          <p class="eyebrow">从这里开始</p>
          <h1 class="hero-phrase">{{ heroPhrase }}</h1>
          <p class="muted">选择一个最终成果，继续拆成可执行的分计划；进度由任务时长加权算出。</p>
        </div>
        <div class="page-head__actions">
          <SpriteButton size="sm" @click="router.push('/master-plans/new')">+ 新建总计划</SpriteButton>
        </div>
      </header>

      <GlassCard v-if="loading" class="state-card">
        <p class="muted">正在读取总计划…</p>
      </GlassCard>

      <GlassCard v-else-if="error" class="state-card">
        <p class="error-text">{{ error }}</p>
        <button type="button" class="btn btn--ghost btn--sm" @click="load">重新加载</button>
      </GlassCard>

      <GlassCard v-else-if="!hasPlans" class="state-card">
        <EmptyState
          title="还没有总计划"
          description="先写下一个最终成果，例如「三个月通过 N2」。之后再把目标拆成分计划，系统会带你一路走到今天的专注。"
        >
          <SpriteButton @click="router.push('/master-plans/new')">创建第一个总计划</SpriteButton>
          <button
            type="button"
            class="btn btn--ghost"
            :disabled="creatingSample"
            @click="createSample"
          >
            {{ creatingSample ? '正在生成…' : '一键示例' }}
          </button>
        </EmptyState>
      </GlassCard>

      <div v-else class="plan-grid">
        <RouterLink
          v-for="summary in summaries"
          :key="summary.masterPlan.id"
          :to="`/master-plans/${summary.masterPlan.id}`"
          class="plan-link"
        >
          <GlassCard interactive class="plan-card">
            <header class="plan-card__head">
              <div class="plan-card__title">
                <p class="eyebrow">{{ MEASURE_TYPE_LABELS[summary.masterPlan.measureType] }}</p>
                <h2>{{ summary.masterPlan.name }}</h2>
              </div>
              <StatusTag kind="master" :status="summary.status" dot />
            </header>

            <p v-if="summary.masterPlan.description" class="plan-card__desc">
              {{ summary.masterPlan.description }}
            </p>

            <ProgressBar
              :value="summary.progress"
              label="整体进度"
              show-value
              :tone="statusTone(summary.status)"
            />

            <footer class="plan-card__foot">
              <span class="numeric">{{ summary.subPlanCount }} 个分计划</span>
              <span>{{ formatCN(summary.masterPlan.deadline) }} 截止</span>
              <span class="numeric">
                {{ summary.status === 'overdue' ? '已逾期' : `剩 ${remainingDays(summary.masterPlan.deadline)} 天` }}
              </span>
            </footer>

            <p v-if="summary.overdueSubPlanCount > 0" class="plan-card__warn">
              {{ summary.overdueSubPlanCount }} 个分计划已逾期，建议重新排期。
            </p>
          </GlassCard>
        </RouterLink>
      </div>
    </div>

    <button
      type="button"
      class="quick-focus"
      aria-label="快速沉浸：依次选择总计划、分计划和任务"
      @click="cascadeOpen = true"
    >
      <span class="quick-focus__icon" aria-hidden="true">
        <span></span>
      </span>
      <span class="quick-focus__text">
        快速沉浸
        <small>逐级选择任务</small>
      </span>
    </button>

    <TaskCascadeModal v-model="cascadeOpen" />
  </AppShell>
</template>

<style scoped>
.hero-phrase {
  font-family: 'Playfair Display', Georgia, 'Times New Roman', serif;
  font-size: clamp(40px, 6.8vw, 72px);
  font-weight: 500;
  line-height: 1.02;
  letter-spacing: -0.025em;
  background: linear-gradient(
    100deg,
    var(--text-strong) 0%,
    var(--accent) 52%,
    var(--text-primary) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: none;
}

/* 右上角抽屉固定占用 340px 宽，桌面端把「新建总计划」让到抽屉左侧 */
@media (min-width: 900px) {
  .page-head__actions {
    margin-right: 380px;
  }
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.plan-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-4);
}

.plan-link {
  display: block;
  color: inherit;
  text-decoration: none;
  border-radius: var(--radius-lg);
}

.plan-link .plan-card {
  border: 1px solid var(--glass-border);
  transition:
    transform var(--dur-base) var(--ease-spring),
    box-shadow var(--dur-base) var(--ease-out),
    background-color var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out);
}

.plan-link:hover .plan-card,
.plan-link:focus-visible .plan-card {
  transform: translateY(-5px);
  background: var(--glass-bg-hover);
  border-color: var(--glass-highlight);
  box-shadow: var(--glass-shadow-hover);
}

.plan-link:focus-visible {
  outline-offset: 4px;
}

.plan-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  height: 100%;
}

.plan-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.plan-card__title h2 {
  margin-top: 4px;
  font-size: 19px;
}

.plan-card__desc {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.plan-card__foot {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  font-size: 12px;
  color: var(--text-faint);
  padding-top: var(--space-2);
  border-top: 1px solid var(--line-soft);
}

.plan-card__warn {
  font-size: 12px;
  color: var(--danger);
  line-height: 1.6;
}

/* 全局快速沉浸入口 */
.quick-focus {
  position: fixed;
  right: clamp(16px, 3vw, 36px);
  bottom: clamp(18px, 3vw, 32px);
  z-index: 50;
  display: inline-flex;
  align-items: center;
  gap: 11px;
  padding: 10px 18px 10px 11px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  color: var(--text-primary);
  font: inherit;
  text-decoration: none;
  cursor: pointer;
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(var(--glass-blur));
  backdrop-filter: blur(var(--glass-blur));
  animation: quick-focus-breathe 3.8s ease-in-out infinite;
  transition:
    transform var(--dur-base) var(--ease-spring),
    box-shadow var(--dur-base) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}

.quick-focus:hover {
  transform: translateY(-2px) scale(1.02);
  background: var(--glass-bg-hover);
  box-shadow: var(--glass-shadow-hover);
}

.quick-focus__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: linear-gradient(140deg, var(--accent) 0%, var(--accent-strong) 100%);
  box-shadow: 0 0 0 0 var(--accent-soft);
  animation: quick-focus-pulse 2.6s ease-out infinite;
}

.quick-focus__icon span {
  width: 0;
  height: 0;
  margin-left: 3px;
  border-top: 7px solid transparent;
  border-bottom: 7px solid transparent;
  border-left: 11px solid var(--accent-contrast);
}

.quick-focus__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
}

.quick-focus__text small {
  font-size: 9px;
  font-weight: 500;
  color: var(--text-tertiary);
}

@keyframes quick-focus-breathe {
  0%,
  100% {
    box-shadow: var(--glass-shadow);
  }
  50% {
    box-shadow:
      var(--glass-shadow),
      0 0 28px -8px var(--accent-soft);
  }
}

@keyframes quick-focus-pulse {
  0% {
    box-shadow: 0 0 0 0 var(--accent-soft);
  }
  70% {
    box-shadow: 0 0 0 12px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

@media (max-width: 640px) {
  .quick-focus {
    right: 14px;
    bottom: 14px;
    padding-right: 14px;
  }

  .quick-focus__text small {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .quick-focus,
  .quick-focus__icon {
    animation: none;
  }

  .quick-focus:hover {
    transform: none;
  }
}

@media (max-width: 640px) {
  .plan-grid {
    grid-template-columns: 1fr;
  }
}
</style>
```

## `src/views/sub/SubPlanDetailView.vue`

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import SpriteButton from '@/components/ui/SpriteButton.vue'
import ProgressBar from '@/components/ui/ProgressBar.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import TaskSelectionModal from '@/components/focus/TaskSelectionModal.vue'
import TaskRow from '@/components/plan/TaskRow.vue'
import { useFocusStore } from '@/stores/focus'
import { useSubPlans } from '@/composables/useSubPlans'
import { useMasterPlans } from '@/composables/useMasterPlans'
import { useTasks } from '@/composables/useTasks'
import { useToast } from '@/composables/useToast'
import { calcProgress, deriveSubPlanStatus } from '@/engine/progress'
import { addDays, diffDays, formatCNFull, todayISO } from '@/lib/date'
import { MEASURE_STANDARD_LABELS, type MasterPlan, type SubPlan, type Task } from '@/types/models'

/** 分计划详情：按天分组的任务列表 + 重新排期入口 */
const route = useRoute()
const router = useRouter()
const toast = useToast()

const subApi = useSubPlans()
const masterApi = useMasterPlans()
const taskApi = useTasks()
const focusStore = useFocusStore()

const subPlan = ref<SubPlan | null>(null)
const masterPlan = ref<MasterPlan | null>(null)
const tasks = ref<Task[]>([])
const loading = ref(true)
const error = ref('')
const showDeletePlan = ref(false)
const deletingPlan = ref(false)
const taskToDelete = ref<Task | null>(null)
const deletingTask = ref(false)
const isTaskModalOpen = ref(false)
const today = todayISO()

const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))

const progress = computed(() => calcProgress(tasks.value))
const pendingTasks = computed(() => tasks.value.filter((task) => task.status !== 'done'))
const ringRadius = 98
const ringCircumference = 2 * Math.PI * ringRadius
const ringOffset = computed(() => ringCircumference * (1 - Math.min(1, Math.max(0, progress.value.progress))))
const status = computed(() =>
  subPlan.value ? deriveSubPlanStatus(progress.value, subPlan.value.deadline, today) : 'active',
)
const remainingDays = computed(() =>
  subPlan.value ? Math.max(0, diffDays(today, subPlan.value.deadline)) : 0,
)

/** 系统自动挑选的下一个任务：未完成里排期最早的（无排期排最后） */
const nextTask = computed<Task | null>(() => {
  const candidates = tasks.value
    .filter((task) => task.status === 'pending' || task.status === 'partial')
    .slice()
    .sort((a, b) => {
      const aDate = a.scheduledDate ?? '9999-12-31'
      const bDate = b.scheduledDate ?? '9999-12-31'
      if (aDate !== bDate) return aDate < bDate ? -1 : 1
      return a.createdAt < b.createdAt ? -1 : 1
    })
  return candidates[0] ?? null
})

const focusHeadline = computed(() => {
  if (nextTask.value) return nextTask.value.name
  return tasks.value.length > 0 ? '这个分计划已经完成' : '还没有可专注的任务'
})

const focusDetail = computed(() => {
  const task = nextTask.value
  if (task) {
    return `预计 ${task.estMinutes} 分钟 · 本次专注 ${task.focusBlock} 分钟 · 衡量标准：${MEASURE_STANDARD_LABELS[task.measureStandard]}`
  }
  return tasks.value.length > 0
    ? '所有任务都完成了，可以重新排期或添加新任务。'
    : '先编辑分计划，添加任务后会自动生成排期。'
})

interface TaskGroup {
  key: string
  label: string
  hint: string
  tasks: Task[]
}

const groups = computed<TaskGroup[]>(() => {
  const buckets: Record<string, Task[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    week: [],
    later: [],
    done: [],
  }

  for (const task of tasks.value) {
    if (task.status === 'done' || task.status === 'skipped') {
      buckets.done?.push(task)
      continue
    }
    if (!task.scheduledDate) {
      buckets.later?.push(task)
      continue
    }
    if (task.scheduledDate < today) buckets.overdue?.push(task)
    else if (task.scheduledDate === today) buckets.today?.push(task)
    else if (task.scheduledDate === addDays(today, 1)) buckets.tomorrow?.push(task)
    else if (task.scheduledDate <= addDays(today, 7)) buckets.week?.push(task)
    else buckets.later?.push(task)
  }

  const definitions: Array<{ key: string; label: string; hint: string }> = [
    { key: 'overdue', label: '已逾期', hint: '这些任务没有按原计划完成，重新排期时会被优先安排。' },
    { key: 'today', label: '今天', hint: '' },
    { key: 'tomorrow', label: '明天', hint: '' },
    { key: 'week', label: '本周', hint: '' },
    { key: 'later', label: '之后', hint: '' },
    { key: 'done', label: '已完成 / 已跳过', hint: '' },
  ]

  return definitions
    .map((definition) => ({
      ...definition,
      tasks: buckets[definition.key] ?? [],
    }))
    .filter((group) => group.tasks.length > 0)
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const plan = await subApi.fetchOne(id.value)
    if (!plan) {
      error.value = subApi.error.value || '分计划不存在，或你没有访问权限。'
      return
    }
    subPlan.value = plan
    masterPlan.value = await masterApi.fetchOne(plan.masterPlanId)
    tasks.value = await taskApi.fetchBySubPlan(plan.id)
    error.value = taskApi.error.value
  } finally {
    loading.value = false
  }
}

function onTaskUpdated(updated: Task): void {
  tasks.value = tasks.value.map((task) => (task.id === updated.id ? updated : task))
  toast.success('任务已更新')
}

function requestDeleteTask(task: Task): void {
  taskToDelete.value = task
}

async function confirmDeleteTask(): Promise<void> {
  if (!taskToDelete.value || deletingTask.value) return
  deletingTask.value = true
  const ok = await taskApi.deleteMany([taskToDelete.value.id])
  deletingTask.value = false
  if (!ok) {
    error.value = taskApi.error.value || '删除任务失败'
    return
  }
  tasks.value = tasks.value.filter((task) => task.id !== taskToDelete.value?.id)
  taskToDelete.value = null
  toast.success('任务已删除')
}

async function confirmDeletePlan(): Promise<void> {
  if (!subPlan.value || deletingPlan.value) return
  deletingPlan.value = true
  const masterId = subPlan.value.masterPlanId
  const ok = await subApi.remove(subPlan.value.id)
  deletingPlan.value = false
  showDeletePlan.value = false
  if (!ok) {
    error.value = subApi.error.value || '删除分计划失败'
    return
  }
  toast.success('分计划已删除')
  await router.replace(`/master-plans/${masterId}`)
}

/**
 * 唯一主操作：先打开任务选择弹窗；用户选中任务后把 taskId 存入 Pinia，
 * 再通过声明式导航进入 /focus。
 */
function openTaskModal(): void {
  if (pendingTasks.value.length === 0) {
    toast.warning('这个分计划暂时没有待做任务')
    return
  }
  isTaskModalOpen.value = true
}

async function onSelectTask(task: Task): Promise<void> {
  focusStore.selectTask(task.id)
  isTaskModalOpen.value = false
  await router.push('/focus')
}

onMounted(load)
</script>

<template>
  <AppShell>
    <div class="page-wrap">
      <nav class="crumb" aria-label="面包屑">
        <RouterLink to="/">我的总计划</RouterLink>
        <span aria-hidden="true">/</span>
        <RouterLink v-if="masterPlan" :to="`/master-plans/${masterPlan.id}`">
          {{ masterPlan.name }}
        </RouterLink>
        <span aria-hidden="true">/</span>
        <span>{{ subPlan?.name ?? '分计划' }}</span>
      </nav>

      <GlassCard v-if="loading" class="state-card">
        <p class="muted">正在读取…</p>
      </GlassCard>

      <GlassCard v-else-if="error && !subPlan" class="state-card">
        <p class="error-text">{{ error }}</p>
        <RouterLink class="btn btn--ghost btn--sm" to="/">返回总计划</RouterLink>
      </GlassCard>

      <template v-else-if="subPlan">
        <header class="sub-head">
          <div class="sub-head__text">
            <p class="eyebrow">可执行模块</p>
            <h1>{{ subPlan.name }}</h1>
            <div class="sub-head__meta">
              <StatusTag kind="sub" :status="status" dot />
              <span class="tiny faint">{{ formatCNFull(subPlan.deadline) }} 截止</span>
              <span class="tiny faint">
                {{ status === 'overdue' ? '已逾期' : `剩余 ${remainingDays} 天` }}
              </span>
              <span class="tiny faint numeric">
                {{ progress.doneCount }}/{{ progress.taskCount }} 个任务
              </span>
            </div>
          </div>
          <div class="sub-head__actions">
            <SpriteButton
              variant="primary"
              size="sm"
              class="sub-action sub-action--primary"
              :disabled="pendingTasks.length === 0"
              @click="openTaskModal"
            >
              进入沉浸
            </SpriteButton>
            <RouterLink
              :to="`/sub-plans/${subPlan.id}/calendar`"
              class="btn btn--ghost btn--sm sub-action"
            >
              日历视图
            </RouterLink>
            <button
              type="button"
              class="btn btn--ghost btn--sm sub-action"
              @click="router.push(`/sub-plans/${subPlan.id}/reschedule`)"
            >
              重新排期
            </button>
            <button
              type="button"
              class="btn btn--ghost btn--sm sub-action"
              @click="router.push(`/sub-plans/${subPlan.id}/edit`)"
            >
              编辑分计划
            </button>
          </div>
        </header>

        <div class="sub-hero">
          <div class="sub-hero__info">
            <GlassCard class="overview">
              <div class="overview__row">
                <div class="overview__progress">
                  <ProgressBar
                    :value="progress.progress"
                    label="分计划进度（已完成时长 / 总时长）"
                    show-value
                    :tone="status === 'completed' ? 'success' : status === 'overdue' ? 'danger' : 'accent'"
                  />
                </div>
                <dl class="overview__stats">
                  <div>
                    <dt>已投入</dt>
                    <dd class="numeric">{{ progress.earnedMinutes }} 分钟</dd>
                  </div>
                  <div>
                    <dt>总时长</dt>
                    <dd class="numeric">{{ progress.totalMinutes }} 分钟</dd>
                  </div>
                  <div>
                    <dt>每日可用</dt>
                    <dd class="numeric">{{ subPlan.weekdayMinutes }} / {{ subPlan.weekendMinutes }}</dd>
                  </div>
                </dl>
              </div>
            </GlassCard>

            <div class="sub-hero__note">
              <div>
                <span>截止日期</span>
                <strong>{{ formatCNFull(subPlan.deadline) }}</strong>
              </div>
              <div>
                <span>剩余时间</span>
                <strong>{{ status === 'overdue' ? '已逾期' : `${remainingDays} 天` }}</strong>
              </div>
              <div>
                <span>缓冲日</span>
                <strong>每周 {{ subPlan.bufferDays }} 天</strong>
              </div>
            </div>
          </div>

          <!-- 右侧大圆盘：系统自动挑选当前任务 -->
          <GlassCard class="focus-cta">
            <div class="focus-cta__copy">
              <p class="eyebrow">下一步</p>
              <h2>{{ focusHeadline }}</h2>
              <p class="tiny muted">{{ focusDetail }}</p>
            </div>
            <div class="focus-orbit">
              <span class="focus-orbit__halo" aria-hidden="true"></span>
              <svg class="focus-orbit__svg" viewBox="0 0 220 220" aria-hidden="true">
                <defs>
                  <linearGradient id="orbit-gradient" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stop-color="var(--accent)" />
                    <stop offset="0.55" stop-color="var(--accent-strong)" />
                    <stop offset="1" stop-color="var(--accent)" />
                  </linearGradient>
                </defs>
                <circle class="focus-orbit__track" cx="110" cy="110" :r="ringRadius" />
                <circle
                  class="focus-orbit__progress"
                  cx="110"
                  cy="110"
                  :r="ringRadius"
                  :stroke-dasharray="ringCircumference"
                  :stroke-dashoffset="ringOffset"
                  transform="rotate(-90 110 110)"
                />
              </svg>
              <div class="focus-orbit__core">
                <span>待做任务</span>
                <strong class="numeric">{{ pendingTasks.length }}</strong>
                <small>从右上角进入沉浸</small>
              </div>
            </div>
            <p class="focus-cta__note tiny faint">
              点击右上角「进入沉浸」选择这次要做的任务；进入后只保留计时。
            </p>
          </GlassCard>
        </div>

        <p v-if="error" class="error-text" role="alert">{{ error }}</p>

        <GlassCard v-if="tasks.length === 0" class="state-card">
          <EmptyState
            compact
            title="这个分计划还没有任务"
            description="编辑分计划，添加可执行的任务后会自动生成排期。"
          >
            <SpriteButton size="sm" @click="router.push(`/sub-plans/${subPlan.id}/edit`)">
              编辑分计划
            </SpriteButton>
          </EmptyState>
        </GlassCard>

        <section v-else class="task-groups">
          <div v-for="group in groups" :key="group.key" class="task-group">
            <header class="task-group__head">
              <h2 class="task-group__title">
                {{ group.label }}
                <span class="task-group__count numeric">{{ group.tasks.length }}</span>
              </h2>
              <p v-if="group.hint" class="tiny faint">{{ group.hint }}</p>
            </header>
            <ul class="task-list">
              <TaskRow
                v-for="task in group.tasks"
                :key="task.id"
                :task="task"
                @updated="onTaskUpdated"
                @request-delete="requestDeleteTask"
              />
            </ul>
          </div>

          <p class="buffer-note">
            缓冲日：每周 {{ subPlan.bufferDays }} 天（不排任务，延误时优先消耗）。
            {{ subPlan.bufferDays === 0 ? '当前没有缓冲，一次延误会导致整体顺延。' : `约合 ${Math.max(1, Math.round((diffDays(today, subPlan.deadline) / 7) * subPlan.bufferDays))} 天缓冲。` }}
          </p>
        </section>

        <div class="foot-actions">
          <RouterLink class="btn btn--ghost btn--sm" :to="`/master-plans/${subPlan.masterPlanId}`">
            返回 {{ masterPlan?.name ?? '总计划' }}
          </RouterLink>
          <div class="foot-actions__right">
            <span class="tiny faint">总计划 → 分计划 → 专注</span>
            <button type="button" class="link-btn foot-actions__delete" @click="showDeletePlan = true">
              删除分计划
            </button>
          </div>
        </div>
      </template>
    </div>

    <TaskSelectionModal
      v-model="isTaskModalOpen"
      :tasks="tasks"
      :title="`选择「${subPlan?.name ?? '分计划'}」的一个任务`"
      subtitle="只显示未完成任务；选中后把 taskId 交给 useFocusStore，再进入沉浸页。"
      @select="onSelectTask"
    />

    <ConfirmDialog
      v-model="showDeletePlan"
      title="删除这个分计划？"
      :description="`「${subPlan?.name ?? ''}」下的 ${tasks.length} 个任务与全部学习记录都会一并删除。`"
      confirm-label="删除"
      danger
      :busy="deletingPlan"
      @confirm="confirmDeletePlan"
    />

    <ConfirmDialog
      :model-value="Boolean(taskToDelete)"
      title="删除这个任务？"
      :description="`「${taskToDelete?.name ?? ''}」及其学习记录会被删除，无法恢复。`"
      confirm-label="删除"
      danger
      :busy="deletingTask"
      @update:model-value="taskToDelete = null"
      @confirm="confirmDeleteTask"
    />
  </AppShell>
</template>

<style scoped>
.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-faint);
  margin-bottom: var(--space-4);
  flex-wrap: wrap;
}

.crumb a {
  color: var(--text-muted);
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.sub-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-5);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.sub-head__text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  text-shadow: var(--heading-shadow, none);
}

.sub-head__meta {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-top: 2px;
}

.sub-head__actions {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.sub-action {
  min-height: 38px;
}

.sub-action--primary {
  animation: action-pulse 2.8s ease-in-out infinite;
}

@keyframes action-pulse {
  0%,
  100% {
    box-shadow:
      inset 0 1px 0 var(--glass-highlight),
      0 10px 24px -16px var(--accent-strong);
  }
  50% {
    box-shadow:
      inset 0 1px 0 var(--glass-highlight),
      0 0 0 5px var(--accent-soft),
      0 14px 32px -18px var(--accent-strong);
  }
}

/* 非对称主区：左侧信息微雕，右侧大圆盘专注入口 */
.sub-hero {
  display: grid;
  grid-template-columns: minmax(0, 35fr) minmax(0, 65fr);
  align-items: stretch;
  gap: var(--space-4);
  margin-top: var(--space-2);
}

.sub-hero__info {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.overview {
  flex: 1;
  display: flex;
  align-items: center;
}

.overview__row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-6);
  flex-wrap: wrap;
}

.sub-hero__note {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  padding: 12px 16px;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--glass-bg-soft);
  box-shadow: var(--glass-shadow);
}

.sub-hero__note div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sub-hero__note span {
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-tertiary);
}

.sub-hero__note strong {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 巨大的圆形「开始专注」入口 */
.focus-cta {
  position: relative;
  overflow: hidden;
  margin-top: 0;
  padding: clamp(22px, 3vw, 34px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  text-align: center;
}

.focus-cta::before {
  content: '';
  position: absolute;
  top: -140px;
  right: -80px;
  width: 340px;
  height: 340px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent-soft), transparent 68%);
  filter: blur(18px);
  pointer-events: none;
}

.focus-cta > * {
  position: relative;
  z-index: 1;
}

.focus-cta__copy {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  max-width: 34ch;
}

.focus-cta__copy h2 {
  font-size: clamp(20px, 2.6vw, 27px);
  line-height: 1.28;
}

.focus-orbit__core {
  position: relative;
  z-index: 2;
  width: clamp(150px, 12vw, 184px);
  height: clamp(150px, 12vw, 184px);
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  box-shadow:
    var(--glass-shadow),
    inset 0 1px 0 var(--glass-highlight);
  -webkit-backdrop-filter: blur(var(--glass-blur-strong));
  backdrop-filter: blur(var(--glass-blur-strong));
}

.focus-orbit__core span {
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--text-tertiary);
}

.focus-orbit__core strong {
  font-size: clamp(36px, 4vw, 48px);
  font-weight: 300;
  line-height: 1;
  color: var(--text-strong);
}

.focus-orbit__core small {
  font-size: 9px;
  color: var(--text-tertiary);
}

.focus-orbit {
  position: relative;
  display: grid;
  place-items: center;
  width: clamp(204px, 17vw, 250px);
  height: clamp(204px, 17vw, 250px);
  margin: clamp(8px, 1.8vw, 18px) auto;
}

.focus-orbit__svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
  animation: orbit-breathe 4.8s ease-in-out infinite;
}

.focus-orbit__track {
  fill: none;
  stroke: var(--line);
  stroke-width: 1.2;
}

.focus-orbit__progress {
  fill: none;
  stroke: url(#orbit-gradient);
  stroke-width: 2;
  stroke-linecap: round;
  filter: drop-shadow(0 0 6px var(--accent-soft));
  transition: stroke-dashoffset var(--dur-slow) var(--ease-out);
}

.focus-orbit__halo {
  position: absolute;
  inset: 8%;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent-soft) 0%, transparent 68%);
  filter: blur(18px);
  animation: orbit-halo 5.2s ease-in-out infinite;
  pointer-events: none;
}

@keyframes orbit-breathe {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.72;
  }
  42% {
    transform: scale(1.05);
    opacity: 1;
  }
  70% {
    transform: scale(1.02);
    opacity: 0.82;
  }
}

@keyframes orbit-halo {
  0%,
  100% {
    transform: scale(0.96);
    opacity: 0.45;
  }
  40% {
    transform: scale(1.05);
    opacity: 0.8;
  }
  72% {
    transform: scale(0.99);
    opacity: 0.55;
  }
}

.focus-cta__note {
  max-width: 32ch;
  line-height: 1.6;
}

@media (max-width: 860px) {
  .sub-hero {
    grid-template-columns: minmax(0, 1fr);
  }

  .focus-cta {
    min-height: 280px;
  }

  .focus-orbit__core {
    width: 140px;
    height: 140px;
  }
}

@media (max-width: 520px) {
  .sub-hero__note {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
}

.overview__progress {
  flex: 1;
  min-width: 220px;
}

.overview__stats {
  display: flex;
  gap: var(--space-6);
  margin: 0;
  flex-wrap: wrap;
}

.overview__stats dt {
  font-size: 11px;
  color: var(--text-faint);
}

.overview__stats dd {
  margin: 2px 0 0;
  font-size: 14px;
  font-weight: 560;
  color: var(--text-strong);
}

.task-groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  margin-top: var(--space-6);
}

.task-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.task-group__head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.task-group__title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  font-weight: 600;
}

.task-group__count {
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--line-soft);
  color: var(--text-faint);
  font-size: 11px;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.buffer-note {
  padding: 12px 16px;
  border-radius: var(--radius-md);
  border: 1px dashed var(--line);
  background: var(--glass-bg-soft);
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1.7;
}

.foot-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-top: var(--space-7);
  padding-top: var(--space-5);
  border-top: 1px solid var(--line-soft);
}

.foot-actions__right {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.foot-actions__delete {
  color: var(--danger);
  background: transparent;
  border: 0;
  font-size: 12px;
  cursor: pointer;
}
@media (prefers-reduced-motion: reduce) {
  .focus-orbit__svg,
  .focus-orbit__halo {
    animation: none;
  }
}
</style>
```

## `src/views/sub/SubPlanCalendar.vue`

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useSubPlans } from '@/composables/useSubPlans'
import { useMasterPlans } from '@/composables/useMasterPlans'
import { useTasks } from '@/composables/useTasks'
import { formatCNFull, todayISO } from '@/lib/date'
import type { MasterPlan, SubPlan, Task } from '@/types/models'

/** 分计划日历：按 scheduled_date 聚合任务，7 列 CSS Grid 月视图 */
const route = useRoute()
const subApi = useSubPlans()
const masterApi = useMasterPlans()
const taskApi = useTasks()

const subPlan = ref<SubPlan | null>(null)
const masterPlan = ref<MasterPlan | null>(null)
const tasks = ref<Task[]>([])
const loading = ref(true)
const error = ref('')
const cursor = ref(startOfMonth(new Date()))
const today = todayISO()

const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))

const weekdays = ['日', '一', '二', '三', '四', '五', '六']

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const monthLabel = computed(() =>
  `${cursor.value.getFullYear()} 年 ${cursor.value.getMonth() + 1} 月`,
)

/** reduce: 按 scheduled_date 分组 */
const tasksByDate = computed<Record<string, Task[]>>(() =>
  tasks.value.reduce<Record<string, Task[]>>((groups, task) => {
    if (!task.scheduledDate) return groups
    const list = groups[task.scheduledDate] ?? []
    list.push(task)
    groups[task.scheduledDate] = list
    return groups
  }, {}),
)

const unscheduledTasks = computed(() => tasks.value.filter((task) => !task.scheduledDate))

interface CalendarCell {
  key: string
  date: string
  day: number
  inMonth: boolean
  tasks: Task[]
}

const calendarCells = computed<CalendarCell[]>(() => {
  const year = cursor.value.getFullYear()
  const month = cursor.value.getMonth()
  const leading = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: CalendarCell[] = []

  for (let index = 0; index < leading; index += 1) {
    cells.push({ key: `blank-${index}`, date: '', day: 0, inMonth: false, tasks: [] })
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    cells.push({
      key: date,
      date,
      day,
      inMonth: true,
      tasks: tasksByDate.value[date] ?? [],
    })
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `tail-${cells.length}`, date: '', day: 0, inMonth: false, tasks: [] })
  }

  return cells
})

const doneCount = computed(() => tasks.value.filter((task) => task.status === 'done').length)

function moveMonth(delta: number): void {
  cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + delta, 1)
}

function statusClass(task: Task): string {
  if (task.status === 'done') return 'is-done'
  if (task.status === 'partial') return 'is-partial'
  if (task.status === 'skipped') return 'is-skipped'
  return 'is-pending'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const plan = await subApi.fetchOne(id.value)
    if (!plan) {
      error.value = subApi.error.value || '分计划不存在，或你没有访问权限。'
      return
    }
    subPlan.value = plan
    masterPlan.value = await masterApi.fetchOne(plan.masterPlanId)
    tasks.value = await taskApi.fetchBySubPlan(plan.id)
    error.value = taskApi.error.value
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <AppShell>
    <div class="page-wrap">
      <nav class="crumb" aria-label="面包屑">
        <RouterLink to="/">我的总计划</RouterLink>
        <span aria-hidden="true">/</span>
        <RouterLink v-if="masterPlan" :to="`/master-plans/${masterPlan.id}`">
          {{ masterPlan.name }}
        </RouterLink>
        <span aria-hidden="true">/</span>
        <RouterLink v-if="subPlan" :to="`/sub-plans/${subPlan.id}`">
          {{ subPlan.name }}
        </RouterLink>
        <span aria-hidden="true">/</span>
        <span>日历视图</span>
      </nav>

      <GlassCard v-if="loading" class="state-card">
        <p class="muted">正在展开日历…</p>
      </GlassCard>

      <GlassCard v-else-if="error && !subPlan" class="state-card">
        <p class="error-text">{{ error }}</p>
        <RouterLink class="btn btn--ghost btn--sm" to="/">返回总计划</RouterLink>
      </GlassCard>

      <template v-else-if="subPlan">
        <header class="calendar-head">
          <div class="page-head__text">
            <p class="eyebrow">时间分布</p>
            <h1>{{ subPlan.name }} · 日历</h1>
            <p class="muted">
              {{ formatCNFull(subPlan.deadline) }} 截止 · 已完成 {{ doneCount }}/{{ tasks.length }} 个任务
            </p>
          </div>

          <div class="calendar-nav">
            <button type="button" class="calendar-nav__btn" aria-label="上个月" @click="moveMonth(-1)">←</button>
            <span class="calendar-nav__label">{{ monthLabel }}</span>
            <button type="button" class="calendar-nav__btn" aria-label="下个月" @click="moveMonth(1)">→</button>
          </div>
        </header>

        <p v-if="error" class="error-text" role="alert">{{ error }}</p>

        <GlassCard v-if="tasks.length === 0" class="state-card">
          <EmptyState
            compact
            title="还没有任务"
            description="先回到分计划，添加任务后会自动排期到日历。"
          >
            <RouterLink class="btn btn--ghost btn--sm" :to="`/sub-plans/${subPlan.id}`">
              返回分计划
            </RouterLink>
          </EmptyState>
        </GlassCard>

        <template v-else>
          <GlassCard class="calendar-card" :padded="false">
            <div class="calendar-grid" role="grid" aria-label="任务日历">
              <div v-for="weekday in weekdays" :key="weekday" class="calendar-weekday" role="columnheader">
                {{ weekday }}
              </div>

              <div
                v-for="cell in calendarCells"
                :key="cell.key"
                class="calendar-cell"
                :class="{ 'is-empty': !cell.inMonth, 'is-today': cell.date === today }"
                role="gridcell"
              >
                <div v-if="cell.inMonth" class="calendar-cell__head">
                  <span class="calendar-cell__day numeric">{{ cell.day }}</span>
                  <span v-if="cell.tasks.length" class="calendar-cell__count numeric">{{ cell.tasks.length }}</span>
                </div>

                <div v-if="cell.tasks.length" class="calendar-pills">
                  <span
                    v-for="task in cell.tasks"
                    :key="task.id"
                    class="calendar-pill"
                    :class="statusClass(task)"
                    :title="`${task.name} · ${task.estMinutes} 分钟`"
                  >
                    {{ task.name }}
                  </span>
                </div>
              </div>
            </div>
          </GlassCard>

          <section v-if="unscheduledTasks.length" class="unscheduled">
            <div class="section__head">
              <span class="section__title">未排期任务</span>
              <span class="tiny faint">{{ unscheduledTasks.length }} 个</span>
            </div>
            <div class="unscheduled__list">
              <span v-for="task in unscheduledTasks" :key="task.id" class="calendar-pill is-pending">
                {{ task.name }}
              </span>
            </div>
          </section>
        </template>
      </template>
    </div>
  </AppShell>
</template>

<style scoped>
.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--space-4);
  font-size: 12px;
  color: var(--text-tertiary);
  flex-wrap: wrap;
}

.crumb a {
  color: var(--text-secondary);
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.calendar-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.calendar-nav {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
}

.calendar-nav__btn {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.calendar-nav__btn:hover {
  background: var(--glass-bg);
  color: var(--text-primary);
}

.calendar-nav__label {
  min-width: 94px;
  text-align: center;
  font-size: 12px;
  color: var(--text-primary);
}

.calendar-card {
  overflow: hidden;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border-top: 1px solid var(--line-soft);
  border-left: 1px solid var(--line-soft);
}

.calendar-weekday {
  padding: 10px 8px;
  border-right: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
  font-size: 9px;
  letter-spacing: 0.12em;
  text-align: center;
  color: var(--text-secondary);
}

.calendar-cell {
  min-height: 106px;
  padding: 7px;
  border-right: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
  background: transparent;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.calendar-cell:hover:not(.is-empty) {
  background: var(--glass-bg-soft);
}

.calendar-cell.is-empty {
  background: color-mix(in srgb, var(--line-soft) 30%, transparent);
}

.calendar-cell.is-today {
  background: var(--accent-softer);
  box-shadow: inset 0 0 0 1px var(--accent-soft);
}

.calendar-cell__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin-bottom: 5px;
}

.calendar-cell__day {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
}

.calendar-cell.is-today .calendar-cell__day {
  color: var(--accent);
  font-weight: 700;
}

.calendar-cell__count {
  font-size: 8px;
  color: var(--text-tertiary);
}

.calendar-pills {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.calendar-pill {
  display: block;
  max-width: 100%;
  padding: 3px 6px;
  border-radius: 6px;
  font-size: 9px;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border: 1px solid transparent;
}

.calendar-pill.is-pending {
  background: var(--accent-softer);
  border-color: var(--accent-soft);
  color: var(--accent-strong);
}

.calendar-pill.is-done {
  background: var(--success-soft);
  border-color: color-mix(in srgb, var(--success) 24%, transparent);
  color: var(--success);
  opacity: 0.8;
}

.calendar-pill.is-partial {
  background: var(--warning-soft);
  border-color: color-mix(in srgb, var(--warning) 24%, transparent);
  color: var(--warning);
}

.calendar-pill.is-skipped {
  background: var(--line-soft);
  color: var(--text-faint);
  text-decoration: line-through;
}

.unscheduled {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: var(--space-5);
}

.unscheduled__list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

@media (max-width: 720px) {
  .calendar-cell {
    min-height: 82px;
    padding: 5px;
  }

  .calendar-pill {
    font-size: 8px;
    padding: 2px 4px;
  }

  .calendar-weekday {
    font-size: 8px;
    padding: 8px 4px;
  }
}
</style>
```

## `src/views/SettingsView.vue`

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import SpriteButton from '@/components/ui/SpriteButton.vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore, type ThemeName } from '@/stores/theme'
import { useSettingsStore } from '@/stores/settings'
import { useToast } from '@/composables/useToast'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import { todayISO } from '@/lib/date'

/** 设置页：账户、资料、偏好、数据导出、法律信息 */
const auth = useAuthStore()
const theme = useThemeStore()
const settings = useSettingsStore()
const toast = useToast()
const router = useRouter()

const exporting = ref(false)
const signingOut = ref(false)
const exportError = ref('')
const profileNickname = ref('')
const profileBio = ref('')
const profileSaving = ref(false)
const profileMessage = ref('')
const profileError = ref('')

const shortUserId = computed(() => {
  const id = auth.userId
  if (!id) return '—'
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
})

const themeOptions: Array<{ value: ThemeName; label: string; hint: string }> =
  theme.themes.map((option) => ({
    value: option.id,
    label: option.label,
    hint: option.hint,
  }))

async function loadProfile(): Promise<void> {
  const ok = await auth.loadProfile()
  if (!ok) {
    profileError.value = auth.error || '资料读取失败'
    return
  }
  profileNickname.value = auth.profile?.nickname ?? ''
  profileBio.value = auth.profile?.bio ?? ''
}

async function saveProfile(): Promise<void> {
  if (profileSaving.value) return
  profileSaving.value = true
  profileMessage.value = ''
  profileError.value = ''
  const ok = await auth.updateProfile(profileNickname.value, profileBio.value)
  profileSaving.value = false
  if (!ok) {
    profileError.value = auth.error || '保存资料失败'
    return
  }
  profileMessage.value = '资料已保存'
  toast.success('资料已更新')
  profileNickname.value = auth.profile?.nickname ?? ''
  profileBio.value = auth.profile?.bio ?? ''
}

onMounted(loadProfile)

async function signOut(): Promise<void> {
  signingOut.value = true
  await auth.signOut()
  signingOut.value = false
  toast.push('已退出登录')
  await router.replace('/login')
}

async function exportData(): Promise<void> {
  if (exporting.value) return
  exporting.value = true
  exportError.value = ''
  try {
    const [masters, subs, tasks, logs] = await Promise.all([
      supabase.from('master_plans').select('*'),
      supabase.from('sub_plans').select('*'),
      supabase.from('tasks').select('*'),
      supabase.from('study_logs').select('*'),
    ])
    const firstError = masters.error ?? subs.error ?? tasks.error ?? logs.error
    if (firstError) {
      exportError.value = describeError(firstError)
      return
    }
    const payload = {
      app: 'Shiguang · Picked Light',
      exportedAt: new Date().toISOString(),
      account: auth.email,
      master_plans: masters.data ?? [],
      sub_plans: subs.data ?? [],
      tasks: tasks.data ?? [],
      study_logs: logs.data ?? [],
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `shiguang-export-${todayISO()}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast.success('数据已导出为 JSON')
  } catch (cause) {
    exportError.value = describeError(cause)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <AppShell>
    <div class="page-wrap page-wrap--narrow">
      <header class="page-head">
        <div class="page-head__text">
          <p class="eyebrow">支撑页</p>
          <h1>设置</h1>
          <p class="muted">偏好只保存在这台设备；计划与学习记录保存在 Supabase。</p>
        </div>
      </header>

      <div class="settings">
        <GlassCard class="settings__card">
          <div class="section__head">
            <span class="section__title">资料</span>
            <span class="tiny faint">会显示在自习室座位</span>
          </div>

          <form class="profile-form" novalidate @submit.prevent="saveProfile">
            <div class="field">
              <label class="field__label" for="profile-nickname">昵称</label>
              <input
                id="profile-nickname"
                v-model="profileNickname"
                class="input"
                type="text"
                maxlength="40"
                placeholder="你的昵称"
              />
            </div>

            <div class="field">
              <label class="field__label" for="profile-bio">自我介绍</label>
              <textarea
                id="profile-bio"
                v-model="profileBio"
                class="input profile-textarea"
                maxlength="240"
                rows="3"
                placeholder="一句话介绍自己，最多 240 字"
              ></textarea>
              <span class="field__hint">{{ profileBio.length }}/240</span>
            </div>

            <p v-if="profileError" class="error-text" role="alert">{{ profileError }}</p>
            <p v-if="profileMessage" class="success-text" role="status">{{ profileMessage }}</p>

            <div class="row">
              <SpriteButton type="submit" size="sm" :loading="profileSaving">
                保存资料
              </SpriteButton>
              <span class="tiny faint">修改会同步到 profiles 表和全局 auth.profile</span>
            </div>
          </form>
        </GlassCard>

        <GlassCard class="settings__card">
          <div class="section__head">
            <span class="section__title">账户</span>
          </div>
          <dl class="account">
            <div>
              <dt>邮箱</dt>
              <dd>{{ auth.email || '未登录' }}</dd>
            </div>
            <div>
              <dt>用户 ID</dt>
              <dd class="account__id" :title="auth.userId">{{ shortUserId }}</dd>
            </div>
            <div>
              <dt>登录状态</dt>
              <dd>{{ auth.isAuthenticated ? '已登录' : '未登录' }}</dd>
            </div>
          </dl>
          <div class="row">
            <button type="button" class="btn btn--ghost btn--sm" :disabled="signingOut" @click="signOut">
              {{ signingOut ? '正在退出…' : '退出登录' }}
            </button>
          </div>
        </GlassCard>

        <GlassCard class="settings__card">
          <div class="section__head">
            <span class="section__title">外观</span>
          </div>
          <div class="theme-options" role="radiogroup" aria-label="主题">
            <label
              v-for="option in themeOptions"
              :key="option.value"
              class="theme-option"
              :class="{ 'is-active': theme.theme === option.value }"
            >
              <input
                type="radio"
                name="theme"
                :value="option.value"
                :checked="theme.theme === option.value"
                @change="theme.setTheme(option.value)"
              />
              <span class="theme-option__dot" :class="`theme-option__dot--${option.value}`" aria-hidden="true"></span>
              <span class="theme-option__label">{{ option.label }}</span>
              <span class="theme-option__hint">{{ option.hint }}</span>
            </label>
          </div>
        </GlassCard>

        <GlassCard class="settings__card">
          <div class="section__head">
            <span class="section__title">专注</span>
          </div>
          <div class="field">
            <label class="field__label" for="focus-block">默认单次专注块长度</label>
            <select
              id="focus-block"
              class="select"
              :value="settings.defaultFocusBlock"
              @change="settings.setDefaultFocusBlock(Number(($event.target as HTMLSelectElement).value))"
            >
              <option :value="15">15 分钟</option>
              <option :value="25">25 分钟（推荐）</option>
              <option :value="45">45 分钟</option>
            </select>
            <span class="field__hint">新建分计划时作为每个任务专注块的默认值。</span>
          </div>

          <div class="switch-row">
            <label class="switch">
              <input
                type="checkbox"
                :checked="settings.remindInApp"
                @change="settings.setRemindInApp(($event.target as HTMLInputElement).checked)"
              />
              <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
              <span class="switch__text">
                站内提醒
                <small>到了计划时间在页面内提示</small>
              </span>
            </label>

            <label class="switch">
              <input
                type="checkbox"
                :checked="settings.remindEmail"
                @change="settings.setRemindEmail(($event.target as HTMLInputElement).checked)"
              />
              <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
              <span class="switch__text">
                邮件提醒
                <small>第一版仅保存偏好，不会真正发送邮件</small>
              </span>
            </label>
          </div>
        </GlassCard>

        <GlassCard class="settings__card">
          <div class="section__head">
            <span class="section__title">数据</span>
          </div>
          <p class="muted settings__desc">
            导出包含总计划、分计划、任务与学习记录的 JSON 文件。这是个人项目，建议定期备份。
          </p>
          <div class="row">
            <SpriteButton size="sm" variant="ghost" :loading="exporting" @click="exportData">
              导出我的数据
            </SpriteButton>
            <span v-if="exportError" class="field__error" role="alert">{{ exportError }}</span>
          </div>
        </GlassCard>

        <GlassCard class="settings__card">
          <div class="section__head">
            <span class="section__title">关于</span>
          </div>
          <p class="muted settings__desc">
            拾光 · Picked Light 是一个免费的学习计划工具。动态排期与效率系数只提供参考性建议，不构成学习效果承诺。
          </p>
          <nav class="legal-links" aria-label="法律信息">
            <RouterLink to="/privacy">隐私政策</RouterLink>
            <RouterLink to="/terms">用户协议</RouterLink>
            <a href="mailto:2658116631@qq.com">联系我们</a>
          </nav>
        </GlassCard>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.settings__card {
  padding: clamp(20px, 3vw, 28px);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.profile-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.profile-textarea {
  min-height: 86px;
  resize: vertical;
  line-height: 1.6;
}

.account {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-4);
  margin: 0;
}

.account dt {
  font-size: 11px;
  color: var(--text-faint);
}

.account dd {
  margin: 3px 0 0;
  font-size: 13px;
  color: var(--text-strong);
  word-break: break-all;
}

.account__id {
  font-family: var(--font-mono);
  font-size: 11px !important;
  color: var(--text-muted) !important;
}

.theme-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-3);
}

.theme-option {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: var(--glass-bg-soft);
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}

.theme-option input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.theme-option.is-active {
  border-color: var(--accent);
  background: var(--accent-softer);
}

.theme-option:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.theme-option__dot {
  width: 16px;
  height: 16px;
  margin-bottom: 7px;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  box-shadow: 0 2px 8px -2px var(--overlay);
}

.theme-option__dot--forest {
  background: var(--theme-dot-forest);
}

.theme-option__dot--sakura {
  background: var(--theme-dot-sakura);
}

.theme-option__dot--snow {
  background: var(--theme-dot-snow);
}

.theme-option__label {
  font-size: 13px;
  font-weight: 560;
  color: var(--text-strong);
}

.theme-option__hint {
  font-size: 11px;
  color: var(--text-faint);
}

.switch-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.switch {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.switch__track {
  position: relative;
  width: 42px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: var(--radius-pill);
  background: var(--line);
  transition: background-color var(--dur-fast) var(--ease-out);
}

.switch__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--text-inverse);
  box-shadow: 0 1px 3px var(--overlay);
  transition: transform var(--dur-base) var(--ease-spring);
}

.switch input:checked + .switch__track {
  background: var(--accent);
}

.switch input:checked + .switch__track .switch__thumb {
  transform: translateX(18px);
}

.switch input:focus-visible + .switch__track {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.switch__text {
  display: flex;
  flex-direction: column;
  font-size: 13px;
  color: var(--text);
}

.switch__text small {
  font-size: 11px;
  color: var(--text-faint);
}

.settings__desc {
  font-size: 13px;
  line-height: 1.7;
}

.legal-links {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  font-size: 13px;
}
</style>
```

## `src/components/plan/TaskRow.vue`

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import { useTasks } from '@/composables/useTasks'
import { useStudyLogs } from '@/composables/useStudyLogs'
import { formatCN, isoDateTimeToDate } from '@/lib/date'
import {
  MEASURE_STANDARD_LABELS,
  TASK_STATUS_LABELS,
  type StudyLog,
  type Task,
  type TaskStatus,
} from '@/types/models'

/** 任务行：折叠展示摘要，展开可改状态 / 预计时长 / 查看历史 */
const props = defineProps<{ task: Task }>()
const emit = defineEmits<{
  (event: 'updated', task: Task): void
  (event: 'request-delete', task: Task): void
}>()

const taskApi = useTasks()
const logsApi = useStudyLogs()

const expanded = ref(false)
const loadingLogs = ref(false)
const saving = ref(false)
const message = ref('')
const logs = ref<StudyLog[]>([])

const draft = ref({
  status: props.task.status as TaskStatus,
  estMinutes: props.task.estMinutes,
  actualMinutes: props.task.actualMinutes,
})

const hasHistory = computed(() => logs.value.length > 0)

function toggle(): void {
  expanded.value = !expanded.value
  if (expanded.value && logs.value.length === 0 && !loadingLogs.value) {
    void loadLogs()
  }
}

async function loadLogs(): Promise<void> {
  loadingLogs.value = true
  logs.value = await logsApi.fetchByTask(props.task.id)
  loadingLogs.value = false
}

async function save(): Promise<void> {
  if (saving.value) return
  saving.value = true
  message.value = ''
  const nextStatus = draft.value.status
  const nextActual =
    nextStatus === 'done' && draft.value.actualMinutes <= 0
      ? draft.value.estMinutes
      : Math.max(0, draft.value.actualMinutes)
  const updated = await taskApi.updateTask(props.task.id, {
    status: nextStatus,
    estMinutes: Math.max(1, draft.value.estMinutes),
    actualMinutes: nextActual,
  })
  saving.value = false
  if (!updated) {
    message.value = taskApi.error.value || '保存失败'
    return
  }
  emit('updated', updated)
  message.value = '已保存'
  await loadLogs()
}

function statusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status]
}
</script>

<template>
  <li class="task" :class="{ 'task--expanded': expanded, 'task--completed': task.status === 'done' }">
    <button type="button" class="task__summary" :aria-expanded="expanded" @click="toggle">
      <span class="task__dot" :class="`task__dot--${task.status}`" aria-hidden="true"></span>
      <span class="task__main">
        <span class="task__name">{{ task.name }}</span>
        <span class="task__meta">
          {{ task.estMinutes }} 分钟 · {{ MEASURE_STANDARD_LABELS[task.measureStandard] }} ·
          每块 {{ task.focusBlock }} 分钟
        </span>
      </span>
      <StatusTag :status="task.status" class="task__tag" />
      <span class="task__chevron" aria-hidden="true">⌄</span>
    </button>

    <div v-if="expanded" class="task__detail">
      <div class="task__fields">
        <label class="task__field">
          <span class="field__label">状态</span>
          <select v-model="draft.status" class="select">
            <option v-for="(label, value) in TASK_STATUS_LABELS" :key="value" :value="value">
              {{ statusLabel(value) }}
            </option>
          </select>
        </label>
        <label class="task__field">
          <span class="field__label">预计时长（分钟）</span>
          <input v-model.number="draft.estMinutes" class="input numeric" type="number" min="1" max="1440" />
        </label>
        <label class="task__field">
          <span class="field__label">实际时长（分钟）</span>
          <input v-model.number="draft.actualMinutes" class="input numeric" type="number" min="0" max="1440" />
        </label>
      </div>

      <div class="task__actions">
        <button type="button" class="btn btn--sm btn--primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存修改' }}
        </button>
        <button type="button" class="link-btn" @click="emit('request-delete', task)">删除任务</button>
        <span v-if="message" class="tiny faint">{{ message }}</span>
      </div>

      <div class="task__history">
        <p class="section__title">学习记录</p>
        <p v-if="loadingLogs" class="tiny faint">正在读取…</p>
        <ul v-else-if="hasHistory" class="task__history-list">
          <li v-for="log in logs" :key="log.id">
            <span class="numeric">{{ formatCN(isoDateTimeToDate(log.loggedAt)) }}</span>
            <span>{{ TASK_STATUS_LABELS[log.status] }}</span>
            <span class="numeric">{{ log.actualMinutes }}/{{ log.plannedMinutes }} 分钟</span>
          </li>
        </ul>
        <p v-else class="tiny faint">还没有记录。完成一次专注后会自动写入。</p>
      </div>
    </div>
  </li>
</template>

<style scoped>
.task {
  border: 0;
  border-top: 1px solid var(--line-soft);
  border-radius: 0;
  background: transparent;
  overflow: hidden;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    border-radius var(--dur-fast) var(--ease-out);
}

.task:first-child {
  border-top: 0;
}

.task:hover {
  border-radius: 12px;
  background: var(--glass-bg-soft);
  box-shadow: 0 8px 20px -16px var(--overlay);
}

.task--expanded {
  border-radius: 14px;
  background: var(--glass-bg-soft);
  box-shadow: 0 8px 20px -16px var(--overlay);
}

.task--completed {
  opacity: 0.5;
}

.task--completed .task__name {
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.task--expanded {
  background: var(--glass-bg);
  border-color: var(--line);
}

.task__summary {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: 13px 16px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.task__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--text-faint);
}

.task__dot--pending {
  background: var(--accent);
}

.task__dot--done {
  background: var(--success);
}

.task__dot--partial {
  background: var(--warning);
}

.task__dot--skipped {
  background: var(--text-faint);
}

.task__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.task__name {
  font-size: 14px;
  font-weight: 550;
  color: var(--text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task__meta {
  font-size: 11px;
  color: var(--text-faint);
}

.task__tag {
  flex: 0 0 auto;
}

.task__chevron {
  color: var(--text-faint);
  font-size: 12px;
  transition: transform var(--dur-base) var(--ease-spring);
}

.task--expanded .task__chevron {
  transform: rotate(180deg);
}

.task__detail {
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  animation: detail-in var(--dur-base) var(--ease-out);
}

.task__fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}

.task__field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.task__field .input,
.task__field .select {
  min-height: 38px;
  font-size: 13px;
  padding: 6px 10px;
}

.task__actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.task__history {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: var(--space-3);
  border-top: 1px solid var(--line-soft);
}

.task__history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.task__history-list li {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-muted);
}

@keyframes detail-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .task__detail {
    animation: none;
  }

  .task--expanded .task__chevron {
    transform: none;
  }
}
</style>
```

## `src/views/sub/SubPlanFormView.vue`

```vue
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import SpriteButton from '@/components/ui/SpriteButton.vue'
import DiagnosticList from '@/components/diagnostics/DiagnosticList.vue'
import { useMasterPlans } from '@/composables/useMasterPlans'
import { useSubPlans } from '@/composables/useSubPlans'
import { useTasks } from '@/composables/useTasks'
import { useToast } from '@/composables/useToast'
import { useSettingsStore } from '@/stores/settings'
import { diagnoseSubPlan, type DiagnosticPatch } from '@/engine/diagnostics'
import {
  appendNewTasks,
  buildInitialSchedule,
  collectAssignments,
  type ScheduleWindow,
} from '@/engine/schedule'
import { addDays, formatCN, isValidISODate, todayISO } from '@/lib/date'
import {
  MEASURE_STANDARD_OPTIONS,
  type MasterPlan,
  type MeasureStandard,
  type SubPlan,
  type TaskStatus,
} from '@/types/models'

/**
 * 分计划创建 / 编辑（核心表单）。
 * 区块 A：归属与目标信息；区块 B：任务拆解；区块 C：实时规则诊断。
 * 保存时在前端完成「初始排期」，再把 scheduled_date 一起写入数据库。
 */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const masterApi = useMasterPlans()
const subApi = useSubPlans()
const taskApi = useTasks()
const settings = useSettingsStore()
const isDev = import.meta.env.DEV

const today = todayISO()
const isEdit = computed(() => route.name === 'sub-plan-edit')
const routeMasterId = computed(() =>
  typeof route.params.masterId === 'string' ? route.params.masterId : '',
)
const routeSubId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))

interface TaskDraftRow {
  key: string
  id?: string
  name: string
  estMinutes: number
  measureStandard: MeasureStandard
  focusBlock: number
  status: TaskStatus
  actualMinutes: number
  scheduledDate: string | null
}

const masterPlan = ref<MasterPlan | null>(null)
const subPlan = ref<SubPlan | null>(null)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notFound = ref(false)
const originalTaskIds = ref<string[]>([])

let keySeed = 0
function newKey(): string {
  keySeed += 1
  return `draft-${keySeed}`
}

function createRow(): TaskDraftRow {
  return {
    key: newKey(),
    name: '',
    estMinutes: 25,
    measureStandard: 'recall',
    focusBlock: settings.defaultFocusBlock,
    status: 'pending',
    actualMinutes: 0,
    scheduledDate: null,
  }
}

const form = reactive({
  name: '',
  deadline: '',
  weekdayMinutes: 60,
  weekendMinutes: 90,
  bufferDays: 1,
})

const rows = ref<TaskDraftRow[]>([])

const namedRows = computed(() => rows.value.filter((row) => row.name.trim().length > 0))
const totalMinutes = computed(() =>
  namedRows.value.reduce((sum, row) => sum + Math.max(0, Number(row.estMinutes) || 0), 0),
)

const report = computed(() =>
  diagnoseSubPlan({
    deadline: form.deadline,
    weekdayMinutes: Number(form.weekdayMinutes) || 0,
    weekendMinutes: Number(form.weekendMinutes) || 0,
    bufferDays: Number(form.bufferDays) || 0,
    tasks: namedRows.value.map((row) => ({
      name: row.name,
      estMinutes: Math.max(0, Number(row.estMinutes) || 0),
      measureStandard: row.measureStandard,
      focusBlock: Math.max(1, Number(row.focusBlock) || 25),
    })),
    masterDeadline: masterPlan.value?.deadline ?? '',
    masterName: masterPlan.value?.name ?? '',
    today,
  }),
)

const nameError = computed(() => (form.name.trim() ? '' : '分计划名称不能为空'))
const tasksError = computed(() => (namedRows.value.length > 0 ? '' : '至少添加一个任务'))
const durationError = computed(() =>
  namedRows.value.some((row) => Number(row.estMinutes) < 1) ? '任务预计时长至少 1 分钟' : '',
)
const availabilityError = computed(() =>
  Number(form.weekdayMinutes) + Number(form.weekendMinutes) > 0
    ? ''
    : '工作日与周末的可用时间不能同时为 0',
)
const canSave = computed(
  () =>
    !report.value.hasBlocking &&
    !nameError.value &&
    !tasksError.value &&
    !durationError.value &&
    !availabilityError.value &&
    isValidISODate(form.deadline) &&
    !saving.value,
)

function buildWindow(): ScheduleWindow {
  return {
    start: today,
    deadline: form.deadline,
    weekdayMinutes: Math.max(0, Number(form.weekdayMinutes) || 0),
    weekendMinutes: Math.max(0, Number(form.weekendMinutes) || 0),
    bufferDays: Number(form.bufferDays) || 0,
  }
}

function addRow(): void {
  rows.value = [...rows.value, createRow()]
}

function removeRow(key: string): void {
  rows.value = rows.value.filter((row) => row.key !== key)
}

function applyPatch(patch: DiagnosticPatch): void {
  if (patch.kind === 'deadline') {
    form.deadline = patch.value
    return
  }
  if (patch.kind === 'buffer') {
    form.bufferDays = patch.value
    return
  }
  if (patch.kind === 'measure-all') {
    rows.value = rows.value.map((row) =>
      row.measureStandard === 'understand' ? { ...row, measureStandard: patch.value } : row,
    )
    return
  }
  if (patch.kind === 'split-task') {
    const target = namedRows.value[patch.taskIndex]
    if (!target) return
    splitTask(target.key, patch.parts)
  }
}

function splitTask(rowKey: string, parts: number): void {
  const index = rows.value.findIndex((row) => row.key === rowKey)
  const row = rows.value[index]
  if (!row) return
  if (row.status === 'done') {
    toast.warning('已完成的任务无需拆分')
    return
  }
  const count = Math.max(2, Math.min(8, Math.round(parts)))
  const baseName = row.name.replace(/（\d+\/\d+）$/, '').trim() || '任务'
  const per = Math.max(1, Math.ceil(row.estMinutes / count))
  const replacement = Array.from({ length: count }, (_, partIndex) => ({
    ...row,
    key: newKey(),
    id: undefined,
    name: `${baseName}（${partIndex + 1}/${count}）`,
    estMinutes: per,
    status: 'pending' as TaskStatus,
    actualMinutes: 0,
    scheduledDate: null,
  }))
  rows.value.splice(index, 1, ...replacement)
  toast.push(`已拆成 ${count} 个任务`)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  notFound.value = false
  try {
    let masterId = routeMasterId.value

    if (isEdit.value) {
      const loaded = await subApi.fetchOne(routeSubId.value)
      if (!loaded) {
        notFound.value = true
        error.value = subApi.error.value || '分计划不存在，或你没有访问权限。'
        return
      }
      subPlan.value = loaded
      masterId = loaded.masterPlanId
      form.name = loaded.name
      form.deadline = loaded.deadline
      form.weekdayMinutes = loaded.weekdayMinutes
      form.weekendMinutes = loaded.weekendMinutes
      form.bufferDays = loaded.bufferDays

      const existingTasks = await taskApi.fetchBySubPlan(loaded.id)
      rows.value = existingTasks.map((task) => ({
        key: task.id,
        id: task.id,
        name: task.name,
        estMinutes: task.estMinutes,
        measureStandard: task.measureStandard,
        focusBlock: task.focusBlock,
        status: task.status,
        actualMinutes: task.actualMinutes,
        scheduledDate: task.scheduledDate,
      }))
      originalTaskIds.value = existingTasks.map((task) => task.id)
    }

    if (!masterId) {
      notFound.value = true
      error.value = '缺少所属总计划，请从总计划详情页进入。'
      return
    }

    const master = await masterApi.fetchOne(masterId)
    if (!master) {
      notFound.value = true
      error.value = masterApi.error.value || '所属总计划不存在。'
      return
    }
    masterPlan.value = master

    if (!isEdit.value) {
      const suggested = addDays(today, 30)
      form.deadline = suggested < master.deadline ? suggested : master.deadline
      form.weekdayMinutes = 60
      form.weekendMinutes = 90
      form.bufferDays = 1
      rows.value = [createRow(), createRow()]
    }
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  if (!canSave.value || !masterPlan.value) return
  saving.value = true
  error.value = ''

  const validRows = rows.value.filter((row) => row.name.trim().length > 0)
  const windowOptions = buildWindow()

  try {
    if (isEdit.value && subPlan.value) {
      const updated = await subApi.update(subPlan.value.id, {
        masterPlanId: subPlan.value.masterPlanId,
        name: form.name.trim(),
        deadline: form.deadline,
        weekdayMinutes: Number(form.weekdayMinutes),
        weekendMinutes: Number(form.weekendMinutes),
        bufferDays: Number(form.bufferDays),
      })
      if (!updated) {
        error.value = subApi.error.value || '保存失败'
        return
      }

      // 删除被移除的任务
      const keptIds = new Set(validRows.map((row) => row.id).filter((id): id is string => Boolean(id)))
      const removedIds = originalTaskIds.value.filter((id) => !keptIds.has(id))
      if (removedIds.length > 0) {
        const removed = await taskApi.deleteMany(removedIds)
        if (!removed) {
          error.value = taskApi.error.value || '删除任务失败'
          return
        }
      }

      // 更新保留的任务（不改动已有排期）
      for (const row of validRows) {
        if (!row.id) continue
        const savedTask = await taskApi.updateTask(row.id, {
          name: row.name.trim(),
          estMinutes: Number(row.estMinutes),
          measureStandard: row.measureStandard,
          focusBlock: Number(row.focusBlock),
        })
        if (!savedTask) {
          error.value = taskApi.error.value || '更新任务失败'
          return
        }
      }

      // 新增任务：占用剩余容量，不悄悄重排旧任务
      const newRows = validRows.filter((row) => !row.id)
      if (newRows.length > 0) {
        const existing = validRows
          .filter((row) => row.id && row.scheduledDate)
          .map((row) => ({
            scheduledDate: row.scheduledDate,
            estMinutes: Math.max(0, Number(row.estMinutes) || 0),
          }))
        const appended = appendNewTasks(
          existing,
          newRows.map((row) => ({
            id: row.key,
            name: row.name,
            estMinutes: Math.max(1, Number(row.estMinutes) || 1),
            oldDate: null,
          })),
          windowOptions,
        )
        const assignments = collectAssignments(appended.days)
        const created = await taskApi.createMany(
          updated.id,
          newRows.map((row) => ({
            name: row.name.trim(),
            estMinutes: Math.max(1, Number(row.estMinutes) || 1),
            measureStandard: row.measureStandard,
            focusBlock: Number(row.focusBlock),
            scheduledDate: assignments.get(row.key) ?? form.deadline,
          })),
        )
        if (created.length !== newRows.length) {
          error.value = taskApi.error.value || '新增任务失败'
          return
        }
      }

      toast.success('分计划已更新')
      await router.replace(`/sub-plans/${updated.id}`)
      return
    }

    /* 新建：先建分计划，再生成初始排期并批量插入任务 */
    const created = await subApi.create({
      masterPlanId: masterPlan.value.id,
      name: form.name.trim(),
      deadline: form.deadline,
      weekdayMinutes: Number(form.weekdayMinutes),
      weekendMinutes: Number(form.weekendMinutes),
      bufferDays: Number(form.bufferDays),
    })
    if (!created) {
      error.value = subApi.error.value || '创建分计划失败'
      return
    }

    const drafts = validRows.map((row) => ({
      id: row.key,
      name: row.name,
      estMinutes: Math.max(1, Number(row.estMinutes) || 1),
      oldDate: null,
    }))
    const schedule = buildInitialSchedule(drafts, windowOptions)
    const assignments = collectAssignments(schedule.days)

    const createdTasks = await taskApi.createMany(
      created.id,
      validRows.map((row) => ({
        name: row.name.trim(),
        estMinutes: Math.max(1, Number(row.estMinutes) || 1),
        measureStandard: row.measureStandard,
        focusBlock: Number(row.focusBlock),
        scheduledDate: assignments.get(row.key) ?? form.deadline,
      })),
    )

    if (createdTasks.length !== validRows.length) {
      // 补偿：任务写入失败时删除刚建的分计划，避免留下空壳
      await subApi.remove(created.id)
      error.value = taskApi.error.value || '任务创建失败，已回滚分计划'
      return
    }

    if (!schedule.feasible) {
      toast.warning('任务量超出可排期范围，已尽量安排，建议重新排期')
    }
    toast.success('分计划已创建并完成初始排期')
    await router.replace(`/sub-plans/${created.id}`)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <AppShell>
    <div class="page-wrap">
      <nav class="crumb" aria-label="面包屑">
        <RouterLink to="/">我的总计划</RouterLink>
        <span aria-hidden="true">/</span>
        <RouterLink v-if="masterPlan" :to="`/master-plans/${masterPlan.id}`">
          {{ masterPlan.name }}
        </RouterLink>
        <span aria-hidden="true">/</span>
        <span>{{ isEdit ? '编辑分计划' : '新建分计划' }}</span>
      </nav>

      <header class="page-head">
        <div class="page-head__text">
          <p class="eyebrow">可执行模块</p>
          <h1>{{ isEdit ? '编辑分计划' : '新建分计划' }}</h1>
          <p class="muted">
            分计划负责排每日任务。填写右侧信息时，诊断会实时计算可行性与风险。
          </p>
        </div>
      </header>

      <GlassCard v-if="loading" class="state-card">
        <p class="muted">正在读取…</p>
      </GlassCard>

      <GlassCard v-else-if="notFound" class="state-card">
        <p class="error-text">{{ error }}</p>
        <RouterLink class="btn btn--ghost btn--sm" to="/">返回总计划列表</RouterLink>
      </GlassCard>

      <form v-else class="editor" :class="{ 'editor--dev': isDev }" novalidate @submit.prevent="save">
        <div class="editor__main">
          <!-- 区块 A -->
          <GlassCard class="form-card">
            <div class="section__head">
              <span class="section__title">A · 归属与目标</span>
              <span v-if="masterPlan" class="tiny faint">
                总计划截止 {{ formatCN(masterPlan.deadline) }}
              </span>
            </div>

            <div class="form-grid">
              <div class="field form-grid--full">
                <span class="field__label">所属总计划</span>
                <div class="locked-field">
                  <span class="locked-field__name">{{ masterPlan?.name ?? '—' }}</span>
                  <span class="tiny faint">分计划必须归属一个总计划</span>
                </div>
              </div>

              <div class="field form-grid--full">
                <label class="field__label" for="sub-name">分计划名称</label>
                <input
                  id="sub-name"
                  v-model="form.name"
                  class="input"
                  type="text"
                  maxlength="80"
                  placeholder="例如：N2 词汇"
                  :aria-invalid="Boolean(nameError)"
                  required
                />
                <span v-if="nameError" class="field__error">{{ nameError }}</span>
              </div>

              <div class="field">
                <label class="field__label" for="sub-deadline">截止日期</label>
                <input
                  id="sub-deadline"
                  v-model="form.deadline"
                  class="input"
                  type="date"
                  :min="today"
                  :max="masterPlan?.deadline"
                  required
                />
                <span class="field__hint">不能晚于总计划截止日期。</span>
              </div>

              <div class="field">
                <label class="field__label" for="sub-buffer">每周缓冲日</label>
                <select id="sub-buffer" v-model.number="form.bufferDays" class="select">
                  <option :value="0">0 天</option>
                  <option :value="1">1 天（推荐）</option>
                  <option :value="2">2 天</option>
                </select>
                <span class="field__hint">延误时优先消耗缓冲日。</span>
              </div>

              <div class="field">
                <label class="field__label" for="sub-weekday">工作日每日可用（分钟）</label>
                <input
                  id="sub-weekday"
                  v-model.number="form.weekdayMinutes"
                  class="input numeric"
                  type="number"
                  min="0"
                  max="720"
                  step="5"
                />
              </div>

              <div class="field">
                <label class="field__label" for="sub-weekend">周末每日可用（分钟）</label>
                <input
                  id="sub-weekend"
                  v-model.number="form.weekendMinutes"
                  class="input numeric"
                  type="number"
                  min="0"
                  max="720"
                  step="5"
                />
              </div>
            </div>
            <p v-if="availabilityError" class="field__error">{{ availabilityError }}</p>
          </GlassCard>

          <!-- 区块 B -->
          <GlassCard class="form-card">
            <div class="section__head">
              <span class="section__title">B · 任务拆解</span>
              <span class="tiny faint">
                {{ namedRows.length }} 个任务 · 共 {{ totalMinutes }} 分钟
              </span>
            </div>

            <div class="task-list">
              <div class="task-editor__head" aria-hidden="true">
                <span>#</span>
                <span>任务名</span>
                <span>预计时长</span>
                <span>衡量标准</span>
                <span>专注块</span>
                <span></span>
              </div>

              <div v-for="(row, index) in rows" :key="row.key" class="task-editor">
                <span class="task-editor__index numeric">{{ index + 1 }}</span>
                <div class="field task-editor__name">
                  <label class="sr-only" :for="`task-name-${row.key}`">任务名</label>
                  <input
                    :id="`task-name-${row.key}`"
                    v-model="row.name"
                    class="input"
                    type="text"
                    maxlength="120"
                    placeholder="例如：N2 核心词汇 Unit 1（120 词）"
                  />
                </div>
                <div class="field">
                  <label class="sr-only" :for="`task-min-${row.key}`">预计时长（分钟）</label>
                  <input
                    :id="`task-min-${row.key}`"
                    v-model.number="row.estMinutes"
                    class="input numeric"
                    type="number"
                    min="1"
                    max="1440"
                  />
                </div>
                <div class="field">
                  <label class="sr-only" :for="`task-measure-${row.key}`">衡量标准</label>
                  <select :id="`task-measure-${row.key}`" v-model="row.measureStandard" class="select">
                    <option v-for="option in MEASURE_STANDARD_OPTIONS" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </div>
                <div class="field">
                  <label class="sr-only" :for="`task-block-${row.key}`">单次专注块</label>
                  <select :id="`task-block-${row.key}`" v-model.number="row.focusBlock" class="select">
                    <option :value="15">15 分钟</option>
                    <option :value="25">25 分钟</option>
                    <option :value="45">45 分钟</option>
                  </select>
                </div>
                <div class="task-editor__actions">
                  <span v-if="row.status !== 'pending'" class="tag tag--partial">{{ row.status === 'done' ? '已完成' : row.status === 'skipped' ? '已跳过' : '部分完成' }}</span>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="删除这一行"
                    @click="removeRow(row.key)"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>

            <button type="button" class="btn btn--ghost btn--sm add-row" @click="addRow">+ 添加任务</button>

            <p v-if="durationError" class="field__error">{{ durationError }}</p>
            <p v-else-if="tasksError" class="field__error">{{ tasksError }}</p>
          </GlassCard>

          <p v-if="error" class="error-text" role="alert">{{ error }}</p>

          <div class="editor__actions">
            <SpriteButton type="submit" :disabled="!canSave" :loading="saving">
              {{ isEdit ? '保存修改' : '保存并排期' }}
            </SpriteButton>
            <RouterLink
              class="btn btn--ghost"
              :to="isEdit && subPlan ? `/sub-plans/${subPlan.id}` : masterPlan ? `/master-plans/${masterPlan.id}` : '/'"
            >
              取消
            </RouterLink>
            <span v-if="report.hasBlocking" class="tiny faint">阻断项未清零，保存已禁用。</span>
          </div>
        </div>

        <!-- 区块 C：仅开发环境显示规则诊断 / 排期预览 -->
        <aside v-if="isDev" class="editor__aside">
          <GlassCard class="editor__diag">
            <DiagnosticList :report="report" :applying="saving" @apply="applyPatch" />
          </GlassCard>

          <GlassCard class="editor__summary">
            <p class="section__title">排期预览（前端计算）</p>
            <ul class="summary-list">
              <li>
                <span>任务总时长</span>
                <span class="numeric">{{ totalMinutes }} 分钟</span>
              </li>
              <li>
                <span>每日均值</span>
                <span class="numeric">
                  {{ Math.round(((Number(form.weekdayMinutes) || 0) * 5 + (Number(form.weekendMinutes) || 0) * 2) / 7) }} 分钟
                </span>
              </li>
              <li>
                <span>缓冲日</span>
                <span class="numeric">每周 {{ form.bufferDays }} 天</span>
              </li>
              <li>
                <span>诊断</span>
                <span>
                  <span class="tag" :class="report.hasBlocking ? 'tag--overdue' : report.hasWarning ? 'tag--partial' : 'tag--completed'">
                    {{ report.hasBlocking ? '有阻断' : report.hasWarning ? '有警告' : '全部通过' }}
                  </span>
                </span>
              </li>
            </ul>
            <p class="tiny faint summary-note">
              保存后按「工作日 / 周末容量 + 缓冲日」生成初始排期；之后可在分计划详情页重新排期。
            </p>
          </GlassCard>
        </aside>
      </form>
    </div>
  </AppShell>
</template>

<style scoped>
.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-faint);
  margin-bottom: var(--space-4);
  flex-wrap: wrap;
}

.crumb a {
  color: var(--text-muted);
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}

.editor--dev {
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, 1fr);
}

.editor__main {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.form-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.locked-field {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  background: var(--glass-bg-soft);
  border: 1px solid var(--line-soft);
}

.locked-field__name {
  font-size: 14px;
  font-weight: 560;
  color: var(--text-strong);
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-editor__head,
.task-editor {
  display: grid;
  grid-template-columns: 26px minmax(180px, 2.2fr) minmax(90px, 0.8fr) minmax(110px, 1fr) minmax(100px, 0.8fr) 72px;
  gap: 8px;
  align-items: center;
}

.task-editor__head {
  padding: 0 4px;
  font-size: 11px;
  color: var(--text-faint);
}

.task-editor {
  padding: 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-soft);
  background: var(--glass-bg-soft);
  animation: row-in var(--dur-base) var(--ease-out);
}

.task-editor .input,
.task-editor .select {
  min-height: 38px;
  font-size: 13px;
  padding: 6px 10px;
}

.task-editor__index {
  font-size: 11px;
  color: var(--text-faint);
  text-align: center;
}

.task-editor__name {
  min-width: 0;
}

.task-editor__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.icon-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-faint);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.icon-btn:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

.add-row {
  align-self: flex-start;
}

.editor__actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.editor__aside {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  position: sticky;
  top: var(--space-5);
  min-width: 0;
}

.editor__diag,
.editor__summary {
  padding: var(--space-5);
}

.summary-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: var(--space-3);
}

.summary-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: 12px;
  color: var(--text-muted);
}

.summary-list li span:last-child {
  color: var(--text-strong);
}

.summary-note {
  margin-top: var(--space-3);
  line-height: 1.7;
}

@keyframes row-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 1080px) {
  .editor {
    grid-template-columns: 1fr;
  }

  .editor__aside {
    position: static;
  }
}

@media (max-width: 820px) {
  .task-editor__head {
    display: none;
  }

  .task-editor {
    grid-template-columns: 1fr 1fr;
  }

  .task-editor__index {
    display: none;
  }

  .task-editor__name {
    grid-column: 1 / -1;
  }

  .task-editor__actions {
    grid-column: 1 / -1;
    justify-content: space-between;
  }
}
</style>
```

## `src/views/master/MasterPlanFormView.vue`

```vue
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import GlassCard from '@/components/ui/GlassCard.vue'
import SpriteButton from '@/components/ui/SpriteButton.vue'
import DiagnosticList from '@/components/diagnostics/DiagnosticList.vue'
import { useMasterPlans } from '@/composables/useMasterPlans'
import { useSubPlans } from '@/composables/useSubPlans'
import { useToast } from '@/composables/useToast'
import { diagnoseMasterPlan, type DiagnosticPatch } from '@/engine/diagnostics'
import { isValidISODate, todayISO } from '@/lib/date'
import {
  MEASURE_TYPE_OPTIONS,
  type MeasureType,
  type SubPlan,
} from '@/types/models'

/** 总计划创建 / 编辑（轻量表单，只诊断 2 条规则） */
const route = useRoute()
const router = useRouter()
const toast = useToast()
const masterApi = useMasterPlans()
const subApi = useSubPlans()
const isDev = import.meta.env.DEV

const today = todayISO()
const isEdit = computed(() => route.name === 'master-plan-edit')
const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notFound = ref(false)
const subPlans = ref<SubPlan[]>([])

const form = reactive({
  name: '',
  deadline: '',
  measureType: 'exam' as MeasureType,
  description: '',
})

const report = computed(() =>
  diagnoseMasterPlan({
    deadline: form.deadline,
    subPlans: subPlans.value.map((sub) => ({
      id: sub.id,
      name: sub.name,
      deadline: sub.deadline,
    })),
    today,
  }),
)

/** 与已有分计划冲突时，数据库触发器也会拒绝，因此提前禁用保存 */
const hasDateConflict = computed(() =>
  report.value.items.some((item) => item.id === 'master-subplan-conflict' && item.level === 'warn'),
)

const nameError = computed(() => (form.name.trim().length === 0 ? '总计划名称不能为空' : ''))
const canSave = computed(
  () =>
    !report.value.hasBlocking &&
    !hasDateConflict.value &&
    form.name.trim().length > 0 &&
    isValidISODate(form.deadline) &&
    !saving.value,
)

function applyPatch(patch: DiagnosticPatch): void {
  if (patch.kind === 'deadline') form.deadline = patch.value
}

async function load(): Promise<void> {
  loading.value = true
  if (!isEdit.value) {
    form.deadline = ''
    form.name = ''
    loading.value = false
    return
  }
  const plan = await masterApi.fetchOne(id.value)
  if (!plan) {
    notFound.value = true
    error.value = masterApi.error.value
    loading.value = false
    return
  }
  form.name = plan.name
  form.deadline = plan.deadline
  form.measureType = plan.measureType
  form.description = plan.description
  subPlans.value = await subApi.fetchByMaster(plan.id)
  loading.value = false
}

async function save(): Promise<void> {
  if (!canSave.value) return
  saving.value = true
  error.value = ''
  const input = {
    name: form.name.trim(),
    deadline: form.deadline,
    measureType: form.measureType,
    description: form.description.trim(),
  }
  const saved = isEdit.value
    ? await masterApi.update(id.value, input)
    : await masterApi.create(input)
  saving.value = false
  if (!saved) {
    error.value = masterApi.error.value || '保存失败'
    return
  }
  toast.success(isEdit.value ? '总计划已更新' : '总计划已创建')
  await router.replace(`/master-plans/${saved.id}`)
}

onMounted(load)
</script>

<template>
  <AppShell>
    <div class="page-wrap page-wrap--narrow">
      <nav class="crumb" aria-label="面包屑">
        <RouterLink to="/">我的总计划</RouterLink>
        <span aria-hidden="true">/</span>
        <span>{{ isEdit ? '编辑' : '新建' }}</span>
      </nav>

      <header class="page-head">
        <div class="page-head__text">
          <p class="eyebrow">最终成果</p>
          <h1>{{ isEdit ? '编辑总计划' : '新建总计划' }}</h1>
          <p class="muted">只需要写清结果与日期；任务拆解、每日可用时间、缓冲日都在分计划里设置。</p>
        </div>
      </header>

      <GlassCard v-if="loading" class="state-card">
        <p class="muted">正在读取…</p>
      </GlassCard>

      <GlassCard v-else-if="notFound" class="state-card">
        <p class="error-text">{{ error || '总计划不存在' }}</p>
        <RouterLink class="btn btn--ghost btn--sm" to="/">返回列表</RouterLink>
      </GlassCard>

      <form v-else class="editor" :class="{ 'editor--dev': isDev }" novalidate @submit.prevent="save">
        <div class="editor__main">
          <GlassCard class="editor__card">
            <div class="form-grid">
              <div class="field form-grid--full">
                <label class="field__label" for="master-name">总计划名称</label>
                <input
                  id="master-name"
                  v-model="form.name"
                  class="input"
                  type="text"
                  maxlength="120"
                  placeholder="例如：三个月通过 N2"
                  :aria-invalid="Boolean(nameError)"
                  required
                />
                <span class="field__hint">写成最终成果，而不是每天的动作。</span>
              </div>

              <div class="field">
                <label class="field__label" for="master-deadline">截止日期</label>
                <input
                  id="master-deadline"
                  v-model="form.deadline"
                  class="input"
                  type="date"
                  :min="today"
                  required
                />
                <span class="field__hint">分计划的截止日期不能晚于这一天。</span>
              </div>

              <div class="field">
                <label class="field__label" for="master-measure">目标衡量标准</label>
                <select id="master-measure" v-model="form.measureType" class="select">
                  <option v-for="option in MEASURE_TYPE_OPTIONS" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </div>

              <div class="field form-grid--full">
                <label class="field__label" for="master-desc">一句话成果描述（可选）</label>
                <textarea
                  id="master-desc"
                  v-model="form.description"
                  class="textarea"
                  maxlength="300"
                  placeholder="怎样才算达成？例如：N2 考试 90 分以上，能读懂新闻标题。"
                ></textarea>
              </div>
            </div>

            <p v-if="error" class="error-text" role="alert">{{ error }}</p>

            <div class="editor__actions">
              <SpriteButton type="submit" :disabled="!canSave" :loading="saving">
                {{ isEdit ? '保存修改' : '创建总计划' }}
              </SpriteButton>
              <RouterLink
                class="btn btn--ghost"
                :to="isEdit && id ? `/master-plans/${id}` : '/'"
              >
                取消
              </RouterLink>
              <span v-if="report.hasBlocking" class="tiny faint">存在阻断项，保存已禁用。</span>
              <span v-else-if="hasDateConflict" class="tiny faint">与分计划日期冲突，请先处理。</span>
            </div>
          </GlassCard>
        </div>

        <!-- 仅开发环境显示规则诊断 -->
        <aside v-if="isDev" class="editor__aside">
          <GlassCard class="editor__diag">
            <DiagnosticList :report="report" :applying="saving" @apply="applyPatch" />
          </GlassCard>

          <p class="editor__note tiny faint">
            总计划不直接挂任务，进度由分计划按任务时长加权汇总。状态（进行中 / 已完成 / 已逾期）由系统计算，不能手动修改。
          </p>
        </aside>
      </form>
    </div>
  </AppShell>
</template>

<style scoped>
.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-faint);
  margin-bottom: var(--space-4);
}

.crumb a {
  color: var(--text-muted);
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}

.editor--dev {
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 1fr);
}

.editor__card {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.editor__actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding-top: var(--space-4);
  border-top: 1px solid var(--line-soft);
}

.editor__aside {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  position: sticky;
  top: var(--space-5);
}

.editor__diag {
  padding: var(--space-5);
}

.editor__note {
  padding: 0 4px;
  line-height: 1.7;
}

@media (max-width: 900px) {
  .editor {
    grid-template-columns: 1fr;
  }

  .editor__aside {
    position: static;
  }
}
</style>
```


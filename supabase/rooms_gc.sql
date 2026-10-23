-- ============================================================================
-- 拾光 · Picked Light —— 自习室脏数据清理与级联约束
-- 在 Supabase SQL Editor 执行一次；可重复执行。
-- ============================================================================

begin;

-- 1. 删除没有任何成员的孤儿房间
delete from public.rooms r
where not exists (
  select 1
  from public.room_members m
  where m.room_id = r.id
);

-- 2. 删除指向不存在房间的成员记录（正常情况下 FK 已阻止，作为修复兜底）
delete from public.room_members m
where not exists (
  select 1
  from public.rooms r
  where r.id = m.room_id
);

-- 3. 确保 room_members.room_id 为 ON DELETE CASCADE
alter table public.room_members
  drop constraint if exists room_members_room_id_fkey;

alter table public.room_members
  add constraint room_members_room_id_fkey
  foreign key (room_id)
  references public.rooms (id)
  on delete cascade;

-- 4. 房主删除房间后，rooms -> room_members 继续级联清理
alter table public.rooms
  drop constraint if exists rooms_host_id_fkey;

alter table public.rooms
  add constraint rooms_host_id_fkey
  foreign key (host_id)
  references auth.users (id)
  on delete cascade;

-- 5. 空房间删除策略（最后一名成员离开后允许清理）
drop policy if exists "rooms_delete_empty" on public.rooms;
create policy "rooms_delete_empty" on public.rooms
  for delete to authenticated
  using (
    not exists (
      select 1 from public.room_members m
      where m.room_id = rooms.id
    )
  );

-- 5.1 host_id 权限：读大厅公开，插/改/删只允许房主
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

-- 6. 数据库层 GC：成员删除后若房间为空，自动删除房间
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

-- 7. 权限：登录用户可以读大厅、创建自己的房间、加入/退出
revoke all on public.rooms from anon;
revoke all on public.room_members from anon;

grant select, insert, update, delete on public.rooms to authenticated;
grant select, insert, delete on public.room_members to authenticated;

commit;

-- 可选：验证是否还有孤儿数据
-- select r.id, r.name, r.created_at
-- from public.rooms r
-- where not exists (select 1 from public.room_members m where m.room_id = r.id);

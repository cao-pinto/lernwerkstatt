-- RLS fix for Admin UI (schools create/list)
-- Run in Supabase SQL editor.

-- 1) Platform admins table
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

drop policy if exists platform_admins_self_select on public.platform_admins;
create policy platform_admins_self_select on public.platform_admins
for select to authenticated
using (user_id = auth.uid());

-- 2) Admin helper
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.platform_admins a
    where a.user_id = auth.uid()
  );
$$;

grant execute on function public.is_platform_admin() to authenticated;

-- 3) Policies for schools (Admin UI)
drop policy if exists schools_select_platform_admin on public.schools;
create policy schools_select_platform_admin on public.schools
for select to authenticated
using (public.is_platform_admin());

drop policy if exists schools_insert_platform_admin on public.schools;
create policy schools_insert_platform_admin on public.schools
for insert to authenticated
with check (public.is_platform_admin());

drop policy if exists schools_update_platform_admin on public.schools;
create policy schools_update_platform_admin on public.schools
for update to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists schools_delete_platform_admin on public.schools;
create policy schools_delete_platform_admin on public.schools
for delete to authenticated
using (public.is_platform_admin());

-- 4) Admin read access for dashboard counts/lists
do $$
begin
  -- teachers
  begin
    execute 'drop policy if exists teachers_select_platform_admin on public.teachers';
    execute 'create policy teachers_select_platform_admin on public.teachers for select to authenticated using (public.is_platform_admin())';
  exception when undefined_table then null;
  end;

  -- students
  begin
    execute 'drop policy if exists students_select_platform_admin on public.students';
    execute 'create policy students_select_platform_admin on public.students for select to authenticated using (public.is_platform_admin())';
  exception when undefined_table then null;
  end;
end $$;

-- 5) Register current admin (change email if needed)
insert into public.platform_admins(user_id, email)
select id, email
from auth.users
where email = 'rudolf.bauboeck@gmail.com'
on conflict (user_id)
do update set email = excluded.email;

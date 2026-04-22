-- LernWerkstatt: Security / RLS lockdown
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

-- Helper: current student profile for browser-authenticated students.
-- The function tries multiple mappings so it can work with older and newer auth setups:
-- 1) students.user_id if that column exists
-- 2) student_id in JWT app/user metadata
-- 3) login_code in JWT metadata
-- 4) local-part of the auth email (for code-based student logins)
create or replace function public.current_student_profile()
returns public.students
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result_row public.students%rowtype;
  jwt_payload jsonb := auth.jwt();
  jwt_email text := lower(coalesce(jwt_payload->>'email', ''));
  jwt_email_local text := upper(nullif(split_part(jwt_email, '@', 1), ''));
  jwt_student_id text := nullif(
    coalesce(
      jwt_payload->'user_metadata'->>'student_id',
      jwt_payload->'app_metadata'->>'student_id',
      ''
    ),
    ''
  );
  jwt_login_code text := upper(nullif(
    coalesce(
      jwt_payload->'user_metadata'->>'login_code',
      jwt_payload->'app_metadata'->>'login_code',
      ''
    ),
    ''
  ));
  has_user_id boolean := false;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'students'
      and column_name = 'user_id'
  )
  into has_user_id;

  if has_user_id then
    execute 'select * from public.students where user_id = $1 limit 1'
      into result_row
      using auth.uid();
    if found then
      return result_row;
    end if;
  end if;

  if jwt_student_id is not null then
    begin
      select *
      into result_row
      from public.students
      where id = jwt_student_id::uuid
      limit 1;

      if found then
        return result_row;
      end if;
    exception
      when others then
        null;
    end;
  end if;

  if jwt_login_code is not null then
    select *
    into result_row
    from public.students
    where upper(login_code) = jwt_login_code
    limit 1;

    if found then
      return result_row;
    end if;
  end if;

  if jwt_email_local is not null then
    select *
    into result_row
    from public.students
    where upper(login_code) = jwt_email_local
    limit 1;

    if found then
      return result_row;
    end if;
  end if;

  return null;
end;
$$;

grant execute on function public.current_student_profile() to authenticated;

-- Basis-Tabellen absichern
alter table public.teachers enable row level security;
alter table public.students enable row level security;
alter table public.attempts enable row level security;

-- Klassenklima / Verhalten absichern (nur wenn die Tabellen schon existieren)
do $$
begin
  if to_regclass('public.class_climate_sessions') is not null then
    execute 'alter table public.class_climate_sessions enable row level security';
  end if;

  if to_regclass('public.class_climate_entries') is not null then
    execute 'alter table public.class_climate_entries enable row level security';
  end if;

  if to_regclass('public.class_climate_student_usage') is not null then
    execute 'alter table public.class_climate_student_usage enable row level security';
  end if;

  if to_regclass('public.class_climate_reflections') is not null then
    execute 'alter table public.class_climate_reflections enable row level security';
  end if;

  if to_regclass('public.student_behavior_statuses') is not null then
    execute 'alter table public.student_behavior_statuses enable row level security';
  end if;
end $$;

-- Unused helper view should not stay API-readable with login_code.
revoke all on public.v_school_students from anon, authenticated;

-- Teachers
drop policy if exists teachers_select_self on public.teachers;
create policy teachers_select_self on public.teachers
for select
to authenticated
using (
  user_id = auth.uid()
);

drop policy if exists teachers_select_manager_same_school on public.teachers;
create policy teachers_select_manager_same_school on public.teachers
for select
to authenticated
using (
  school_id = (select (public.current_teacher_profile()).school_id)
  and (select (public.current_teacher_profile()).role) = 'manager'
);

drop policy if exists teachers_select_platform_admin on public.teachers;
create policy teachers_select_platform_admin on public.teachers
for select
to authenticated
using (
  public.is_platform_admin()
);

-- Students
drop policy if exists students_select_own on public.students;
create policy students_select_own on public.students
for select
to authenticated
using (
  id = (select (public.current_student_profile()).id)
);

drop policy if exists students_select_teacher_same_school on public.students;
create policy students_select_teacher_same_school on public.students
for select
to authenticated
using (
  school_id = (select (public.current_teacher_profile()).school_id)
);

drop policy if exists students_select_platform_admin on public.students;
create policy students_select_platform_admin on public.students
for select
to authenticated
using (
  public.is_platform_admin()
);

drop policy if exists students_insert_manager_same_school on public.students;
create policy students_insert_manager_same_school on public.students
for insert
to authenticated
with check (
  school_id = (select (public.current_teacher_profile()).school_id)
  and (select (public.current_teacher_profile()).role) = 'manager'
);

drop policy if exists students_update_manager_same_school on public.students;
create policy students_update_manager_same_school on public.students
for update
to authenticated
using (
  school_id = (select (public.current_teacher_profile()).school_id)
  and (select (public.current_teacher_profile()).role) = 'manager'
)
with check (
  school_id = (select (public.current_teacher_profile()).school_id)
  and (select (public.current_teacher_profile()).role) = 'manager'
);

drop policy if exists students_delete_manager_same_school on public.students;
create policy students_delete_manager_same_school on public.students
for delete
to authenticated
using (
  school_id = (select (public.current_teacher_profile()).school_id)
  and (select (public.current_teacher_profile()).role) = 'manager'
);

drop policy if exists students_insert_platform_admin on public.students;
create policy students_insert_platform_admin on public.students
for insert
to authenticated
with check (
  public.is_platform_admin()
);

drop policy if exists students_update_platform_admin on public.students;
create policy students_update_platform_admin on public.students
for update
to authenticated
using (
  public.is_platform_admin()
)
with check (
  public.is_platform_admin()
);

drop policy if exists students_delete_platform_admin on public.students;
create policy students_delete_platform_admin on public.students
for delete
to authenticated
using (
  public.is_platform_admin()
);

-- Attempts
drop policy if exists attempts_select_own on public.attempts;
create policy attempts_select_own on public.attempts
for select
to authenticated
using (
  student_id = (select (public.current_student_profile()).id)
);

drop policy if exists attempts_insert_own on public.attempts;
create policy attempts_insert_own on public.attempts
for insert
to authenticated
with check (
  student_id = (select (public.current_student_profile()).id)
);

drop policy if exists attempts_update_own on public.attempts;
create policy attempts_update_own on public.attempts
for update
to authenticated
using (
  student_id = (select (public.current_student_profile()).id)
)
with check (
  student_id = (select (public.current_student_profile()).id)
);

drop policy if exists attempts_delete_own on public.attempts;
create policy attempts_delete_own on public.attempts
for delete
to authenticated
using (
  student_id = (select (public.current_student_profile()).id)
);

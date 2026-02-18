-- LernWerkstatt: School / DLM / Teacher / Groups model
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

-- 1) Schools
create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- 2) Teachers: add school and role
alter table public.teachers
  add column if not exists school_id uuid references public.schools(id) on delete cascade,
  add column if not exists role text not null default 'teacher' check (role in ('manager','teacher')),
  add column if not exists created_by_teacher_id uuid references public.teachers(id) on delete set null;

create index if not exists idx_teachers_school_id on public.teachers(school_id);
create index if not exists idx_teachers_user_id on public.teachers(user_id);

-- 3) Students: school + structured names
alter table public.students
  add column if not exists school_id uuid references public.schools(id) on delete cascade,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists class_name text;

create index if not exists idx_students_school_id on public.students(school_id);
create index if not exists idx_students_class_name on public.students(class_name);
create unique index if not exists uq_students_login_code on public.students(login_code);

-- 4) Teacher groups
create table if not exists public.teacher_groups (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_teacher_groups_teacher_id on public.teacher_groups(teacher_id);
create index if not exists idx_teacher_groups_school_id on public.teacher_groups(school_id);

create table if not exists public.teacher_group_students (
  group_id uuid not null references public.teacher_groups(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, student_id)
);

create index if not exists idx_teacher_group_students_student_id on public.teacher_group_students(student_id);

-- 5) Ensure attempts are deleted when student is deleted
alter table public.attempts
  drop constraint if exists attempts_student_id_fkey;

alter table public.attempts
  add constraint attempts_student_id_fkey
  foreign key (student_id) references public.students(id) on delete cascade;

-- 6) Display name builder ("Vorname N.")
create or replace function public.make_display_name(first_name text, last_name text)
returns text
language sql
immutable
as $$
  select trim(coalesce(first_name,'')) ||
         case
           when trim(coalesce(last_name,'')) = '' then ''
           else ' ' || upper(left(trim(last_name), 1)) || '.'
         end;
$$;

create or replace function public.students_fill_display_name()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.first_name,'') <> '' then
    new.display_name := public.make_display_name(new.first_name, new.last_name);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_students_fill_display_name on public.students;
create trigger trg_students_fill_display_name
before insert or update of first_name, last_name
on public.students
for each row
execute function public.students_fill_display_name();

-- 7) Helper view for school-local student list (optional)
create or replace view public.v_school_students as
select
  s.id,
  s.school_id,
  s.class_name,
  s.first_name,
  s.last_name,
  s.display_name,
  s.login_code,
  s.created_at
from public.students s;

-- 8) RLS helpers
create or replace function public.current_teacher_profile()
returns public.teachers
language sql
stable
security definer
set search_path = public
as $$
  select t.*
  from public.teachers t
  where t.user_id = auth.uid()
  limit 1;
$$;

grant execute on function public.current_teacher_profile() to authenticated;

-- 9) RLS (idempotent)
alter table public.schools enable row level security;
alter table public.teacher_groups enable row level security;
alter table public.teacher_group_students enable row level security;

-- schools: admins/managers can read own school (admin handled via service role)
drop policy if exists schools_select_auth on public.schools;
create policy schools_select_auth on public.schools
for select
to authenticated
using (
  id = (select (public.current_teacher_profile()).school_id)
);

-- teacher_groups
drop policy if exists teacher_groups_select on public.teacher_groups;
create policy teacher_groups_select on public.teacher_groups
for select
to authenticated
using (
  teacher_id = (select (public.current_teacher_profile()).id)
  or (
    school_id = (select (public.current_teacher_profile()).school_id)
    and (select (public.current_teacher_profile()).role) = 'manager'
  )
);

drop policy if exists teacher_groups_insert on public.teacher_groups;
create policy teacher_groups_insert on public.teacher_groups
for insert
to authenticated
with check (
  teacher_id = (select (public.current_teacher_profile()).id)
  and school_id = (select (public.current_teacher_profile()).school_id)
);

drop policy if exists teacher_groups_delete on public.teacher_groups;
create policy teacher_groups_delete on public.teacher_groups
for delete
to authenticated
using (
  teacher_id = (select (public.current_teacher_profile()).id)
  or (
    school_id = (select (public.current_teacher_profile()).school_id)
    and (select (public.current_teacher_profile()).role) = 'manager'
  )
);

-- teacher_group_students
drop policy if exists teacher_group_students_select on public.teacher_group_students;
create policy teacher_group_students_select on public.teacher_group_students
for select
to authenticated
using (
  exists (
    select 1
    from public.teacher_groups g
    where g.id = teacher_group_students.group_id
      and (
        g.teacher_id = (select (public.current_teacher_profile()).id)
        or (
          g.school_id = (select (public.current_teacher_profile()).school_id)
          and (select (public.current_teacher_profile()).role) = 'manager'
        )
      )
  )
);

drop policy if exists teacher_group_students_insert on public.teacher_group_students;
create policy teacher_group_students_insert on public.teacher_group_students
for insert
to authenticated
with check (
  exists (
    select 1
    from public.teacher_groups g
    join public.students s on s.id = teacher_group_students.student_id
    where g.id = teacher_group_students.group_id
      and g.teacher_id = (select (public.current_teacher_profile()).id)
      and s.school_id = g.school_id
  )
);

drop policy if exists teacher_group_students_delete on public.teacher_group_students;
create policy teacher_group_students_delete on public.teacher_group_students
for delete
to authenticated
using (
  exists (
    select 1
    from public.teacher_groups g
    where g.id = teacher_group_students.group_id
      and (
        g.teacher_id = (select (public.current_teacher_profile()).id)
        or (
          g.school_id = (select (public.current_teacher_profile()).school_id)
          and (select (public.current_teacher_profile()).role) = 'manager'
        )
      )
  )
);

-- 10) Optional convenience function for manager checks
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'manager' from public.current_teacher_profile()), false);
$$;

grant execute on function public.is_manager() to authenticated;

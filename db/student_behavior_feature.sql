create extension if not exists pgcrypto;

create table if not exists public.student_behavior_statuses (
  student_id uuid primary key references public.students(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  points integer not null default 0 check (points between 0 and 12),
  teacher_note text,
  updated_by_teacher_id uuid references public.teachers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_student_behavior_statuses_school
  on public.student_behavior_statuses(school_id, points desc);

-- LernWerkstatt: Temporaere soziale Rueckmeldungen an die Lehrkraft
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.feedback_rounds (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  group_id uuid not null references public.teacher_groups(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  school_week integer not null check (school_week between 1 and 40),
  status text not null default 'active' check (status in ('active', 'closed')),
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_rounds_group_week on public.feedback_rounds(group_id, school_week);
create index if not exists idx_feedback_rounds_teacher_id on public.feedback_rounds(teacher_id);
create unique index if not exists uq_feedback_rounds_active_group_week
  on public.feedback_rounds(group_id, school_week)
  where status = 'active';

create table if not exists public.feedback_round_participants (
  round_id uuid not null references public.feedback_rounds(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  is_present boolean not null default true,
  has_voted boolean not null default false,
  voted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (round_id, student_id)
);

create index if not exists idx_feedback_round_participants_student_id
  on public.feedback_round_participants(student_id);

create table if not exists public.feedback_votes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.feedback_rounds(id) on delete cascade,
  voter_student_id uuid not null references public.students(id) on delete cascade,
  target_student_id uuid references public.students(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  constraint uq_feedback_votes_round_voter unique (round_id, voter_student_id),
  constraint feedback_votes_not_self check (
    target_student_id is null or voter_student_id <> target_student_id
  ),
  constraint feedback_votes_reason_required check (
    target_student_id is null or length(trim(coalesce(reason, ''))) > 0
  )
);

create index if not exists idx_feedback_votes_round_id on public.feedback_votes(round_id);
create index if not exists idx_feedback_votes_target_student_id on public.feedback_votes(target_student_id);

alter table public.feedback_rounds enable row level security;
alter table public.feedback_round_participants enable row level security;
alter table public.feedback_votes enable row level security;

create or replace function public.cleanup_expired_feedback_rounds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  delete from public.feedback_rounds
  where (
    status = 'closed'
    and coalesce(closed_at, created_at) < now() - interval '24 hours'
  )
  or (
    status = 'active'
    and created_at < now() - interval '7 days'
  );

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.cleanup_expired_feedback_rounds() to authenticated;

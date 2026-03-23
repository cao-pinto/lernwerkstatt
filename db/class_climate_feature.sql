create extension if not exists pgcrypto;

create table if not exists public.class_climate_sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  group_id uuid not null references public.teacher_groups(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  protocol_date date not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_class_climate_session_group_date
  on public.class_climate_sessions(group_id, protocol_date);

create index if not exists idx_class_climate_sessions_teacher
  on public.class_climate_sessions(teacher_id, protocol_date desc);

create table if not exists public.class_climate_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_climate_sessions(id) on delete cascade,
  severity text not null check (severity in ('l', 'm', 's')),
  category_key text not null,
  category_label text not null,
  item_text text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_class_climate_entries_session
  on public.class_climate_entries(session_id, created_at desc);

create table if not exists public.class_climate_student_usage (
  session_id uuid not null references public.class_climate_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  entry_count integer not null default 0 check (entry_count between 0 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, student_id)
);

create or replace function public.class_climate_add_student_entry(
  p_session_id uuid,
  p_student_id uuid,
  p_severity text,
  p_category_key text,
  p_category_label text,
  p_item_text text,
  p_note text default null
)
returns public.class_climate_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.class_climate_sessions%rowtype;
  next_count integer;
  inserted_entry public.class_climate_entries%rowtype;
begin
  if p_severity not in ('l', 'm', 's') then
    raise exception 'Ungültiger Schweregrad';
  end if;

  select *
  into session_row
  from public.class_climate_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'Tagesprotokoll nicht gefunden';
  end if;

  if session_row.status <> 'active' then
    raise exception 'Tagesprotokoll ist nicht mehr geöffnet';
  end if;

  insert into public.class_climate_student_usage (session_id, student_id, entry_count)
  values (p_session_id, p_student_id, 1)
  on conflict (session_id, student_id)
  do update
    set entry_count = public.class_climate_student_usage.entry_count + 1,
        updated_at = now()
  returning entry_count into next_count;

  if next_count > 10 then
    update public.class_climate_student_usage
    set entry_count = entry_count - 1,
        updated_at = now()
    where session_id = p_session_id
      and student_id = p_student_id;
    raise exception 'Maximal 10 Einträge pro Schüler und Tagesprotokoll';
  end if;

  insert into public.class_climate_entries (
    session_id,
    severity,
    category_key,
    category_label,
    item_text,
    note,
    created_at,
    updated_at
  )
  values (
    p_session_id,
    p_severity,
    trim(coalesce(p_category_key, '')),
    trim(coalesce(p_category_label, '')),
    trim(coalesce(p_item_text, '')),
    nullif(trim(coalesce(p_note, '')), ''),
    now(),
    now()
  )
  returning * into inserted_entry;

  update public.class_climate_sessions
  set updated_at = now()
  where id = p_session_id;

  return inserted_entry;
end;
$$;

grant execute on function public.class_climate_add_student_entry(uuid, uuid, text, text, text, text, text) to authenticated;


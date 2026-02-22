-- LernWerkstatt: Feature "Umwandlungen"
-- Run in Supabase SQL editor.

-- 1) attempts.game absichern (falls Altstände ohne game existieren)
alter table public.attempts
  add column if not exists game text;

update public.attempts
set game = 'math'
where game is null;

alter table public.attempts
  alter column game set default 'math';

-- 2) Performance-Indexe für Umwandlungen + Lehrerübersichten
create index if not exists idx_attempts_game_mode_created
  on public.attempts(game, mode, created_at desc);

create index if not exists idx_attempts_student_game_mode
  on public.attempts(student_id, game, mode);

-- 3) Optional: Score-Index für Highscores
create index if not exists idx_attempts_conversion_score
  on public.attempts(game, mode, correct_count desc)
  where game = 'conversion';

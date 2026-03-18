# Supabase Edge Functions (LernWerkstatt)

## Enthaltene Functions
- `admin_create_manager`
- `feedback_close_round`
- `feedback_reset_round`
- `feedback_start_round`
- `feedback_student_status`
- `feedback_submit_vote`
- `feedback_teacher_round_status`
- `manager_create_teacher`
- `manager_delete_teacher`
- `manager_delete_student`
- `teacher_group_attempts`
- `get_highscores`
- `get_highscores_binary`
- `get_highscores_tree`
- `get_highscores_conversions`

## Voraussetzungen
- Migration ausführen: `db/lernwerkstatt_school_model.sql`
- Fuer soziale Rueckmeldungen zusaetzlich: `db/social_feedback_feature.sql`
- In Supabase Secrets setzen:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `ADMIN_EMAILS` (nur für `admin_create_manager`, kommasepariert)

Beispiel:
- `ADMIN_EMAILS=admin@deinedomain.at,weitere.admin@deinedomain.at`

## Deploy
```bash
supabase functions deploy admin_create_manager
supabase functions deploy feedback_close_round
supabase functions deploy feedback_reset_round
supabase functions deploy feedback_start_round
supabase functions deploy feedback_student_status
supabase functions deploy feedback_submit_vote
supabase functions deploy feedback_teacher_round_status
supabase functions deploy teacher_group_attempts
supabase functions deploy manager_create_teacher
supabase functions deploy manager_delete_teacher
supabase functions deploy manager_delete_student
supabase functions deploy get_highscores
supabase functions deploy get_highscores_binary
supabase functions deploy get_highscores_tree
supabase functions deploy get_highscores_conversions
```

## Lokal testen
```bash
supabase functions serve --env-file .env.local
```

Dann z. B. `POST /functions/v1/manager_create_teacher` mit Bearer-Token eines DLM.

# Supabase Edge Functions (LernWerkstatt)

## Enthaltene Functions
- `admin_create_manager`
- `manager_create_teacher`
- `manager_delete_teacher`
- `manager_delete_student`
- `get_highscores_conversions`

## Voraussetzungen
- Migration ausführen: `db/lernwerkstatt_school_model.sql`
- In Supabase Secrets setzen:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `ADMIN_EMAILS` (nur für `admin_create_manager`, kommasepariert)

Beispiel:
- `ADMIN_EMAILS=admin@deinedomain.at,weitere.admin@deinedomain.at`

## Deploy
```bash
supabase functions deploy admin_create_manager
supabase functions deploy manager_create_teacher
supabase functions deploy manager_delete_teacher
supabase functions deploy manager_delete_student
supabase functions deploy get_highscores_conversions
```

## Lokal testen
```bash
supabase functions serve --env-file .env.local
```

Dann z. B. `POST /functions/v1/manager_create_teacher` mit Bearer-Token eines DLM.

import {
  corsHeaders,
  fail,
  getAdminClient,
  getBearerToken,
  getCaller,
  ok,
} from "../_shared/common.ts";

async function resolveStudent(
  supabase: ReturnType<typeof getAdminClient>,
  callerId: string,
  fallbackStudentId?: string,
) {
  let { data: student, error } = await supabase
    .from("students")
    .select("id,display_name,class_name,user_id")
    .eq("user_id", callerId)
    .maybeSingle();

  if (!student && fallbackStudentId) {
    const fallback = await supabase
      .from("students")
      .select("id,display_name,class_name,user_id")
      .eq("id", fallbackStudentId)
      .maybeSingle();
    student = fallback.data || student;
    error = fallback.error || error;
  }

  if (error) throw new Error(error.message);
  if (!student) throw new Error("Kein Schülerprofil gefunden");
  return student;
}

async function resolvePrimaryGroup(
  supabase: ReturnType<typeof getAdminClient>,
  studentId: string,
  className: string | null,
) {
  const links = await supabase
    .from("teacher_group_students")
    .select("group_id")
    .eq("student_id", studentId);

  if (links.error) throw new Error(links.error.message);
  const groupIds = Array.from(new Set((links.data || []).map((row) => String(row.group_id))));
  if (!groupIds.length) return null;

  const groups = await supabase
    .from("teacher_groups")
    .select("id,name,school_id,teacher_id,created_at")
    .in("id", groupIds)
    .order("created_at", { ascending: true });

  if (groups.error) throw new Error(groups.error.message);
  const exactMatch = (groups.data || []).find((group) => String(group.name || "").trim() === String(className || "").trim());
  return exactMatch || (groups.data || [])[0] || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Nur POST erlaubt", 405);

  try {
    const supabase = getAdminClient();
    const token = getBearerToken(req);
    if (!token) return fail("Authorization Bearer Token fehlt", 401);
    const body = await req.json().catch(() => ({}));

    const caller = await getCaller(supabase, token);
    const student = await resolveStudent(supabase, caller.id, body?.student_id ? String(body.student_id) : undefined);
    const group = await resolvePrimaryGroup(supabase, student.id, student.class_name || null);

    if (!group) {
      return ok({
        student,
        group: null,
        session: null,
        entries_remaining: 0,
        entries_used: 0,
        entries: [],
      });
    }

    const { data: session, error: sessionErr } = await supabase
      .from("class_climate_sessions")
      .select("id,protocol_date,status,started_at,closed_at")
      .eq("group_id", group.id)
      .eq("status", "active")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sessionErr) return fail("Tagesprotokoll konnte nicht geladen werden", 400, sessionErr.message);

    if (!session) {
      return ok({
        student,
        group: { id: group.id, name: group.name },
        session: null,
        entries_remaining: 0,
        entries_used: 0,
        entries: [],
      });
    }

    const usage = await supabase
      .from("class_climate_student_usage")
      .select("entry_count")
      .eq("session_id", session.id)
      .eq("student_id", student.id)
      .maybeSingle();

    if (usage.error) return fail("Eintragslimit konnte nicht geladen werden", 400, usage.error.message);

    const { data: entries, error: entriesErr } = await supabase
      .from("class_climate_entries")
      .select("id,severity,category_key,category_label,item_text,note,created_at,updated_at")
      .eq("session_id", session.id)
      .order("created_at", { ascending: false });

    if (entriesErr) return fail("Tagesprotokolleinträge konnten nicht geladen werden", 400, entriesErr.message);

    const used = Number(usage.data?.entry_count || 0);

    return ok({
      student: {
        id: student.id,
        display_name: student.display_name,
        class_name: student.class_name,
      },
      group: { id: group.id, name: group.name },
      session,
      entries_used: used,
      entries_remaining: Math.max(0, 10 - used),
      entries: entries || [],
    });
  } catch (error) {
    return fail("Interner Fehler", 500, String(error));
  }
});

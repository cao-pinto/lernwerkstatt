import {
  corsHeaders,
  fail,
  getAdminClient,
  getBearerToken,
  getCaller,
  ok,
} from "../_shared/common.ts";

function normalizeSeverity(raw: unknown): "l" | "m" | "s" {
  const severity = String(raw ?? "").trim();
  if (severity !== "l" && severity !== "m" && severity !== "s") {
    throw new Error("severity muss l, m oder s sein");
  }
  return severity;
}

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
    .select("id,name,created_at")
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
    if (!group) return fail("Keine Klasse für den Schüler gefunden", 403);

    const sessionId = String(body?.session_id ?? "").trim();
    const categoryKey = String(body?.category_key ?? "").trim();
    const categoryLabel = String(body?.category_label ?? "").trim();
    const itemText = String(body?.item_text ?? "").trim();
    const note = String(body?.note ?? "").trim() || null;
    const severity = normalizeSeverity(body?.severity);

    if (!sessionId || !categoryKey || !categoryLabel || !itemText) {
      return fail("Kategorie, Vorfall und Sitzung sind erforderlich", 400);
    }

    const { data: session, error: sessionErr } = await supabase
      .from("class_climate_sessions")
      .select("id,group_id,status")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionErr) return fail("Tagesprotokoll konnte nicht geladen werden", 400, sessionErr.message);
    if (!session) return fail("Tagesprotokoll nicht gefunden", 404);
    if (session.group_id !== group.id) return fail("Dieses Tagesprotokoll gehört nicht zur Klasse des Schülers", 403);
    if (session.status !== "active") return fail("Das Tagesprotokoll ist bereits geschlossen", 409);

    const rpc = await supabase.rpc("class_climate_add_student_entry", {
      p_session_id: sessionId,
      p_student_id: student.id,
      p_severity: severity,
      p_category_key: categoryKey,
      p_category_label: categoryLabel,
      p_item_text: itemText,
      p_note: note,
    });

    if (rpc.error) return fail("Eintrag konnte nicht gespeichert werden", 400, rpc.error.message);

    const usage = await supabase
      .from("class_climate_student_usage")
      .select("entry_count")
      .eq("session_id", sessionId)
      .eq("student_id", student.id)
      .maybeSingle();

    if (usage.error) return fail("Eintragslimit konnte nicht geladen werden", 400, usage.error.message);

    return ok({
      entry: Array.isArray(rpc.data) ? rpc.data[0] : rpc.data,
      entries_used: Number(usage.data?.entry_count || 0),
      entries_remaining: Math.max(0, 10 - Number(usage.data?.entry_count || 0)),
    });
  } catch (error) {
    return fail("Interner Fehler", 500, String(error));
  }
});

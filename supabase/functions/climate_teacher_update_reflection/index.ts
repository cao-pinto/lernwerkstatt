import {
  corsHeaders,
  fail,
  getAdminClient,
  getBearerToken,
  getCaller,
  getTeacherProfileByUserId,
  ok,
} from "../_shared/common.ts";

function clampPoints(raw: unknown): number {
  const points = Number(raw);
  if (!Number.isInteger(points)) throw new Error("reflected_points muss eine ganze Zahl sein");
  return Math.max(0, Math.min(12, points));
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
    let teacher = await getTeacherProfileByUserId(supabase, caller.id);
    if ((!teacher?.id || !teacher.school_id) && body?.teacher_id) {
      const fallback = await supabase
        .from("teachers")
        .select("id,user_id,display_name,school_id,role")
        .eq("id", String(body.teacher_id))
        .maybeSingle();
      teacher = fallback.data || teacher;
    }
    if (!teacher?.id || !teacher.school_id) return fail("Kein Lehrerprofil gefunden", 403);

    const sessionId = String(body?.session_id ?? "").trim();
    const categoryKey = String(body?.category_key ?? "").trim();
    const categoryLabel = String(body?.category_label ?? "").trim();
    const itemText = String(body?.item_text ?? "").trim();
    const teacherNote = String(body?.teacher_note ?? "").trim() || null;
    if (!sessionId || !categoryKey || !categoryLabel || !itemText) return fail("session_id, Kategorie und Vorfall sind erforderlich", 400);

    let reflectedPoints = 0;
    try {
      reflectedPoints = clampPoints(body?.reflected_points);
    } catch (error) {
      return fail(String(error instanceof Error ? error.message : error), 400);
    }

    const { data: session, error: sessionErr } = await supabase
      .from("class_climate_sessions")
      .select("id,teacher_id")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionErr) return fail("Tagesprotokoll konnte nicht geladen werden", 400, sessionErr.message);
    if (!session) return fail("Tagesprotokoll nicht gefunden", 404);
    if (session.teacher_id !== teacher.id) return fail("Dieses Tagesprotokoll gehört nicht zur Lehrkraft", 403);

    const { data: reflection, error: reflectionErr } = await supabase
      .from("class_climate_reflections")
      .upsert({
        session_id: sessionId,
        category_key: categoryKey,
        category_label: categoryLabel,
        item_text: itemText,
        reflected_points: reflectedPoints,
        teacher_note: teacherNote,
        updated_by_teacher_id: teacher.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "session_id,item_text" })
      .select("session_id,category_key,category_label,item_text,reflected_points,teacher_note,updated_at")
      .single();

    if (reflectionErr || !reflection) return fail("Reflektierte Einordnung konnte nicht gespeichert werden", 400, reflectionErr?.message);

    return ok({ reflection });
  } catch (error) {
    return fail("Interner Fehler", 500, String(error));
  }
});

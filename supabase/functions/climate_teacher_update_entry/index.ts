import {
  corsHeaders,
  fail,
  getAdminClient,
  getBearerToken,
  getCaller,
  getTeacherProfileByUserId,
  ok,
} from "../_shared/common.ts";

function normalizeSeverity(raw: unknown): "l" | "m" | "s" {
  const severity = String(raw ?? "").trim();
  if (severity !== "l" && severity !== "m" && severity !== "s") {
    throw new Error("severity muss l, m oder s sein");
  }
  return severity;
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
    if (!teacher?.id) return fail("Kein Lehrerprofil gefunden", 403);

    const action = String(body?.action ?? "").trim();
    const entryId = String(body?.entry_id ?? "").trim();
    const sessionId = String(body?.session_id ?? "").trim();

    if (!["create", "update", "delete"].includes(action)) return fail("Ungültige action", 400);

    if (action === "create") {
      if (!sessionId) return fail("session_id fehlt", 400);
      const severity = normalizeSeverity(body?.severity);
      const categoryKey = String(body?.category_key ?? "").trim();
      const categoryLabel = String(body?.category_label ?? "").trim();
      const itemText = String(body?.item_text ?? "").trim();
      const note = String(body?.note ?? "").trim() || null;

      if (!categoryKey || !categoryLabel || !itemText) {
        return fail("Kategorie und Vorfall sind erforderlich", 400);
      }

      const { data: session, error: sessionErr } = await supabase
        .from("class_climate_sessions")
        .select("id,teacher_id,status")
        .eq("id", sessionId)
        .maybeSingle();

      if (sessionErr) return fail("Tagesprotokoll konnte nicht geladen werden", 400, sessionErr.message);
      if (!session) return fail("Tagesprotokoll nicht gefunden", 404);
      if (session.teacher_id !== teacher.id) return fail("Dieses Tagesprotokoll gehört nicht zur Lehrkraft", 403);
      if (session.status !== "active") return fail("Geschlossene Tagesprotokolle können nicht ergänzt werden", 409);

      const { data: created, error: createErr } = await supabase
        .from("class_climate_entries")
        .insert({
          session_id: sessionId,
          severity,
          source: "teacher",
          category_key: categoryKey,
          category_label: categoryLabel,
          item_text: itemText,
          note,
        })
        .select("id,severity,source,category_key,category_label,item_text,note,created_at,updated_at")
        .single();

      if (createErr || !created) return fail("Eintrag konnte nicht angelegt werden", 400, createErr?.message);

      await supabase
        .from("class_climate_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", sessionId);

      return ok({ entry: created });
    }

    if (!entryId) return fail("entry_id fehlt", 400);

    const { data: entry, error: entryErr } = await supabase
      .from("class_climate_entries")
      .select("id,session_id")
      .eq("id", entryId)
      .maybeSingle();

    if (entryErr) return fail("Eintrag konnte nicht geladen werden", 400, entryErr.message);
    if (!entry) return fail("Eintrag nicht gefunden", 404);

    const { data: session, error: sessionErr } = await supabase
      .from("class_climate_sessions")
      .select("id,teacher_id,status")
      .eq("id", entry.session_id)
      .maybeSingle();

    if (sessionErr) return fail("Tagesprotokoll konnte nicht geladen werden", 400, sessionErr.message);
    if (!session) return fail("Tagesprotokoll nicht gefunden", 404);
    if (session.teacher_id !== teacher.id) return fail("Dieser Eintrag gehört nicht zur Lehrkraft", 403);

    if (action === "delete") {
      const { error: deleteErr } = await supabase
        .from("class_climate_entries")
        .delete()
        .eq("id", entryId);

      if (deleteErr) return fail("Eintrag konnte nicht gelöscht werden", 400, deleteErr.message);
      return ok({ deleted: true });
    }

    const severity = normalizeSeverity(body?.severity);
    const note = String(body?.note ?? "").trim() || null;

    const { data: updated, error: updateErr } = await supabase
      .from("class_climate_entries")
      .update({
        severity,
        note,
        updated_at: new Date().toISOString(),
      })
      .eq("id", entryId)
      .select("id,severity,source,category_key,category_label,item_text,note,created_at,updated_at")
      .single();

    if (updateErr || !updated) return fail("Eintrag konnte nicht aktualisiert werden", 400, updateErr?.message);

    return ok({ entry: updated });
  } catch (error) {
    return fail("Interner Fehler", 500, String(error));
  }
});

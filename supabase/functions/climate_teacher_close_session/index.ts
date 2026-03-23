import {
  corsHeaders,
  fail,
  getAdminClient,
  getBearerToken,
  getCaller,
  getTeacherProfileByUserId,
  ok,
} from "../_shared/common.ts";

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

    const sessionId = String(body?.session_id ?? "").trim();
    if (!sessionId) return fail("session_id fehlt", 400);

    const { data: session, error: sessionErr } = await supabase
      .from("class_climate_sessions")
      .select("id,teacher_id,status")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionErr) return fail("Tagesprotokoll konnte nicht geladen werden", 400, sessionErr.message);
    if (!session) return fail("Tagesprotokoll nicht gefunden", 404);
    if (session.teacher_id !== teacher.id) return fail("Dieses Tagesprotokoll gehört nicht zur Lehrkraft", 403);
    if (session.status === "closed") return ok({ session });

    const { data: closed, error: closeErr } = await supabase
      .from("class_climate_sessions")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .select("id,protocol_date,status,started_at,closed_at")
      .single();

    if (closeErr || !closed) return fail("Tagesprotokoll konnte nicht geschlossen werden", 400, closeErr?.message);

    await supabase
      .from("class_climate_student_usage")
      .delete()
      .eq("session_id", sessionId);

    return ok({ session: closed });
  } catch (error) {
    return fail("Interner Fehler", 500, String(error));
  }
});

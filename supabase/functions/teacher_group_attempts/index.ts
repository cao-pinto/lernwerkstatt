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
    let profile = await getTeacherProfileByUserId(supabase, caller.id);
    if ((!profile?.id || !profile.school_id) && body?.teacher_id) {
      const { data: fallbackTeacher } = await supabase
        .from("teachers")
        .select("id,user_id,display_name,school_id,role")
        .eq("id", String(body.teacher_id))
        .maybeSingle();
      profile = fallbackTeacher || profile;
    }
    if (!profile?.id || !profile.school_id) return fail("Kein Lehrerprofil gefunden", 403, { auth_user_id: caller.id });

    const groupId = String(body?.group_id ?? "").trim();
    if (!groupId) return fail("group_id fehlt", 400);

    const { data: group, error: groupErr } = await supabase
      .from("teacher_groups")
      .select("id,teacher_id,school_id")
      .eq("id", groupId)
      .maybeSingle();

    if (groupErr) return fail("Gruppe konnte nicht geladen werden", 400, groupErr.message);
    if (!group) return fail("Gruppe nicht gefunden", 404);

    const canRead = group.teacher_id === profile.id
      || (group.school_id === profile.school_id && profile.role === "manager");
    if (!canRead) return fail("Keine Berechtigung fuer diese Gruppe", 403);

    const { data: links, error: linkErr } = await supabase
      .from("teacher_group_students")
      .select("student_id")
      .eq("group_id", groupId);

    if (linkErr) return fail("Gruppenmitglieder konnten nicht geladen werden", 400, linkErr.message);

    const studentIds = Array.from(new Set((links || []).map((x) => String(x.student_id)).filter(Boolean)));
    if (!studentIds.length) return ok({ attempts: [] });

    const { data: attempts, error: attemptsErr } = await supabase
      .from("attempts")
      .select("student_id,game,mode,correct_count,wrong_count,total_count,accuracy,created_at")
      .in("student_id", studentIds)
      .order("created_at", { ascending: false });

    if (attemptsErr) return fail("Versuche konnten nicht geladen werden", 400, attemptsErr.message);

    return ok({ attempts: attempts || [] });
  } catch (e) {
    return fail("Interner Fehler", 500, String(e));
  }
});

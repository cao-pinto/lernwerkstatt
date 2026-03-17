import {
  corsHeaders,
  fail,
  getAdminClient,
  getBearerToken,
  getCaller,
  getTeacherProfileByUserId,
  ok,
} from "../_shared/common.ts";

function parseWeek(raw: unknown): number {
  const week = Number(raw);
  if (!Number.isInteger(week) || week < 1 || week > 40) {
    throw new Error("school_week muss zwischen 1 und 40 liegen");
  }
  return week;
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

    let schoolWeek = 0;
    try {
      schoolWeek = parseWeek(body?.school_week);
    } catch (err) {
      return fail(String(err instanceof Error ? err.message : err), 400);
    }

    const { data: group, error: groupErr } = await supabase
      .from("teacher_groups")
      .select("id,teacher_id,school_id")
      .eq("id", groupId)
      .maybeSingle();

    if (groupErr) return fail("Gruppe konnte nicht geladen werden", 400, groupErr.message);
    if (!group) return fail("Gruppe nicht gefunden", 404);
    if (group.teacher_id !== profile.id) return fail("Nur die zugeordnete Lehrkraft darf diese Woche zuruecksetzen", 403);
    if (group.school_id !== profile.school_id) return fail("Gruppe gehoert nicht zur Schule der Lehrkraft", 403);

    const { data: rounds, error: roundErr } = await supabase
      .from("feedback_rounds")
      .select("id")
      .eq("group_id", groupId)
      .eq("school_week", schoolWeek);

    if (roundErr) return fail("Rueckmeldungsrunden konnten nicht geladen werden", 400, roundErr.message);
    if (!(rounds || []).length) return ok({ deleted_round_count: 0, school_week: schoolWeek });

    const roundIds = rounds.map((x) => x.id);
    const { error: deleteErr } = await supabase
      .from("feedback_rounds")
      .delete()
      .in("id", roundIds);

    if (deleteErr) return fail("Rueckmeldungswoche konnte nicht zurueckgesetzt werden", 400, deleteErr.message);

    return ok({
      deleted_round_count: roundIds.length,
      school_week: schoolWeek,
    });
  } catch (e) {
    return fail("Interner Fehler", 500, String(e));
  }
});

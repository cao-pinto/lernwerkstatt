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
    const presentStudentIds = Array.isArray(body?.present_student_ids)
      ? body.present_student_ids.map((x: unknown) => String(x ?? "").trim()).filter(Boolean)
      : [];

    if (!groupId) return fail("group_id fehlt", 400);

    let schoolWeek = 0;
    try {
      schoolWeek = parseWeek(body?.school_week);
    } catch (err) {
      return fail(String(err instanceof Error ? err.message : err), 400);
    }

    const { data: group, error: groupErr } = await supabase
      .from("teacher_groups")
      .select("id,school_id,teacher_id,name")
      .eq("id", groupId)
      .maybeSingle();

    if (groupErr) return fail("Gruppe konnte nicht geladen werden", 400, groupErr.message);
    if (!group) return fail("Gruppe nicht gefunden", 404);
    if (group.teacher_id !== profile.id) return fail("Nur die zugeordnete Lehrkraft darf die Runde starten", 403);
    if (group.school_id !== profile.school_id) return fail("Gruppe gehoert nicht zur Schule der Lehrkraft", 403);

    const { data: activeRound, error: activeErr } = await supabase
      .from("feedback_rounds")
      .select("id")
      .eq("group_id", groupId)
      .eq("school_week", schoolWeek)
      .eq("status", "active")
      .maybeSingle();

    if (activeErr) return fail("Aktive Runde konnte nicht geprueft werden", 400, activeErr.message);
    if (activeRound) return fail("Fuer diese Gruppe und Schulwoche laeuft bereits eine Runde", 409);

    const { data: links, error: linkErr } = await supabase
      .from("teacher_group_students")
      .select("student_id")
      .eq("group_id", groupId);

    if (linkErr) return fail("Gruppenmitglieder konnten nicht geladen werden", 400, linkErr.message);

    const memberIds = Array.from(new Set((links || []).map((x) => String(x.student_id))));
    if (!memberIds.length) return fail("Die Gruppe enthaelt keine Schueler", 400);

    const requestedPresentIds = presentStudentIds.length ? Array.from(new Set(presentStudentIds)) : memberIds;
    const invalidIds = requestedPresentIds.filter((id) => !memberIds.includes(id));
    if (invalidIds.length) return fail("Anwesenheitsliste enthaelt ungueltige Schueler", 400, invalidIds);
    if (!requestedPresentIds.length) return fail("Es muss mindestens ein anwesender Schueler markiert sein", 400);

    const { data: createdRound, error: roundErr } = await supabase
      .from("feedback_rounds")
      .insert({
        school_id: profile.school_id,
        group_id: groupId,
        teacher_id: profile.id,
        school_week: schoolWeek,
        status: "active",
      })
      .select("id,group_id,school_week,status,started_at")
      .single();

    if (roundErr || !createdRound) {
      return fail("Rueckmeldungsrunde konnte nicht erstellt werden", 400, roundErr?.message);
    }

    const participantRows = memberIds.map((studentId) => ({
      round_id: createdRound.id,
      student_id: studentId,
      is_present: requestedPresentIds.includes(studentId),
      has_voted: false,
      voted_at: null,
    }));

    const { error: participantErr } = await supabase
      .from("feedback_round_participants")
      .insert(participantRows);

    if (participantErr) {
      await supabase.from("feedback_rounds").delete().eq("id", createdRound.id);
      return fail("Teilnehmer konnten nicht angelegt werden", 400, participantErr.message);
    }

    return ok({
      round: createdRound,
      participant_count: memberIds.length,
      present_count: requestedPresentIds.length,
    });
  } catch (e) {
    return fail("Interner Fehler", 500, String(e));
  }
});

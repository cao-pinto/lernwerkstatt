import {
  corsHeaders,
  fail,
  getAdminClient,
  getBearerToken,
  getCaller,
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
    let { data: student, error: studentErr } = await supabase
      .from("students")
      .select("id,display_name,class_name,user_id")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (!student && body?.student_id) {
      const fallback = await supabase
        .from("students")
        .select("id,display_name,class_name,user_id")
        .eq("id", String(body.student_id))
        .maybeSingle();
      student = fallback.data || student;
      studentErr = fallback.error || studentErr;
    }

    if (studentErr) return fail("Schuelerprofil konnte nicht geladen werden", 400, studentErr.message);
    if (!student) return fail("Kein Schuelerprofil gefunden", 403, { auth_user_id: caller.id });

    const { data: participantRows, error: participantErr } = await supabase
      .from("feedback_round_participants")
      .select("round_id,is_present,has_voted,voted_at")
      .eq("student_id", student.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (participantErr) return fail("Teilnehmerstatus konnte nicht geladen werden", 400, participantErr.message);
    if (!(participantRows || []).length) {
      return ok({
        student: {
          id: student.id,
          display_name: student.display_name,
          class_name: student.class_name,
        },
        round: null,
      });
    }

    const roundIds = Array.from(new Set((participantRows || []).map((x) => x.round_id)));
    const { data: rounds, error: roundErr } = await supabase
      .from("feedback_rounds")
      .select("id,group_id,school_week,status,created_at")
      .in("id", roundIds)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (roundErr) return fail("Runde konnte nicht geladen werden", 400, roundErr.message);
    const round = (rounds || [])[0] || null;
    if (!round) {
      return ok({
        student: {
          id: student.id,
          display_name: student.display_name,
          class_name: student.class_name,
        },
        round: null,
      });
    }

    const participant = (participantRows || []).find((row) => row.round_id === round.id);
    if (!participant) return fail("Teilnehmerstatus fuer aktive Runde fehlt", 400);

    const { data: group, error: groupErr } = await supabase
      .from("teacher_groups")
      .select("id,name")
      .eq("id", round.group_id)
      .maybeSingle();

    if (groupErr) return fail("Gruppenname konnte nicht geladen werden", 400, groupErr.message);

    const { data: allParticipants, error: allParticipantsErr } = await supabase
      .from("feedback_round_participants")
      .select("student_id,is_present")
      .eq("round_id", round.id)
      .eq("is_present", true);

    if (allParticipantsErr) return fail("Teilnehmerliste konnte nicht geladen werden", 400, allParticipantsErr.message);

    const otherIds = (allParticipants || [])
      .map((x) => String(x.student_id))
      .filter((id) => id !== student.id);

    const { data: others, error: othersErr } = otherIds.length
      ? await supabase
        .from("students")
        .select("id,display_name,class_name")
        .in("id", otherIds)
      : { data: [], error: null };

    if (othersErr) return fail("Mitschueler konnten nicht geladen werden", 400, othersErr.message);

    const selectableStudents = (others || []).sort((a, b) =>
      String(a.display_name || "").localeCompare(String(b.display_name || ""), "de")
    );

    return ok({
      student: {
        id: student.id,
        display_name: student.display_name,
        class_name: student.class_name,
      },
      round: {
        id: round.id,
        group_id: round.group_id,
        group_name: group?.name ?? "—",
        school_week: round.school_week,
        is_present: !!participant.is_present,
        has_voted: !!participant.has_voted,
        voted_at: participant.voted_at ?? null,
      },
      selectable_students: selectableStudents,
    });
  } catch (e) {
    return fail("Interner Fehler", 500, String(e));
  }
});

import {
  corsHeaders,
  fail,
  getAdminClient,
  getBearerToken,
  getCaller,
  ok,
} from "../_shared/common.ts";

function normalizeReason(raw: unknown): string | null {
  const text = String(raw ?? "").trim().replace(/\s+/g, " ");
  return text ? text : null;
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
    let { data: student, error: studentErr } = await supabase
      .from("students")
      .select("id,display_name,user_id")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (!student && body?.student_id) {
      const fallback = await supabase
        .from("students")
        .select("id,display_name,user_id")
        .eq("id", String(body.student_id))
        .maybeSingle();
      student = fallback.data || student;
      studentErr = fallback.error || studentErr;
    }

    if (studentErr) return fail("Schuelerprofil konnte nicht geladen werden", 400, studentErr.message);
    if (!student) return fail("Kein Schuelerprofil gefunden", 403, { auth_user_id: caller.id });
    const roundId = String(body?.round_id ?? "").trim();
    const targetStudentId = String(body?.target_student_id ?? "").trim() || null;
    const reason = normalizeReason(body?.reason);

    if (!roundId) return fail("round_id fehlt", 400);
    if (targetStudentId && !reason) return fail("Bitte eine Begruendung angeben", 400);
    if (!targetStudentId && reason) return fail("Eine Begruendung ist nur mit Schuelerauswahl erlaubt", 400);

    const { data: round, error: roundErr } = await supabase
      .from("feedback_rounds")
      .select("id,status")
      .eq("id", roundId)
      .maybeSingle();

    if (roundErr) return fail("Runde konnte nicht geladen werden", 400, roundErr.message);
    if (!round || round.status !== "active") return fail("Diese Rueckmeldungsrunde ist nicht mehr aktiv", 400);

    const { data: participant, error: participantErr } = await supabase
      .from("feedback_round_participants")
      .select("round_id,student_id,is_present,has_voted")
      .eq("round_id", roundId)
      .eq("student_id", student.id)
      .maybeSingle();

    if (participantErr) return fail("Teilnehmerstatus konnte nicht geladen werden", 400, participantErr.message);
    if (!participant) return fail("Du bist nicht Teil dieser Rueckmeldungsrunde", 403);
    if (!participant.is_present) return fail("Du bist fuer diese Runde nicht als anwesend markiert", 403);
    if (participant.has_voted) return fail("Du hast bereits abgestimmt", 409);

    if (targetStudentId) {
      if (targetStudentId === student.id) return fail("Du kannst dich nicht selbst auswaehlen", 400);

      const { data: targetParticipant, error: targetErr } = await supabase
        .from("feedback_round_participants")
        .select("student_id,is_present")
        .eq("round_id", roundId)
        .eq("student_id", targetStudentId)
        .maybeSingle();

      if (targetErr) return fail("Ausgewaehlter Schueler konnte nicht geprueft werden", 400, targetErr.message);
      if (!targetParticipant || !targetParticipant.is_present) {
        return fail("Der ausgewaehlte Schueler ist in dieser Runde nicht verfuegbar", 400);
      }
    }

    const { error: voteErr } = await supabase
      .from("feedback_votes")
      .insert({
        round_id: roundId,
        voter_student_id: student.id,
        target_student_id: targetStudentId,
        reason,
      });

    if (voteErr) return fail("Rueckmeldung konnte nicht gespeichert werden", 400, voteErr.message);

    const { error: updateErr } = await supabase
      .from("feedback_round_participants")
      .update({ has_voted: true, voted_at: new Date().toISOString() })
      .eq("round_id", roundId)
      .eq("student_id", student.id);

    if (updateErr) return fail("Stimmstatus konnte nicht aktualisiert werden", 400, updateErr.message);

    return ok({
      success: true,
      message: "Deine Rueckmeldung wurde gespeichert.",
      voted_for_student: !!targetStudentId,
    });
  } catch (e) {
    return fail("Interner Fehler", 500, String(e));
  }
});

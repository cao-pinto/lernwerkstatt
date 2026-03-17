import {
  corsHeaders,
  fail,
  getAdminClient,
  getBearerToken,
  getCaller,
  getTeacherProfileByUserId,
  ok,
} from "../_shared/common.ts";

function sortByName<T extends { display_name: string | null }>(rows: T[]): T[] {
  return rows.sort((a, b) => String(a.display_name || "").localeCompare(String(b.display_name || ""), "de"));
}

async function buildClosedSummary(supabase: ReturnType<typeof getAdminClient>, roundId: string) {
  const { data: votes, error: votesErr } = await supabase
    .from("feedback_votes")
    .select("target_student_id,reason")
    .eq("round_id", roundId);

  if (votesErr) throw new Error(`Stimmen konnten nicht geladen werden: ${votesErr.message}`);

  const targetIds = Array.from(new Set((votes || []).map((x) => x.target_student_id).filter(Boolean)));
  const { data: targets, error: targetErr } = targetIds.length
    ? await supabase
      .from("students")
      .select("id,display_name,class_name")
      .in("id", targetIds)
    : { data: [], error: null };

  if (targetErr) throw new Error(`Schueler fuer Zusammenfassung konnten nicht geladen werden: ${targetErr.message}`);

  const targetMap = new Map((targets || []).map((x) => [x.id, x]));
  const grouped = new Map<string, { target_student_id: string; display_name: string | null; class_name: string | null; count: number; reasons: string[] }>();
  let noFeedbackCount = 0;

  for (const vote of votes || []) {
    if (!vote.target_student_id) {
      noFeedbackCount += 1;
      continue;
    }

    const student = targetMap.get(vote.target_student_id) || null;
    const existing = grouped.get(vote.target_student_id) || {
      target_student_id: vote.target_student_id,
      display_name: student?.display_name ?? null,
      class_name: student?.class_name ?? null,
      count: 0,
      reasons: [],
    };

    existing.count += 1;
    if (String(vote.reason || "").trim()) existing.reasons.push(String(vote.reason).trim());
    grouped.set(vote.target_student_id, existing);
  }

  return {
    no_feedback_count: noFeedbackCount,
    results: Array.from(grouped.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(a.display_name || "").localeCompare(String(b.display_name || ""), "de");
    }),
  };
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
    if (!profile?.id && body?.teacher_id) {
      const { data: fallbackTeacher } = await supabase
        .from("teachers")
        .select("id,user_id,display_name,school_id,role")
        .eq("id", String(body.teacher_id))
        .maybeSingle();
      profile = fallbackTeacher || profile;
    }
    if (!profile?.id) return fail("Kein Lehrerprofil gefunden", 403, { auth_user_id: caller.id });
    const roundId = String(body?.round_id ?? "").trim();
    const groupId = String(body?.group_id ?? "").trim();
    const schoolWeek = Number(body?.school_week);

    let roundQuery = supabase
      .from("feedback_rounds")
      .select("id,group_id,teacher_id,school_week,status,started_at,closed_at,created_at");

    if (roundId) {
      roundQuery = roundQuery.eq("id", roundId);
    } else {
      if (!groupId) return fail("group_id oder round_id fehlt", 400);
      if (!Number.isInteger(schoolWeek) || schoolWeek < 1 || schoolWeek > 40) {
        return fail("school_week muss zwischen 1 und 40 liegen", 400);
      }
      roundQuery = roundQuery.eq("group_id", groupId).eq("school_week", schoolWeek).order("created_at", { ascending: false }).limit(1);
    }

    const { data: round, error: roundErr } = await roundQuery.maybeSingle();
    if (roundErr) return fail("Runde konnte nicht geladen werden", 400, roundErr.message);
    if (!round) return ok({ round: null });
    if (round.teacher_id !== profile.id) return fail("Nur die zugeordnete Lehrkraft darf diese Runde sehen", 403);

    const { data: group, error: groupErr } = await supabase
      .from("teacher_groups")
      .select("id,name")
      .eq("id", round.group_id)
      .maybeSingle();

    if (groupErr) return fail("Gruppenname konnte nicht geladen werden", 400, groupErr.message);

    const { data: participants, error: participantErr } = await supabase
      .from("feedback_round_participants")
      .select("student_id,is_present,has_voted,voted_at")
      .eq("round_id", round.id);

    if (participantErr) return fail("Teilnehmer konnten nicht geladen werden", 400, participantErr.message);

    const studentIds = Array.from(new Set((participants || []).map((x) => x.student_id)));
    const { data: students, error: studentErr } = studentIds.length
      ? await supabase
        .from("students")
        .select("id,display_name,class_name")
        .in("id", studentIds)
      : { data: [], error: null };

    if (studentErr) return fail("Schueler konnten nicht geladen werden", 400, studentErr.message);
    const studentMap = new Map((students || []).map((x) => [x.id, x]));

    const participantRows = sortByName((participants || []).map((row) => {
      const student = studentMap.get(row.student_id) || null;
      return {
        student_id: row.student_id,
        display_name: student?.display_name ?? null,
        class_name: student?.class_name ?? null,
        is_present: !!row.is_present,
        has_voted: !!row.has_voted,
        voted_at: row.voted_at ?? null,
      };
    }));

    const presentCount = participantRows.filter((x) => x.is_present).length;
    const votedCount = participantRows.filter((x) => x.is_present && x.has_voted).length;

    const response: Record<string, unknown> = {
      round: {
        ...round,
        group_name: group?.name ?? "—",
      },
      participants: participantRows,
      progress: {
        total_count: participantRows.length,
        present_count: presentCount,
        voted_count: votedCount,
        open_count: Math.max(0, presentCount - votedCount),
      },
    };

    if (round.status === "closed") {
      response.summary = await buildClosedSummary(supabase, round.id);
    }

    return ok(response);
  } catch (e) {
    return fail("Interner Fehler", 500, String(e));
  }
});

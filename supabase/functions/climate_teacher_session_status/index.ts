import {
  corsHeaders,
  fail,
  getAdminClient,
  getBearerToken,
  getCaller,
  getTeacherProfileByUserId,
  ok,
} from "../_shared/common.ts";

function normalizeDate(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("protocol_date muss im Format YYYY-MM-DD gesendet werden");
  }
  return value;
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

    const groupId = String(body?.group_id ?? "").trim();
    if (!groupId) return fail("group_id fehlt", 400);

    let protocolDate = "";
    try {
      protocolDate = normalizeDate(body?.protocol_date);
    } catch (error) {
      return fail(String(error instanceof Error ? error.message : error), 400);
    }

    const { data: group, error: groupErr } = await supabase
      .from("teacher_groups")
      .select("id,name,school_id,teacher_id")
      .eq("id", groupId)
      .maybeSingle();

    if (groupErr) return fail("Gruppe konnte nicht geladen werden", 400, groupErr.message);
    if (!group) return fail("Gruppe nicht gefunden", 404);
    if (group.teacher_id !== teacher.id) return fail("Diese Gruppe gehört nicht zur Lehrkraft", 403);

    const { data: session, error: sessionErr } = await supabase
      .from("class_climate_sessions")
      .select("id,protocol_date,status,started_at,closed_at,group_id")
      .eq("group_id", groupId)
      .eq("protocol_date", protocolDate)
      .maybeSingle();

    if (sessionErr) return fail("Tagesprotokoll konnte nicht geladen werden", 400, sessionErr.message);

    if (!session) {
      const { data: memberLinks, error: memberLinkErr } = await supabase
        .from("teacher_group_students")
        .select("student_id")
        .eq("group_id", groupId);

      if (memberLinkErr) return fail("Gruppenschüler konnten nicht geladen werden", 400, memberLinkErr.message);
      const studentIds = (memberLinks || []).map((row) => String(row.student_id));
      const { data: students, error: studentsErr } = studentIds.length
        ? await supabase
          .from("students")
          .select("id,display_name,class_name")
          .in("id", studentIds)
          .order("display_name", { ascending: true })
        : { data: [], error: null };

      if (studentsErr) return fail("Schüler konnten nicht geladen werden", 400, studentsErr.message);

      const { data: behaviorRows, error: behaviorErr } = studentIds.length
        ? await supabase
          .from("student_behavior_statuses")
          .select("student_id,points,teacher_note,updated_at")
          .in("student_id", studentIds)
        : { data: [], error: null };

      if (behaviorErr) return fail("Verhaltensstatus konnte nicht geladen werden", 400, behaviorErr.message);
      const behaviorMap = new Map((behaviorRows || []).map((row) => [String(row.student_id), row]));

      return ok({
        teacher: {
          id: teacher.id,
          display_name: teacher.display_name,
          school_id: teacher.school_id,
        },
        group: {
          id: group.id,
          name: group.name,
        },
        session: null,
        entries: [],
        behavior_statuses: (students || []).map((student) => ({
          student_id: student.id,
          display_name: student.display_name,
          class_name: student.class_name,
          points: Number(behaviorMap.get(String(student.id))?.points || 0),
          teacher_note: behaviorMap.get(String(student.id))?.teacher_note || null,
          updated_at: behaviorMap.get(String(student.id))?.updated_at || null,
        })),
      });
    }

    const { data: entries, error: entriesErr } = await supabase
      .from("class_climate_entries")
      .select("id,severity,category_key,category_label,item_text,note,created_at,updated_at")
      .eq("session_id", session.id)
      .order("created_at", { ascending: false });

    if (entriesErr) return fail("Einträge konnten nicht geladen werden", 400, entriesErr.message);

    const { data: memberLinks, error: memberLinkErr } = await supabase
      .from("teacher_group_students")
      .select("student_id")
      .eq("group_id", groupId);

    if (memberLinkErr) return fail("Gruppenschüler konnten nicht geladen werden", 400, memberLinkErr.message);
    const studentIds = (memberLinks || []).map((row) => String(row.student_id));
    const { data: students, error: studentsErr } = studentIds.length
      ? await supabase
        .from("students")
        .select("id,display_name,class_name")
        .in("id", studentIds)
        .order("display_name", { ascending: true })
      : { data: [], error: null };

    if (studentsErr) return fail("Schüler konnten nicht geladen werden", 400, studentsErr.message);

    const { data: behaviorRows, error: behaviorErr } = studentIds.length
      ? await supabase
        .from("student_behavior_statuses")
        .select("student_id,points,teacher_note,updated_at")
        .in("student_id", studentIds)
      : { data: [], error: null };

    if (behaviorErr) return fail("Verhaltensstatus konnte nicht geladen werden", 400, behaviorErr.message);
    const behaviorMap = new Map((behaviorRows || []).map((row) => [String(row.student_id), row]));

    return ok({
      teacher: {
        id: teacher.id,
        display_name: teacher.display_name,
        school_id: teacher.school_id,
      },
      group: {
        id: group.id,
        name: group.name,
      },
      session,
      entries: entries || [],
      behavior_statuses: (students || []).map((student) => ({
        student_id: student.id,
        display_name: student.display_name,
        class_name: student.class_name,
        points: Number(behaviorMap.get(String(student.id))?.points || 0),
        teacher_note: behaviorMap.get(String(student.id))?.teacher_note || null,
        updated_at: behaviorMap.get(String(student.id))?.updated_at || null,
      })),
    });
  } catch (error) {
    return fail("Interner Fehler", 500, String(error));
  }
});

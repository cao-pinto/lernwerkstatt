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
  if (!Number.isInteger(points)) throw new Error("points muss eine ganze Zahl sein");
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

    const groupId = String(body?.group_id ?? "").trim();
    const studentId = String(body?.student_id ?? "").trim();
    const teacherNote = String(body?.teacher_note ?? "").trim() || null;
    if (!groupId || !studentId) return fail("group_id und student_id sind erforderlich", 400);

    let points = 0;
    try {
      points = clampPoints(body?.points);
    } catch (error) {
      return fail(String(error instanceof Error ? error.message : error), 400);
    }

    const { data: group, error: groupErr } = await supabase
      .from("teacher_groups")
      .select("id,school_id,teacher_id")
      .eq("id", groupId)
      .maybeSingle();

    if (groupErr) return fail("Gruppe konnte nicht geladen werden", 400, groupErr.message);
    if (!group) return fail("Gruppe nicht gefunden", 404);
    if (group.teacher_id !== teacher.id) return fail("Diese Gruppe gehört nicht zur Lehrkraft", 403);

    const link = await supabase
      .from("teacher_group_students")
      .select("student_id")
      .eq("group_id", groupId)
      .eq("student_id", studentId)
      .maybeSingle();

    if (link.error) return fail("Gruppenzuordnung konnte nicht geladen werden", 400, link.error.message);
    if (!link.data) return fail("Schüler gehört nicht zur gewählten Gruppe", 403);

    const student = await supabase
      .from("students")
      .select("id,display_name,school_id,class_name")
      .eq("id", studentId)
      .maybeSingle();

    if (student.error) return fail("Schülerprofil konnte nicht geladen werden", 400, student.error.message);
    if (!student.data) return fail("Schüler nicht gefunden", 404);
    if (student.data.school_id !== teacher.school_id) return fail("Schüler gehört nicht zur Schule der Lehrkraft", 403);

    const { data: updated, error: upsertErr } = await supabase
      .from("student_behavior_statuses")
      .upsert({
        student_id: studentId,
        school_id: teacher.school_id,
        points,
        teacher_note: teacherNote,
        updated_by_teacher_id: teacher.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "student_id" })
      .select("student_id,points,teacher_note,updated_at")
      .single();

    if (upsertErr || !updated) return fail("Verhaltensstatus konnte nicht gespeichert werden", 400, upsertErr?.message);

    return ok({
      student: {
        id: student.data.id,
        display_name: student.data.display_name,
        class_name: student.data.class_name,
      },
      behavior_status: updated,
    });
  } catch (error) {
    return fail("Interner Fehler", 500, String(error));
  }
});

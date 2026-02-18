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

    const caller = await getCaller(supabase, token);
    const profile = await getTeacherProfileByUserId(supabase, caller.id);
    if (!profile || profile.role !== "manager" || !profile.school_id) {
      return fail("Nur Digital Learning Manager erlaubt", 403);
    }

    const body = await req.json().catch(() => ({}));
    const student_id = String(body?.student_id ?? "").trim();
    if (!student_id) return fail("student_id fehlt", 400);

    const { data: student, error: studentErr } = await supabase
      .from("students")
      .select("*")
      .eq("id", student_id)
      .maybeSingle();

    if (studentErr) return fail("Fehler beim Laden des Schülers", 400, studentErr.message);
    if (!student) return fail("Schüler nicht gefunden", 404);
    if (student.school_id !== profile.school_id) return fail("Schüler gehört nicht zur Schule des Managers", 403);

    // Explicit cleanup (safe even if cascades also exist)
    await supabase.from("teacher_group_students").delete().eq("student_id", student_id);
    await supabase.from("attempts").delete().eq("student_id", student_id);

    const { error: delStudentErr } = await supabase.from("students").delete().eq("id", student_id);
    if (delStudentErr) return fail("Schüler konnte nicht gelöscht werden", 400, delStudentErr.message);

    let deletedAuthUser = false;
    if (student.user_id) {
      const { error: delAuthErr } = await supabase.auth.admin.deleteUser(student.user_id);
      if (!delAuthErr) deletedAuthUser = true;
    }

    return ok({
      deleted_student_id: student_id,
      deleted_auth_user: deletedAuthUser,
    });
  } catch (e) {
    return fail("Interner Fehler", 500, String(e));
  }
});

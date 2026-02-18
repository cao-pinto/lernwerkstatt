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
    const teacher_id = String(body?.teacher_id ?? "").trim();
    if (!teacher_id) return fail("teacher_id fehlt", 400);
    if (teacher_id === profile.id) return fail("Manager kann sich nicht selbst löschen", 400);

    const { data: target, error: targetErr } = await supabase
      .from("teachers")
      .select("id,user_id,school_id,role")
      .eq("id", teacher_id)
      .maybeSingle();

    if (targetErr) return fail("Fehler beim Laden des Lehrers", 400, targetErr.message);
    if (!target) return fail("Lehrer nicht gefunden", 404);
    if (target.school_id !== profile.school_id) return fail("Lehrer gehört nicht zur Schule des Managers", 403);
    if (target.role !== "teacher") return fail("Es können nur Lehrer (nicht Manager) gelöscht werden", 400);

    // Fallback cleanup in case old schema has no ON DELETE CASCADE for groups.
    const { data: groups } = await supabase.from("teacher_groups").select("id").eq("teacher_id", teacher_id);
    const groupIds = (groups || []).map((g) => g.id);
    if (groupIds.length) {
      await supabase.from("teacher_group_students").delete().in("group_id", groupIds);
      await supabase.from("teacher_groups").delete().in("id", groupIds);
    }

    const { error: deleteTeacherErr } = await supabase.from("teachers").delete().eq("id", teacher_id);
    if (deleteTeacherErr) return fail("Lehrer konnte nicht gelöscht werden", 400, deleteTeacherErr.message);

    let deletedAuthUser = false;
    if (target.user_id) {
      const { error: deleteAuthErr } = await supabase.auth.admin.deleteUser(target.user_id);
      if (!deleteAuthErr) deletedAuthUser = true;
    }

    return ok({
      deleted_teacher_id: teacher_id,
      deleted_groups: groupIds.length,
      deleted_auth_user: deletedAuthUser,
    });
  } catch (e) {
    return fail("Interner Fehler", 500, String(e));
  }
});

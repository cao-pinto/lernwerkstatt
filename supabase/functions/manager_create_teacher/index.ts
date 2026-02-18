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
    if (!profile) return fail("Kein Lehrerprofil gefunden", 403);
    if (profile.role !== "manager") return fail("Nur Digital Learning Manager erlaubt", 403);
    if (!profile.school_id) return fail("Manager hat keine Schule zugeordnet", 400);

    const body = await req.json().catch(() => ({}));
    const display_name = String(body?.display_name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "").trim();
    const requestedSchool = String(body?.school_id ?? "").trim();

    if (!display_name || !email || !password) {
      return fail("Pflichtfelder fehlen: display_name, email, password", 400);
    }
    if (requestedSchool && requestedSchool !== profile.school_id) {
      return fail("school_id passt nicht zur Schule des Managers", 403);
    }

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { app_role: "teacher" },
    });
    if (createErr || !created.user) return fail("Auth-User konnte nicht erstellt werden", 400, createErr?.message);

    const { data: teacherRow, error: teacherErr } = await supabase
      .from("teachers")
      .insert({
        user_id: created.user.id,
        display_name,
        school_id: profile.school_id,
        role: "teacher",
        created_by_teacher_id: profile.id,
      })
      .select("id,user_id,display_name,school_id,role,created_by_teacher_id")
      .single();

    if (teacherErr) {
      await supabase.auth.admin.deleteUser(created.user.id);
      return fail("Lehrer-Profil konnte nicht erstellt werden", 400, teacherErr.message);
    }

    return ok({ teacher: teacherRow });
  } catch (e) {
    return fail("Interner Fehler", 500, String(e));
  }
});

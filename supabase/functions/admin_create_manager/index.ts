import {
  corsHeaders,
  fail,
  getAdminClient,
  getBearerToken,
  getCaller,
  isAllowedAdmin,
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
    if (!isAllowedAdmin(caller.email)) {
      return fail(
        "Nicht erlaubt. Setze ADMIN_EMAILS als kommaseparierte Liste (z. B. admin@schule.at).",
        403,
      );
    }

    const body = await req.json().catch(() => ({}));
    const school_id = String(body?.school_id ?? "").trim();
    const display_name = String(body?.display_name ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "").trim();

    if (!school_id || !display_name || !email || !password) {
      return fail("Pflichtfelder fehlen: school_id, display_name, email, password", 400);
    }

    const { data: school, error: schoolErr } = await supabase
      .from("schools")
      .select("id,name")
      .eq("id", school_id)
      .maybeSingle();
    if (schoolErr) return fail("Fehler beim Laden der Schule", 400, schoolErr.message);
    if (!school) return fail("Schule nicht gefunden", 404);

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { app_role: "manager" },
    });
    if (createErr || !created.user) return fail("Auth-User konnte nicht erstellt werden", 400, createErr?.message);

    const { data: teacherRow, error: teacherErr } = await supabase
      .from("teachers")
      .insert({
        user_id: created.user.id,
        display_name,
        school_id,
        role: "manager",
      })
      .select("id,user_id,display_name,school_id,role")
      .single();

    if (teacherErr) {
      await supabase.auth.admin.deleteUser(created.user.id);
      return fail("Manager-Profil konnte nicht erstellt werden", 400, teacherErr.message);
    }

    return ok({
      manager: teacherRow,
      school,
      created_by: caller.email,
    });
  } catch (e) {
    return fail("Interner Fehler", 500, String(e));
  }
});

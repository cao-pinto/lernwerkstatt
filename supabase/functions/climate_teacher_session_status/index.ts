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
      });
    }

    const { data: entries, error: entriesErr } = await supabase
      .from("class_climate_entries")
      .select("id,severity,category_key,category_label,item_text,note,created_at,updated_at")
      .eq("session_id", session.id)
      .order("created_at", { ascending: false });

    if (entriesErr) return fail("Einträge konnten nicht geladen werden", 400, entriesErr.message);

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
    });
  } catch (error) {
    return fail("Interner Fehler", 500, String(error));
  }
});

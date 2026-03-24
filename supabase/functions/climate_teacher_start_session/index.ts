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

    const { data: existing, error: existingErr } = await supabase
      .from("class_climate_sessions")
      .select("id,status")
      .eq("group_id", groupId)
      .eq("protocol_date", protocolDate)
      .maybeSingle();

    if (existingErr) return fail("Vorhandenes Tagesprotokoll konnte nicht geprüft werden", 400, existingErr.message);
    if (existing) {
      if (existing.status === "active") {
        return ok({
          session: {
            id: existing.id,
            protocol_date: protocolDate,
            status: "active",
          },
          group: {
            id: group.id,
            name: group.name,
          },
        });
      }

      const reopened = await supabase
        .from("class_climate_sessions")
        .update({
          status: "active",
          closed_at: null,
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select("id,protocol_date,status,started_at,closed_at")
        .single();

      if (reopened.error || !reopened.data) {
        return fail("Geschlossenes Tagesprotokoll konnte nicht fortgesetzt werden", 400, reopened.error?.message);
      }

      return ok({
        session: reopened.data,
        group: {
          id: group.id,
          name: group.name,
        },
      });
    }

    const { data: created, error: createErr } = await supabase
      .from("class_climate_sessions")
      .insert({
        school_id: teacher.school_id,
        group_id: groupId,
        teacher_id: teacher.id,
        protocol_date: protocolDate,
        status: "active",
      })
      .select("id,protocol_date,status,started_at,closed_at")
      .single();

    if (createErr || !created) return fail("Tagesprotokoll konnte nicht gestartet werden", 400, createErr?.message);

    return ok({
      session: created,
      group: {
        id: group.id,
        name: group.name,
      },
    });
  } catch (error) {
    return fail("Interner Fehler", 500, String(error));
  }
});

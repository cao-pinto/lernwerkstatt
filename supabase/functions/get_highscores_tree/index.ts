import { corsHeaders, fail, getAdminClient, ok } from "../_shared/common.ts";

type AttemptRow = { student_id: string; correct_count: number | null };
type StudentRow = { id: string; school_id: string | null; display_name: string | null };
type TreeMode = "tree10" | "tree100" | "tree_int10" | "tree_int100";

function parseStudentId(body: unknown): string | null {
  const id = String((body as { student_id?: string } | null)?.student_id ?? "").trim();
  return /^[0-9a-fA-F-]{36}$/.test(id) ? id : null;
}

async function loadAttemptsForMode(
  supabase: ReturnType<typeof getAdminClient>,
  mode: string,
): Promise<AttemptRow[]> {
  const { data: attempts, error: attemptsErr } = await supabase
    .from("attempts")
    .select("student_id,correct_count")
    .eq("game", "tree")
    .eq("mode", mode)
    .order("correct_count", { ascending: false })
    .limit(5000);

  if (attemptsErr) throw new Error(`attempts ${mode} query fehlgeschlagen: ${attemptsErr.message}`);
  return (attempts || []) as AttemptRow[];
}

async function top10ByMode(
  supabase: ReturnType<typeof getAdminClient>,
  schoolId: string,
  modes: string[],
): Promise<Array<{ name: string; trees: number }>> {
  const chunks = await Promise.all(modes.map((mode) => loadAttemptsForMode(supabase, mode)));
  const rows = chunks.flat();
  const ids = Array.from(new Set(rows.map((r) => r.student_id).filter(Boolean)));
  if (!ids.length) return [];

  const { data: students, error: studentsErr } = await supabase
    .from("students")
    .select("id,school_id,display_name")
    .in("id", ids);

  if (studentsErr) throw new Error(`students ${mode} query fehlgeschlagen: ${studentsErr.message}`);

  const studentMap = new Map<string, StudentRow>();
  for (const s of (students || []) as StudentRow[]) {
    if (s.school_id === schoolId) studentMap.set(s.id, s);
  }

  const bestByStudent = new Map<string, { name: string; trees: number }>();
  for (const r of rows) {
    const s = studentMap.get(r.student_id);
    if (!s) continue;
    const score = Number(r.correct_count || 0);
    const prev = bestByStudent.get(r.student_id);
    if (!prev || score > prev.trees) {
      bestByStudent.set(r.student_id, { name: s.display_name || "—", trees: score });
    }
  }

  return Array.from(bestByStudent.values())
    .sort((a, b) => b.trees - a.trees || a.name.localeCompare(b.name, "de"))
    .slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Nur POST erlaubt", 405);

  try {
    const supabase = getAdminClient();
    const body = await req.json().catch(() => ({}));
    const studentId = parseStudentId(body);
    if (!studentId) return fail("student_id fehlt oder ungültig", 400);

    const { data: me, error: meErr } = await supabase
      .from("students")
      .select("school_id")
      .eq("id", studentId)
      .maybeSingle();

    if (meErr) return fail("student query fehlgeschlagen", 400, meErr.message);
    const schoolId = me?.school_id ? String(me.school_id) : null;
    if (!schoolId) return fail("Schule zum student_id nicht gefunden", 404);

    const [v10, v100, vInt10, vInt100] = await Promise.all([
      top10ByMode(supabase, schoolId, ["tree10"]),
      top10ByMode(supabase, schoolId, ["tree100"]),
      top10ByMode(supabase, schoolId, ["tree_int10", "treeInt10"]),
      top10ByMode(supabase, schoolId, ["tree_int100", "treeInt100"]),
    ]);

    return ok({ ok: true, v10, v100, vInt10, vInt100 });
  } catch (e) {
    return fail("Interner Fehler", 500, String(e));
  }
});

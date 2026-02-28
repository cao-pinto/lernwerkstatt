import { corsHeaders, fail, getAdminClient, ok } from "../_shared/common.ts";

type AttemptRow = { student_id: string; correct_count: number | null };
type StudentRow = { id: string; school_id: string | null; display_name: string | null };

function parseStudentId(body: unknown): string | null {
  const id = String((body as { student_id?: string } | null)?.student_id ?? "").trim();
  return /^[0-9a-fA-F-]{36}$/.test(id) ? id : null;
}

async function top10ByMode(
  supabase: ReturnType<typeof getAdminClient>,
  schoolId: string,
  mode: "small" | "big",
): Promise<Array<{ name: string; correct: number }>> {
  const { data: attempts, error: attemptsErr } = await supabase
    .from("attempts")
    .select("student_id,correct_count")
    .eq("mode", mode)
    .or("game.is.null,game.eq.math")
    .order("correct_count", { ascending: false })
    .limit(5000);

  if (attemptsErr) throw new Error(`attempts ${mode} query fehlgeschlagen: ${attemptsErr.message}`);

  const rows = (attempts || []) as AttemptRow[];
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

  const bestByStudent = new Map<string, { name: string; correct: number }>();
  for (const r of rows) {
    const s = studentMap.get(r.student_id);
    if (!s) continue;
    const score = Number(r.correct_count || 0);
    const prev = bestByStudent.get(r.student_id);
    if (!prev || score > prev.correct) {
      bestByStudent.set(r.student_id, { name: s.display_name || "—", correct: score });
    }
  }

  return Array.from(bestByStudent.values())
    .sort((a, b) => b.correct - a.correct || a.name.localeCompare(b.name, "de"))
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

    const [small, big] = await Promise.all([
      top10ByMode(supabase, schoolId, "small"),
      top10ByMode(supabase, schoolId, "big"),
    ]);

    return ok({ ok: true, small, big });
  } catch (e) {
    return fail("Interner Fehler", 500, String(e));
  }
});

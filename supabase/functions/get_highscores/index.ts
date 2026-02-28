import { corsHeaders, fail, getAdminClient, getBearerToken, getCaller, ok } from "../_shared/common.ts";

type AttemptRow = {
  student_id: string;
  correct_count: number | null;
  students: { id: string; display_name: string | null } | { id: string; display_name: string | null }[] | null;
};

async function getSchoolIdForCaller(supabase: ReturnType<typeof getAdminClient>, userId: string): Promise<string | null> {
  const { data: teacher, error: teacherErr } = await supabase
    .from("teachers")
    .select("school_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (teacherErr) throw new Error(`teacher lookup fehlgeschlagen: ${teacherErr.message}`);
  if (teacher?.school_id) return String(teacher.school_id);

  const { data: student, error: studentErr } = await supabase
    .from("students")
    .select("school_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (studentErr) throw new Error(`student lookup fehlgeschlagen: ${studentErr.message}`);
  if (student?.school_id) return String(student.school_id);

  return null;
}

async function top10ByMode(
  supabase: ReturnType<typeof getAdminClient>,
  schoolId: string,
  mode: "small" | "big",
): Promise<Array<{ name: string; correct: number }>> {
  const { data, error } = await supabase
    .from("attempts")
    .select("student_id,correct_count,students!inner(id,school_id,display_name)")
    .eq("students.school_id", schoolId)
    .eq("mode", mode)
    .or("game.is.null,game.eq.math")
    .order("correct_count", { ascending: false })
    .limit(5000);

  if (error) throw new Error(`attempts ${mode} query fehlgeschlagen: ${error.message}`);

  const rows = (data || []) as AttemptRow[];
  const bestByStudent = new Map<string, { name: string; correct: number }>();

  for (const row of rows) {
    const student = Array.isArray(row.students) ? row.students[0] : row.students;
    if (!student?.id) continue;

    const score = Number(row.correct_count || 0);
    const prev = bestByStudent.get(student.id);
    if (!prev || score > prev.correct) {
      bestByStudent.set(student.id, { name: student.display_name || "—", correct: score });
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
    const token = getBearerToken(req);
    if (!token) return fail("Authorization Bearer Token fehlt", 401);

    const supabase = getAdminClient();
    const caller = await getCaller(supabase, token);
    const schoolId = await getSchoolIdForCaller(supabase, caller.id);

    if (!schoolId) return fail("Keine Schule für diesen Benutzer gefunden", 403);

    const [small, big] = await Promise.all([
      top10ByMode(supabase, schoolId, "small"),
      top10ByMode(supabase, schoolId, "big"),
    ]);

    return ok({ ok: true, small, big });
  } catch (e) {
    return fail("Interner Fehler", 500, String(e));
  }
});

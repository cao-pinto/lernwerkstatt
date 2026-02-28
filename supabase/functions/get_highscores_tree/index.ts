import { corsHeaders, fail, getAdminClient, getBearerToken, getCaller, ok } from "../_shared/common.ts";

type AttemptRow = {
  student_id: string;
  correct_count: number | null;
  students: { id: string; display_name: string | null } | { id: string; display_name: string | null }[] | null;
};

type TreeMode = "tree10" | "tree100" | "treeInt10" | "treeInt100";

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
  mode: TreeMode,
): Promise<Array<{ name: string; trees: number }>> {
  const { data, error } = await supabase
    .from("attempts")
    .select("student_id,correct_count,students!inner(id,school_id,display_name)")
    .eq("students.school_id", schoolId)
    .eq("game", "tree")
    .eq("mode", mode)
    .order("correct_count", { ascending: false })
    .limit(5000);

  if (error) throw new Error(`attempts ${mode} query fehlgeschlagen: ${error.message}`);

  const rows = (data || []) as AttemptRow[];
  const bestByStudent = new Map<string, { name: string; trees: number }>();

  for (const row of rows) {
    const student = Array.isArray(row.students) ? row.students[0] : row.students;
    if (!student?.id) continue;

    const score = Number(row.correct_count || 0);
    const prev = bestByStudent.get(student.id);
    if (!prev || score > prev.trees) {
      bestByStudent.set(student.id, { name: student.display_name || "—", trees: score });
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
    const token = getBearerToken(req);
    if (!token) return fail("Authorization Bearer Token fehlt", 401);

    const supabase = getAdminClient();
    const caller = await getCaller(supabase, token);
    const schoolId = await getSchoolIdForCaller(supabase, caller.id);

    if (!schoolId) return fail("Keine Schule für diesen Benutzer gefunden", 403);

    const [v10, v100, vInt10, vInt100] = await Promise.all([
      top10ByMode(supabase, schoolId, "tree10"),
      top10ByMode(supabase, schoolId, "tree100"),
      top10ByMode(supabase, schoolId, "treeInt10"),
      top10ByMode(supabase, schoolId, "treeInt100"),
    ]);

    return ok({ ok: true, v10, v100, vInt10, vInt100 });
  } catch (e) {
    return fail("Interner Fehler", 500, String(e));
  }
});

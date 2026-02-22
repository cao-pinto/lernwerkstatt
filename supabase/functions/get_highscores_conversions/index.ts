import { corsHeaders, fail, getAdminClient, ok } from "../_shared/common.ts";

type AttemptRow = { student_id: string; correct_count: number | null };
type StudentRow = { id: string; display_name: string | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Nur POST erlaubt", 405);

  try {
    const supabase = getAdminClient();
    const body = await req.json().catch(() => ({}));
    const mode = String(body?.mode ?? "").trim();

    if (!mode) return fail("mode fehlt", 400);
    if (!/^[a-z_]{4,40}$/.test(mode)) return fail("mode ungültig", 400);

    const { data: attempts, error: attemptsErr } = await supabase
      .from("attempts")
      .select("student_id,correct_count")
      .eq("game", "conversion")
      .eq("mode", mode)
      .order("correct_count", { ascending: false })
      .limit(1000);

    if (attemptsErr) return fail("attempts query fehlgeschlagen", 400, attemptsErr.message);

    const rows = (attempts || []) as AttemptRow[];
    if (!rows.length) return ok({ ok: true, mode, top10: [] });

    const ids = Array.from(new Set(rows.map((r) => r.student_id).filter(Boolean)));
    const { data: students, error: studentsErr } = await supabase
      .from("students")
      .select("id,display_name")
      .in("id", ids);

    if (studentsErr) return fail("students query fehlgeschlagen", 400, studentsErr.message);

    const nameById = new Map<string, string>();
    for (const s of ((students || []) as StudentRow[])) {
      nameById.set(s.id, s.display_name || "—");
    }

    const bestByName = new Map<string, number>();
    for (const r of rows) {
      const name = nameById.get(r.student_id) || "—";
      const score = Number(r.correct_count || 0);
      const prev = bestByName.get(name);
      if (prev == null || score > prev) bestByName.set(name, score);
    }

    const top10 = Array.from(bestByName.entries())
      .map(([name, correct]) => ({ name, correct }))
      .sort((a, b) => b.correct - a.correct || a.name.localeCompare(b.name, "de"))
      .slice(0, 10);

    return ok({ ok: true, mode, top10 });
  } catch (e) {
    return fail("Interner Fehler", 500, String(e));
  }
});

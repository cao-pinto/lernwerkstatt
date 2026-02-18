import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type TeacherProfile = {
  id: string;
  user_id: string;
  display_name: string | null;
  school_id: string | null;
  role: "manager" | "teacher" | string;
};

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export function fail(message: string, status = 400, details?: unknown): Response {
  return new Response(JSON.stringify({ error: message, details }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export function getAdminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

export async function getCaller(
  supabase: SupabaseClient,
  token: string,
): Promise<{ id: string; email: string | null }> {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new Error("Ungültiges Auth-Token");
  }
  return { id: data.user.id, email: data.user.email ?? null };
}

export async function getTeacherProfileByUserId(
  supabase: SupabaseClient,
  userId: string,
): Promise<TeacherProfile | null> {
  const { data, error } = await supabase
    .from("teachers")
    .select("id,user_id,display_name,school_id,role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Teacher-Profil konnte nicht geladen werden: ${error.message}`);
  }
  return (data as TeacherProfile | null) ?? null;
}

export function parseAdminEmails(): Set<string> {
  const raw = Deno.env.get("ADMIN_EMAILS") ?? "";
  const parts = raw
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return new Set(parts);
}

export function isAllowedAdmin(email: string | null): boolean {
  if (!email) return false;
  const admins = parseAdminEmails();
  if (!admins.size) return false;
  return admins.has(email.toLowerCase());
}

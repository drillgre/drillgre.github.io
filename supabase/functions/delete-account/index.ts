import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://drillgre.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return reply(401, { error: "Please sign in again before deleting your account." });
  }

  let payload: { confirmation?: string };
  try {
    payload = await req.json();
  } catch {
    return reply(400, { error: "Invalid request body." });
  }
  if (payload.confirmation !== "DELETE") {
    return reply(400, { error: "Account deletion confirmation is required." });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) {
    return reply(500, { error: "Account deletion is not configured on the server." });
  }

  const accessToken = authorization.slice(7).trim();
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return reply(401, { error: "Your session is invalid or expired. Sign in again." });
  }

  const adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userData.user.id, false);
  if (deleteError) {
    return reply(500, { error: deleteError.message || "Supabase could not delete this account." });
  }

  return reply(200, { success: true });
});

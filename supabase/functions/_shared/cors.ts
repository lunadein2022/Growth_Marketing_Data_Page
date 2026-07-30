// Shared CORS headers for browser-invoked Edge Functions.
// Tighten ALLOW_ORIGIN to your deployed frontend origin(s) in production.
const ALLOW_ORIGIN = Deno.env.get("CORS_ALLOW_ORIGIN") ?? "*";

export const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Método no permitido." }, 405);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 8192) {
    return jsonResponse({ error: "La solicitud es demasiado grande." }, 413);
  }

  let body: Record<string, unknown>;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 8192) {
      return jsonResponse({ error: "La solicitud es demasiado grande." }, 413);
    }
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse({ error: "El formato de la solicitud no es válido." }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "El formato de la solicitud no es válido." }, 400);
  }

  const { token, first_name, last_name, attending, companions, comment } = body;
  if (typeof token !== "string" || token.length < 32 || token.length > 128) {
    return jsonResponse({ error: "El enlace de invitación no es válido o está cerrado." }, 400);
  }
  if (
    typeof first_name !== "string" || first_name.trim().length < 1 || first_name.trim().length > 80
    || typeof last_name !== "string" || last_name.trim().length < 1 || last_name.trim().length > 80
    || typeof attending !== "boolean"
    || !Number.isInteger(companions) || Number(companions) < 0 || Number(companions) > 10
    || (comment !== undefined && (typeof comment !== "string" || comment.length > 500))
  ) {
    return jsonResponse({ error: "Revisa los datos del formulario e inténtalo nuevamente." }, 400);
  }
  if (!attending && companions !== 0) {
    return jsonResponse({ error: "Una respuesta negativa no puede incluir acompañantes." }, 400);
  }

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!projectUrl || !anonKey) {
    console.error("Required Supabase environment variables are missing.");
    return jsonResponse({ error: "El servicio no está disponible." }, 500);
  }

  let rpcResponse: Response;
  try {
    rpcResponse = await fetch(`${projectUrl}/rest/v1/rpc/submit_public_rsvp`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_token: token,
        p_first_name: first_name.trim(),
        p_last_name: last_name.trim(),
        p_attending: attending,
        p_companions: companions,
        p_comment: typeof comment === "string" ? comment.trim() : "",
      }),
    });
  } catch {
    console.error("Could not reach the RSVP database function.");
    return jsonResponse({ error: "No se pudo conectar con el servicio. Inténtalo nuevamente." }, 502);
  }

  if (!rpcResponse.ok) {
    if (rpcResponse.status >= 500) {
      console.error("RSVP database function returned a server error.");
      return jsonResponse({ error: "No se pudo guardar la respuesta. Inténtalo nuevamente." }, 502);
    }
    return jsonResponse({ error: "El enlace no es válido, está cerrado o los datos exceden los límites permitidos." }, 400);
  }

  return jsonResponse({ ok: true }, 200);
});

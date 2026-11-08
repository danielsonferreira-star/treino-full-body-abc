// Ponte com o Strava. Guarda o Client Secret no servidor (variáveis de ambiente do Netlify)
// e faz três coisas: troca o código de login por tokens, renova tokens e cria a atividade.
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req, context) => {
  const action = context.params?.action;
  const id = Netlify.env.get("STRAVA_CLIENT_ID");
  const secret = Netlify.env.get("STRAVA_CLIENT_SECRET");
  if (!id || !secret) return json({ error: "Strava ainda não configurado neste site." }, 503);

  if (action === "config") return json({ clientId: id });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Requisição inválida." }, 400); }

  if (action === "token" || action === "refresh") {
    const p = new URLSearchParams({ client_id: id, client_secret: secret });
    if (action === "token") {
      if (!body.code) return json({ error: "Código de autorização ausente." }, 400);
      p.set("code", body.code);
      p.set("grant_type", "authorization_code");
    } else {
      if (!body.refresh_token) return json({ error: "Token de renovação ausente." }, 400);
      p.set("refresh_token", body.refresh_token);
      p.set("grant_type", "refresh_token");
    }
    const r = await fetch("https://www.strava.com/oauth/token", { method: "POST", body: p });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: j.message || "O Strava recusou o login.", detail: j.errors }, r.status);
    return json({
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at,
      nome: j.athlete ? j.athlete.firstname || "" : undefined,
    });
  }

  if (action === "activity") {
    const { access_token, activity: a } = body || {};
    if (!access_token || !a) return json({ error: "Dados da atividade ausentes." }, 400);
    const p = new URLSearchParams();
    for (const f of ["name", "sport_type", "type", "start_date_local", "elapsed_time", "description"]) {
      if (a[f] != null) p.set(f, String(a[f]));
    }
    const r = await fetch("https://www.strava.com/api/v3/activities", {
      method: "POST",
      headers: { Authorization: "Bearer " + access_token },
      body: p,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: j.message || "Não foi possível criar a atividade.", detail: j.errors }, r.status);
    return json({ id: j.id });
  }

  return json({ error: "Ação desconhecida." }, 404);
};

export const config = { path: "/api/strava/:action" };

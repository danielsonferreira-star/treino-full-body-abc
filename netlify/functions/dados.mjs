// Guarda os treinos de cada atleta no Netlify Blobs.
// A chave é um código de 40 caracteres gerado no aparelho a partir de nome + PIN (o servidor nunca vê nome nem PIN).
import { getStore } from "@netlify/blobs";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req, context) => {
  const id = context.params?.id || "";
  if (!/^[a-f0-9]{40}$/.test(id)) return json({ error: "Identificador inválido." }, 400);
  const store = getStore({ name: "treinos", consistency: "strong" });

  if (req.method === "GET") {
    const data = await store.get(id, { type: "json" });
    return json({ data: data || null });
  }

  if (req.method === "PUT") {
    const text = await req.text();
    if (text.length > 400000) return json({ error: "Dados grandes demais." }, 413);
    let data;
    try { data = JSON.parse(text); } catch { return json({ error: "Dados inválidos." }, 400); }
    if (!data || typeof data !== "object" || !data.s || typeof data.s !== "object") {
      return json({ error: "Formato inválido." }, 400);
    }
    await store.setJSON(id, { i: data.i, n: data.n, s: data.s, t: new Date().toISOString() });
    return json({ ok: true });
  }

  return json({ error: "Método não permitido." }, 405);
};

export const config = { path: "/api/dados/:id" };

// Integrações da versão publicada no Netlify: cronômetro do treino, Strava e app Saúde (iPhone).
// Usa as variáveis globais do app (sessions, W, NAMES, slug, queueSave, renderPanel...).
(function () {
  const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const SHORTCUT = "Treino ABC";
  const SK = "fullbody-abc-strava";
  let clientId = null; // null = carregando, false = indisponível

  // ---------- estilo ----------
  const css = document.createElement("style");
  css.textContent = `
  .timerbar,.actbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:12px 18px;border-bottom:1px solid var(--line)}
  .actbar{border-bottom:0;border-top:1px solid var(--line)}
  .timerbar .t{font-size:13px;color:var(--muted)}
  .timerbar .t b{color:var(--ink);font-variant-numeric:tabular-nums}
  .btn{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:999px;padding:9px 15px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
  .btn[disabled]{opacity:.55;cursor:default}
  .btn.go{background:var(--ink);color:var(--bg);border-color:var(--ink)}
  .btn.strava{background:#FC4C02;border-color:#FC4C02;color:#fff}
  .btn.health{background:#FF2D55;border-color:#FF2D55;color:#fff}
  .durf{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
  .durf input{width:64px;padding:7px 8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;font-size:15px;text-align:right;font-variant-numeric:tabular-nums}
  .imsg{flex-basis:100%;font-size:12px;color:var(--muted);min-height:0}
  .imsg.err{color:var(--a)}
  .integ{padding:12px 0 16px;display:grid;gap:12px}
  .integ ol{margin:0;padding-left:20px;display:grid;gap:6px}
  .integ code{font-size:12px;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
  .integ .row{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
  `;
  document.head.appendChild(css);

  // ---------- utilitários ----------
  const tok = () => { try { return JSON.parse(localStorage.getItem(SK) || "null"); } catch (e) { return null; } };
  const setTok = t => { try { t ? localStorage.setItem(SK, JSON.stringify(t)) : localStorage.removeItem(SK); } catch (e) {} };
  const pad = n => String(n).padStart(2, "0");
  const localISO = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":00";
  const hhmm = d => pad(d.getHours()) + ":" + pad(d.getMinutes());
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  async function api(action, body) {
    const r = await fetch("/api/strava/" + action, body
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || "Erro " + r.status); e.status = r.status; throw e; }
    return j;
  }

  function sess(k, w) {
    const s = sessions[k] || (sessions[k] = { treino: w, feito: false, ex: {} });
    s.treino = w; s.ex = s.ex || {};
    return s;
  }
  function elapsedMin(s) {
    if (!s.inicio) return null;
    const end = s.fim ? new Date(s.fim) : new Date();
    return Math.max(1, Math.round((end - new Date(s.inicio)) / 60000));
  }
  function duration(s) {
    const v = +s.duracao || elapsedMin(s) || 60;
    return Math.max(5, Math.min(300, v));
  }

  // ---------- Strava ----------
  function connect() {
    const base = IS_IOS ? "https://www.strava.com/oauth/mobile/authorize" : "https://www.strava.com/oauth/authorize";
    location.href = base + "?client_id=" + encodeURIComponent(clientId) +
      "&response_type=code&approval_prompt=auto&scope=" + encodeURIComponent("read,activity:write") +
      "&redirect_uri=" + encodeURIComponent(location.origin + "/");
  }
  async function accessToken() {
    let t = tok();
    if (!t) return null;
    if ((t.expires_at || 0) * 1000 < Date.now() + 60000) {
      const n = await api("refresh", { refresh_token: t.refresh_token });
      t = Object.assign({}, t, n, { nome: t.nome });
      setTok(t);
    }
    return t.access_token;
  }
  function buildActivity(d, w, s) {
    const dur = duration(s);
    let start;
    if (s.inicio) start = new Date(s.inicio);
    else if (+d === +today) start = new Date(Date.now() - dur * 60000);
    else start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 19, 0);
    const lines = W[w].map(([n]) => {
      const e = s.ex[slug(n)];
      if (!e || (!e.kg && !e.reps)) return null;
      return n + ": " + (e.kg ? e.kg + " kg" : "—") + " × " + (e.reps || "—");
    }).filter(Boolean);
    return {
      name: NAMES[w],
      sport_type: "WeightTraining",
      type: "WeightTraining",
      start_date_local: localISO(start),
      elapsed_time: dur * 60,
      description: (lines.length ? "Série válida (carga × reps)\n" + lines.join("\n") + "\n\n" : "") + "Full Body ABC",
    };
  }
  async function sendStrava(d, w, k, btn, msg) {
    btn.disabled = true; msg.className = "imsg"; msg.textContent = "Enviando ao Strava…";
    try {
      const at = await accessToken();
      if (!at) { connect(); return; }
      const s = sess(k, w);
      const r = await api("activity", { access_token: at, activity: buildActivity(d, w, s) });
      s.stravaId = r.id; queueSave(k); renderPanel();
    } catch (e) {
      btn.disabled = false; msg.className = "imsg err";
      if (e.status === 401) { setTok(null); msg.textContent = "A conexão com o Strava expirou. Toque em Conectar ao Strava de novo."; renderPanel(); }
      else msg.textContent = "Não foi possível enviar: " + e.message;
    }
  }

  // retorno do login do Strava (?code=...)
  async function handleCallback() {
    const q = new URLSearchParams(location.search);
    if (!q.has("code") && !q.has("error")) return;
    history.replaceState(null, "", location.pathname);
    if (q.get("error")) { status("Conexão com o Strava cancelada."); return; }
    if (!(q.get("scope") || "").includes("activity:write")) {
      status("Para gravar treinos, deixe marcada a permissão de criar atividades no Strava."); return;
    }
    try {
      const t = await api("token", { code: q.get("code") });
      setTok(t); status("Strava conectado" + (t.nome ? " como " + t.nome : "") + ".");
    } catch (e) { status("Não foi possível conectar ao Strava: " + e.message); }
    renderPanel(); renderIntegrations();
  }

  // ---------- app Saúde (Atalhos do iPhone) ----------
  const healthURL = min => "shortcuts://run-shortcut?name=" + encodeURIComponent(SHORTCUT) + "&input=text&text=" + encodeURIComponent(String(min));

  // ---------- painel do treino ----------
  let tick = null;
  window.afterPanel = function (p, d, w, k) {
    clearInterval(tick);
    const s = sessions[k] || { ex: {} };
    const isToday = +d === +today;

    // cronômetro + duração (topo)
    const tb = document.createElement("div");
    tb.className = "timerbar";
    const el = elapsedMin(s);
    tb.innerHTML =
      (s.inicio
        ? '<span class="t">Começou às <b>' + hhmm(new Date(s.inicio)) + "</b>" + (s.fim ? " · terminou às <b>" + hhmm(new Date(s.fim)) + "</b>" : ' · <b id="elap">' + el + " min</b>") + "</span>"
        : (isToday ? '<button type="button" class="btn go" id="startBtn">▶ Iniciar treino</button>' : '<span class="t">Sem horário registrado</span>')) +
      '<label class="durf" for="durIn">Duração<input id="durIn" inputmode="numeric" placeholder="' + (el || 60) + '" value="' + esc(s.duracao || "") + '"> min</label>';
    p.querySelector(".ph").after(tb);

    const st = tb.querySelector("#startBtn");
    if (st) st.onclick = () => { const x = sess(k, w); x.inicio = new Date().toISOString(); delete x.fim; queueSave(k); renderPanel(); };
    const di = tb.querySelector("#durIn");
    di.addEventListener("input", () => { const x = sess(k, w); x.duracao = di.value.replace(/\D/g, ""); queueSave(k); });
    if (s.inicio && !s.fim) tick = setInterval(() => { const e = document.getElementById("elap"); if (e) { e.textContent = elapsedMin(s) + " min"; di.placeholder = elapsedMin(s); } }, 30000);

    // ao marcar feito, fecha o cronômetro
    const done = p.querySelector("#done");
    done.addEventListener("click", () => {
      const x = sess(k, w);
      if (!x.feito && x.inicio && !x.fim) { x.fim = new Date().toISOString(); if (!x.duracao) x.duracao = String(elapsedMin(x)); setTimeout(renderPanel, 0); }
    });

    // ações (rodapé)
    const ab = document.createElement("div");
    ab.className = "actbar";
    let html = "";
    if (clientId) {
      if (s.stravaId) html += '<a class="btn strava" href="https://www.strava.com/activities/' + encodeURIComponent(s.stravaId) + '" target="_blank" rel="noopener">✓ No Strava · ver ↗</a>';
      else if (tok()) html += '<button type="button" class="btn strava" id="stravaBtn">Enviar ao Strava</button>';
      else html += '<button type="button" class="btn" id="stravaConn">Conectar ao Strava</button>';
    }
    if (IS_IOS && isToday) html += '<a class="btn health" id="healthBtn" href="' + healthURL(duration(s)) + '">♥ Gravar no Saúde</a>';
    if (!html) return;
    html += '<div class="imsg" id="imsg"></div>';
    ab.innerHTML = html;
    p.appendChild(ab);
    const msg = ab.querySelector("#imsg");
    const sb = ab.querySelector("#stravaBtn");
    if (sb) sb.onclick = () => sendStrava(d, w, k, sb, msg);
    const sc = ab.querySelector("#stravaConn");
    if (sc) sc.onclick = connect;
    const hb = ab.querySelector("#healthBtn");
    if (hb) hb.addEventListener("click", () => {
      hb.href = healthURL(duration(sessions[k] || s));
      msg.className = "imsg"; msg.textContent = "Abrindo o atalho “" + SHORTCUT + "”. Se nada acontecer, crie o atalho (veja “Strava e app Saúde” abaixo).";
    });
  };

  // ---------- seção de configuração ----------
  function renderIntegrations() {
    let box = document.getElementById("integ");
    if (!box) {
      box = document.createElement("details");
      box.id = "integ";
      const ref = document.querySelector(".wrap > details");
      ref.parentNode.insertBefore(box, ref);
    }
    const open = box.open;
    const t = tok();
    let strava;
    if (clientId === null) strava = "<p>Verificando o Strava…</p>";
    else if (!clientId) strava = "<p>O envio ao Strava não está configurado neste site.</p>";
    else if (t) strava = '<div class="row"><span>Conectado' + (t.nome ? " como <b>" + esc(t.nome) + "</b>" : "") + '.</span><button type="button" class="btn" id="stravaOff">Desconectar</button></div><p>No fim do treino, toque em <b>Enviar ao Strava</b>. Vai como atividade de musculação, com as cargas na descrição.</p>';
    else strava = '<div class="row"><button type="button" class="btn strava" id="stravaOn">Conectar ao Strava</button></div><p>Você faz login no Strava uma vez e autoriza o app a criar atividades.</p>';

    box.innerHTML =
      "<summary>Strava e app Saúde</summary><div class=\"integ\">" +
      "<div><h3>Strava</h3>" + strava + "</div>" +
      "<div><h3>App Saúde (iPhone)</h3><p>O botão <b>Gravar no Saúde</b> abre um atalho do iPhone que registra o treino de força no app Saúde. Apps que leem o Saúde, como o GymRats, pegam o treino de lá. Crie o atalho uma vez no app <b>Atalhos</b>:</p><ol>" +
      "<li>Toque em <b>+</b> e dê o nome <code>" + SHORTCUT + "</code> (exatamente assim).</li>" +
      "<li>Adicione a ação <b>Obter Números da Entrada</b> e escolha <b>Entrada do Atalho</b> como entrada. Se o iPhone perguntar de onde vem a entrada, deixe aceitar <b>Texto</b>.</li>" +
      "<li>Adicione <b>Ajustar Data</b>: <b>Subtrair</b> · <b>Números</b> · <b>minutos</b> · de <b>Data Atual</b>.</li>" +
      "<li>Adicione <b>Registrar Exercício</b>: tipo <b>Treino de Força Tradicional</b>, data <b>Data Ajustada</b>, duração <b>Números</b> em minutos.</li>" +
      "<li>Na primeira vez, permita que o Atalhos grave exercícios no Saúde.</li></ol></div></div>";
    box.open = open;
    const on = box.querySelector("#stravaOn"); if (on) on.onclick = connect;
    const off = box.querySelector("#stravaOff"); if (off) off.onclick = () => { setTok(null); renderIntegrations(); renderPanel(); };
  }

  // ---------- início ----------
  renderIntegrations();
  renderPanel();
  api("config").then(j => { clientId = j.clientId || false; }).catch(() => { clientId = false; })
    .then(() => { renderIntegrations(); renderPanel(); handleCallback(); });
})();

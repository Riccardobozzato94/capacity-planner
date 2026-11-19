import { planCapacity } from "./engine.ts";
import { evaluate } from "./eval.ts";
import { SEED, SPRINTS } from "./synthetic.ts";
import type { CapacityResult, Demand } from "./types.ts";

// D1 e' opzionale: il Worker funziona con env.DB assente.
type D1Result = { results?: Array<Record<string, unknown>> };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all(): Promise<D1Result>;
};
export type D1Like = { prepare(sql: string): D1Statement };
export type Env = { DB?: D1Like };

const DEMO_AT = "2026-11-19T09:00:00.000Z";
const DEMO_SPRINT = "S1";
const THRESHOLD_PCT = 85;

// Il piano pubblico aggiunge le demand (titoli e skill) per la tabella
// assegnazioni e il segnale di storage; non contiene alcuna ground truth.
type PublicPlan = CapacityResult & { demands: Demand[]; persisted: boolean };
type PublicSprint = { name: string; members: number; demands: number };

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function html(value: string): Response {
  return new Response(value, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// Nessuna scrittura su GET: il Worker usa D1 solo in lettura. `available` e'
// true se il binding esiste e la tabella e' leggibile; `count` e' il numero di
// piani gia' presenti. Entrambi sono false/0 senza DB o con lettura non riuscita.
async function readStorage(env: Env): Promise<{ available: boolean; count: number }> {
  if (!env.DB) return { available: false, count: 0 };
  try {
    const result = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM capacity_plans",
    ).all();
    return { available: true, count: Number(result.results?.[0]?.n ?? 0) };
  } catch {
    return { available: false, count: 0 };
  }
}

// Proiezione pubblica degli sprint: soli dati di input, nessuna annotazione
// dell'eval e nessuna probe interna.
function publicSprints(): PublicSprint[] {
  return SPRINTS.map((s) => ({
    name: s.name,
    members: s.members.length,
    demands: s.demands.length,
  }));
}

function findSprint(name: string | null) {
  if (!name) return undefined;
  return SPRINTS.find((s) => s.name === name);
}

function planFor(name: string, generatedAt: string, persisted: boolean): PublicPlan {
  const sprint = findSprint(name);
  if (!sprint) throw new Error("sprint non trovato");
  const result = planCapacity(sprint.members, sprint.demands, sprint.name, generatedAt);
  return { ...result, demands: sprint.demands.map((d) => ({ ...d })), persisted };
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JSON inline in <script>: '<' potrebbe chiudere il tag, U+2028/U+2029 sono
// separatori di riga validi in JS ma non in JSON. Escape come sequenze Unicode.
function safeJsonInline(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function barWidth(pct: number): number {
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function pctLabel(pct: number): number {
  return Math.round(pct);
}

function barsHtml(plan: PublicPlan): string {
  return plan.members
    .map((r) => {
      const fill = r.overloaded ? "util-fill over" : "util-fill";
      return `<div class="bar-row">
        <div class="bar-meta"><span class="m-name">${esc(r.member.name)}</span><span class="m-role">${esc(r.member.role)}</span><span class="m-skills">${esc(r.member.skills.join(", "))}</span></div>
        <div class="util-track"><div class="${fill}" style="width:${barWidth(r.utilizationPct)}%"></div><div class="util-threshold" aria-hidden="true"></div></div>
        <div class="bar-value"><span class="pct">${pctLabel(r.utilizationPct)}%</span><span class="hours">${r.assignedHours} / ${r.member.availableHours} h</span></div>
      </div>`;
    })
    .join("");
}

function assignHtml(plan: PublicPlan): string {
  const demandById = new Map(plan.demands.map((d) => [d.id, d]));
  const memberById = new Map(plan.members.map((r) => [r.member.id, r.member]));
  return plan.assignments
    .map((a) => {
      const d = demandById.get(a.demandId);
      const member = a.memberId ? memberById.get(a.memberId) : undefined;
      const who = a.memberId
        ? (member ? member.name + " · " + member.role : a.memberId)
        : "non assegnata";
      const outcome = a.memberId ? "assegnata" : a.reason;
      return `<tr>
        <td class="mono">${esc(a.demandId)}</td>
        <td>${d ? esc(d.title) : ""}</td>
        <td>${d ? esc(d.skill) : ""}</td>
        <td class="num">${d ? d.effortHours : 0}</td>
        <td>${esc(who)}</td>
        <td class="reason">${esc(outcome)}</td>
      </tr>`;
    })
    .join("");
}

function warningsHtml(plan: PublicPlan): string {
  if (plan.unassigned.length === 0) {
    return '<li class="empty">Nessuna demand non assegnata.</li>';
  }
  const demandById = new Map(plan.demands.map((d) => [d.id, d]));
  return plan.unassigned
    .map((id) => {
      const d = demandById.get(id);
      const reason =
        plan.assignments.find((a) => a.demandId === id)?.reason ?? "";
      return `<li>${esc(id)} · ${d ? esc(d.title) : ""} — ${esc(reason)}</li>`;
    })
    .join("");
}

function dashboardHtml(initial: PublicPlan, storedPlans: number): string {
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Capacity Planner</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0B0E13; color: #F9FAFB; font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1040px; margin: 0 auto; padding: 32px 20px 64px; }
  header.page { border-bottom: 1px solid #1F2937; padding-bottom: 18px; margin-bottom: 20px; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: .01em; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .09em; color: #9CA3AF; margin: 0 0 14px; }
  .subtitle, .note { color: #9CA3AF; font-size: 13px; margin: 0; }
  .toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
  .toolbar label { color: #9CA3AF; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
  select { background: #121821; color: #F9FAFB; border: 1px solid #293241; border-radius: 8px; padding: 9px 12px; font: inherit; min-width: 120px; }
  select:focus { outline: 2px solid #D97757; outline-offset: -1px; }
  .seed { color: #6B7280; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .bars-panel, .detail-panel { background: #121821; border: 1px solid #1F2937; border-radius: 12px; padding: 22px; margin-bottom: 18px; }
  .bars-panel { border-top: 3px solid #D97757; }
  .util-bars { display: block; }
  .threshold-legend { color: #9CA3AF; font-size: 12px; margin: -4px 0 18px; display: flex; align-items: center; gap: 8px; }
  .legend-swatch { display: inline-block; width: 26px; height: 8px; flex: none; }
  .bar-row { display: flex; align-items: center; gap: 14px; padding: 9px 0; border-bottom: 1px solid #1F2937; }
  .bar-row:last-child { border-bottom: 0; }
  .bar-meta { width: 300px; flex: none; display: flex; gap: 8px; align-items: baseline; }
  .m-name { font-weight: 650; min-width: 24px; }
  .m-role { color: #D97757; font-size: 12px; }
  .m-skills { color: #9CA3AF; font-size: 12px; }
  .util-track { position: relative; flex: 1; height: 12px; background: #1F2937; border-radius: 6px; }
  .util-fill { height: 100%; border-radius: 6px; background: #D97757; }
  .util-fill.over { background: #F87171; }
  .util-threshold { position: absolute; left: 85%; top: -3px; bottom: -3px; width: 2px; background: #F9FAFB; }
  .bar-value { width: 120px; flex: none; text-align: right; display: flex; flex-direction: column; }
  .pct { font-weight: 650; font-variant-numeric: tabular-nums; }
  .hours { color: #9CA3AF; font-size: 11px; font-variant-numeric: tabular-nums; }
  table.assign-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .assign-table thead th { background: #161D27; color: #9CA3AF; font-size: 11px; text-transform: uppercase; letter-spacing: .07em; text-align: left; padding: 11px 12px; border-bottom: 1px solid #293241; }
  .assign-table tbody td { padding: 10px 12px; border-bottom: 1px solid #1F2937; }
  .assign-table tbody tr:last-child td { border-bottom: 0; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #D97757; font-size: 12px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .reason { color: #9CA3AF; font-size: 12px; }
  ul.warnings { list-style: none; padding: 0; margin: 0; }
  .warnings li { padding: 9px 12px; margin-bottom: 8px; border-left: 3px solid #F87171; background: rgba(248,113,113,.08); border-radius: 6px; font-size: 13px; }
  .warnings li.empty { border-left-color: #374151; background: #161D27; color: #9CA3AF; }
  footer.page { margin-top: 26px; border-top: 1px solid #1F2937; padding-top: 14px; }
  @media (max-width: 760px) { .bar-meta { width: auto; flex-wrap: wrap; } .bar-row { flex-wrap: wrap; } .util-track { min-width: 100%; } }
</style>
</head>
<body>
<main>
  <header class="page">
    <h1>Capacity Planner</h1>
    <p class="subtitle">Pianificazione, capacity planning e coordinamento; dashboard Jira e Confluence per stato, avanzamento e rischi.</p>
  </header>

  <div class="toolbar">
    <label for="sprint-select">Sprint</label>
    <select id="sprint-select">${publicSprints().map((s) => `<option value="${esc(s.name)}"${s.name === initial.sprint ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
    <span class="seed">seed ${SEED}</span>
  </div>

  <section class="bars-panel">
    <h2>Utilizzo per membro</h2>
    <p class="threshold-legend">Soglia ${THRESHOLD_PCT}% · oltre la soglia la barra passa in allarme <span class="legend-swatch util-fill over"></span></p>
    <div class="util-bars bars" id="bars">${barsHtml(initial)}</div>
  </section>

  <section class="detail-panel">
    <h2>Assegnazioni</h2>
    <table class="assign-table">
      <thead><tr><th>Demand</th><th>Titolo</th><th>Skill</th><th>Ore</th><th>Membro</th><th>Esito</th></tr></thead>
      <tbody id="assign-rows">${assignHtml(initial)}</tbody>
    </table>
    <h2 style="margin-top:24px">Avvisi</h2>
    <ul class="warnings" id="warnings">${warningsHtml(initial)}</ul>
  </section>

  <footer class="page">
    <p class="note">Ho coordinato team di progetto di 8–12 persone.</p>
    <p class="note" id="stored-note">Piani salvati in D1: ${storedPlans}</p>
    <p class="note">Dati sintetici deterministicamente fissati, seed ${SEED}.</p>
  </footer>
</main>
<script>
var select = document.getElementById("sprint-select");
var current = ${safeJsonInline(initial)};
var THRESHOLD = ${THRESHOLD_PCT};

function esc(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function barWidth(pct) { return Math.max(0, Math.min(100, Math.round(pct))); }
function pctLabel(pct) { return Math.round(pct); }
function barsHtml(plan) {
  return plan.members.map(function (r) {
    var fill = r.overloaded ? "util-fill over" : "util-fill";
    return '<div class="bar-row">' +
      '<div class="bar-meta"><span class="m-name">' + esc(r.member.name) + '</span><span class="m-role">' + esc(r.member.role) + '</span><span class="m-skills">' + esc(r.member.skills.join(", ")) + '</span></div>' +
      '<div class="util-track"><div class="' + fill + '" style="width:' + barWidth(r.utilizationPct) + '%"></div><div class="util-threshold" aria-hidden="true"></div></div>' +
      '<div class="bar-value"><span class="pct">' + pctLabel(r.utilizationPct) + '%</span><span class="hours">' + r.assignedHours + ' / ' + r.member.availableHours + ' h</span></div>' +
      '</div>';
  }).join("");
}
function assignHtml(plan) {
  var demandById = {};
  plan.demands.forEach(function (d) { demandById[d.id] = d; });
  var memberById = {};
  plan.members.forEach(function (r) { memberById[r.member.id] = r.member; });
  return plan.assignments.map(function (a) {
    var d = demandById[a.demandId];
    var member = a.memberId ? memberById[a.memberId] : undefined;
    var who = a.memberId ? (member ? member.name + " · " + member.role : a.memberId) : "non assegnata";
    var outcome = a.memberId ? "assegnata" : a.reason;
    return "<tr>" +
      '<td class="mono">' + esc(a.demandId) + "</td>" +
      "<td>" + (d ? esc(d.title) : "") + "</td>" +
      "<td>" + (d ? esc(d.skill) : "") + "</td>" +
      '<td class="num">' + (d ? d.effortHours : 0) + "</td>" +
      "<td>" + esc(who) + "</td>" +
      '<td class="reason">' + esc(outcome) + "</td>" +
      "</tr>";
  }).join("");
}
function warningsHtml(plan) {
  if (plan.unassigned.length === 0) return '<li class="empty">Nessuna demand non assegnata.</li>';
  var demandById = {};
  plan.demands.forEach(function (d) { demandById[d.id] = d; });
  return plan.unassigned.map(function (id) {
    var d = demandById[id];
    var a = plan.assignments.filter(function (x) { return x.demandId === id; })[0];
    var reason = a ? a.reason : "";
    return "<li>" + esc(id) + " · " + (d ? esc(d.title) : "") + " — " + esc(reason) + "</li>";
  }).join("");
}
function render(plan) {
  current = plan;
  document.getElementById("bars").innerHTML = barsHtml(plan);
  document.getElementById("assign-rows").innerHTML = assignHtml(plan);
  document.getElementById("warnings").innerHTML = warningsHtml(plan);
}
select.addEventListener("change", async function () {
  try {
    var res = await fetch("/api/plan?sprint=" + encodeURIComponent(select.value));
    if (!res.ok) throw new Error("HTTP " + res.status);
    render(await res.json());
  } catch (err) {
    document.getElementById("stored-note").textContent = "Caricamento non riuscito: " + err.message;
  }
});
</script>
</body>
</html>`;
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/health" && request.method === "GET") {
    return json({ status: "ok" });
  }

  if (path === "/api/sprints" && request.method === "GET") {
    const storage = await readStorage(env);
    return json({
      seed: String(SEED),
      sprints: publicSprints(),
      storedPlans: storage.count,
    });
  }

  if (path === "/api/plan" && request.method === "GET") {
    const sprint = findSprint(url.searchParams.get("sprint"));
    if (!sprint) {
      return json({ error: "sprint non valido" }, 400);
    }
    const generatedAt = new Date().toISOString();
    // GET resta read-only: `persisted` segnala solo che lo storage e' raggiungibile.
    const persisted = (await readStorage(env)).available;
    return json(planFor(sprint.name, generatedAt, persisted));
  }

  if (path === "/api/eval" && request.method === "POST") {
    return json(evaluate());
  }

  if (path === "/" && request.method === "GET") {
    // Un solo accesso D1: il bootstrap e il contatore condividono lo stesso segnale.
    const storage = await readStorage(env);
    const initial = planFor(DEMO_SPRINT, DEMO_AT, storage.available);
    return html(dashboardHtml(initial, storage.count));
  }

  return json({ error: "endpoint non trovato" }, 404);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};

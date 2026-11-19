import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = "https://x.dev";

function get(path: string): Promise<Response> {
  return import("../src/index.ts").then((mod) =>
    mod.default.fetch(new Request(BASE + path), {}), // env senza DB
  );
}

function post(path: string): Promise<Response> {
  return import("../src/index.ts").then((mod) =>
    mod.default.fetch(new Request(BASE + path, { method: "POST" }), {}),
  );
}

// La ground truth dell'eval (EXPECTED_OVERLOADED) e la probe interna non
// devono comparire ne' nelle risposte API ne' nella dashboard. Il campo
// `note` di /api/eval e' ammesso dal contratto e non e' un identificatore.
function hasGroundTruth(value: unknown): boolean {
  const text = JSON.stringify(value);
  return (
    text.includes("EXPECTED_OVERLOADED") ||
    text.includes("probe-d") ||
    text.includes("PROBE")
  );
}

test("API funziona senza D1: piano S1 con 10 membri e 12 demand senza ground truth", async () => {
  const mod = await import("../src/index.ts");
  const res = await mod.default.fetch(
    new Request(BASE + "/api/plan?sprint=S1"),
    {}, // env senza DB
  );
  assert.equal(res.status, 200);
  const plan = await res.json() as {
    sprint: string;
    members: Array<{
      member: { id: string; name: string; role: string; skills: string[] };
      assignedHours: number;
      utilizationPct: number;
      overloaded: boolean;
    }>;
    assignments: Array<{ demandId: string; memberId: string | null; reason: string }>;
    unassigned: string[];
    totals: { demandHours: number; availableHours: number; overloadedMembers: number };
    generatedAt: string;
    persisted: boolean;
  };
  assert.equal(plan.sprint, "S1");
  assert.equal(plan.members.length, 10);
  assert.equal(plan.assignments.length, 12);
  assert.deepEqual(plan.unassigned, []);
  assert.deepEqual(plan.totals, {
    demandHours: 108,
    availableHours: 276,
    overloadedMembers: 0,
  });
  assert.equal(typeof plan.generatedAt, "string");
  // GET resta read-only: senza DB la segnalazione e' onesta.
  assert.equal(plan.persisted, false);
  assert.equal(hasGroundTruth(plan), false);

  // Il motore riporta numeri reali e la soglia 85% resta nella logica del motore.
  const al = plan.members.find((m) => m.member.id === "AL")!;
  assert.equal(al.assignedHours, 16);
  assert.equal(al.utilizationPct, 50);
  assert.equal(al.overloaded, false);
  assert.deepEqual(al.member.skills, ["TypeScript", "Pimcore", "API"]);
});

test("API espone health, sprints, plan, eval e dashboard senza DB", async () => {
  const health = await get("/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const sprints = await get("/api/sprints");
  assert.equal(sprints.status, 200);
  const sprintData = await sprints.json() as {
    seed: string;
    sprints: Array<{ name: string; members: number; demands: number }>;
    storedPlans: number;
  };
  assert.equal(sprintData.seed, "20261119");
  assert.equal(sprintData.storedPlans, 0);
  assert.deepEqual(sprintData.sprints, [
    { name: "S1", members: 10, demands: 12 },
    { name: "S2", members: 9, demands: 11 },
    { name: "S3", members: 8, demands: 13 },
    { name: "S4", members: 10, demands: 14 },
  ]);
  assert.equal(hasGroundTruth(sprintData), false);

  const counts = [12, 11, 13, 14];
  for (let i = 0; i < sprintData.sprints.length; i++) {
    const name = sprintData.sprints[i].name;
    const res = await get("/api/plan?sprint=" + name);
    assert.equal(res.status, 200);
    const data = await res.json() as {
      sprint: string;
      assignments: unknown[];
      persisted: boolean;
    };
    assert.equal(data.sprint, name);
    assert.equal(data.assignments.length, counts[i]);
    assert.equal(data.persisted, false);
    assert.equal(hasGroundTruth(data), false);
  }

  const bad = await get("/api/plan?sprint=S9");
  assert.equal(bad.status, 400);
  const missing = await get("/api/plan");
  assert.equal(missing.status, 400);

  const evalRes = await post("/api/eval");
  assert.equal(evalRes.status, 200);
  const metrics = await evalRes.json() as Record<string, unknown>;
  assert.equal(metrics.seed, "20261119");
  assert.equal(metrics.count, 4);
  assert.equal(metrics.id, "eval-capacity-20261119");
  assert.equal(metrics.createdAt, "2026-11-19T09:00:00.000Z");
  assert.equal(metrics.dataset, "capacity-planner");
  assert.equal(metrics.overloadDetectionAccuracy, 0.75);
  assert.equal(metrics.assignmentRate, 49 / 50);
  assert.equal(metrics.unassignedExplained, 1);
  assert.equal(typeof metrics.note, "string");
  // La nota e' ammessa, i dati della probe e la ground truth no.
  assert.equal(hasGroundTruth(metrics), false);

  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.headers.get("content-type") ?? "", /text\/html/);
  const html = await root.text();

  // Layout a barre: diverso da decision-card, tabella e gauge.
  assert.ok(html.includes("util-bar"), "la dashboard deve usare barre di utilizzo");
  assert.ok(html.includes("util-threshold"), "manca la soglia 85% sulle barre");
  assert.ok(!html.includes("decision-card"));
  assert.ok(!html.includes("conic-gradient"));
  assert.ok(!html.includes("gauge-panel"));

  // Selettore sprint S1-S4.
  for (const name of ["S1", "S2", "S3", "S4"]) {
    assert.ok(html.includes(`value="${name}"`), `manca l'opzione ${name}`);
  }
  assert.ok(html.includes("sprint-select"));

  // Barre con nomi, ruoli, skill e numeri reali del motore.
  for (const label of ["AL", "Dev", "TypeScript", "Pimcore", "API"]) {
    assert.ok(html.includes(label), `manca il riferimento ${label}`);
  }
  assert.ok(html.includes("16 / 32 h"), "mancano le ore reali di AL");
  assert.ok(html.includes("50%"), "manca la percentuale reale di AL");
  assert.ok(html.includes("Soglia 85%"));
  assert.ok(html.includes("util-fill over"), "manca la regola di allarme oltre soglia");

  // Tabella assegnazioni e avvisi per demand non assegnate.
  assert.ok(html.includes("Assegnazioni"));
  assert.ok(html.includes("assign-table"));
  assert.ok(html.includes("Avvisi"));
  assert.ok(html.includes("Nessuna demand non assegnata"));

  // Copertura colori e frasi CV verbatim.
  assert.ok(html.includes("#0B0E13"));
  assert.ok(html.includes("#D97757"));
  assert.ok(html.includes("#F9FAFB"));
  assert.ok(
    html.includes(
      "Pianificazione, capacity planning e coordinamento; dashboard Jira e Confluence per stato, avanzamento e rischi",
    ),
  );
  assert.ok(html.includes("Ho coordinato team di progetto di 8–12 persone"));
  assert.equal(hasGroundTruth(html), false);

  const notFound = await get("/nope");
  assert.equal(notFound.status, 404);
});

test("API /api/plan: S2 mostra demand non assegnata e S3 un membro in overload", async () => {
  const s2 = await get("/api/plan?sprint=S2");
  assert.equal(s2.status, 200);
  const s2plan = await s2.json() as {
    sprint: string;
    unassigned: string[];
    assignments: Array<{ demandId: string; memberId: string | null; reason: string }>;
    persisted: boolean;
  };
  assert.equal(s2plan.sprint, "S2");
  assert.deepEqual(s2plan.unassigned, ["d11"]);
  const nullA = s2plan.assignments.find((a) => a.memberId === null)!;
  assert.equal(nullA.demandId, "d11");
  assert.equal(nullA.reason, "Nessuna disponibilità per skill Kafka: servono 8 h");
  assert.equal(s2plan.persisted, false);

  const s3 = await get("/api/plan?sprint=S3");
  assert.equal(s3.status, 200);
  const s3plan = await s3.json() as {
    sprint: string;
    members: Array<{
      member: { id: string };
      assignedHours: number;
      utilizationPct: number;
      overloaded: boolean;
    }>;
    totals: { overloadedMembers: number };
    persisted: boolean;
  };
  assert.equal(s3plan.sprint, "S3");
  const over = s3plan.members.filter((m) => m.overloaded);
  assert.deepEqual(over.map((m) => m.member.id), ["SC"]);
  assert.ok(over[0].utilizationPct > 85);
  assert.equal(over[0].assignedHours, 12);
  assert.equal(s3plan.totals.overloadedMembers, 1);
  assert.equal(s3plan.persisted, false);

  // Il renderer espone gia' soglia, barre in allarme e area avvisi; verificarne
  // la presenza con i dati reali del dashboard iniziale.
  const root = await get("/");
  const html = await root.text();
  assert.ok(html.includes("util-threshold"));
  assert.ok(html.includes("Soglia 85%"));
  assert.ok(html.includes("util-fill over"));
  assert.ok(html.includes("Avvisi"));
});

test("dashboard evidenzia oltre 85% e avvisa le demand non assegnate", async () => {
  const mod = await import("../src/index.ts");
  const { SPRINTS } = await import("../src/synthetic.ts");
  const original = { members: SPRINTS[0].members, demands: SPRINTS[0].demands };
  try {
    // S1 minimale: AL riceve 10/10 h (100% > 85%) e una skill Pimcore resta
    // senza membro, così barra in allarme e avviso sono esercitati davvero.
    SPRINTS[0].members = [
      { id: "AL", name: "AL", role: "Dev", skills: ["TypeScript"], availableHours: 10 },
    ];
    SPRINTS[0].demands = [
      { id: "dX", title: "Carico eccessivo", skill: "TypeScript", effortHours: 10, priority: "high" },
      { id: "dY", title: "Skill mancante", skill: "Pimcore", effortHours: 8, priority: "high" },
    ];

    const res = await mod.default.fetch(new Request(BASE + "/"), {});
    assert.equal(res.status, 200);
    const html = await res.text();

    assert.match(html, /class="util-fill over" style="width:100%"/);
    assert.ok(html.includes("10 / 10 h"));
    assert.ok(html.includes("100%"));
    assert.ok(html.includes("dY · Skill mancante"));
    assert.ok(html.includes("Nessuna disponibilità per skill Pimcore: servono 8 h"));
    assert.ok(
      html.includes('<ul class="warnings" id="warnings"><li>dY · Skill mancante'),
      "l'elenco avvisi deve partire dalla demand non assegnata",
    );
  } finally {
    SPRINTS[0].members = original.members;
    SPRINTS[0].demands = original.demands;
  }
});

test("GET / e /api/plan leggono D1 senza scrivere e allineano il bootstrap", async () => {
  const mod = await import("../src/index.ts");
  let selects = 0;
  const env = {
    DB: {
      prepare(sql: string) {
        assert.match(sql, /^SELECT COUNT\(\*\) AS n FROM capacity_plans$/);
        return {
          bind() {
            assert.fail("nessun bind su GET");
            return this;
          },
          run() {
            assert.fail("nessuna scrittura su GET");
            return this;
          },
          async all() {
            selects += 1;
            return { results: [{ n: 3 }] };
          },
        };
      },
    },
  };

  const res = await mod.default.fetch(new Request(BASE + "/"), env);
  assert.equal(res.status, 200);
  const body = await res.text();

  // Un solo accesso D1 in lettura: bootstrap e contatore condividono il segnale.
  assert.equal(selects, 1);
  const bootstrap = body.match(/var current = (\{.*\});/);
  assert.ok(bootstrap, "bootstrap current mancante");
  const current = JSON.parse(bootstrap![1]) as { persisted: boolean; sprint: string };
  assert.equal(current.persisted, true);
  assert.equal(current.sprint, "S1");
  assert.ok(body.includes("Piani salvati in D1: 3"));
  assert.equal(bootstrap![1].includes("</script"), false);

  const planRes = await mod.default.fetch(
    new Request(BASE + "/api/plan?sprint=S2"),
    env,
  );
  assert.equal(planRes.status, 200);
  const plan = await planRes.json() as { persisted: boolean };
  assert.equal(plan.persisted, true);
  assert.ok(selects >= 2);
});

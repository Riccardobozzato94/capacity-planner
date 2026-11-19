import { test } from "node:test";
import assert from "node:assert/strict";
import { planCapacity } from "../src/engine.ts";
import { SEED, SPRINTS } from "../src/synthetic.ts";
import type { Demand, Member } from "../src/types.ts";

test("skill senza membri resta non assegnata", () => {
  const r = planCapacity(
    [{ id: "m1", name: "AL", role: "Dev", skills: ["TypeScript"], availableHours: 30 }],
    [{ id: "d1", title: "Report", skill: "Pimcore", effortHours: 8, priority: "high" }],
    "S1", "2026-11-19T09:00:00.000Z"
  );
  assert.deepEqual(r.unassigned, ["d1"]);
  assert.equal(r.assignments[0]!.memberId, null);
  assert.match(r.assignments[0]!.reason, /Nessuna disponibilità per skill Pimcore/);
});

test("ordina per priorità poi effort decrescente", () => {
  const members: Member[] = [
    { id: "m1", name: "AL", role: "Dev", skills: ["API", "QA", "UX", "TypeScript"], availableHours: 100 },
  ];
  const demands: Demand[] = [
    { id: "dLow", title: "Basso", skill: "UX", effortHours: 2, priority: "low" },
    { id: "dHighSmall", title: "Alto piccolo", skill: "QA", effortHours: 3, priority: "high" },
    { id: "dHighBig", title: "Alto grande", skill: "API", effortHours: 8, priority: "high" },
    { id: "dMed", title: "Medio", skill: "TypeScript", effortHours: 5, priority: "medium" },
  ];
  const r = planCapacity(members, demands, "S2", "2026-11-19T09:00:00.000Z");
  assert.deepEqual(
    r.assignments.map((a) => a.demandId),
    ["dHighBig", "dHighSmall", "dMed", "dLow"]
  );
});

test("sceglie il candidato con più ore residue", () => {
  const members: Member[] = [
    { id: "m1", name: "MR", role: "Dev", skills: ["TypeScript"], availableHours: 10 },
    { id: "m2", name: "GB", role: "Dev", skills: ["TypeScript"], availableHours: 20 },
  ];
  const demands: Demand[] = [1, 2, 3].map((n) => ({
    id: `d${n}`,
    title: `Attività ${n}`,
    skill: "TypeScript",
    effortHours: 6,
    priority: "high" as const,
  }));
  const r = planCapacity(members, demands, "S3", "2026-11-19T09:00:00.000Z");
  assert.deepEqual(
    r.assignments.map((a) => a.memberId),
    ["m2", "m2", "m1"]
  );
  assert.deepEqual(r.unassigned, []);
});

test("utilization e soglia overloaded a 85", () => {
  const members: Member[] = [
    { id: "ok", name: "LP", role: "QA", skills: ["QA"], availableHours: 20 },
    { id: "over", name: "SC", role: "UX", skills: ["Pimcore"], availableHours: 20 },
    { id: "edge", name: "EC", role: "UX", skills: ["UX"], availableHours: 20 },
  ];
  const demands: Demand[] = [
    { id: "a", title: "A", skill: "QA", effortHours: 8, priority: "high" },
    { id: "b", title: "B", skill: "Pimcore", effortHours: 18, priority: "high" },
    { id: "c", title: "C", skill: "UX", effortHours: 17, priority: "high" },
  ];
  const r = planCapacity(members, demands, "S4", "2026-11-19T09:00:00.000Z");
  const byId = new Map(r.members.map((m) => [m.member.id, m]));
  assert.equal(byId.get("ok")!.utilizationPct, 40);
  assert.equal(byId.get("over")!.utilizationPct, 90);
  assert.equal(byId.get("edge")!.utilizationPct, 85);
  assert.equal(byId.get("ok")!.overloaded, false);
  assert.equal(byId.get("over")!.overloaded, true);
  assert.equal(byId.get("edge")!.overloaded, false);
  assert.equal(r.totals.overloadedMembers, 1);
});

test("membri con zero ore disponibili non generano NaN", () => {
  const members: Member[] = [
    { id: "z", name: "FM", role: "Dev", skills: ["Shopware"], availableHours: 0 },
  ];
  const demands: Demand[] = [
    { id: "d", title: "Zero", skill: "Shopware", effortHours: 4, priority: "medium" },
  ];
  const r = planCapacity(members, demands, "S1", "2026-11-19T09:00:00.000Z");
  assert.equal(r.unassigned.length, 1);
  assert.equal(r.members[0]!.assignedHours, 0);
  assert.equal(r.members[0]!.utilizationPct, 0);
  assert.equal(r.members[0]!.overloaded, false);
  assert.equal(Number.isNaN(r.members[0]!.utilizationPct), false);
});

test("totali e pass-through di sprint e generatedAt", () => {
  const members: Member[] = [
    { id: "m", name: "RD", role: "Integrazione", skills: ["API"], availableHours: 40 },
  ];
  const demands: Demand[] = [
    { id: "d1", title: "Uno", skill: "API", effortHours: 10, priority: "high" },
    { id: "d2", title: "Due", skill: "API", effortHours: 5, priority: "low" },
  ];
  const r = planCapacity(members, demands, "S7", "2026-11-19T12:34:56.000Z");
  assert.equal(r.sprint, "S7");
  assert.equal(r.generatedAt, "2026-11-19T12:34:56.000Z");
  assert.deepEqual(r.totals, { demandHours: 15, availableHours: 40, overloadedMembers: 0 });
});

test("dataset sintetico: seed, 4 sprint, 8-12 membri e 10-14 demand", () => {
  assert.equal(SEED, 20261119);
  assert.equal(SPRINTS.length, 4);
  for (const s of SPRINTS) {
    assert.match(s.name, /^S\d+$/);
    assert.ok(s.members.length >= 8 && s.members.length <= 12, `${s.name} membri`);
    assert.ok(s.demands.length >= 10 && s.demands.length <= 14, `${s.name} demand`);
    const r = planCapacity(s.members, s.demands, s.name, "2026-11-19T09:00:00.000Z");
    assert.equal(r.generatedAt, "2026-11-19T09:00:00.000Z");
  }
});

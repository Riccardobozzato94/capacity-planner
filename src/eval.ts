import { planCapacity } from "./engine.ts";
import { SEED, SPRINTS } from "./synthetic.ts";
import type { CapacityResult } from "./types.ts";

const CREATED_AT = "2026-11-19T09:00:00.000Z";
const DATASET = "capacity-planner";
const EVAL_ID = "eval-capacity-20261119";

// Rende esplicito lo scope di unassignedExplained: il valore non puo essere
// letto come evidenza sui soli 4 sprint del dataset.
const NOTE =
  "I 4 sprint sintetici non hanno demand non assegnate. unassignedExplained e reso non vacuo da una probe interna, non conteggiata in count: la probe esercita una demand senza alcun membro con la skill richiesta. Il valore copre gli sprint del dataset piu la probe.";

// Ground truth annotata a mano, indipendente da planCapacity: id dei membri
// che l'annotatore considera in overload. Non e derivata dall'output del motore.
// L'annotatore usa un giudizio di rischio key-person, non la soglia fissa 85%:
// per S3 segnala AL (20 h, punto unico per le integrazioni API) mentre il
// motore non segnala nessuno. Disaccordo deliberato: accuracy < 1 by design.
const EXPECTED_OVERLOADED: Record<string, string[]> = {
  S1: [],
  S2: [],
  S3: ["AL"],
  S4: [],
};

function fraction(matches: number, total: number): number {
  return total === 0 ? 0 : matches / total;
}

function sameIds(actual: string[], expected: string[]): boolean {
  const a = [...actual].sort();
  const e = [...expected].sort();
  return a.length === e.length && a.every((value, i) => value === e[i]);
}

// Ogni domanda non assegnata deve avere un motivo non vuoto e deve comparire
// in `unassigned`; viceversa ogni id in `unassigned` deve avere un'assegnazione
// con memberId null. Controllo strutturale, non legato alla soglia di overload.
function explained(result: CapacityResult): boolean {
  const nullAssignments = result.assignments.filter((a) => a.memberId === null);
  if (!nullAssignments.every((a) => a.reason.trim().length > 0)) return false;
  const nullIds = new Set(nullAssignments.map((a) => a.demandId));
  const unassignedIds = new Set(result.unassigned);
  if (nullIds.size !== unassignedIds.size) return false;
  for (const id of unassignedIds) {
    if (!nullIds.has(id)) return false;
  }
  return true;
}

export function evaluate(): {
  id: string;
  createdAt: string;
  dataset: string;
  seed: string;
  count: number;
  note: string;
  overloadDetectionAccuracy: number;
  assignmentRate: number;
  unassignedExplained: number;
} {
  let overloadMatches = 0;
  let assignedDemands = 0;
  let totalDemands = 0;

  const explainedChecks: boolean[] = [];

  for (const sprint of SPRINTS) {
    const result = planCapacity(
      sprint.members,
      sprint.demands,
      sprint.name,
      CREATED_AT
    );

    const predicted = result.members
      .filter((m) => m.overloaded)
      .map((m) => m.member.id);
    const expected = EXPECTED_OVERLOADED[sprint.name];
    if (expected === undefined) {
      throw new Error(`Ground truth mancante per lo sprint ${sprint.name}`);
    }
    if (sameIds(predicted, expected)) overloadMatches += 1;

    assignedDemands += result.assignments.filter((a) => a.memberId !== null).length;
    totalDemands += sprint.demands.length;

    explainedChecks.push(explained(result));
  }

  // Controllo non vacuo: una domanda Pimcore senza alcun membro con la skill
  // deve finire in `unassigned` con motivo esplicito (Review Focus Task 13).
  // Non entra in `count`, che resta il numero di sprint del dataset.
  const probe = planCapacity(
    [{ id: "probe", name: "probe", role: "Dev", skills: ["TypeScript"], availableHours: 30 }],
    [{ id: "probe-d", title: "Probe", skill: "Pimcore", effortHours: 8, priority: "high" }],
    "PROBE",
    CREATED_AT
  );
  explainedChecks.push(explained(probe));

  return {
    id: EVAL_ID,
    createdAt: CREATED_AT,
    dataset: DATASET,
    seed: String(SEED),
    count: SPRINTS.length,
    note: NOTE,
    overloadDetectionAccuracy: fraction(overloadMatches, SPRINTS.length),
    assignmentRate: fraction(assignedDemands, totalDemands),
    unassignedExplained: fraction(
      explainedChecks.filter(Boolean).length,
      explainedChecks.length
    ),
  };
}

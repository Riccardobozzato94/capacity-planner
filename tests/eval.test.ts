import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../src/eval.ts";

test("eval restituisce metriche complete su 4 sprint", () => {
  const e = evaluate();
  assert.equal(e.count, 4);
  assert.equal(e.seed, "20261119");
  assert.equal(e.dataset, "capacity-planner");
  assert.equal(e.unassignedExplained, 1);
  assert.ok(e.overloadDetectionAccuracy >= 0 && e.overloadDetectionAccuracy <= 1);
  assert.ok(e.assignmentRate >= 0 && e.assignmentRate <= 1);
});

test("eval espone esattamente i campi del brief", () => {
  assert.deepEqual(Object.keys(evaluate()).sort(), [
    "assignmentRate",
    "count",
    "createdAt",
    "dataset",
    "id",
    "overloadDetectionAccuracy",
    "seed",
    "unassignedExplained",
  ]);
});

test("eval blocca ground truth indipendente e metadati deterministici", () => {
  const e = evaluate();

  assert.equal(e.id, "eval-capacity-20261119");
  assert.equal(e.createdAt, "2026-11-19T09:00:00.000Z");

  // Ground truth annotata a mano: per S3 l'annotatore segnala AL come membro
  // in overload (rischio key-person), mentre il motore con soglia 85% non
  // segnala nessuno. Se expected fosse ri-derivato da planCapacity,
  // overloadDetectionAccuracy tornerebbe a 1 e questo guard fallirebbe.
  assert.ok(e.overloadDetectionAccuracy < 1);
  assert.equal(e.overloadDetectionAccuracy, 0.75);
  assert.equal(e.assignmentRate, 1);
  assert.equal(e.unassignedExplained, 1);
});

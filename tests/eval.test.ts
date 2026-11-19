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

test("eval espone esattamente i campi del contratto", () => {
  assert.deepEqual(Object.keys(evaluate()).sort(), [
    "assignmentRate",
    "count",
    "createdAt",
    "dataset",
    "id",
    "note",
    "overloadDetectionAccuracy",
    "seed",
    "unassignedExplained",
  ]);
});

test("eval dichiara esplicitamente lo scope di unassignedExplained", () => {
  const e = evaluate();
  assert.equal(typeof e.note, "string");
  assert.ok(e.note.includes("4"), "la nota deve citare i 4 sprint del dataset");
  assert.ok(e.note.includes("S2"), "la nota deve citare la demand non assegnata in S2");
  assert.ok(e.note.includes("S3"), "la nota deve citare il membro in overload in S3");
  assert.ok(e.note.includes("non assegnata"));
  assert.ok(e.note.includes("overload"));
  assert.equal(e.note.includes("probe"), false, "la probe non esiste piu");
});

test("eval blocca ground truth indipendente e metadati deterministici", () => {
  const e = evaluate();

  assert.equal(e.id, "eval-capacity-20261119");
  assert.equal(e.createdAt, "2026-11-19T09:00:00.000Z");

  // Ground truth annotata a mano: per S4 l'annotatore segnala AL come membro
  // in overload (rischio key-person), mentre il motore con soglia 85% non
  // segnala nessuno. Se expected fosse ri-derivato da planCapacity,
  // overloadDetectionAccuracy tornerebbe a 1 e questo guard fallirebbe.
  // S3 e' il caso reale di overload (SC): li' annotatore e motore concordano.
  assert.ok(e.overloadDetectionAccuracy < 1);
  assert.equal(e.overloadDetectionAccuracy, 0.75);
  // Una demand su 50 resta non assegnata: il tasso e' onestamente < 1.
  assert.ok(e.assignmentRate < 1);
  assert.equal(e.assignmentRate, 49 / 50);
  assert.equal(e.unassignedExplained, 1);
});

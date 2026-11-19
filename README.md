# Capacity Planner

## Il problema vero

«Pianificazione, capacity planning e coordinamento; dashboard Jira e Confluence per stato, avanzamento e rischi»: quando domanda di lavoro e disponibilità del team sono distribuite tra persone, skill e sprint, servono assegnazioni esplicite, un segnale di saturazione per membro e una spiegazione verificabile per ogni domanda che resta scoperta. Questo prototipo trasforma membri, ore disponibili e demand di sprint in un piano deterministico con assegnazioni, utilizzo percentuale, overload e motivi di non assegnazione.

## Dichiarazione dati

I 4 sprint sintetici e il pool di 10 membri definiti in `src/synthetic.ts` sono generati con seed `20261119`: 50 demand totali (12 in S1, 11 in S2, 13 in S3, 14 in S4), nessun dato di clienti reali, nessuna integrazione con Jira o Confluence. Le etichette `EXPECTED_OVERLOADED` usate dall'eval in `src/eval.ts` sono annotate a mano, indipendenti dall'output del motore, e non compaiono in nessuna risposta API né nella dashboard. Il prototipo non misura risparmi economici, risultati di business o tempo risparmiato.

## Vincoli

- Runtime: Node.js ≥ 22.6 e Cloudflare Workers (`src/index.ts` esporta `fetch(request, env)`).
- Zero dipendenze npm (`package.json` senza `dependencies`) e zero chiamate a modelli LLM: l'allocazione è deterministica in `src/engine.ts`.
- Il motore riceve `generatedAt` come parametro ISO dal chiamante (`planCapacity(members, demands, sprint, generatedAt)`); nessun `new Date()` dentro l'engine o nell'eval, così test ed eval sono riproducibili. Il timestamp della risposta `GET /api/plan` è generato dal Worker.
- Persistenza opzionale e in sola lettura dal Worker: tutte le rotte funzionano con `env.DB` assente. Se il binding D1 esiste, `readStorage` esegue solo `SELECT COUNT(*) AS n FROM capacity_plans`; `persisted` è `true` se la lettura riesce, `storedPlans` è il numero di righe presenti (0 senza DB o con lettura non riuscita). Non esiste alcun percorso di scrittura nel Worker. Lo schema previsto è in `migrations/0001_init.sql` (`capacity_plans`: `id`, `sprint`, `plan`, `created_at`).
- Nessuna scrittura su `GET`: `GET /api/plan` non persiste nulla e restituisce `persisted` solo come segnale di storage raggiungibile in lettura.
- Dataset ed eval deterministici: seed `20261119`, `count` 4 sprint, output eval con `id`, `createdAt`, `dataset`, `seed`, `count`.

## Cosa fa il tool

Input: un elenco di `Member` (`id`, `name`, `role`, `skills`, `availableHours`) e di `Demand` (`id`, `title`, `skill`, `effortHours`, `priority`) per uno sprint. Output: un `CapacityResult` con `sprint`, `members` (ore assegnate, `utilizationPct`, `overloaded`), `assignments`, `unassigned`, `totals`, `generatedAt`.

- Ordinamento delle demand: priorità `high` → `medium` → `low`, poi `effortHours` decrescente a parità di priorità.
- Allocazione: per ogni demand si seleziona il membro con la skill richiesta e il maggior numero di ore residue (`remaining`), solo se `remaining >= effortHours`. In caso di assegnazione si registrano ore e `reason` vuoto; altrimenti l'assegnazione ha `memberId: null`, la demand entra in `unassigned` e `reason` è `Nessuna disponibilità per skill ${demand.skill}: servono ${demand.effortHours} h`.
- Utilizzo e overload: `utilizationPct = (assignedHours / availableHours) * 100` (0 se `availableHours` è 0), `overloaded = utilizationPct > 85`. `totals` riporta `demandHours`, `availableHours` e `overloadedMembers`.
- Stati dimostrativi nel dataset: in S2 la demand `d11` "Integrazione eventi Kafka" (skill `Kafka`, 8 h, `high`) resta non assegnata perché nessun membro di S2 possiede la skill `Kafka`. In S3 il membro `SC` (ruolo `UX`, unico membro con skill `UX` in S3, `availableHours` 14) riceve `d06` "UX navigazione" (8 h) e `d13` "UX accessibilità" (4 h): 12/14 h = 85.7%, quindi `overloaded`.

Interfacce esposte dal Worker: `GET /health`, `GET /api/sprints` (seed, sprint con conteggi `members`/`demands`, `storedPlans`), `GET /api/plan?sprint=...` (piano con `demands` e `persisted`; 400 se sprint non valido), `POST /api/eval`, `GET /` (dashboard con selettore sprint, barre di utilizzo per membro, soglia 85%, tabella assegnazioni, avvisi per demand non assegnate e conteggio piani salvati). Il bootstrap della dashboard usa lo sprint demo `S1` con `generatedAt` fisso `2026-11-19T09:00:00.000Z`.

## Cosa dimostra del percorso

Il prototipo rende operativo il presidio di «Pianificazione, capacity planning e coordinamento; dashboard Jira e Confluence per stato, avanzamento e rischi»: domanda e capacità sono confrontate per skill e priorità, l'allocazione privilegia le ore residue disponibili, lo stato di overload supera una soglia esplicita (85%) e ogni demand non assegnata riporta il motivo. Riflette il lavoro di coordinamento espresso anche da «Ho coordinato team di progetto di 8–12 persone», reso qui come regole ispezionabili su un dataset deterministico.

## Metriche misurate su dati sintetici

Fonte: `results/eval.json` generato da `scripts/eval.ts` (`evaluate()` in `src/eval.ts`) su 4 sprint sintetici deterministici (`S1`–`S4`).

| Campo | Valore |
| --- | ---: |
| dataset | `capacity-planner` |
| seed | `20261119` |
| count | 4 |
| overloadDetectionAccuracy | 0.75 |
| assignmentRate | 0.98 |
| unassignedExplained | 1 |

`EXPECTED_OVERLOADED` è una ground truth annotata a mano, indipendente da `planCapacity`: per S4 l'annotatore segnala `AL` (punto unico per le integrazioni API) mentre il motore, basato sulla soglia 85%, non segnala nessuno; il disaccordo è deliberato e porta `overloadDetectionAccuracy` a 3/4. `assignmentRate` è 49/50 demand assegnate sul dataset. `unassignedExplained` è calcolato sui soli 4 sprint del dataset con un controllo strutturale (ogni assegnazione con `memberId: null` ha `reason` non vuoto e l'id compare in `unassigned`, e viceversa); S2 include già la demand non assegnata `d11` (skill `Kafka`) con motivo esplicito.

## Limiti

- Dataset sintetico: 4 sprint, 10 membri e 50 demand con skill e ruoli predefiniti; non rappresenta calendari reali, assenze, lavoro parallelo, dipendenze tra demand o contesti cliente.
- Allocazione greedy deterministica (priorità, poi effort decrescente, poi maggiori ore residue): non ottimizza globalmente, non bilancia il carico oltre la scelta locale e non gestisce demand che richiedono più skill o più persone.
- La soglia di overload è fissa a 85% in `src/engine.ts`; la ground truth dell'eval usa invece un giudizio di rischio "key-person" annotato a mano, quindi il disaccordo su S4 è atteso dal disegno dell'eval, non una correzione automatica del motore.
- `generatedAt` di `/api/plan` è prodotto dal Worker a ogni richiesta HTTP; il bootstrap della dashboard usa il timestamp fisso `DEMO_AT` (`2026-11-19T09:00:00.000Z`).
- Nessuna integrazione reale con Jira, Confluence, calendari o sistemi HR; la persistenza D1, quando raggiungibile, è usata solo in lettura (`capacity_plans`) e il Worker non scrive piani.

## Prova tu

Prerequisito: Node.js ≥ 22.6.

```bash
node --test tests/*.test.ts
node scripts/eval.ts
```

`node scripts/eval.ts` rigenera `results/eval.json`. Per eseguire il Worker in locale (dopo aver impostato `database_id` in `wrangler.toml` se si vuole usare D1):

```bash
npx wrangler dev
```

La dashboard è disponibile su `/`, il piano di uno sprint via `GET /api/plan?sprint=S1` (sprint `S1`–`S4`).

## Appendice: API e deploy

| Metodo | Percorso | Descrizione |
| --- | --- | --- |
| GET | `/health` | Stato `{ "status": "ok" }` |
| GET | `/api/sprints` | Seed, elenco sprint (`name`, `members`, `demands`) e `storedPlans` (0 senza DB o lettura non riuscita) |
| GET | `/api/plan?sprint=...` | Piano dello sprint con `demands` e `persisted` (storage leggibile); 400 se sprint non valido |
| POST | `/api/eval` | Esegue la valutazione e restituisce le metriche con `seed` e `count` |
| GET | `/` | Dashboard HTML con barre di utilizzo, assegnazioni, avvisi e accesso ai dati via API |

Configurazione Worker (`wrangler.toml`): `name = "capacity-planner"`, `main = "src/index.ts"`, `compatibility_date = "2026-11-19"`, `workers_dev = true`, binding D1 `DB` verso `database_name = "ai-projects"`. Valorizzare `database_id` dopo la creazione del database; senza binding o con tabella non leggibile le API restano operative e la persistenza è riportata come non disponibile.

---

# Capacity Planner

## The real problem

«Pianificazione, capacity planning e coordinamento; dashboard Jira e Confluence per stato, avanzamento e rischi»: when work demand and team availability are spread across people, skills, and sprints, you need explicit assignments, a saturation signal per member, and a verifiable explanation for every demand left uncovered. This prototype turns members, available hours, and sprint demands into a deterministic plan with assignments, percentage utilization, overload, and reasons for non-assignment.

## Data declaration

The 4 synthetic sprints and the pool of 10 members defined in `src/synthetic.ts` are generated with seed `20261119`: 50 demands in total (12 in S1, 11 in S2, 13 in S3, 14 in S4), no real client data, no Jira or Confluence integrations. The `EXPECTED_OVERLOADED` labels used by the eval in `src/eval.ts` are hand-annotated, independent from the engine output, and never appear in any API response or in the dashboard. The prototype does not measure cost savings, business results, or time saved.

## Constraints

- Runtime: Node.js ≥ 22.6 and Cloudflare Workers (`src/index.ts` exports `fetch(request, env)`).
- Zero npm dependencies (`package.json` has no `dependencies`) and zero LLM calls: allocation is deterministic in `src/engine.ts`.
- The engine receives `generatedAt` as an ISO parameter from the caller (`planCapacity(members, demands, sprint, generatedAt)`); no `new Date()` inside the engine or eval, so tests and eval are reproducible. The `GET /api/plan` response timestamp is generated by the Worker.
- Optional persistence, read-only from the Worker: all routes work when `env.DB` is absent. When the D1 binding exists, `readStorage` runs only `SELECT COUNT(*) AS n FROM capacity_plans`; `persisted` is `true` if the read succeeds, `storedPlans` is the number of rows present (0 without DB or on a failed read). There is no write path in the Worker. The expected schema is in `migrations/0001_init.sql` (`capacity_plans`: `id`, `sprint`, `plan`, `created_at`).
- No writes on `GET`: `GET /api/plan` persists nothing and returns `persisted` only as a readable-storage signal.
- Deterministic dataset and eval: seed `20261119`, `count` 4 sprints, eval output with `id`, `createdAt`, `dataset`, `seed`, `count`.

## What the tool does

Input: a list of `Member` (`id`, `name`, `role`, `skills`, `availableHours`) and `Demand` (`id`, `title`, `skill`, `effortHours`, `priority`) for a sprint. Output: a `CapacityResult` with `sprint`, `members` (assigned hours, `utilizationPct`, `overloaded`), `assignments`, `unassigned`, `totals`, `generatedAt`.

- Demand ordering: priority `high` → `medium` → `low`, then `effortHours` descending within the same priority.
- Allocation: for each demand it selects the member with the required skill and the highest remaining hours (`remaining`), only if `remaining >= effortHours`. On assignment it records hours and an empty `reason`; otherwise the assignment has `memberId: null`, the demand goes to `unassigned`, and `reason` is `Nessuna disponibilità per skill ${demand.skill}: servono ${demand.effortHours} h`.
- Utilization and overload: `utilizationPct = (assignedHours / availableHours) * 100` (0 if `availableHours` is 0), `overloaded = utilizationPct > 85`. `totals` reports `demandHours`, `availableHours`, and `overloadedMembers`.
- Demo states in the dataset: in S2 demand `d11` "Integrazione eventi Kafka" (skill `Kafka`, 8 h, `high`) remains unassigned because no S2 member has the `Kafka` skill. In S3 member `SC` (role `UX`, the only S3 member with the `UX` skill, `availableHours` 14) receives `d06` "UX navigazione" (8 h) and `d13` "UX accessibilità" (4 h): 12/14 h = 85.7%, so `overloaded`.

Worker interfaces: `GET /health`, `GET /api/sprints` (seed, sprints with `members`/`demands` counts, `storedPlans`), `GET /api/plan?sprint=...` (plan with `demands` and `persisted`; 400 if sprint is invalid), `POST /api/eval`, `GET /` (dashboard with sprint selector, per-member utilization bars, 85% threshold, assignments table, warnings for unassigned demands, and stored plans count). The dashboard bootstrap uses demo sprint `S1` with fixed `generatedAt` `2026-11-19T09:00:00.000Z`.

## What this shows about the background

The prototype operationalizes the control expressed by «Pianificazione, capacity planning e coordinamento; dashboard Jira e Confluence per stato, avanzamento e rischi»: demand and capacity are compared by skill and priority, allocation favors the member with the most remaining hours, overload crosses an explicit threshold (85%), and every unassigned demand carries a reason. It reflects the coordination work also expressed by «Ho coordinato team di progetto di 8–12 persone», rendered here as inspectable rules over a deterministic dataset.

## Metrics measured on synthetic data

Source: `results/eval.json` produced by `scripts/eval.ts` (`evaluate()` in `src/eval.ts`) over 4 deterministic synthetic sprints (`S1`–`S4`).

| Field | Value |
| --- | ---: |
| dataset | `capacity-planner` |
| seed | `20261119` |
| count | 4 |
| overloadDetectionAccuracy | 0.75 |
| assignmentRate | 0.98 |
| unassignedExplained | 1 |

`EXPECTED_OVERLOADED` is a hand-annotated ground truth, independent from `planCapacity`: for S4 the annotator flags `AL` (single point for API integrations) while the engine, based on the 85% threshold, flags no one; the disagreement is deliberate and yields `overloadDetectionAccuracy` 3/4. `assignmentRate` is 49/50 demands assigned across the dataset. `unassignedExplained` is computed over the 4 dataset sprints only with a structural check (every assignment with `memberId: null` has a non-empty `reason` and its id appears in `unassigned`, and vice versa); S2 already includes unassigned demand `d11` (skill `Kafka`) with an explicit reason.

## Limitations

- Synthetic dataset: 4 sprints, 10 members, and 50 demands with predefined skills and roles; it does not represent real calendars, absences, parallel work, dependencies between demands, or client contexts.
- Deterministic greedy allocation (priority, then effort descending, then highest remaining hours): it does not optimize globally, does not balance load beyond the local choice, and does not handle demands requiring multiple skills or multiple people.
- The overload threshold is fixed at 85% in `src/engine.ts`; the eval ground truth uses a hand-annotated "key-person" risk judgment instead, so the S4 disagreement is expected by the eval design, not an automatic correction of the engine.
- `/api/plan` `generatedAt` is produced by the Worker on each HTTP request; the dashboard bootstrap uses the fixed timestamp `DEMO_AT` (`2026-11-19T09:00:00.000Z`).
- No real integration with Jira, Confluence, calendars, or HR systems; when reachable, D1 persistence is used read-only (`capacity_plans`) and the Worker does not write plans.

## Try it

Prerequisite: Node.js ≥ 22.6.

```bash
node --test tests/*.test.ts
node scripts/eval.ts
```

`node scripts/eval.ts` regenerates `results/eval.json`. To run the Worker locally (after setting `database_id` in `wrangler.toml` if you want D1):

```bash
npx wrangler dev
```

The dashboard is available at `/`, a sprint plan via `GET /api/plan?sprint=S1` (sprints `S1`–`S4`).

## Appendix: API and deploy

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Status `{ "status": "ok" }` |
| GET | `/api/sprints` | Seed, sprint list (`name`, `members`, `demands`) and `storedPlans` (0 without DB or on a failed read) |
| GET | `/api/plan?sprint=...` | Sprint plan with `demands` and `persisted` (storage readable); 400 if sprint is invalid |
| POST | `/api/eval` | Runs evaluation and returns metrics with `seed` and `count` |
| GET | `/` | HTML dashboard with utilization bars, assignments, warnings, and data access via API |

Worker configuration (`wrangler.toml`): `name = "capacity-planner"`, `main = "src/index.ts"`, `compatibility_date = "2026-11-19"`, `workers_dev = true`, D1 binding `DB` to `database_name = "ai-projects"`. Set `database_id` after creating the database; without the binding or with an unreadable table, APIs remain operational and persistence is reported as unavailable.

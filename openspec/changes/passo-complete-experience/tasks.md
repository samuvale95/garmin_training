## 1. Contracts and baseline

- [x] 1.1 Record remaining master-plan journeys against current routes, APIs and supported/unsupported capabilities; retain the completed foundation increment unchanged.
- [ ] 1.2 Share concrete draft, validation, constraints and goal DTOs between backend and frontend; verify ownership/error/status semantics.

## 2. Durable storage and migration

- [x] 2.1 Add user-scoped revisioned draft storage including original import, input, generation state, validation and activation receipt.
- [ ] 2.2 Add independent goals, immutable versions, program associations and dated evaluation storage; migrate embedded race goals idempotently.
- [x] 2.3 Add versioned athlete availability and shared transaction locking covering all relevant legacy/new writers, with consistent lock ordering and documented global serialization trade-off.
- [ ] 2.4 Keep explicit target lookups strict and legacy race adapters compatible; preserve unrelated goals, activities and histories.

## 3. Proposal and compatibility services

- [x] 3.1 Implement authenticated draft CRUD with revision conflicts, source preservation, and explicit new/merge/replace modes.
- [x] 3.2 Make generator proposal mode fully side-effect free, with explicit goal/no-goal and effective start/range support.
- [ ] 3.3 Include all active program commitments in generator context without copying them into the new proposal; retain existing AI configuration.
- [ ] 3.4 Persist generation request identity/results/errors and recover interrupted requests without overwriting newer input.
- [x] 3.5 Implement a shared pure compatibility evaluator for availability, daily count/duration, preserved sessions and supported sport rules; expose missing/unverifiable inputs.
- [x] 3.6 Build full context fingerprints including active membership, session content, goal/constraint versions and relevant source evidence.
- [ ] 3.7 Implement atomic activation with final validation, protected/history preservation, idempotent receipt and rollback; block legacy activation bypasses.

## 4. Goals and evaluations

- [ ] 4.1 Implement typed goal CRUD/version history and independent program links for race and non-race goals.
- [ ] 4.2 Implement dated execution/progress/quality responses from supported evidence; default unsupported strength/performance metrics to insufficient data.
- [ ] 4.3 Reuse applicable race evaluations and canonical activity identity; preserve historical target versions and avoid duplicate athlete totals.

## 5. Program and goal interface

- [ ] 5.1 Add explicit single-workout/new-program entry points and a dedicated AI/file creation path, preserving legacy URLs.
- [ ] 5.2 Build goal, availability, context and preferences steps with durable save/resume and supported-range disclosure.
- [ ] 5.3 Build YAML upload/paste, useful parse errors, source retention and explicit target selection; show only supported formats.
- [ ] 5.4 Build shared editable review with per-program impact, homogeneous weekly summaries, preserved sessions and clear compatibility limits.
- [ ] 5.5 Handle generation/activation retries, stale review, conflict and insufficient-data acknowledgement; offer calendar and separate Garmin publication after activation.
- [ ] 5.6 Replace race-only goal overview with independent goal create/edit/detail/evaluation history and visible program contributions.

## 6. Daily training and publication

- [ ] 6.1 Complete sport-aware session/workout detail actions and contextual return; make move conflict preview precede save.
- [ ] 6.2 Add original/short version comparison, phases/durations and restoration using existing supported variants.
- [ ] 6.3 Complete editor field validation, duration summary and unsaved-edit protection, including explicit limits of browser navigation handling.
- [ ] 6.4 Remove implicit Garmin pushes from local saves while preserving discoverable pending diff and explicit send/replace/delete confirmations.
- [ ] 6.5 Handle partial/failed/unknown publication outcomes and reconciliation before retry; distinguish acquisition from sending and Connect from device confirmation.

## 7. Activity, recovery, nutrition and configuration

- [ ] 7.1 Complete Storico/Andamento/Resoconti and detail links with canonical activity identity, off-plan support and observed/estimated homogeneous comparisons.
- [ ] 7.2 Complete Recupero Oggi/Tendenze with source/time, missing/stale states and explanations for advanced load metrics.
- [ ] 7.3 Complete shared nutrition date and Piano del giorno/Diario navigation; preserve date and origin in one photo/text/manual review/save flow.
- [ ] 7.4 Verify quantity correction, suggested-versus-consumed distinction, double-session timeline and no clock-based claim of an ongoing workout.
- [ ] 7.5 Group profile/account/connections/athlete/equipment/preferences; retain optional connections, recoverable errors and useful first-use choices.
- [ ] 7.6 Complete responsive workspace, focus/reduced-motion/error/loading conventions and reversible new-experience entry-point flag.

## 8. Verification and release evidence

Stato del blocco programmi del 30 ottobre: vedere [verification.md](verification.md). I punti generali sotto restano aperti quando includono percorsi o prove fuori da questo blocco.

- [x] Verifica circoscritta AI/YAML incollato → bozza salvata → ripresa → revisione → attivazione con obiettivo, conflitto, contesto scaduto e conferma legata al token corrente (fixture browser isolate).
- [x] Verifica degli 8 fix backend successivi al precedente blocco da 28 test, su PostgreSQL locale isolato.
- [x] TypeScript, lint mirato e build di produzione finali del blocco programmi/obiettivi.

- [ ] 8.1 Test draft isolation, source recovery, ownership, revision invalidation, generation completion races and truthful missing-data evaluation.
- [ ] 8.2 Test all-active compatibility, activation idempotency/rollback, retained locked/completed identity and stale membership/session/goal/constraint changes; test real transaction races when an isolated PostgreSQL instance is available.
- [ ] 8.3 Run relevant existing backend tests, frontend build/type/lint checks and fix introduced regressions.
- [ ] 8.4 Verify isolated browser journeys for AI/import resume-review-activate, stale/conflict/error, move/editor/short variant, nutrition date and publication outcomes without external writes.
- [ ] 8.5 Inspect representative populated/empty/error screens at 360/390/430/768/1440 px, enlarged text, keyboard/focus and reduced motion; record actual findings.
- [ ] 8.6 Perform Astra critical review of persistence/concurrency/history/publication and Terra visual review; resolve actionable findings.
- [ ] 8.7 Update master-plan status and verification/rollback documentation, clearly separating completed local checks from unperformed live-service, participant and assistive-technology validation.

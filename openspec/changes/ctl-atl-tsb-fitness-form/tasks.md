## 1. Modulo fisiologico Fitness, Fatica e Forma

- [x] 1.1 Creare `training_plan/fitness_fatigue.py` con stima del carico di allenamento giornaliero (TL/TSS) per attività passate e sessioni pianificate.
- [x] 1.2 Implementare il modello esponenziale a doppio decadimento per $CTL$ ($\tau=42\text{d}$), $ATL$ ($\tau=7\text{d}$) e $TSB = CTL - ATL$ con warmup seed iniziale.
- [x] 1.3 Implementare la classificazione fisiologica del TSB (5 zone da Overreaching a Freschezza/Detraining).
- [x] 1.4 Implementare la funzione di proiezione verso la gara obiettivo (Venezia Marathon / race goal) con verifica del tapering.
- [x] 1.5 Aggiungere test unitari esaustivi in `tests/test_fitness_fatigue.py`.

## 2. Integrazione API Backend

- [x] 2.1 Definire i modelli Pydantic in `training_plan/api/schemas.py` (`FitnessFatigueResponse`, `FitnessFatiguePoint`, `RaceTaperingOut`, ecc.).
- [x] 2.2 Creare l'endpoint `GET /body/fitness-fatigue` in `training_plan/api/routes_body.py`.
- [x] 2.3 Aggiungere test di integrazione per l'endpoint in `tests/test_api_body.py`.

## 3. UI Frontend e Proiezione Maratona

- [x] 3.1 Aggiornare i tipi in `web/src/lib/types.ts` e aggiungere l'hook React Query `useFitnessFatigue` in `web/src/lib/queries.ts`.
- [x] 3.2 Creare il componente visivo Fitness / Fatigue / Form in `web/src/app/(tabs)/body/load/page.tsx` con curve storiche, indicatore di stato TSB e simulazione tapering maratona.
- [x] 3.3 Verificare con `uv run pytest` e `npm run build`.

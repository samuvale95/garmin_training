## 1. Algoritmo di pulizia e rilevamento spike cardio

- [x] 1.1 Creare `training_plan/hr_cleaning.py` con `clean_heart_rate_stream(...)`, rilevamento spike ($|dHR/dt| > 5$ bpm/s) e interpolazione lineare.
- [x] 1.2 Implementare il rilevamento del *cadence lock* (gradino $\ge 20$ bpm agganciato alla cadenza $\pm 3$ spm a passo costante).
- [x] 1.3 Calcolare metriche di qualità stream: `valid_ratio`, `quality` (`alta`, `media`, `bassa`), `spikes_detected`, `cadence_lock_seconds`.
- [x] 1.4 Aggiungere test unitari completi in `tests/test_hr_cleaning.py`.

## 2. Integrazione con intensità, zone e passo

- [x] 2.1 Aggiornare `training_plan/intensity.py` per usare lo stream ripulito nel calcolo di `time_in_zone` e istogrammi.
- [x] 2.2 Aggiornare `training_plan/paces.py` per scartare campioni con spike o cadence lock dalla stima passo/battito.
- [x] 2.3 Aggiornare gli schemi API in `training_plan/api/schemas.py` ed esporre `hr_quality` nelle risposte di analisi seduta.

## 3. Affidabilità biometrica notturna e allarmi controllati

- [x] 3.1 Implementare `calculate_overnight_reliability(...)` in `training_plan/body_insights.py` (sonno $<4$h o HRV mancante → `parziale`).
- [x] 3.2 Aggiornare `training_plan/readiness.py` per non emettere verdetti di stop assoluto ("Oggi fermati") su dati parziali, declassando a moderato con nota esplicita.
- [x] 3.3 Aggiungere test in `tests/test_readiness.py` e `tests/test_body_insights.py`.

## 4. Esposizione UI e verifica

- [x] 4.1 Aggiornare i tipi TypeScript in `web/src/lib/types.ts` con i campi di affidabilità e qualità.
- [x] 4.2 Mostrare badge di qualità cardio nel dettaglio seduta e note di dato parziale nella scheda Prontezza/Corpo.
- [x] 4.3 Verificare con `pytest` e `npm run build`.

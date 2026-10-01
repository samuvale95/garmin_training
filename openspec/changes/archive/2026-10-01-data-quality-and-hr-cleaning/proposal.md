## Why

Sensori ottici al polso e fasce cardio soffrono regolarmente di artefatti tecnici: *cadence lock* (il sensore ottico si aggancia al ritmo dei passi ~170–180 spm durante un fondo lento), picchi spuri improvvisi (es. 210 bpm per sfregamento della maglietta tecnica) e blackout temporanei. Oggi l'app calcola il tempo nelle zone, la conformità dell'intensità e le decisioni di prontezza/recupero basandosi ciecamente sui dati grezzi: un picco falso altera le zone cardio e il carico, mentre una notte con sonno parziale può scatenare allarmi ingiustificati. Inoltre l'atleta non sa quanto fidarsi dei numeri mostrati.

## What Changes

- **Filtro anomalie fisiologiche su stream cardio**:
  - Rilevamento e neutralizzazione dei picchi spuri isolati ($|dHR/dt| > 5$ bpm/s non sostenuti, o valori oltre la frequenza massima plausibile).
  - Rilevamento del *cadence lock* (battito che sale a gradino agganciandosi alla cadenza $\pm 3$ spm a passo costante).
  - Pulizia e interpolazione degli outlier per i calcoli di tempo in zona e stima passo/battito.
- **Indice di affidabilità dei dati notturni (RHR / HRV / Sonno)**:
  - Valutazione della completezza della notte (sonno $<4$ ore o ampi buchi di registrazione degradano l'affidabilità a `parziale`).
  - La prontezza e gli allarmi di sicurezza modulano il proprio verdetto ("Dato parziale: procedi con cautela" anziché "Oggi fermati").
- **Esposizione della qualità del dato all'atleta**:
  - Badge di affidabilità su ogni seduta analizzata (`hr_quality`: `alta` | `media` | `bassa`) e segnalazione trasparente di quanti campioni o minuti anomali sono stati corretti.
  - Indicatore di confidenza del dato notturno nella scheda Corpo.

## Capabilities

### New Capabilities
- `heart-rate-cleaning`: Algoritmi di rilevamento outlier, scarto spike, neutralizzazione cadence lock e calcolo del punteggio di qualità dello stream cardio.
- `biometric-data-quality`: Indice di completezza e affidabilità per dati notturni (sonno, HRV, frequenza a riposo) con degradazione controllata degli allarmi.

### Modified Capabilities
<!-- Nessuna modifica ai requisiti delle capability esistenti; i filtri rafforzano i dati in ingresso -->

## Impact

- `training_plan/intensity.py`: utilizzo dello stream cardio pulito per istogrammi e calcolo tempo nelle zone.
- `training_plan/paces.py`: campioni per stima passo/battito depurati dagli spike e dal cadence lock.
- `training_plan/body_insights.py` & `training_plan/readiness.py`: classificazione dell'affidabilità della notte e prevenzione di allarmi su dati frammentari.
- `training_plan/api/schemas.py`: campi `hr_quality` nell'analisi seduta e `reliability` nello snapshot del corpo.
- Frontend: badge di qualità discreto nelle schermate di dettaglio seduta e prontezza.

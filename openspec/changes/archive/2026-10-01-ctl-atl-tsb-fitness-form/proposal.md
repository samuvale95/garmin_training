## Why

Garmin Connect restituisce un valore aggregato settimanale del carico e un rapporto acuto/cronico (ACWR), ma non espone il modello fisiologico completo di **Fitness, Fatica e Forma** (CTL, ATL, TSB: modello impulso-risposta di Banister / Coggan).
Per un atleta che prepara una maratona (come la Venice Marathon) o gare di fondo, è fondamentale conoscere il proprio bilanciamento di stress: sapere se ci si trova in una fase di sovraccarico produttivo ($TSB \in [-25, -10]$), a rischio overreaching ($TSB < -25$), o se lo scarico (tapering) sta portando la freschezza al picco ottimale per il giorno della gara ($TSB \in [+5, +20]$).

## What Changes

- **Calcolo del Training Load giornaliero**: stima dell'impulso di allenamento (TRIMP / Training Load) per ogni attività completata a partire da durata, frequenza cardiaca ed intensità rispetto alle soglie, integrando i dati storici salvati.
- **Modello esponenziale continuo CTL / ATL / TSB**:
  - **CTL (Chronic Training Load / Forma fisica)**: media mobile esponenziale con costante temporale $\tau = 42$ giorni.
  - **ATL (Acute Training Load / Fatica)**: media mobile esponenziale con costante temporale $\tau = 7$ giorni.
  - **TSB (Training Stress Balance / Freschezza e Forma)**: $TSB = CTL - ATL$.
- **Classificazione dello stato di forma**: interpretazione automatica del TSB in 5 zone (Overreaching / Rischio infortunio, Costruzione ottimale, Neutro / Mantenimento, Freschezza / Picco gara, Perdita di forma / Detraining).
- **Proiezione verso la gara (Venice Marathon)**: simulazione dell'andamento di CTL, ATL e TSB sulle sedute pianificate fino alla gara obiettivo per verificare la riuscita del tapering.
- **Nuovo endpoint API e UI integrata**: endpoint `/body/fitness-fatigue` e componente visivo su `/body/load` con grafici delle curve e indicatore dello stato di forma in stile Passo.

## Capabilities

### New Capabilities
- `fitness-fatigue-model`: Calcolo del carico giornaliero, simulazione continua di CTL, ATL, TSB e proiezione di freschezza per la gara.

### Modified Capabilities
<!-- None -->

## Impact

- `training_plan/fitness_fatigue.py`: nuovo modulo di calcolo matematico deterministico per CTL/ATL/TSB e proiezioni.
- `training_plan/api/routes_body.py`: nuovo endpoint `/body/fitness-fatigue`.
- `training_plan/api/schemas.py`: schemi per serie storiche e proiezioni di forma e fatica.
- `web/src/lib/types.ts` & `web/src/lib/queries.ts`: tipi TypeScript e hook React Query.
- `web/src/app/(tabs)/body/load/page.tsx`: aggiunta del grafico di Fitness / Fatigue / Form e della proiezione gara.

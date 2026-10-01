## Context

Garmin Connect fornisce agli utenti una schermata a barre di "Carico di allenamento" per 4 settimane e un rapporto acuto:cronico (ACWR). Tuttavia, questo approccio non scompone i due fattori biologici antagonisti definiti dal modello impulso-risposta di Banister / Coggan:
1. **Fitness (Chronic Training Load - CTL)**: l'adattamento fisiologico a lungo termine che richiede tempo per essere costruito (emivita di ~42 giorni).
2. **Fatigue (Acute Training Load - ATL)**: lo stress e la fatica a breve termine che si accumulano rapidamente e si dissipano rapidamente (emivita di ~7 giorni).
3. **Form / Freshness (Training Stress Balance - TSB)**: $TSB = CTL - ATL$. Quando la fatica supera la fitness, il TSB è negativo; quando la fatica si dissipa durante lo scarico mantenendo la fitness, il TSB diventa positivo, creando il picco di forma per il giorno della gara.

In vista di una maratona come la Venice Marathon (o qualsiasi gara target), la gestione delle ultime 3-4 settimane di tapering è critica: arrivare alla partenza con un $TSB \in [+5, +20]$ garantisce gambe riposate e fitness intatta, mentre un $TSB < 0$ indica fatica residua e un $TSB > +25$ indica perdita di tono aerobico.

## Goals / Non-Goals

**Goals:**
- Implementare un calcolo deterministico e trasparente del Training Load giornaliero per ogni attività completata e per le sedute future del piano.
- Implementare il modello esponenziale a doppio decadimento ($CTL: \tau=42\text{d}$, $ATL: \tau=7\text{d}$, $TSB = CTL - ATL$).
- Inizializzare lo storico in modo stabile anche con dati storici parziali (evitando salite artificiali da zero).
- Classificare il TSB in 5 zone fisiologiche chiare con consigli pratici per l'atleta.
- Proiettare le curve di CTL, ATL e TSB nel futuro fino al giorno della maratona/gara obiettivo usando le sedute pianificate.
- Esporre i dati tramite l'endpoint `/body/fitness-fatigue` e integrarli nella UI di `/body/load` con estetica coerente a Passo.

**Non-Goals:**
- Non sostituire la telemetria proprietaria di Garmin Connect: il modello Passo lavora in parallelo su tutte le attività salvate (Garmin e Strava) e sulle sessioni future.
- Non richiedere un misuratore di potenza / Stryd obbligatorio: il carico è stimabile in modo ibrido (carico nativo Garmin > TRIMP basato su FC > rTSS basato su passo/durata).

## Decisions

### 1. Stima del Training Load giornaliero
Per ogni giorno del calendario:
- Se sono presenti una o più attività completate:
  - Priorità 1: Se l'attività ha un `training_load` numerico salvato da Garmin, viene sommato direttamente.
  - Priorità 2: TRIMP fisiologico basato su frequenza cardiaca media, frequenza a riposo e frequenza massima:
    $$\Delta HR = \frac{HR_{avg} - HR_{rest}}{HR_{max} - HR_{rest}}$$
    $$\text{TRIMP} = \text{duration\_min} \times \Delta HR \times 0.64 \times e^{1.92 \times \Delta HR}$$
    Normalizzato in punti TSS equivalenti ($100 \text{ pt} \approx 60' \text{ a soglia anaerobica}$).
  - Priorità 3: Stima da passo/durata in base ai km percorsi e all'intensità dichiarata della seduta.
- Per le sedute future pianificate:
  - Il carico viene calcolato in base alla durata prevista della sessione moltiplicata per l'Intensity Factor ($IF$) della tipologia di seduta (recupero: 40/h, corsa facile: 50/h, medio/lungo: 65/h, ripetute/tempo: 80/h).

### 2. Modello Esponenziale Continuo (Banister / Coggan)
Per ogni giorno $t$:
$$CTL_t = CTL_{t-1} + (Load_t - CTL_{t-1}) \cdot (1 - e^{-1 / 42})$$
$$ATL_t = ATL_{t-1} + (Load_t - ATL_{t-1}) \cdot (1 - e^{-1 / 7})$$
$$TSB_t = CTL_t - ATL_t$$

Per evitare che le curve partano da 0 all'inizio della serie storica disponibile, il punto di partenza viene inizializzato con la media pesata delle prime due settimane di carico.

### 3. Fasce di Training Stress Balance (TSB)
- **Overreaching / Alto Rischio** ($TSB < -25$): Fatica acuta eccessiva. Consigliato alleggerire o inserire riposo prima che subentri infortunio.
- **Costruzione Ottimale** ($-25 \le TSB \le -10$): Zona ideale di sovraccarico funzionale durante i blocchi di volume e qualità.
- **Mantenimento / Neutro** ($-10 < TSB \le +5$): Equilibrio tra stimolo e recupero, forma costante.
- **Freschezza e Picco Gara** ($+5 < TSB \le +20$): La "sweet spot" per il giorno della gara. La fatica è azzerata, la fitness è preservata al 95%+.
- **Transizione / Detraining** ($TSB > +20$): Mancanza prolungata di stimoli, inizio della perdita di adattamenti cardiocircolatori.

### 4. Proiezione Tapering per la Gara
Dalla data odierna fino alla data della gara obiettivo:
- Il sistema propaga il modello giorno per giorno applicando il carico atteso delle sedute future presenti nel piano.
- Calcola il $TSB_{\text{gara}}$ stimato e genera un responso:
  - Se $5 \le TSB_{\text{gara}} \le 20$: Tapering bilanciato e picco di freschezza atteso.
  - Se $TSB_{\text{gara}} < 5$: Tapering troppo breve o carico finale troppo pesante (rischio gambe pesanti in maratona).
  - Se $TSB_{\text{gara}} > 20$: Tapering troppo aggressivo o prolungato (rischio perdita di reattività).

## Risks / Trade-offs

- [Storico attività breve nel database] → Mitigazione: se l'utente ha pochi giorni di attività, il sistema applica un warmup basato sui giorni presenti ed espone un disclaimer "Stima in calibrazione (richiede 3-4 settimane di dati per piena precisione)".
- [Disallineamento tra scala Garmin e scala TRIMP] → Mitigazione: normalizzazione coerente di tutti i carichi su scala TSS (1 ora alla soglia del lattato = 100 punti).

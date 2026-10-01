## Context

I sensori cardio (fasce toraciche e cardiofrequenzimetri ottici da polso) sono soggetti ad artefatti fisici frequenti:
1. **Spike elettrostatici**: all'inizio della corsa, prima che la pelle sudi, lo sfregamento della maglietta tecnica induce picchi spuri a 200–220 bpm della durata di pochi secondi.
2. **Cadence lock**: nei sensori ottici, il movimento dell'arto scambia il flusso sanguigno per l'oscillazione del braccio, facendo saltare improvvisamente il battito (es. da 135 a 175 bpm) per minuti interi mentre il passo rimane identico.
3. **Blackout / drop out**: interruzioni temporanee della lettura (battiti a 0 o 30 bpm).
4. **Dati notturni parziali**: orologio sfilato prima di svegliarsi, batteria scarica o sonno inferiore a 4 ore che producono medie HRV e RHR distorte.

Attualmente l'applicazione passa questi numeri grezzi a `time_in_zone()`, `heart_rate_histogram()`, `pace_at_heart_rate()` e `evaluate_signals()`. Un picco finto falsa il tempo in zona 4/5, distorce la stima di efficienza aerobica e può scatenare allarmi ingiustificati.

## Goals / Non-Goals

**Goals:**
- Implementare una pipeline pura e deterministica `clean_heart_rate_stream(...)` che rileva spike non fisiologici, disconnessioni e cadence lock.
- Interpolare buchi brevi ($\le 10$ secondi) ed escludere intervalli irrecuperabili dai calcoli di zona e passo/battito.
- Calcolare un indice di qualità dello stream cardio (`alta`, `media`, `bassa`) e il conteggio dei minuti corretti.
- Definire l'indice di affidabilità dei dati del corpo notturni (`affidabile` vs `parziale`).
- Evitare che un dato notturno parziale attivi allarmi severi di stop allenamento ("Oggi fermati").
- Esporre la qualità del dato nelle API e nell'interfaccia con indicatori visivi discreti.

**Non-Goals:**
- Modificare i file originali o i dati grezzi su Garmin Connect/Strava: la pulizia avviene in memoria durante l'elaborazione analitica.
- Inventare dati sintetici dove mancano lunghi tratti di registrazione: se il dato è assente per 20 minuti, la qualità viene segnalata come bassa.

## Decisions

### 1. Criteri fisiologici per il rilevamento spike
- **Derivata temporale $|dHR/dt|$**: una variazione istantanea $>5$ bpm al secondo non è fisiologicamente possibile per il cuore umano. Se il battito salta di 25 bpm in 2 secondi senza variazione di velocità, è un artefatto.
- **Tetti plausibili**: valori $>215$ bpm (o $>\text{max\_hr} + 5$) o $<35$ bpm vengono marcati come invalidi.
- **Riparazione**: i buchi isolati ($\le 10$ s) vengono interpolati linearmente tra il valore precedente valido e il successivo; i tratti anomali più lunghi vengono azzerati/marcati `None`.

### 2. Rilevamento del Cadence Lock
- Un salto a gradino di $\ge 20$ bpm in meno di 5 secondi, in cui $|HR - \text{Cadenza}| \le 3$ per almeno 20 secondi consecutivi mentre il passo è stabile ($\pm 5\%$).
- Quando rilevato, i campioni vengono esclusi dal calcolo delle zone e dalla regressione passo/battito per non contaminare la stima aerobica.

### 3. Struttura del risultato di pulizia
```python
@dataclass(frozen=True)
class StreamQualityResult:
    cleaned_heart_rates: list[float | None]
    raw_heart_rates: list[float | None]
    valid_ratio: float  # percentuale campioni affidabili (es. 0.98)
    quality: Literal["alta", "media", "bassa"]
    spikes_detected: int
    cadence_lock_seconds: int
```

### 4. Affidabilità biometrica notturna
- In `training_plan/body_insights.py`: calcolo `overnight_reliability`.
  - Se `sleep_minutes < 240` (meno di 4 ore registrate) o `hrv_last_night_ms is None` o buchi nel tracciamento: `reliability = "parziale"`.
  - Altrimenti: `reliability = "affidabile"`.
- In `readiness.py`: se `reliability == "parziale"`, gli alert di battito a riposo elevato o HRV depresso non possono superare la severità moderata e aggiungono la nota: *"Dato notturno parziale (3h registrate): interpretazione con cautela"*.

## Risks / Trade-offs

- [Falso positivo su scatto massimale o ripetuta breve] → Mitigazione: se anche la velocità ($v$) o la potenza aumentano bruscamente nello stesso istante, il filtro riconosce l'inizio di una ripetuta e non scarta la salita del battito.
- [Perdita di dati se il sensore si blocca] → Mitigazione: l'app non inventa dati, ma espone con trasparenza il badge "Qualità cardio: bassa (sensore instabile)".

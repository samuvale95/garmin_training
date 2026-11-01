# Allenamenti Garmin: codici e struttura reali

Letti da un account reale nel novembre 2026, in sola lettura: l'elenco ufficiale
`GET /workout-service/workout/types` e alcuni allenamenti salvati (forza, nuoto, bici)
tramite `GET /workout-service/workout/{id}`. Nessun allenamento è stato creato o
modificato. Questo file sostituisce i valori presi da codice di terzi, che erano
sbagliati per nuoto, forza e "altro".

## Sport (`sportType`)

| id | key | uso in Passo |
|---|---|---|
| 1 | running | corsa, e trail (Garmin non ha un tipo trail per gli allenamenti) |
| 2 | cycling | bici, strada e rulli |
| 3 | other | altro |
| 4 | swimming | nuoto in piscina |
| 5 | strength_training | forza e corpo libero |
| 6 | cardio_training | — |
| 7 | yoga | — |
| 8 | pilates | — |
| 9 | hiit | — |
| 10 | multi_sport | possibile in futuro per bici + corsa (da provare) |
| 11 | mobility | mobilità |
| 13 | rucking | — |

## Fasi (`stepType`)

1 warmup · 2 cooldown · 3 interval · 4 recovery · 5 rest · 6 repeat · 7 other · 8 main

## Condizioni di fine (`endCondition`)

1 lap.button · 2 time · 3 distance · 4 calories · 5 power · 6 heart.rate ·
7 iterations · 8 fixed.rest · 9 fixed.repetition · **10 reps** · 11 training.peaks.tss ·
12 repetition.time · 16 repetition.swim.css.offset (gli altri riguardano il VBT)

## Obiettivi (`targetType`)

1 no.target · 2 power.zone · 3 cadence · 4 heart.rate.zone · 5 speed.zone ·
6 pace.zone · 7 grade · 8 heart.rate.lap · 9 power.lap · 13 speed.lap ·
14 swim.stroke · 15 resistance · 17 swim.css.offset · 18 swim.instruction ·
19 instruction

## Nuoto

- Stili (`strokeType`): 1 any_stroke · 2 backstroke · 3 breaststroke · 4 drill · 5 fly ·
  6 free · 7 individual_medley · 8 mixed
- Attrezzi (`equipmentType`): 1 fins · 2 kickboard · 3 paddles · 4 pull_buoy · 5 snorkel
- Esercizi tecnici (`drillType`): 1 kick · 2 pull · 3 drill
- Intensità (`swimInstructionType`): 1 recovery … 7 all_out, 8 fast, 9 ascend, 10 descend
- La lunghezza della vasca sta sull'allenamento: `poolLength: 50.0` e
  `poolLengthUnit: {unitId: 1, unitKey: "meter", factor: 100.0}`. Cambiare vasca vuol
  dire riscrivere l'allenamento.
- Struttura tipica: fasi a distanza (`distance`, in metri), pause a tempo o "premi il
  tasto" (`lap.button`), ripetute in `RepeatGroupDTO`, il passo per 100 m scritto nella
  descrizione della fase.

## Forza e corpo libero

- Ogni fase di lavoro porta `category` ed `exerciseName` dal catalogo pubblico
  `https://connect.garmin.com/web-data/exercises/Exercises.json` (47 categorie, 1.531
  esercizi, con muscoli primari e secondari, `isBodyWeight` e la variante con
  sovraccarico in `counterpart`). Esempi: `PUSH_UP/PUSH_UP`, `PLANK/SIDE_PLANK`,
  `PULL_UP/PULL_UP`, `TRICEPS_EXTENSION/BODY_WEIGHT_DIP`.
- Fine della fase: `reps` (ripetizioni), `time` (isometrie come il plank) o `lap.button`.
- Peso: `weightValue: -1` quando è a corpo libero.
- Le serie sono un `RepeatGroupDTO` che alterna esercizio e pausa a tempo.
- Il catalogo non dice l'attrezzatura (sbarra, anelli, elastici): quella va mappata da noi.

## Bici

- Fasi a tempo con obiettivo `power.zone` e i watt in `targetValueOne`/`targetValueTwo`
  (es. 162–178 W), oppure `heart.rate.zone` o `cadence` per chi non misura la potenza.
- Le fasi centrali usano spesso il tipo `other` invece di `interval`.

## Verificato con andata e ritorno (novembre 2026)

Allenamenti caricati, riletti e cancellati subito sull'account reale:

- **Nuoto**: `poolLength` 50 + `poolLengthUnit` metri, passi a distanza in metri,
  `strokeType` (free, backstroke) ed `equipmentType` (pull_buoy) tornano identici.
- **Bici**: obiettivo principale `power.zone` 220–240 W e **secondario** `cadence`
  85–95 rpm sullo stesso passo (`secondaryTargetType`, `secondaryTargetValueOne/Two`);
  `heart.rate.zone` 120–135 con i battiti come valori assoluti. Tutto torna identico.
- **Forza**: `category` + `exerciseName` e fine a `reps`, confermati anche sull'orologio.

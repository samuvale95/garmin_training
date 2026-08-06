# Prompt per Claude Design — blocchi "Carburante" e "Dati personali"

Incolla tutto quello che segue.

---

Stai disegnando dei blocchi nuovi per **Passo**, una PWA mobile-first di allenamento
per la corsa. Il design system esiste già: leggi prima `web/src/app/globals.css`,
`web/src/components/motion/primitives.tsx` e `web/src/app/(tabs)/body/page.tsx`, che è
la schermata stilisticamente più vicina a quelle nuove.

## Vincoli non negoziabili

**Linguaggio.** Tutte le stringhe a schermo in italiano, minuscolo dove il resto
dell'app lo è, tono editoriale e asciutto. Il codice, i nomi di variabili e i commenti
in inglese.

**Il frame.** Larghezza massima 430px (`--frame-max-width`), tutto pensato per il
pollice. Padding orizzontale 20-22px come le schermate esistenti.

**Palette e token.** Usa solo le variabili CSS esistenti — niente colori nuovi:
`--crema` (sfondo), `--crema-card`, `--sabbia`, `--inchiostro` (testo e card scure),
`--inchiostro-50` (testo secondario), `--corallo`, `--verde` / `--verde-testo`,
`--azzurro` / `--azzurro-testo`, `--giallo` / `--giallo-testo`, `--lilla`,
`--rosa-avviso` / `--rosso-avviso`. Raggi: `--radius-card-lg` (27) per gli eroi,
`--radius-card` (22), `--radius-chip` (14), `--radius-pill`.

**Tipografia.** Outfit di default; `.font-mono` (DM Mono) per **tutti i numeri**;
`.font-serif-italic` (Instrument Serif) per le frasi di commento, mai per i dati.

**Movimento.** Riusa `SlideUp`, `WordIn`, `ProgressRing`, `BarGrow`, `PulseRing` da
`components/motion/primitives.tsx`, con `useMountOnce` per animare solo al primo
ingresso. Massimo tre animazioni in contemporanea, una sola illustrazione "che respira"
per schermata.

**La regola di contenuto più importante.** Questa è una funzione di **rifornimento, mai
di restrizione**. Niente calorie da tagliare, niente peso obiettivo, niente giudizio su
cosa è stato mangiato, niente barre "rosse" perché hai superato qualcosa. La parola
"dieta" non compare mai. Superare il target di carboidrati non è un errore: la barra si
riempie e basta, non diventa un avviso. Gli unici avvisi ammessi riguardano il
**mancare** carburante prima di una sessione dura.

## Cosa disegnare

### A — Corpo e dati personali (dentro `/settings`)

**A1. Card "Il tuo corpo".** Sta in `web/src/app/settings/page.tsx`, sotto la card
profilo, con lo stesso stile delle card esistenti (`--crema-card`, raggio `--radius-card`).

Mostra peso, altezza, età. Il peso è il dato che conta — gli altri sono di contorno,
più piccoli. Sotto il peso, una riga minuscola con la provenienza e la data:
*"dalla bilancia Garmin · 4 agosto"* oppure *"dal profilo Garmin"* oppure *"inserito da te"*.

Il peso è **modificabile a mano**: un valore inserito dall'utente vince su Garmin finché
non lo cancella. Serve un affordance di modifica discreta (tap sul numero → input
numerico con unità "kg"), non un form sempre aperto.

Stato senza dato: *"Non ho il tuo peso"* + un input per inserirlo, con una riga che
spiega perché serve — *"serve per calcolare quanti carboidrati ti servono"* — senza
insistere.

Dati disponibili: `{ weight_kg: number|null, measured_on: string|null, source: "scale"|"profile"|"manual"|null, height_cm: number|null, age: number|null }`.

### B — Ingresso dalla tab Corpo

**B1.** In fondo a `/body` c'è già una lista di `NavRow` (oggi solo "Carico 4 settimane").
Aggiungi **"Carburante"**, ma non come riga muta: una card compatta che anticipa già la
risposta, perché nel 90% dei casi l'utente non aprirà mai la schermata piena.

> **Carburante** · Domani il lungo → *stasera carboidrati* → `520-740 g`

Deve degradare a una riga semplice quando non c'è né peso né piano.

### C — Schermata `/body/fuel` — "Carburante"

Sfondo `--crema`, header con `PageHeader` (freccia indietro) come `/body/load`.

**C1. Eroe "Domani".** La card più importante della schermata: è l'unica cosa utile
quando non hai fotografato niente. Card scura (`--inchiostro`) o verde, con:
- l'etichetta della sessione di domani (*"Domani: lungo 18 km"*), o *"Domani riposo"*
- la fascia di carboidrati in grammi, in mono e grande: `520-740 g`
- sotto, in secondario, il rapporto: `7-10 g per kg`
- una frase in serif italic: *"Stasera pasta, e colazione almeno due ore prima."*

**C2. Blocco "Oggi".** Due indicatori affiancati, carboidrati e proteine: quanto hai
assunto rispetto al target di oggi. Usa `ProgressRing` per i carboidrati (il dato
protagonista) e una barra per le proteine, oppure due barre — scegli tu, ma i numeri
devono essere leggibili senza fare i conti: `310 g` su `450-630 g`.

Tre stati, tutti da disegnare:
1. **niente registrato** (il default): niente zeri e niente anelli vuoti, che sembrano
   un fallimento. Mostra il target del giorno come informazione, non come debito, e la
   CTA per fotografare.
2. **qualcosa registrato**: gli indicatori pieni, sempre etichettati **"stima"**.
3. **degradato**: manca il peso → i target come range assoluti su un peso di
   riferimento dichiarato (*"su 70 kg di riferimento"*); manca il piano → solo i valori
   di mantenimento.

**C3. Lista dei pasti di oggi.** Una riga per voce: miniatura della foto (quadrata,
raggio `--radius-chip`), la descrizione del modello (*"pasta al pomodoro, pane"*),
i macro in mono (`85 g C · 22 g P`), l'ora. Due marcatori:
- chip di **confidenza** (`bassa` / `media` / `alta`) — una stima a confidenza bassa
  deve *sembrare* un'ipotesi, non un dato
- badge **"corretto da te"** quando l'utente ha modificato i numeri

Tap sulla riga → sheet di modifica (E1). Swipe o azione esplicita per eliminare.

**C4. CTA "Fotografa il piatto".** Bottone principale, pieno, corallo, che apre la
fotocamera. Deve restare raggiungibile anche con la lista lunga.

**C5. Blocco commento.** Una o due frasi in `.font-serif-italic` su `--sabbia`, scritte
dal modello. Ha bisogno di un aspetto tale che **la versione template e quella del
modello siano indistinguibili** — non deve esistere un badge "AI".

**C6. Nota a piè di schermata.** Riga piccolissima, `--inchiostro-50`:
*"Orientamento sportivo generale, non un consiglio clinico."*

### D — Flusso foto

**D1. Cattura.** Si appoggia all'input fotocamera nativo. Serve la schermata subito
dopo: anteprima della foto a tutta larghezza, con lo stato di attesa.

**D2. Stato "sto stimando".** Dura 3-8 secondi reali. Non uno spinner: qualcosa che dia
il senso che il modello sta *guardando* il piatto. Riusa `PulseRing` o uno skeleton dei
campi che stanno per riempirsi.

**D3. Card stima.** La foto in alto, poi descrizione, kcal e i tre macro. **Ogni campo
modificabile prima di salvare** — la correzione è il percorso principale, non un ripiego.
Il chip di confidenza sta qui in evidenza: con confidenza bassa il copy invita
esplicitamente a correggere (*"Non sono sicuro delle porzioni — sistemale tu"*).
Due azioni: **Salva** e **Scarta**.

**D4. Errore.** Modello non raggiungibile o foto illeggibile. Deve offrire
l'inserimento manuale dei macro come uscita, non solo un "riprova".

### E — Correzione e storico

**E1. Sheet di modifica.** Stessi campi di D3, aperto da una riga esistente. Salvando,
la voce diventa "corretta da te".

**E2. Storico settimanale.** Sette colonnine (lun-dom), ognuna che mostra quanto ci si è
avvicinati al target di quel giorno. **Non colorare di rosso i giorni sotto target**:
usa `--neutro-barra` per i giorni scarichi e `--verde-tratto` per quelli in target, e
una didascalia che spiega l'andamento invece di giudicarlo.

## Contratti dati (già definiti lato backend)

```ts
type FuelTargets = {
  date: string;                    // YYYY-MM-DD
  weight_kg: number | null;
  weight_source: "scale" | "profile" | "manual" | "reference" | null;
  today: DayTarget;
  tomorrow: DayTarget;
  advice: string;                  // frase deterministica, sempre presente
  narrative: string | null;        // frase del modello, quando disponibile
};

type DayTarget = {
  date: string;
  session_title: string | null;
  load: "riposo" | "facile" | "moderato" | "duro" | "molto_lungo";
  duration_minutes: number | null;
  carb_g_per_kg: [number, number];
  carb_g: [number, number] | null;      // null senza peso
  protein_g_per_kg: [number, number];
  protein_g: [number, number] | null;
};

type FoodEntry = {
  id: number;
  date: string;
  logged_at: string;               // ISO 8601
  source: "photo" | "manual";
  description: string | null;
  kcal: number | null;
  carb_g: number | null;
  protein_g: number | null;
  fat_g: number | null;
  confidence: "low" | "medium" | "high" | null;
  corrected: boolean;
  image_url: string | null;
};

type FuelDay = { date: string; entries: FoodEntry[]; totals: {...}; targets: FuelTargets };
```

## Cosa NON disegnare

- Nessun grafico calorico, nessun bilancio energetico, nessuna proiezione di peso.
- Nessuna schermata di onboarding nutrizionale: i dati che servono o ci sono o si
  degradano.
- Nessun badge "generato dall'AI".
- Niente quarto tab: "Carburante" vive dentro Corpo, come `/body/load`.

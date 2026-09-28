# Dubbi da verificare con l'uso

Scelte fatte "a prima stima" o limiti noti, emersi durante lo sviluppo di fase 0–2 e
della gamification. Si riguardano man mano che l'app viene usata: per ognuno c'è come
accorgersene e cosa cambiare. Quando un dubbio si chiude, si cancella da qui (o si sposta
nella sezione in fondo con la decisione presa).

## Da provare a mano (UI mai vista in un browser)

Tutte le schermate nuove sono passate da typecheck, lint e build, ma nessuna è stata
guardata girare:

- attesa animata della generazione (corsa, bici, palestra) e card "Genera" su Settimana;
- check-in su Oggi (quando compare, i due tocchi, la zona del dolore, "Cambia");
- foglio degli avvisi dopo uno spostamento (Adatta / Confermo / Annulla), da Settimana e dall'editor;
- blocco degli spostamenti e dei salvataggi mentre il piano viene riscritto;
- resoconto settimanale (`/summary`), card del lunedì su Oggi, link da Settimana;
- Progressi (`/progress`), card con mascotte su Oggi, punti nel resoconto;
- card di adattamento su Oggi (proposta, applicato con annulla, attesa dopo 1,5 s);
- interruttore della modalità di adattamento nella schermata Livello.

## Piano generato

- **Lungo della maratona corto**: con 167 minuti a settimana il lungo arriva al massimo a
  90 minuti a 4 settimane dalla gara. È prudente per costruzione (cresce dal volume
  attuale). Se sembra troppo poco: alzare la quota del lungo o il tetto per distanza in
  `plan_skeleton.py`.
- **Parametri dello scheletro sono una prima stima** (crescita 5/7/10%, settimana leggera
  al 75–80%, tetti per distanza, quota del lungo per giorni). Si vede dalle frasi "perché"
  di ogni settimana: se una suona sbagliata, il numero è lì.
- **Modello di default (DeepSeek v3.2)**: sul tuo account ha passato i controlli al 2°
  tentativo in 43 s. Se le sedute o le descrizioni sono scarse, cambiare `LLM_PLAN_MODEL`
  senza toccare codice.
- **Le descrizioni del modello possono sbagliare il contesto** (ha scritto "ultima corsa
  prima della maratona" una settimana prima della settimana di gara). I numeri sono
  controllati, le parole no.
- **Tempi**: di solito 30–60 s, nel caso peggiore circa 3,5 minuti. Da verificare che il
  proxy davanti all'API in produzione non tagli le richieste lunghe.

## Limiti e avvisi

- **Il limite del lungo è largo sul tuo account**: parte dalla corsa più lunga delle
  ultime 8 settimane per durata, che è un trail di 3 h. Se serve: usare solo corse su
  strada, o il 90° percentile.
- **Sedute senza step sono invisibili alle regole sui minuti** (piani importati con "Lungo
  15km" e nessuno step). Il piano generato scrive sempre gli step; quelli importati no.
- **Le sedute già fatte, lette dallo storico, contano come facili** (lo storico ha minuti,
  non ripetute): ripetute vere fatte ieri non fanno scattare "due giorni duri di fila".
  Rimedio futuro: il tipo della seduta dal battito.
- **Avvisi solo sulle sedute del piano**, non sugli allenamenti del solo calendario Garmin.
- **Quanto spesso scattano gli avvisi**: le scelte sono registrate in `move_decision`. Se una
  regola viene quasi sempre confermata, è troppo severa.

## Check-in

- **Quando compare**: con Garmin collegato dipende dall'attività di oggi vista da Garmin;
  senza Garmin dalla seduta del piano. Se non compare quando dovrebbe, guardare lì.
- **Il dolore da solo rende la giornata "cauta", non ferma**: coerente con gli altri
  segnali. Da rivedere se sembra poco.

## Resoconto e gamification

- **Serie di 43 settimane sul tuo account** grazie a 3 salva-serie in un anno: è la regola
  (1 gettone ogni 4 settimane, massimo 2), ma è da sentire se "regala" troppo.
- **Valori dei punti sono una prima stima** (+10 giorno del piano, +5 riposo, +3 check-in,
  +10 scelta intelligente, +20 settimana attiva, +20 piano completo, −10 oltre il 130%).
- **"Come da piano" è morbido**: conta il giorno allenato, non la seduta identica. Con
  l'adattamento ora attivo si potrebbe stringere.
- **Badge e serie guardano solo le ultime 52 settimane**: "Primo passo" risulta senza data
  se la prima corsa è più vecchia.
- **Nessuna intensità dal battito nel resoconto** (serve la soglia Garmin a ogni lettura).

## Adattamento

- **Una seduta saltata riscrive tutta la finestra** (fino a 3 settimane), sostituendo le
  sedute non bloccate: tante modifiche per un piano importato. Alternativa: solo il resto
  della settimana più la prossima.
- **Niente notifiche push**: l'adattamento si vede aprendo Oggi.
- **La prontezza usata dall'adattamento** viene dallo snapshot del corpo in cache (10
  minuti); se Garmin non risponde, l'evento semplicemente non scatta.
- **Modifiche dall'editor durante un adattamento non sono bloccate lato UI** (lo sono solo
  durante la generazione). Il server non sovrascrive: le sedute modificate diventano
  bloccate e la scrittura controlla che il piano non sia cambiato.

## Dati e ambiente

- **Scritture sul database di produzione durante le prove**: livello salvato portato a 3
  (corretto: era 1 perché la schermata livello non era mai stata aperta); create le tabelle
  `checkin` e `move_decision` (vuote). `plan_adaptation` verrà creata all'avvio.
- **22 test falliscono da prima** (`test_db`, `test_api`, `test_api_caching`,
  `test_api_nutrition`): non toccati da questo lavoro.
- **Build locale**: Turbopack non ha i binding nativi su questa macchina; si compila con
  `npx next build --webpack`.
- **Change OpenSpec da archiviare**: `daily-check-in`, `move-warnings`, `weekly-summary`,
  `gamification-core`, `plan-adaptation`, `ai-plan-generation`. `weekly-summary` va
  archiviata prima di `gamification-core`, che ne modifica una spec.

## Chiusi

_(niente ancora)_

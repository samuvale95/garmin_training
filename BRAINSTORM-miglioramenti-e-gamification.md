# Brainstorming — miglioramenti e gamification

Raccolta delle idee emerse in una sessione di brainstorming. Non è un piano: è il
serbatoio da cui scegliere cosa trasformare in proposte OpenSpec (`/opsx:propose`).

Vincolo che vale per tutto quello che segue (da `PLAN-analisi-dati.md`): **ogni numero
è deterministico e ricontrollabile a mano, l'LLM scrive solo la prosa.** Vale anche per
i punti di gioco: ogni punto deve poter essere spiegato ("+10 perché l'easy è rimasto
92% in Z2"). Con il piano e il cibo gestiti dall'AI il vincolo si precisa, non cade:
vedi §0.4.

---

## 0. Scopo — il filtro per ogni idea

Senza uno scopo comune questo documento diventa mille feature scollegate. Ogni idea
qui sotto deve dire quale parte dello scopo serve; se non ne serve nessuna, si scarta.

### 0.1 Scopo primario

> **Passo trasforma i dati del tuo Garmin in una guida semplice, che ti fa allenare con
> costanza e migliorare: dal primo allenamento al livello atleta.**

L'app è pensata per utenti diversi, non per un solo profilo.

### 0.2 Gerarchia

- **Fine — costanza e miglioramento.** Allenarsi con regolarità, e diventare più forti e
  più sani. La costanza è la metrica principale: una feature che non aiuta a tornare ad
  allenarsi la settimana dopo deve giustificarsi bene.
- **Mezzo — semplicità.** Dati spiegati in modo semplice, un orologio che si usa senza
  fatica. Chi non capisce smette.
- **Strumento — AI.** Genera il piano, spiega, guida. Dentro i limiti di §0.4.
- **Vincolo — salute.** Nessun consiglio deve spingere verso un infortunio o un sovraccarico.

Le domande a cui ogni feature deve rispondere:

| Sigla | Domanda |
|---|---|
| **D1 — oggi** | Faccio la seduta prevista, la modifico, riposo? |
| **D2 — blocco** | Il mio allenamento è giusto per l'obiettivo? Cosa cambio? |
| **D3 — obiettivo** | Ci arrivo? È ancora realistico? |
| **C — costanza** | Mi aiuta a continuare ad allenarmi? |
| **V1 — salute** | Evita che una decisione mi faccia male? |
| **V2 — fiducia** | Il dato su cui decido è affidabile? |

### 0.3 Livelli

La stessa app dice cose diverse a seconda di dove si trova l'utente. Si sale per dati e
costanza accumulati, non per scelta.

- **L1 — abitudine.** Obiettivo: costanza. Poche metriche (sedute fatte, minuti, "è stata
  facile?" dal check-in). Niente zone: molti principianti non hanno ancora una soglia
  stimata da Garmin.
- **L2 — struttura.** Arrivano zone, facile contro duro, un primo piano verso un obiettivo.
- **L3 — atleta.** Polarizzazione, soglie, carico, previsione gara: quello che l'app già fa
  oggi in `/coach`.

Il passaggio di livello è anche la spina dorsale naturale della gamification (§6–9).

### 0.4 Principio AI: propone l'AI, i limiti li fissa il codice, l'ultima parola è dell'utente

Il piano oggi è già uno YAML generato da un'AI: portare la generazione dentro l'app
semplifica, non cambia la natura. Le regole:

1. **I limiti li calcola il codice**, in modo deterministico: aumento massimo di volume
   settimanale, quota minima di facile per livello, giorni di riposo, scarico ogni 3–4
   settimane, fabbisogni nutrizionali in base al carico. `prescription.py` e
   `nutrition.py` diventano parte di questi limiti.
2. **L'AI compone dentro i limiti**: quali sedute, in che ordine, con quali parole.
3. **Il codice valida il risultato.** Una proposta che viola un limite non arriva
   all'utente.
4. **Ogni scelta ha un perché**, con i numeri dell'utente.
5. **Le modifiche manuali vincono sempre.** Una seduta modificata a mano è bloccata;
   l'AI adatta il resto e può segnalare un conflitto, mai annullarlo.

**Piano.** Vive sul server (decide il punto 1.3 qui sotto); il file YAML diventa import
ed export. Due orizzonti:

- **Scheletro fino all'obiettivo**: fasi, volume settimanale di riferimento, lungo
  massimo, scarichi, gara. Cambia di rado.
- **Dettaglio a finestra mobile di 2–3 settimane**: sedute complete, generate dentro la
  fase dello scheletro. È l'unica parte scritta sul calendario Garmin.
- Senza obiettivo (tipico di L1): niente scheletro, solo la finestra mobile con un
  obiettivo di costanza.

**Adattamento.** Parte da eventi precisi (check-in, prontezza bassa, seduta saltata o
molto diversa dal previsto, nuova soglia), non da una riscrittura notturna. Modalità
predefinita per livello (L1 automatico con avviso, L3 proposta da accettare),
modificabile nelle impostazioni.

**Cibo.** Nessun piano pasti. Il codice calcola gli obiettivi nutrizionali del giorno in
base al carico; l'utente manda cosa ha mangiato (foto o testo) e l'app dice se è dentro
e cosa manca. Nessun deficit aggressivo, soprattutto a L1.

### 0.5 Flessibilità: sposti quello che vuoi, l'app avvisa solo quando è pericoloso

L'utente deve poter spostare le sedute di giorno liberamente, come oggi. La flessibilità
serve alla costanza: un piano rigido si abbandona. L'app non blocca mai uno spostamento;
controlla la sequenza che ne risulta e interviene solo se è davvero rischiosa.

**Quando scatta l'avviso.** Il controllo è deterministico: regole nel codice, non un
giudizio dell'AI. Guarda la sequenza intorno al giorno di arrivo, contando sia le sedute
pianificate sia quelle già fatte (dallo storico). Esempi di regola, con soglie che
dipendono dal livello:

| Regola | L1 | L2 | L3 |
|---|---|---|---|
| Sedute dure in giorni consecutivi | 2 di fila | 3 di fila | 3 di fila |
| Seduta dura il giorno dopo il lungo | avvisa | avvisa | no |
| Volume della settimana contro la media delle ultime 4 | > +30% | > +30% | > +40% |
| Seduta dura con check-in "dolore" o prontezza molto bassa | avvisa | avvisa | avvisa |

Le soglie sono da tarare. Il principio: due sedute dure di fila sono normali per un
atleta, sono un rischio per chi inizia.

**Deve essere veritiero.** Un avviso che suona troppo spesso smette di essere letto, e
allora non protegge più nessuno. Quindi:

- entra fra le regole solo ciò che ha evidenza solida; quello che è dibattuto (per
  esempio il rapporto acuto:cronico come predittore di infortunio) non fa scattare un
  avviso, al massimo un'informazione;
- il messaggio dice la regola precisa e i numeri dell'utente ("terza seduta dura in tre
  giorni: martedì ripetute, mercoledì soglia, giovedì collinare"), mai un generico
  "attenzione, rischio infortuni";
- dice cosa si rischia e con che evidenza, nello stesso formato `evidence` dei riscontri
  di `/coach`.

**Le tre scelte dopo l'avviso.**

1. **Confermo, mi prendo il rischio.** Lo spostamento resta com'è. La scelta viene
   registrata; l'app non ripete l'avviso su quella stessa sequenza e l'AI non la annulla
   (regola 5 di §0.4).
2. **Adatta la seduta.** Il codice propone una versione che rispetta le regole: più corta,
   meno intensa, o trasformata in facile, restando nel giorno scelto dall'utente. Il
   giorno lo decide l'utente, la seduta si adatta.
3. **Annulla** lo spostamento.

**Come si vede che funziona.** Se una regola viene confermata e ignorata dalla maggior
parte degli utenti, probabilmente è troppo severa e va rivista. Se chi ha confermato un
avviso segnala più spesso dolore nel check-in dei giorni dopo, la regola è giusta.

Oggi esiste un controllo simile ma diverso: `body_insights.assess_conflict` confronta lo
stato del corpo con la seduta del giorno, e ha già le opzioni "sposta"/"ammorbidisci".
Il controllo sugli spostamenti può riusare lo stesso formato.

### 0.6 Le idee di §1–5 passate dal filtro

| Idea | Scopo (la domanda a cui risponde) | Serve | Livello | Stato | Verdetto |
|---|---|---|---|---|---|
| Qualità del dato | "Posso fidarmi di questo numero?" | V2 | tutti | no | tieni |
| Baseline personali | "Sono fuori dalla *mia* norma?" | D1, V1 | L2+ | parziale (HRV su 7 notti, senza dev. std.) | tieni |
| Dati sporchi | Non decidere su un picco FC finto | V2 | tutti | no | tieni |
| Deduplica Garmin ↔ Strava | Non contare due volte la stessa corsa | V2 | tutti | no — `activity_stream` è chiavata senza `source` | tieni, è un bug |
| Soglie ricalibrate | "Le mie zone sono ancora giuste?" | D2, V2 | L2+ | no, solo stima Garmin | tieni; serve un'ancora esterna (test/gara), altrimenti è circolare |
| Backfill | Avere le serie per D2 e D3 | — | — | fatto | — |
| CTL/ATL/TSB | "Sono stanco o in forma, e dove vado?" | D1, D3 | L3 | no | tieni |
| Previsione gara | "Che tempo posso fare oggi?" | D3 | L3 | no | tieni, bassa priorità |
| Polarizzazione | "Il mio facile è davvero facile?" | D2 | L2+ | fatto sul blocco, manca l'andamento settimanale | aggiungi vista settimanale |
| Piano adattivo + scarico | "Scambio o scarico questa settimana?" | D1, D2, V1 | tutti | no | tieni — è il cuore di §0.4 |
| Qualità d'esecuzione (Pa:Hr) | "La base aerobica migliora?" | D2, D3 | L3 | parziale (drift di passo) | tieni |
| Check-in 10 secondi | "Come sto *io*, oltre ai sensori?" | D1, C, V1 | tutti | no | tieni, alta priorità — a L1 sostituisce le zone |
| Prevenzione infortuni | "Sto aumentando troppo in fretta?" | V1 | tutti | parziale (acuto:cronico) | tieni, entra nei limiti di §0.4 |
| Energia disponibile (RED-S) | "Mangio abbastanza per questo carico?" | V1 | L2+ | no | solo informativo: il cibo è stimato |
| Sonno come leva | "Cosa faccio stasera per domani?" | D1 | L2+ | no | rimanda, serve prima le correlazioni |
| Carboidrati intorno alla sessione | "Cosa mangio per la seduta di oggi?" | D1 | tutti | parziale in `nutrition.py` | tieni, fa parte del modello cibo di §0.4 |
| Allarmi di sicurezza | "Oggi devo fermarmi?" | D1, V1 | tutti | no | tieni, soglia su baseline (dev. std.), non +7 bpm fissi |
| Correlazioni personali | "Cosa precede le mie sedute migliori?" | D2 | L3 | no | rimanda, servono molti dati |
| Resoconto settimanale | Il canale da cui arrivano D2 e C | D2, C | tutti | no | tieni, alta priorità |

Le sezioni 6–9 (gamification) vanno passate dallo stesso filtro: servono **C**, e il
passaggio di livello di §0.3 è la loro progressione.

---

## 1. Review sintetica — punti deboli strutturali

1. **Storico arrivato tardi** — per anni tutto era letto al volo con cache di 10 min;
   le domande "sto migliorando?" richiedono serie lunghe e pulite.
2. **Molte sorgenti con affidabilità diversa** (Garmin non documentato, Strava, profilo
   peso vecchio, cibo stimato): il merge e la gestione dei conflitti restano fragili.
3. **Il piano vive nel file sul device** — il server non ha il quadro completo
   piano + fatto + corpo.
4. **Nessun feedback soggettivo** (RPE, dolori, umore): l'app si fida solo dei sensori.

---

## 2. Dati più corretti

- **Punteggio di qualità per ogni dato**: sorgente, data, confidenza salvati accanto al
  valore. Un peso di 2 anni fa pesa meno di uno di ieri; il cibo non corretto non entra
  nei calcoli "forti".
- **Baseline personali** invece di soglie assolute: media e deviazione standard mobili
  (28–60 gg) per HRV, FC a riposo, sonno. Il segnale è "fuori dalla *tua* norma".
- **Rilevamento dati sporchi**: picchi FC da sensore ottico (cadence lock), GPS in
  galleria/pista, attività dimenticate accese → marcate come sospette ed escluse dai trend.
- **Deduplica Garmin ↔ Strava** con chiave unica (inizio ± tolleranza, durata).
- **Soglie ricalibrate in automatico**: FC di soglia e passo di soglia stimati da
  lavori/gare recenti → zone aggiornate (zone sbagliate = analisi intensità sbagliata).
- **Backfill completo** di 1–2 anni per avere serie storiche vere da subito.

## 3. Più prestazioni

- **Modello di carico proprio**: CTL/ATL/TSB (fitness, fatica, forma) calcolati dagli
  stream con TRIMP/rTSS, riproducibili, invece del carico opaco di Garmin.
- **Previsione gara dinamica**: VDOT/Riegel dalle sessioni *eseguite*, confrontata con
  l'obiettivo → confidenza che evolve nel tempo.
- **Controllo polarizzazione**: % tempo Z1-2 vs Z4-5 per settimana (l'errore più comune
  è l'easy fatto troppo forte; `intensity.py` ha già la base).
- **Piano adattivo con suggerimenti, non automatico**: prontezza bassa 2+ giorni →
  proposta di scambio sessioni; rapporto acuto:cronico > 1,5 → proposta di scarico.
  L'utente accetta/rifiuta; il file resta la verità.
- **Settimana di scarico** ogni 3–4 settimane o su segnali di fatica.
- **Qualità d'esecuzione**: rispetto passi per ripetuta, disaccoppiamento Pa:Hr nel lungo
  (< 5% = buona base aerobica).

## 4. Salute dell'utente

- **Check-in giornaliero da 10 secondi**: RPE, dolori (dove/quanto), energia, stress,
  ciclo mestruale se rilevante. Il dato con il miglior rapporto valore/costo.
- **Prevenzione infortuni**: picchi di volume settimanale (> 10–30%), lungo che cresce
  troppo in fretta, km sulle scarpe (Strava gear), peggioramenti tecnici (tempo di contatto
  al suolo che sale con la fatica).
- **Energia disponibile / RED-S**: calorie mangiate vs spese; avviso su deficit cronico
  nei periodi di carico alto.
- **Sonno come leva**: correlazione sonno ↔ qualità della sessione del giorno dopo,
  orario consigliato per andare a letto.
- **Carboidrati intorno alla sessione** in base al tipo di sessione del giorno.
- **Allarmi di sicurezza**: FC a riposo più alta di 7 battiti sulla baseline, con HRV giù
  → "possibile malattia, riposo". Nessuna diagnosi, solo un avviso.

## 5. Insight

- **Correlazioni personali** ("le tue sessioni migliori arrivano dopo > 7 h di sonno e
  3 giorni senza intensità"), mostrate solo con campioni sufficienti.
- **Resoconto settimanale** con i delta (fitness, ore in Z2, aderenza) e una cosa da
  migliorare.

**Ordine suggerito:** check-in + baseline personali → backfill + dati sporchi →
CTL/ATL/TSB + polarizzazione → previsione gara + suggerimenti adattivi → energia
disponibile + allarmi di salute.

---

## 6. Gamification "classica" (orientata alla salute)

Principio: **premiare il comportamento giusto, non il volume.** Anche il riposo fatto
bene vale punti.

- **Punti Disciplina**: sessione eseguita come da piano, easy davvero easy, riposo
  rispettato, lavoro saltato con prontezza rossa ("scelta intelligente"), check-in fatto
  e pasti corretti. Correre più del previsto non dà punti, e se è troppo li toglie.
- **Streak intelligenti** settimanali (aderenza > 80%, sonno, Z2, check-in) con
  **gettone salvastreak** per malattia o infortunio.
- **Badge verificabili dai dati**: PB (Strava), nuovo massimo di VO₂max, disaccoppiamento < 5%,
  settimana polarizzata, scarico da manuale, 7 notti > 7 h, cadenza migliorata,
  "pensionamento" delle scarpe a 700 km.
- **Livello atleta** legato alla fitness (CTL) — scende piano se ti fermi, ed è onesto.
- **Barra verso l'obiettivo gara** (da `goal_fit`).
- **Mascotte con stati** usando le illustrazioni già presenti (`esultanza`, `crollo`,
  `riposo`, `attesa`, `forza`, …).
- **Sfide settimanali** scelte da una regola sui punti deboli (l'LLM formula solo la frase).
- **Resoconti** settimanali e "Wrapped" di fine blocco o gara; card condivisibili.

---

## 7. Gamification geografica — conquista dei territori

Passo ha già il pezzo chiave: le tracce GPS (stream `latlng` di Strava). Esistono app
simili (Turf, INTVL, Run An Empire): la differenza deve venire da **come** corri, non solo
da **dove**.

### Meccanica base
- Mappa a **esagoni H3** (~150–300 m); ogni corsa conquista le celle attraversate.
- **Anello chiuso = area interna conquistata** (stile Paper.io).
- **Decadimento**: le celle non visitate da N settimane diventano contese, poi neutre.

### Il tocco Passo: conquisti meglio se ti alleni bene
- **Easy in Z2 → esplorazione** (celle nuove; doppio valore fuori dalla zona abituale).
- **Lungo → spedizione** (sblocca le regioni lontane).
- **Lavori → fortificazione** (celle-fortezza che decadono più lentamente).
- **Riposo rispettato → rifornimento** (ricarica l'energia di gioco).
- **Energia legata alla prontezza reale**: in rosso conquisti poco o nulla
  (meccanica anti-sovrallenamento).
- Sessione come da piano > sessione a caso.

### Elementi alla Pokémon Go
- **Punti d'interesse** da OpenStreetMap (salite, parchi, monumenti) → carte collezionabili.
- **Boss di zona = segmenti** Strava; chi ha il tempo migliore è il "capopalestra".
- **Collezione di regioni** (quartiere → città) con i confini di OSM.
- **Uova o scrigni** che si schiudono con il *tipo* giusto di km ("20 km in Z2").
- **Eventi a tempo** (celle sul fiume a doppio valore nel weekend).

### Multiplayer (fase 2)
- Squadre o fazioni, celle da rubare con un punteggio di controllo, classifiche per
  aderenza e territorio (non per km). Richiede un backend condiviso: è il salto
  architetturale più grande.

### Da non sottovalutare
- **Privacy**: celle vicino a casa nascoste o sfocate (privacy zone di Strava o un raggio scelto
  dall'utente).
- **Anti-cheat**: scartare i tratti con velocità o cadenza incoerenti con la corsa; la FC
  conferma.
- **Sicurezza**: niente incentivi verso zone private o pericolose, né corse notturne isolate.
- **Frontend**: MapLibre + tile OSM + layer degli esagoni nella PWA Next.js.

---

## 8. Equità: il problema principiante vs atleta

Chi corre tanto vincerebbe sempre, e chi inizia (che ha più bisogno di motivazione)
mollerebbe. Soluzione: **misurare lo sforzo rispetto a sé stessi**, come l'handicap
nel golf.

| Problema | Soluzione |
|---|---|
| Chi corre tanto vince sempre | Punti = **sforzo relativo** alla propria media mobile (4–6 settimane, carico cronico) e alle zone personali |
| Volume esagerato | **Tetto** per sessione e per settimana, rendimenti decrescenti; premiata la frequenza |
| Confronto impari | **Leghe** per livello (Bronzo, Argento, Oro…) con promozioni e retrocessioni a stagione |
| Il principiante molla | Bonus **miglioramento** (% vs mese scorso) e **prime volte**; territorio personale al centro |
| Competizione tossica | **Squadre cooperative** con contributo in base allo sforzo relativo; bonus mentorship |

Esempio: principiante 3 km con una media di 2 km → 150%; atleta 15 km con una media di 20 → 75%. Il
primo conquista di più. Una cella la tiene chi ci passa più **spesso**, non chi corre più forte.

Combinazione consigliata: **sforzo relativo + tetto + leghe**, insieme all'energia legata alla
prontezza.

---

## 9. Altre idee di gamification dello stesso genere

1. **Creature da collezionare** — compaiono in base all'ambiente reale (acqua, salita,
   notte, città); si catturano completando la sessione del piano; si evolvono con la
   costanza; le rarità si sbloccano con i comportamenti sani (es. 100% degli easy in Z2 per 2
   settimane).
2. **Viaggio virtuale** — Cammino di Santiago, Via Francigena, giro d'Italia…; si avanza
   con i km × lo sforzo relativo; cartoline e storie a ogni tappa.
3. **Nebbia di guerra** — la città è coperta; si scopre correndo su **strade nuove**;
   % esplorata per quartiere o città. Ottima per i principianti.
4. **Villaggio da costruire** — ogni tipo di sessione produce una risorsa diversa (easy →
   legno, ripetute → pietra, lungo → oro, **riposo → cibo**); serve equilibrio, quindi insegna
   la periodizzazione. Il sovrallenamento affama il villaggio.
5. **Cacce al tesoro e forzieri** — posizionati entro un raggio proporzionato alla *tua*
   distanza abituale; missioni geografiche ("tocca i 3 ponti"); forzieri a tempo.
6. **Disegni GPS** — "disegna un cuore o una stella"; punteggio di somiglianza della forma;
   la dimensione non conta.
7. **Fantasma di te stesso** — sfida al te di 1, 3 o 6 mesi fa; vinci se sei più veloce
   **a parità di battito** (efficienza reale).
8. **Boss raid cooperativi** — un boss settimanale con una barra di vita enorme, colpito dalla
   comunità con i punti di sforzo relativo.
9. **Stagioni narrative** — 8–12 settimane allineate al blocco di allenamento (base =
   esplorazione, specifico = battaglia, scarico = ritorno, gara = finale).
10. **Meteo e condizioni** — bonus "impresa" per pioggia, freddo o caldo (entro i limiti di
    sicurezza), badge stagionali.

### Combinazioni più promettenti
- **Territorio + creature + villaggio** per il gioco profondo. Il villaggio è il più "Passo"
  perché premia riposo ed equilibrio.
- **Nebbia di guerra + fantasma di te stesso** per i principianti, a basso costo tecnico.
- **Stagioni narrative** come contenitore di tutto, allineate al piano.

### Roadmap indicativa
1. MVP single-player: le tracce Strava diventano celle H3, con la mappa "il mio territorio" e il
   decadimento, calcolata anche sullo storico.
2. I poteri per tipo di sessione e l'energia legata alla prontezza; lo sforzo relativo e il tetto.
3. Anelli chiusi, punti d'interesse, collezione di regioni; nebbia di guerra, fantasma.
4. Il multiplayer con leghe, squadre e raid cooperativi.

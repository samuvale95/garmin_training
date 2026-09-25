# Brainstorming — miglioramenti e gamification

Raccolta delle idee emerse in una sessione di brainstorming. Non è un piano: è il
serbatoio da cui scegliere cosa trasformare in proposte OpenSpec (`/opsx:propose`).

Vincolo che vale per tutto quello che segue (da `PLAN-analisi-dati.md`): **ogni numero
è deterministico e ricontrollabile a mano, l'LLM scrive solo la prosa.** Vale anche per
i punti di gioco: ogni punto deve poter essere spiegato ("+10 perché l'easy è rimasto
92% in Z2").

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

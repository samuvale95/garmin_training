# Revisione UX — appunti per pagina

Raccolti durante le sessioni di verifica in locale (backend vero, Garmin simulato, dati
realistici, schermo da telefono 400 px). Sono **da fare in un secondo passaggio**: la
revisione completa pagina per pagina partirà da qui. Ogni voce dice cosa si è visto e
cosa cambierei; le priorità sono indicative (A = alta, B = media, C = bassa).

Già corretto e quindi escluso da qui: analisi gara, avviso battito ripetuto, "/km/km",
"59 / 0 km", lungo etichettato "Ripetute", contrasto grigio su nero in Progressi,
intestazione doppia in Carico, schede vuote di tecnica in cima all'analisi, zone
contraddittorie, modifica obiettivo che non salvava.

## Trasversale

- **A — Una sola risposta per "cosa faccio oggi".** La home ha molti blocchi (hero,
  maratona, check-in, strip vitale, pasto, azioni, riepilogo, progressi, gara). Va
  ripensata attorno al motivo per cui la si apre: allenamento di oggi → (se c'è) analisi
  di ieri → pasto solo se è ora → il resto dietro un tocco.
- **A — Linguaggio coerente.** "Piano", "Programmi", "Calendario", "file", "YAML"
  convivono; per chi non è tecnico "Il file resta la verità" e "Scarica il YAML" non
  significano nulla. Scegliere un vocabolario (Piano / Programma / Seduta) e usarlo ovunque.
- **B — Tono delle card scure.** Card nere con testo serif grigio: oltre al contrasto, il
  nero è usato sia per "evento importante" (rottura) sia per "navigazione" (Come ti
  alleni). Dare al nero un solo significato.
- **B — Stati vuoti.** Molti dicono cosa manca ma non cosa fare con un tasto (es. "Mi
  mancano le tue zone" → bottone "Stima dalle mie corse").
- **B — Prestazioni percepite.** 23 richieste all'apertura della home a freddo. Valutare
  un endpoint aggregato `/today` (una richiesta, una risposta pronta) e skeleton per
  blocco invece che per pagina.
- **C — Date.** L'input data nativo segue la lingua del browser (in test "10/31/2026");
  valutare un selettore proprio con formato italiano fisso.
- **C — Bottone flottante Next/emoji** visibili solo in sviluppo: verificare che in
  produzione non ci sia nulla sovrapposto alla tab bar.

## Oggi

- **A** — L'hero dice "Cauto" senza spiegare perché nello stesso posto; il motivo è nella
  pagina Recupero. Una riga sotto il badge ("sonno corto, HRV sotto la norma").
- **A** — Il check-in "Com'è andata ieri?" occupa molto spazio anche quando ieri c'è
  stata una maratona con la sua card: unirli (sensazioni dentro la card della corsa).
- **B** — "Apri il calendario / Attività svolte" come due bottoni a metà pagina sembrano
  azioni principali; sono navigazione e la tab bar le copre già.
- **B** — "Riepilogo e prossimi allenamenti" in un `<details>`: poco scopribile.
- **B** — Stato invio a Garmin: oggi è una riga in fondo. Se qualcosa non è arrivato
  deve stare in alto (lo è come avviso rosso), se è tutto ok può sparire del tutto.

## Piano → Calendario

- **A** — Le attività fatte compaiono come "FUORI PIANO" a tratteggio anche quando
  corrispondono chiaramente alla seduta del giorno (stessa data, stesso sport): abbinarle
  e mostrare "fatta ✓" sulla seduta invece di due card.
- **A** — "Sposta" come `<details>` sotto ogni seduta allunga la lista; meglio un'azione
  nel menu della card o il trascinamento (già presente) con un suggerimento visibile.
- **B** — La barra "km fatti · in piano" non distingue fatto-del-piano da fatto-fuori-piano.
- **C** — Il nome dei giorni (LUN 26) e la card hanno allineamenti verticali diversi.

## Piano → Programmi / Obiettivi

- **A** — Quattro bottoni uguali sul programma (Disattiva, Adatta, Collega obiettivi,
  Obiettivo e valutazioni): gerarchia piatta. Uno primario, il resto in un menu.
- **A** — "Modifiche da inviare a Garmin" ha senso ancora? Con l'invio automatico va
  sostituito dallo stato dell'invio (cosa è su Garmin, cosa no, perché).
- **B** — Obiettivi: "Valutazione gara del piano corrente" apre una pagina in Profilo;
  la valutazione dovrebbe stare dentro l'obiettivo stesso.

## Seduta (dettaglio)

- **B** — La distanza totale (12,7 km) mescola km esatti delle ripetute e km stimati di
  riscaldamento/defaticamento a tempo: segnare "circa".
- **B** — L'emoji fiamma è grande quanto il dato principale; ridurla.
- **C** — Barra in basso "Sposta a venerdì / Nel piano": testo troncato a 400 px.

## Attività

- **B** — Lista lunga e piatta: raggruppare per settimana con totale, e mettere in
  evidenza gare e lunghi.
- **B** — Ogni riga dice "Garmin": informazione ripetuta, meglio un'icona piccola o
  niente se è la sorgente di tutte.
- **C** — I filtri occupano mezzo schermo prima del primo risultato.

## Tecnica / analisi corsa

- **B** — Dopo il blocco gara arrivano "Perché è successo" e i link "Come ti alleni":
  valutare se il "Perché" (sensore) vada dentro la nota viola espandibile.
- **B** — Tabella km per km: su telefono 6 colonne sono strette; per livello 1–2
  mostrare passo e battito, il resto in espansione.
- **C** — Selettore attività in alto: le card sono tagliate a destra senza indicazione
  di scorrimento.

## Recupero

- **B** — Badge "Prima dell'allenamento" in alto: non è chiaro cosa significhi.
- **B** — Stress "—" quando manca il dato: dire perché ("l'orologio non l'ha misurato").
- **C** — Grafico HRV: barre grigie tutte uguali tranne l'ultima, poco leggibile.

## Carico

- **A** — "Sei stabile" come titolo anche quando i dati sono pochi o mancanti: il
  giudizio deve dipendere dalla quantità di dati (o dire che non si può ancora dire).
- **B** — "Due scale diverse" spiegato a parole sotto un grafico che le mescola: due
  grafici o una scala sola.
- **B** — Fitness/Fatica/Forma: sigle CTL/ATL/TSB per livello 1–2 vanno nascoste.

## Nutrizione

- **B** — "Piano del giorno" e "Diario" come tab: il pasto attuale è sopra la timeline,
  la timeline ripete gli stessi pasti; scegliere una sola rappresentazione.
- **C** — "Registra pasto" duplicato (header pagina e home).

## Resoconto / Progressi

- **B** — "Questa settimana: 0 giorni su 2 del piano" quando le corse sono state fatte
  fuori piano: tono punitivo; riconoscere il lavoro fatto.
- **C** — Traguardi: card rosa per "raggiunto" e grigie per "da fare" hanno la stessa
  gerarchia; i raggiunti potrebbero diventare una riga di badge.

## Profilo

- **A** — "Il tuo nome / la tua email" come segnaposto quando mancano: mostrare i dati
  veri o non mostrare il blocco.
- **B** — "Il file resta la verità" + tre azioni YAML: spostare in "Avanzate".
- **B** — "Ripristina tutto" in evidenza rossa a metà pagina: è un'azione rara e
  distruttiva, va in fondo dietro conferma (c'è) e in un'area "Avanzate".

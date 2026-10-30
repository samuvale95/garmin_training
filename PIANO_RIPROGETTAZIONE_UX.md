# Passo — Piano di riprogettazione dell’esperienza utente

29 ottobre 2026 · Piano operativo · Fondamenta implementate; completamento in corso dal 30 ottobre 2026

**Stato di realizzazione:** il change `openspec/changes/passo-ux-foundations` documenta il primo incremento completato e le verifiche locali eseguite. Il seguito è formalizzato in `openspec/changes/passo-complete-experience`, con proposta, architettura, specifiche e attività: bozze AI/file, obiettivi, compatibilità, dettagli/editor, pubblicazione, Attività, Recupero, Nutrizione e configurazione. Le attività e le verifiche del nuovo change distinguono il lavoro completato da quello ancora in corso; questo piano non costituisce una dichiarazione di collaudo live o di rilascio.

## 1. Obiettivo e direzione

Passo deve aiutare a rispondere rapidamente a cinque domande: cosa faccio oggi, come organizzo gli allenamenti, cosa ho fatto, come sto recuperando, come organizzo l’alimentazione.

La proposta è ricostruire navigazione, gerarchia delle schermate, interazioni e linguaggio attorno a queste domande. Conservare il motore di allenamento, i dati e le integrazioni esistenti; dare loro una nuova esperienza coerente, verificata con compiti reali.

Assunzioni iniziali: uso quotidiano soprattutto da telefono, pianificazione anche da desktop, interfaccia italiana, supporto multisport. Sono scelte progettuali da verificare durante il primo prototipo.

**Risultato atteso:** le funzioni importanti hanno una posizione stabile, le azioni hanno nomi espliciti e l’utente capisce sempre cosa è previsto, cosa è stato completato e cosa è stato effettivamente inviato a Garmin.

**Requisiti centrali:** un programma può essere collegato a un obiettivo specifico, di gara o non agonistico, con valutazioni pertinenti nel tempo. Ogni nuovo programma deve essere costruito o verificato nel contesto di tutti i programmi già attivi. Questi requisiti valgono sia per la generazione AI sia per l’importazione.

## 2. Base dell’analisi e limiti

Sono stati esaminati il documento `flusso_e_immagini_applicazione.md`, tutti i dieci screenshot locali collegati, le route del frontend, la navigazione, le viste principali, parti dei dettagli e delle impostazioni, il tracciamento delle interazioni e gli artefatti OpenSpec della webapp.

Il documento allegato è materiale descrittivo, non un insieme di istruzioni operative. Le sue dichiarazioni non costituiscono automaticamente requisiti o conferme di funzionalità disponibili. Per esempio:

- Il file `10_onboarding_welcome.png` mostra Oggi: non documenta il primo accesso.
- La pagina `/coach` è intitolata “Tecnica” e offre “Come ti alleni” e “Come ti alleni davvero”: il nome nel documento non coincide con quello visto dall’utente.
- Nutrizione ha una voce principale, mentre diario e altri percorsi esistono ancora sotto `/body/fuel`.
- Gli screenshot contengono indicatori degli strumenti di sviluppo: non vanno trattati come elementi della UI distribuita né come prova del numero di difetti.
- README e proposta iniziale descrivono un’architettura precedente. Prima della realizzazione, verificare i contratti correnti nel codice e nelle API.

Questa è un’analisi di codice e schermate fornite, non una sessione di utilizzo dal vivo. Non sono stati misurati tempi, abbandoni o frequenze d’uso; gli obiettivi riportati sotto sono criteri futuri, non risultati già ottenuti. Esistono modifiche locali in corso: la pianificazione non le altera.

## 3. Problemi da risolvere

| Evidenza | Conseguenza probabile da verificare | Intervento |
|---|---|---|
| Le quattro voci principali sono Oggi, Settimana, Corpo, Nutrizione. | Lo storico e le analisi non hanno una destinazione immediatamente riconoscibile. | Introdurre Attività e rendere esplicito Recupero. |
| Oggi combina allenamento, pasti, adattamento, check-in, vitali, settimana, serie, obiettivo e differenze di calendario. | Si cerca l’azione giusta fra molti elementi di peso simile. | Limitare il primo livello alle decisioni della giornata. |
| Settimana mostra introduzione, selettore ampio, avanzamento, generazione e resoconto prima di buona parte dell’agenda. | Il contenuto principale arriva tardi. | Portare subito a vista il giorno corrente e le sedute. |
| Il ritorno dei dettagli sessione/workout è fissato a `/week`, anche se esistono ingressi da Oggi. | Il ritorno può perdere il contesto di partenza. | Conservare origine, data selezionata e posizione. |
| “Coach”, “Tecnica”, “Come ti alleni”, “Come ti alleni davvero” descrivono aree vicine. | È difficile anticipare il contenuto del collegamento. | Separare Analisi attività, Andamento e Suggerimenti. |
| Nutrizionale presente in Oggi, Corpo, Nutrizione e nelle route fuel. | Indicazioni e registrazioni possono essere percepite come duplicati. | Una sede completa, con anteprime e collegamenti contestuali. |
| Il dettaglio distingue sessioni del piano e workout Garmin mediante percorsi diversi. | Lo stesso concetto appare con varianti di navigazione. | Un modello visivo comune con fonte e stato espliciti. |
| Lo stato di sincronizzazione può sostituire Oggi e Corpo con `/watch-sync` quando i dati risultano vecchi e mancanti. | Un problema parziale interrompe la consultazione. | Avviso locale e accesso ai contenuti ancora validi. |
| Il layout generale è limitato a 480 px. | Su desktop pianificare e confrontare dati resta un’esperienza da telefono. | Layout responsive dedicato alla pianificazione e all’analisi. |
| Negli screenshot compaiono testo scuro su fondo scuro, `5:55/km/km` e `Livello 2 · undefined`. | Leggibilità e fiducia nei dati si riducono. | Verifica contrasto, formattazione centralizzata e stati mancanti leggibili. |

Il grafico del carico nello screenshot accosta inoltre carico eseguito e chilometri previsti, dichiarando due scale diverse. La nota non elimina la difficoltà del confronto: separare le misure o confrontare grandezze omogenee.

## 4. Nuova architettura dell’informazione

Cinque destinazioni principali, sempre nello stesso ordine:

| Destinazione | Domanda | Contenuti di cui è responsabile |
|---|---|---|
| **Oggi** | Cosa devo fare adesso? | Prossima seduta, altre sedute di oggi, check-in, riepilogo recupero, prossimo momento alimentare. |
| **Piano** | Come organizzo il futuro? | Calendario, programmi attivi, obiettivo, creazione/importazione/generazione, modifica e invio a Garmin. |
| **Attività** | Cosa ho fatto e come sta andando? | Storico, dettaglio svolto, confronto con il previsto, analisi, resoconti e continuità. |
| **Recupero** | Come sto e come cambia nel tempo? | Sonno, prontezza, HRV, energia, carico e trend. |
| **Nutrizione** | Cosa è previsto e cosa ho registrato? | Indicazioni della giornata, diario, registrazione pasti e storico. |

**Profilo**, sempre riconoscibile nell’intestazione, raccoglie account, connessioni, parametri atleta, scarpe e preferenze. Le scarpe hanno anche un collegamento contestuale nel dettaglio attività. L’obiettivo ha la propria sede nel Piano; dal profilo si raggiunge lo stesso contenuto.

Su telefono: barra inferiore stabile con icona e testo, senza scomparsa automatica. Su desktop: navigazione laterale con nomi completi e spazio di lavoro più ampio. L’ordine concettuale rimane identico.

Cinque voci sono un’ipotesi da validare a 360 px e con testo ingrandito. Se il test dimostra affollamento, confrontare la variante con quattro voci e Recupero dentro Attività; evitare un generico “Altro” che nasconde di nuovo le funzioni.

**Regole di orientamento:** titolo uguale al nome della destinazione; sottosezioni con etichette stabili; collegamenti contestuali verso una sola sede del contenuto; pulsante Indietro verso il contesto reale; destinazione di ripiego per accessi diretti. Le funzioni importanti restano raggiungibili anche quando non ci sono dati.

Il coach diventa un aiuto contestuale: spiega una seduta, un andamento o una proposta di adattamento. Le analisi complete rimangono raggiungibili in Attività. Non serve una nuova chat come porta di ingresso alle funzioni.

## 5. Schermate da riprogettare

### Oggi: una decisione principale

Ordine stabile dei blocchi:

1. Data, Profilo, stato sintetico dei dati quando rilevante.
2. Prossima seduta: sport, titolo breve, durata, obiettivo e pulsante “Apri allenamento”. Nel giorno di riposo, spiegazione breve e prossima seduta chiaramente datata.
3. Altre sedute di oggi: elenco compatto, ciascuna con stato proprio. Nessuna seduta deve essere scopribile soltanto cambiando una scheda nella hero.
4. “Come ti senti?” e sintesi di recupero con accesso ai dettagli.
5. Prossimo momento alimentare, in forma compatta, con “Registra pasto”.
6. Anteprima di domani e collegamento al Piano.

Dopo una seduta si aggiorna lo stato del blocco principale e compare “Com’è andata?”. Non si riordina arbitrariamente tutta la pagina secondo l’orario. Una richiesta di adattamento importante compare accanto alla seduta interessata.

Serie, premi, dettagli del carico e gestione dei programmi trovano spazio nelle rispettive sezioni. Nessuna raccomandazione nutrizionale lunga deve spingere fuori vista l’azione principale.

### Piano: calendario e gestione riconoscibili

- Intestazione compatta con periodo, “Oggi” e “Aggiungi allenamento”.
- Agenda settimanale su telefono; settimana a colonne su desktop, con alternativa elenco.
- Mostrare il giorno corrente al primo ingresso, preservando poi la scelta dell’utente.
- Tre sottosezioni: **Calendario · Programmi · Obiettivi**. Ogni programma mostra l’obiettivo collegato; più programmi possono contribuire allo stesso obiettivo.
- Programmi contiene crea, importa, genera, attiva/disattiva e gestione multisport. I filtri di visualizzazione devono essere distinti dall’attivazione di un programma.
- “Sposta” è un comando visibile nel dettaglio/menu della seduta; il trascinamento resta una scorciatoia.
- Stati testuali: programmato, completato, saltato, da abbinare; separatamente, stato dell’invio a Garmin.
- Il generatore è un percorso guidato con obiettivo, disponibilità, vincoli e anteprima. Mostrare intervallo effettivo e impatto sul piano esistente prima di applicare.
- Stato di invio compatto: “3 modifiche da inviare”, con accesso al riepilogo.

### Allenamento: preparazione e modifica

Il dettaglio programmato espone prima sport, giorno, durata, obiettivo e stato Garmin; poi la struttura della seduta. Le metriche cambiano con lo sport: passo per corsa, durata/velocità o potenza se disponibile per bici, serie e durata per forza. Mai valori inventati per riempire il layout.

Azioni: **Modifica · Sposta · Versione breve**, quando disponibili. Eliminazione nel menu secondario, con ambito chiaro. Il pulsante principale dipende dallo stato: preparare/inviare l’allenamento, oppure aprire l’attività collegata quando completato. Non suggerire di avviare una registrazione dall’app se la funzione non esiste.

Versione breve: confronto leggibile fra durata originale e nuova, modifiche alle fasi, applicazione e ripristino. Disponibilità derivata dalle regole correnti: non inventare una variante per una seduta che non la supporta.

Editor: campi essenziali subito, dettagli dei blocchi a richiesta, riepilogo persistente della durata e salvataggio chiaro. Proteggere modifiche non salvate e validare vicino al campo. Il pulsante Salva non significa automaticamente “inviato a Garmin”.

### Attività: una sede per storico e analisi

Tre sottosezioni: **Storico · Andamento · Resoconti**.

- Storico filtrabile per periodo e sport, con ricerca per titolo; includere attività fuori piano.
- Dettaglio svolto: riepilogo, previsto rispetto all’eseguito con unità omogenee, grafici e analisi su livelli progressivi.
- Garmin e Strava sono fonti dell’attività, non due esperienze parallele. Definire identità e deduplicazione prima di unificare le liste.
- Analisi: prima osservazione concreta, poi evidenza grafica, poi interpretazione e suggerimento. Separare dati misurati, stime e ipotesi; evitare di presentare una correlazione come una causa accertata.
- Andamento ospita tecnica e progressi; Resoconti ospita riepiloghi settimanali e continuità, inclusi gli elementi oggi in `/progress`.

Lo storico usa le capacità di lettura esistenti dove sufficienti. Filtri, paginazione e deduplicazione eventualmente mancanti sono dipendenze da verificare, non funzionalità già promesse.

### Recupero: sintesi prima delle sigle

Due sottosezioni: **Oggi · Tendenze**. Sintesi breve, aggiornamento dei dati, sonno/prontezza/energia, quindi approfondimenti HRV e carico. Periodo e fonte sempre visibili nei grafici.

CTL, ATL, TSB e ACWR restano disponibili con spiegazione e unità, senza dominare la prima vista. Non trasformare un colore o una singola soglia in una promessa di sicurezza. Valori mancanti, vecchi e stimati devono apparire diversi.

### Nutrizione: distinguere indicazioni e registrazioni

Due sottosezioni: **Piano del giorno · Diario**. Data condivisa e sempre visibile. Il primo mostra indicazioni prima/durante/dopo le sedute; il secondo ciò che è stato effettivamente registrato.

“Registra pasto” è raggiungibile da Oggi e Nutrizione e apre lo stesso percorso: foto/testo/manuale → verifica della stima → salvataggio → ritorno alla giornata. Rendere correggibili porzioni e quantità. I pasti suggeriti non appaiono come consumati. Uno zero registrato non significa automaticamente che l’utente non abbia mangiato.

Orario previsto e allenamento in corso devono essere distinti: l’orario da solo non prova che una seduta sia iniziata. La doppia seduta deve influenzare la timeline senza duplicare il diario.

### Profilo, connessioni e primo accesso

Profilo in gruppi: account; Garmin e Strava; parametri atleta; attrezzatura; preferenze. Connessioni con stato, ultima acquisizione disponibile e azione per risolvere un problema.

Primo accesso: accesso/account secondo il sistema reale → collegamento dati con possibilità di completarlo dopo, ove supportato → scelta fra calendario esistente, importazione o creazione del piano → Oggi. Richiedere le informazioni nel punto in cui servono. Strava resta opzionale per i flussi che non lo richiedono. Un account già configurato torna direttamente al contesto utile.

## 6. Flussi prioritari e criteri di riuscita

| Compito | Percorso proposto | Criterio osservabile |
|---|---|---|
| Capire l’allenamento di oggi | Oggi → dettaglio | Titolo, durata e stato visibili prima di scorrere sul telefono di riferimento. |
| Gestire due sedute | Oggi → elenco del giorno → seduta | Entrambe individuabili e completabili separatamente. |
| Spostare una seduta | Piano → seduta → Sposta → giorno | Nessun trascinamento obbligatorio; avviso prima di applicare eventuali conflitti. |
| Usare una versione breve | Seduta → Versione breve → confronto → applica | Cambiamento comprensibile e ripristinabile; invio Garmin esplicito. |
| Trovare una corsa precedente | Attività → periodo/sport → attività | Non occorre ricordare la settimana del piano o passare dal coach. |
| Registrare un pasto | Oggi/Nutrizione → Registra pasto → verifica → salva | Una sola registrazione, giorno corretto, ritorno al punto di partenza. |
| Inviare il piano | Piano → modifiche da inviare → anteprima → conferma → esito | Distinti salvato, in invio, inviato, fallito; visibili anche esiti parziali. |
| Capire dati mancanti | Recupero → avviso → connessione | Si comprende cosa manca, da quando e quale azione tentare. |
| Cambiare obiettivo | Piano → Obiettivo | Effetti sul piano spiegati prima di eventuali modifiche. |

**Sincronizzazione:** “Aggiorna dati” acquisisce informazioni; “Invia a Garmin” pubblica allenamenti. Per l’orologio mostrare solo gli stati verificabili: conferma su Garmin Connect e conferma sul dispositivo non sono necessariamente la stessa cosa. Conservare anteprima e conferme per sostituzioni/eliminazioni; non promettere annullamento dopo scritture esterne se non supportato.

## 7. Direzione visiva

Un’app sportiva calma, leggibile e riconoscibile come Passo. Conservare marchio e famiglia di illustrazioni clay; ridurre la quantità di contenitori e l’altezza occupata da elementi decorativi.

- Fondo chiaro leggermente caldo, testo scuro e un accento principale coerente con il marchio. Colori sportivi discreti; colori di stato con significato costante.
- Una gerarchia di titoli, corpo testo e numeri; valori confrontabili allineati e unità centralizzate. Meno testo maiuscolo e meno descrizioni tecniche nella vista sintetica.
- Una sola scheda dominante per schermata; liste compatte per calendario, attività e impostazioni. Ombre e arrotondamenti usati per distinguere livelli reali.
- Illustrazione di maggiore dimensione nella prossima seduta o negli stati vuoti; piccola o assente nei dettagli densi. Non rigenerare tutti gli asset prima di aver validato la struttura.
- Animazioni brevi legate a un cambiamento comprensibile. Nessun movimento continuo necessario per capire o trovare una funzione. Scorrimento nativo come impostazione progettuale iniziale.
- Desktop con contenuto su due aree quando utile: calendario e dettaglio, oppure grafico e lettura dei dati. Nessun ingrandimento meccanico delle schede mobili.

Accessibilità da verificare: obiettivo WCAG 2.2 AA, focus visibile, contrasto, riduzione del movimento, testo ingrandito, tastiera e lettore di schermo. Target di prodotto di almeno 44×44 CSS px per i comandi principali; il minimo AA di WCAG 2.2 è 24×24 con eccezioni e condizioni di spaziatura. Ogni trascinamento ha un’alternativa a tocco. [W3C: novità WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/).

Etichette visibili e posizioni prevedibili riducono la necessità di ricordare dove si trova una funzione. [Nielsen Norman Group: riconoscimento e ricordo nelle interfacce](https://www.nngroup.com/articles/recognition-and-recall/).

## 8. Stati da progettare insieme alle schermate

Per ciascun flusso disegnare: caricamento, vuoto iniziale, assenza di risultati, errore recuperabile, assenza di connessione, dati vecchi, successo ed eventuale successo parziale.

Casi specifici: nessun piano; Garmin collegato senza storico; nessuna biometria; nessun dato Strava; giorno di riposo; più sedute; attività fuori piano; abbinamento incerto; generazione non disponibile; stima pasto fallita; limite temporaneo Garmin; modifica salvata ma non inviata; invio interrotto; sessione di accesso scaduta.

Mostrare ciò che resta utilizzabile. Non sostituire un numero mancante con zero. Non cancellare il contesto dopo un errore. Il retry di una scrittura deve evitare duplicazioni e riconciliare l’esito già avvenuto.

## 9. Sequenza di realizzazione

Le fasi sono ordinate per dipendenza. Ogni fase produce un risultato verificabile prima di estendere il lavoro.

| Fase | Lavoro | Consegna e condizione di uscita |
|---|---|---|
| **1 — Inventario e baseline** | Mappare tutte le funzioni, route e stati; verificare quali capacità dell’allegato esistono davvero; esaminare gli eventi d’uso disponibili nel rispetto delle preferenze di tracciamento. | Matrice funzione → sede nuova → API → stato; compiti di riferimento e baseline senza numeri inventati. |
| **2 — Navigazione e wireframe** | Disegnare le cinque sezioni, ritorni e gerarchia; prototipo a bassa fedeltà di Oggi, Piano, dettaglio, Attività e Nutrizione. | Test di reperibilità e percorsi; correggere nomi e raggruppamenti prima della grafica finale. |
| **3 — Sistema visivo** | Token, tipografia, navigazione, righe, schede, grafici, moduli, messaggi, finestre e illustrazioni; esempi mobile e desktop. | Prototipo completo dei flussi prioritari, inclusi vuoti ed errori; checklist accessibilità. |
| **4 — Fondamenta e percorso quotidiano** | Nuovo contenitore responsive, navigazione, ritorni, Oggi, Piano, dettaglio/editor e invio Garmin. | Dal piano alla seduta e al ritorno senza perdita di contesto; funzionalità pregresse raggiungibili durante la transizione. |
| **5 — Storico e comprensione** | Attività, dettaglio svolto, abbinamenti, Andamento, Resoconti, Recupero e grafici. | Nessuna attività duplicata; unità e fonti coerenti; vecchi link ancora risolti. |
| **6 — Nutrizione e configurazione** | Unificazione diario, registrazione pasti, profilo, connessioni, attrezzatura, primo accesso e preferenze. | Tutti gli ingressi portano agli stessi dati e agli stessi flussi; completamento anche nei casi degradati. |
| **7 — Validazione e rilascio** | Test dei compiti, verifica responsive/accessibilità, regressioni, confronto con baseline; rimozione dei percorsi duplicati dopo stabilizzazione. | Criteri di accettazione raggiunti, piano di ripristino verificato e documentazione aggiornata. |

**Primo incremento utile:** navigazione riconoscibile, Oggi essenziale, calendario leggibile, azione Sposta esplicita e ritorno corretto dai dettagli. Questo incremento affronta direttamente la difficoltà di trovare le cose; il rifacimento completo prosegue con le sezioni successive.

Non serve aggiungere un nuovo framework, rifare gli algoritmi o costruire una nuova piattaforma AI per ottenere questo risultato. Ricerca globale, personalizzazione della home e nuove funzioni sportive restano fuori dal primo rilascio salvo evidenza emersa dai test.

## 10. Integrazione nel progetto

| Area corrente | Lavoro previsto |
|---|---|
| `web/src/components/TabBar.tsx`, `TabsPager.tsx`, `AppShell.tsx` e layout delle tab | Un’unica definizione di navigazione per mobile/desktop; rivedere il pager a quattro viste montate e gli swipe globali. Nessun contenuto inattivo deve ricevere focus. |
| `PageHeader.tsx`, `DetailScaffold.tsx` | Origine validata e ritorno contestuale, con fallback sicuro per accessi diretti. |
| `components/tabs-views/*View.tsx` | Ricomporre le schermate attorno ai nuovi compiti; riusare le query valide. |
| `SessionDetailBody.tsx`, `WorkoutEditor.tsx`, `WeekCards.tsx` | Modello condiviso di stato, metriche e azioni; preservare ID e collegamenti piano/attività. |
| `lib/watchSync.ts`, schermate sync e diff | Separare problemi di acquisizione, modifiche locali e pubblicazione; preservare la sicurezza delle scritture. |
| `globals.css`, componenti motion e illustrazioni | Consolidare token e varianti, layout desktop e accessibilità; eliminare stili duplicati progressivamente. |
| `lib/queries.ts`, `store.ts`, `apiClient.ts` | Confermare responsabilità di cache, preferenze e dati server; evitare copie divergenti. |
| `lib/tracker.ts`, `useTracking.ts`, `useScreenReady.ts` | Riutilizzare tracciamento esistente e nomi stabili; misurare completamento e difficoltà dei flussi. |

Mappa di migrazione da finalizzare nella fase 1:

| Percorso attuale | Destinazione nell’esperienza nuova |
|---|---|
| `/today` | Oggi |
| `/week`, `/week/new`, `/import` | Piano: calendario, creazione e programmi |
| `/session/[id]`, `/workout/[id]` e relativi editor | Dettaglio allenamento condiviso, mantenendo identità e provenienza |
| `/coach`, `/coach/allenarsi`, `/coach/esecuzione` | Attività: analisi e andamento |
| `/summary`, `/progress` | Attività: resoconti e continuità |
| `/body`, `/body/stato`, `/body/prontezza`, `/body/load` | Recupero e approfondimenti |
| `/body/conflict` | Proposta contestuale di adattamento, raggiungibile da Oggi/Piano |
| `/nutrition`, `/body/fuel`, `/body/fuel/diario`, `/body/fuel/history` | Nutrizione: piano del giorno, diario e storico |
| `/settings/goal` | Piano: obiettivo, con ingresso anche dal profilo |
| `/settings/*`, `/shoes`, `/connect-garmin`, `/connect-strava` | Profilo e connessioni; scarpe anche dal dettaglio attività |
| `/diff`, `/confirm-deletions`, `/sync`, `/sync/result` | Flusso di pubblicazione del Piano |
| `/watch-sync`, `/rate-limit` | Gestione problemi di connessione, senza bloccare contenuti indipendenti |

I nuovi nomi di sezione non obbligano a cambiare tutti gli URL subito. Prima consolidare il comportamento, poi eventuali alias/redirect preservando parametri e collegamenti salvati. Un redirect non sostituisce la migrazione di stato e semantica.

Usare un interruttore di rilascio per la nuova esperienza e mantenere un percorso di ripristino durante il collaudo. Non reimportare piani o sincronizzare automaticamente per effetto della nuova UI. Verificare persistenza e sessione autenticata al passaggio di versione.

Prima di implementare, formalizzare una nuova change OpenSpec dedicata e collegarla alle capacità già presenti. Le vecchie prescrizioni di layout mobile stretto e navigazione devono essere aggiornate esplicitamente, evitando di applicare alla cieca documentazione storica. Seguire `web/AGENTS.md` per tracciamento, errori, caricamenti e pulsanti in attesa; leggere la documentazione locale Next.js prima di modificare routing e layout.

## 11. Come capire se è più facile da usare

Test iniziale con il proprietario del prodotto e, se disponibili, 4–6 persone che non conoscano l’interfaccia. Usare gli stessi scenari nella UI corrente e nel prototipo. Il campione serve a individuare difficoltà, non a produrre statistiche rappresentative.

Obiettivi proposti:

- Almeno l’80% dei compiti principali completato senza suggerimenti; nessun partecipante bloccato sul percorso quotidiano.
- In cinque secondi l’utente sa indicare quale allenamento è previsto e dove aprirlo.
- Dal livello principale, storico, calendario, diario e connessioni sono raggiungibili entro due passaggi di navigazione. Non contare la compilazione di un modulo come navigazione.
- Nessuna funzione essenziale richiede swipe, pressione prolungata o trascinamento.
- Ritorno dal dettaglio alla stessa data, agli stessi filtri e alla stessa posizione.
- Nessun invio duplicato; aggiornamento dati e invio piano riconosciuti come azioni diverse.
- Pagine utilizzabili a 360, 390, 430, 768 e 1440 px; testo al 200%; tastiera e focus; barra inferiore senza sovrapposizioni alle azioni.
- Confronto dei tempi e degli errori rispetto alla baseline per aprire una seduta, spostarla, trovare un’attività e registrare un pasto. Fissare il miglioramento quantitativo atteso dopo aver misurato il punto di partenza.

Il progetto raccoglie già eventi come `dead_tap`, `rage_tap`, `screen_ready` e `long_loading`: usarli come segnali da interpretare insieme ai test, non come prova automatica di un problema. Integrare l’esito dei compiti dove non ancora disponibile, senza introdurre dati personali superflui negli eventi.

Per la realizzazione: controlli di compilazione e lint pertinenti, test dei flussi critici e delle mutazioni, verifica visiva con dati rappresentativi e stato vuoto. Ampliare le verifiche solo dove modifiche e rischi lo richiedono. Il piano termina quando i percorsi funzionano e sono reperibili, non quando tutte le schermate hanno un nuovo stile.

## 12. Creare allenamenti e programmi: AI e importazione

Approfondimento del percorso di creazione. Qui “allenamento” indica una singola seduta; “programma” indica un insieme di sedute con un obiettivo e un periodo. “Piano” è la sezione che ospita il calendario complessivo. Usare questi termini coerentemente nei titoli e nei pulsanti.

### Ingressi visibili

Nel Calendario, il pulsante **Aggiungi** apre due scelte con descrizione:

- **Allenamento singolo** — “Una seduta in un giorno preciso”.
- **Programma di allenamento** — “Più settimane verso un obiettivo”.

Nella sottosezione Programmi, **Nuovo programma** porta direttamente alla scelta **Crea con AI / Importa un file**. Nello stato iniziale senza programma, mostrare queste due azioni direttamente. Non occorre attraversare le impostazioni o trovare un banner nella settimana corrente.

La creazione manuale della singola seduta usa l’editor esistente. Una futura proposta AI di una sola seduta deve avere un percorso dedicato, con giorno, sport, durata e obiettivo: non deve richiamare una rigenerazione di settimane. Questa capacità specifica richiede verifica o sviluppo e non è inclusa come funzionalità già esistente.

### Crea un programma con AI

Percorso guidato su pagina dedicata, con indicazione del passo e salvataggio della bozza:

1. **Obiettivo.** Scegliere un obiettivo esistente o definirne uno nuovo: gara, prestazione, forma fisica, forza, costanza o mantenimento. Definire cosa verrà valutato e, se pertinente, entro quando. Un programma libero può rimanere senza traguardo specifico. Precompilare informazioni già presenti, consentendo di correggerle.
2. **Disponibilità.** Data di inizio, giorni disponibili, tempo per seduta, giorno preferito per il lungo e possibili doppie sedute. Un riepilogo compatto rende controllabili i vincoli senza doverli esprimere tutti in un testo libero.
3. **Punto di partenza e programmi attivi.** Mostrare quali dati saranno utilizzati: attività recenti, livello, tutti i programmi attivi, relativi obiettivi e priorità, sedute da mantenere e disponibilità residua. La proposta nasce dentro questo contesto, non come calendario indipendente da controllare soltanto alla fine. Se mancano dati essenziali, richiedere soltanto gli input necessari; distinguere informazioni dichiarate e rilevate.
4. **Preferenze e riepilogo.** Campo facoltativo “Altre indicazioni”, per esempio “Forza il venerdì, mantieni il lungo della domenica”. Le preferenze riconosciute devono apparire nel riepilogo; un vincolo non supportato va segnalato, non ignorato silenziosamente.
5. **Genera una bozza.** Elaborazione con stato leggibile, recupero della richiesta e possibilità di ritrovare il risultato. Nessuna modifica al calendario attivo durante questo passaggio.
6. **Controlla e attiva.** Anteprima comune descritta sotto, con possibilità di modificare la bozza o rivedere i vincoli.

Il generatore attuale lavora sulle sedute da domani fino alla domenica della terza settimana coinvolta, normalmente 15–21 giorni, con possibile termine anticipato alla gara. L’esperienza deve distinguere la strategia complessiva dalle settimane effettivamente dettagliate. Se un obiettivo è a mesi di distanza, mostrare chiaramente quali periodi sono indicativi e quali sedute sono già generate. Non promettere un programma interamente dettagliato di durata arbitraria senza estendere il servizio.

**Aggiorna programma** è un’azione separata nel programma esistente. Sostituisce le etichette tecniche attuali con intenzioni esplicite: “Adatta le prossime settimane”, “Aggiungi un altro sport”, “Riprogetta le prossime settimane”. Sempre indicare date, sedute preservate e cambiamenti proposti.

### Importa un file

1. **Scegli la sorgente.** Carica file oppure incolla contenuto. Indicare subito i formati supportati e offrire un modello di esempio. Oggi la UI supporta YAML/YML: PDF, Excel e immagini sono un’eventuale estensione distinta.
2. **Leggi e controlla.** Validare struttura, date, sport, unità, blocchi e riferimenti. Gli errori devono identificare seduta/campo e correzione richiesta; conservare il contenuto se serve riprovare. Un avviso correggibile è diverso da un errore che impedisce l’importazione.
3. **Mostra ciò che è stato riconosciuto.** Nome modificabile, intervallo date, numero di sedute, sport, eventuale obiettivo e anteprima settimanale. Consentire di associare un obiettivo esistente o definirne uno se assente, senza dedurlo arbitrariamente dal titolo. Evidenziare date passate, sovrapposizioni e possibili duplicati senza eliminazioni automatiche; due sedute nello stesso giorno possono essere intenzionali. Verificare la compatibilità con tutti i programmi attivi e i loro obiettivi prima dell’attivazione.
4. **Scegli la destinazione.** Impostazione iniziale “Nuovo programma”. Alternative esplicite: “Aggiungi a un programma esistente” oppure “Sostituisci un programma esistente”, con selezione del programma per nome. Nessuna sostituzione preselezionata.
5. **Controlla e attiva.** Stessa anteprima e stessi stati della generazione AI. Il file resta recuperabile se la validazione o il salvataggio falliscono.

### Anteprima comune e gestione di più programmi

AI e importazione producono lo stesso oggetto concettuale: **una bozza di programma**. La schermata di revisione mostra:

- nome, origine e periodo;
- calendario delle sedute proposte, con durata e sport;
- riepilogo per settimana con misure omogenee;
- impatto sul calendario esistente: aggiunte, modifiche, rimozioni, sedute mantenute e conflitti;
- accesso alla modifica della singola seduta, con nuova validazione dopo l’editing.

Azioni: **Salva bozza** e **Attiva programma**. Se si modifica un programma esistente, usare **Applica modifiche** e descrivere l’ambito esatto. Per sostituzioni, confermare il programma interessato e preservare storico delle attività e sedute bloccate secondo le regole applicabili.

Un programma corsa e uno forza possono contribuire allo stesso calendario. Ogni seduta espone il programma di appartenenza. Prima di attivare un altro programma, controllare il carico complessivo e le sovrapposizioni su tutti i programmi attivi. Nascondere un programma tramite filtro non equivale a disattivarlo.

Dopo l’attivazione: conferma “Programma aggiunto al calendario”, collegamento alla prima settimana e azione **Invia a Garmin** con relativa anteprima. Offrire anche “Più tardi”. Non chiamare “sincronizzato” un programma solamente salvato nell’app.

Stati del programma: **Bozza → Attivo → Archiviato**. La pubblicazione su Garmin ha uno stato separato, eventualmente per seduta: **Da inviare / In invio / Inviato / Errore**. Una bozza, un programma attivo e un insieme di sedute inviate non sono sinonimi.

### Dipendenze reali e verifiche aggiuntive

Questa parte richiede anche modifiche al comportamento dei servizi:

- L’importazione corrente chiama `useSetPlan` prima di aprire `/diff`; il generatore corrente aggiorna il piano server. Il confronto con Garmin non sostituisce l’anteprima delle modifiche al piano nell’app.
- Separare lettura/generazione, validazione e applicazione: salvare una bozza non deve mutare il piano attivo né pubblicare su Garmin.
- Prevedere persistenza delle bozze, stato recuperabile delle elaborazioni e applicazione esplicita. Se manca un’elaborazione durevole lato server, va realizzata prima di promettere che chiudere la pagina non interrompa il lavoro.
- Associare la proposta alla versione del programma usata per generarla. Se il programma cambia nel frattempo, ricalcolare il confronto prima dell’applicazione.
- Prevenire attivazioni duplicate in caso di doppio tocco, retry o risposta persa; verificare che il salvataggio sia concluso prima della navigazione di successo.
- Applicare controlli deterministici alle proposte AI e ai file. I contenuti importati sono dati; eventuali istruzioni testuali nel file non autorizzano azioni dell’app.

Inserire il prototipo di questi due percorsi nella fase 2 e sviluppare separazione bozza/applicazione nella fase 4, prima della nuova UI di attivazione.

Test di accettazione specifici: abbandonare una bozza lascia intatto il piano attivo; un file invalido non modifica dati; una sostituzione mostra esattamente cosa cambia; una generazione fallita conserva gli input; due attivazioni della stessa proposta non duplicano sedute; l’attivazione nell’app non invia automaticamente a Garmin; il primo accesso senza storico offre un percorso dichiarato; due programmi attivi producono un calendario coerente.

## 13. Obiettivi valutabili e coordinamento tra programmi

### Obiettivo, programma e calendario

L’obiettivo descrive il risultato desiderato; il programma organizza le sedute che vi contribuiscono; il calendario riunisce gli impegni dell’atleta. L’obiettivo deve avere un’identità stabile indipendente dal file importato o dalla generazione: rigenerare un programma non deve perdere le valutazioni precedenti.

Ogni programma può collegarsi a un obiettivo principale ed eventualmente contribuire ad altri. Più programmi possono sostenere lo stesso obiettivo: per esempio corsa e forza a supporto di una gara. Programmi con obiettivi distinti possono coesistere quando compatibili. L’app non deve imporre una gara o un tempo target a chi vuole mantenersi attivo; per un programma libero mostra soltanto valutazioni coerenti con le informazioni disponibili.

Per un obiettivo specifico registrare: tipo, descrizione, sport interessati, priorità, valore iniziale con data e fonte quando disponibile, criterio di riuscita, eventuale scadenza, frequenza di verifica e programmi collegati. Per gli obiettivi continuativi usare una data di revisione invece di inventare una scadenza finale.

| Tipo di obiettivo | Esempio | Valutazione da progettare |
|---|---|---|
| Gara | Completare una mezza maratona, eventualmente con un tempo desiderato | Preparazione svolta, andamento dei dati pertinenti, previsione se supportata e risultato effettivo dopo la gara. |
| Prestazione | Migliorare un riferimento su una distanza | Confronto tra test/attività comparabili, valore iniziale e target. |
| Forma fisica | Migliorare resistenza e regolarità | Concordare pochi indicatori osservabili; “forma fisica” da sola non autorizza un punteggio inventato. |
| Forza | Progredire in un esercizio | Serie, ripetizioni, carico o test dichiarati, se effettivamente registrabili. La disponibilità di questi dati va verificata. |
| Costanza o mantenimento | Mantenere una frequenza sostenibile scelta dall’utente | Frequenza reale e continuità nel periodo concordato, con gestione delle pause. |

### Come appare nell’app

**Piano → Obiettivi** mostra obiettivi attivi e conclusi, con il principale evidenziato. La scheda programma rende visibile “Contribuisce a…” e permette di aprire la relativa valutazione. Oggi mostra soltanto un riepilogo utile; i resoconti settimanali collegano ciò che è stato fatto al progresso verso gli obiettivi.

La pagina dell’obiettivo mostra risultato desiderato, punto di partenza, periodo, programmi collegati e valutazioni datate. Separare sempre:

- **Esecuzione del programma:** quanto del previsto è stato realmente svolto.
- **Progresso verso il risultato:** cosa mostrano attività, test e indicatori pertinenti.
- **Qualità della valutazione:** disponibilità, freschezza e comparabilità dei dati.

Completare tutte le sedute non equivale automaticamente a raggiungere il risultato. Evitare una percentuale universale di successo. Gli stati possono essere “In linea”, “Da rivedere”, “Dati insufficienti” e, dove verificabile, “Raggiunto”, accompagnati da evidenze e data dell’ultima valutazione. Predizioni e osservazioni reali rimangono distinguibili.

Rivalutare dopo nuove attività o test rilevanti, nel riepilogo periodico e quando cambiano obiettivo o programmi. L’aggiornamento della valutazione non applica automaticamente modifiche al calendario. Se cambia il target, mantenere la versione precedente e la data della modifica per non riscrivere retroattivamente i progressi.

### Creazione nel contesto di tutti i programmi attivi

Prima della generazione, comporre un quadro unico con obiettivi e priorità, impegni futuri di tutti i programmi attivi, attività effettivamente svolte, disponibilità complessiva, sedute bloccate e fasi dei programmi. Le bozze e i programmi archiviati non impegnano il calendario; eventuali sedute future già presenti su Garmin vanno riconciliate per non contarle due volte.

La compatibilità deve considerare insieme:

- **Tempo:** giorni, orari quando disponibili, durata totale e doppie sedute consentite.
- **Impegno complessivo:** distribuzione di volume, intensità e recupero, preservando unità e metriche pertinenti ai diversi sport. Non sommare chilometri di corsa e bici o convertire arbitrariamente serie di forza in chilometri.
- **Obiettivi e fasi:** priorità, sedute chiave e periodi di preparazione; un programma supplementare deve tenere conto della fase di quello principale.
- **Vincoli:** sedute già fissate dall’utente, disponibilità e dati mancanti che impediscono una valutazione attendibile.

Le regole verificabili devono essere controllate dal servizio; l’AI propone e spiega entro tali vincoli. Non è sufficiente scrivere nel prompt “considera gli altri piani”. Se manca una misura confrontabile tra sport, dichiarare il limite e utilizzare soltanto vincoli supportati, senza simulare un carico totale preciso.

La schermata di revisione presenta uno dei seguenti esiti motivati:

| Esito | Comportamento |
|---|---|
| Compatibile con i vincoli verificati | Attivazione disponibile, con riepilogo di come il nuovo programma si integra. Non costituisce una garanzia sanitaria. |
| Compatibile con modifiche | Proporre cambiamenti puntuali al nuovo programma e, solo se necessario, agli esistenti; mostrarli prima dell’applicazione. |
| Conflitto non risolto | Spiegare quale vincolo non è rispettato e offrire revisione di disponibilità, priorità, periodo o programma. Impedire l’applicazione in presenza di vincoli obbligatori violati. |
| Dati insufficienti | Indicare le informazioni mancanti e quali verifiche restano possibili; non mostrare un’approvazione completa. |

Scelta iniziale: adattare il nuovo programma preservando gli esistenti. Se ciò non basta, presentare una proposta coordinata con differenze separate per programma. Le modifiche agli altri programmi devono essere visibili nella conferma. La priorità di un obiettivo non autorizza a cancellare silenziosamente le sedute degli altri.

Esempio di comportamento, non prescrizione sportiva: con un programma corsa già attivo, creare un programma forza mostra subito le sedute corsa come impegni esistenti e propone le nuove sedute negli spazi compatibili. Se manca disponibilità, l’app presenta il conflitto prima di attivare, invece di sovrapporre due programmi completi.

Per l’importazione, eseguire la stessa valutazione sul contenuto letto. Un file incompatibile resta una bozza; offrire “Rivedi manualmente” o “Proponi un adattamento”, conservando l’originale e mostrando tutte le variazioni. Importare non autorizza una riscrittura AI automatica.

### Impatto tecnico e verifiche

Il codice già espone obiettivi di tipo `RaceGoal` e il generatore legge l’obiettivo del `plan_id` selezionato. Va esteso il modello a obiettivi non agonistici e associazioni esplicite, riusando le valutazioni gara esistenti dove pertinenti.

In `plan_generator.generate`, la costruzione della finestra legge attualmente `list_sessions(user_id, plan_id=plan_id)`: lo storico dell’atleta entra nel contesto, ma questa lettura non basta a garantire il coordinamento degli impegni futuri di tutti i programmi. Integrare esplicitamente gli altri programmi attivi sia nella proposta sia nella validazione prima dell’applicazione.

La logica di proposta senza scrittura delle sedute esiste già tramite `write=False`; va verificato l’intero percorso, inclusi eventuali aggiornamenti dello schema del programma, prima di usarla come garanzia di isolamento della bozza. Le versioni da ricontrollare al momento dell’attivazione includono tutti i programmi coinvolti, obiettivi e vincoli: se cambiano durante la generazione, rivalutare la compatibilità. Una proposta coordinata deve essere applicata in modo coerente, evitando modifiche parziali tra programmi.

Distinguere nelle valutazioni l’origine della seduta e gli obiettivi cui contribuisce. Un’attività condivisa può sostenere più obiettivi, ma si conta una sola volta nel carico complessivo e nella continuità dell’atleta. Disattivare un programma non cancella attività, obiettivi o valutazioni storiche; obiettivi e programmi hanno cicli di vita separati.

Inserire obiettivi, valutazioni e compatibilità nella fase 2 del prototipo e nei contratti della fase 4, non come rifinitura finale. Criteri aggiuntivi:

- Un programma non agonistico non richiede distanza gara o tempo finale.
- Un nuovo programma generato considera gli impegni degli altri programmi attivi prima di proporre le sedute.
- Un file importato attraversa gli stessi controlli di compatibilità.
- Un conflitto di disponibilità o una violazione dei vincoli obbligatori viene mostrato prima dell’attivazione.
- Cambiare un programma mentre viene generata una proposta invalida la precedente valutazione di compatibilità.
- Nessun programma esistente viene modificato senza che le variazioni siano incluse nella revisione.
- La mancanza di dati produce “Dati insufficienti”, non una valutazione positiva inventata.
- Rigenerazione, archiviazione e cambio obiettivo preservano la storia; nessuna attività viene conteggiata due volte nel totale dell’atleta.

## 14. Modelli per la realizzazione del progetto

Questa scelta riguarda gli strumenti con cui progettare, sviluppare e verificare il rifacimento. La scelta del modello AI interno a Passo per generare gli allenamenti resta all’utente.

Assegnazione proposta, basata sui modelli esposti nella sessione e sulla [documentazione ufficiale OpenAI](https://learn.chatgpt.com/docs/models), consultata il 29 ottobre 2026:

| Lavoro | Modello proposto | Impiego nel progetto |
|---|---|---|
| Architettura UX e decisioni complesse | GPT-6 Astra | Struttura dei flussi, obiettivi e programmi multipli, bozze/applicazione e migrazione. |
| Implementazione principale | GPT-6.1 Sol | Schermate, componenti, servizi, integrazione e test delle singole fasi. |
| Revisione dei passaggi critici | GPT-6 Astra | Verifica di perdita dati, conflitti tra programmi, applicazione delle proposte e sincronizzazione. |
| Controlli visivi mirati, se utili | GPT-6.1 Terra | Lettura degli screenshot e controllo di gerarchia, coerenza e testi. |

La distribuzione dei compiti è una scelta progettuale, non un confronto sperimentale svolto sul repository. Il riferimento operativo è Sol per lo sviluppo continuativo, Astra per le decisioni e le revisioni più complesse; Terra è facoltativo. Il livello di ragionamento va aumentato nei passaggi con più vincoli, evitando di usare il massimo per ogni modifica.

Questa assegnazione non cambia il modello della chat, non avvia altri agenti e non costituisce implementazione. L’esito si verifica attraverso prototipi, test e controlli sul progetto, indipendentemente dal modello usato.

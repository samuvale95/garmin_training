# Verifica — 30 ottobre 2026

Implementato il primo incremento del piano `PIANO_RIPROGETTAZIONE_UX.md`: navigazione a cinque sezioni, layout mobile/desktop, pagine Attività/Programmi/Obiettivi, gerarchia di Oggi, ritorno contestuale e comando Sposta nel calendario. Le modifiche locali preesistenti sono state conservate.

## Controlli eseguiti

- `npm run build` in `web`: superato, inclusa compilazione TypeScript e generazione delle 42 pagine statiche.
- ESLint sui componenti e sulle pagine coinvolte: nessun errore. Rimangono avvisi di simboli inutilizzati già presenti nelle viste legacy; rimosso l'import diventato inutilizzato nel nuovo header Nutrizione.
- `openspec validate passo-ux-foundations --strict`: superato.
- `git diff --check`: superato.
- `node scripts/verify-ux-foundations.mjs` in `web`: superato sia sull'anteprima di sviluppo sia sulla build di produzione. L'ultima esecuzione include anche programma destinatario della generazione e modalità iniziale d'importazione.

Il controllo browser usa un profilo temporaneo, un token fittizio e risposte intercettate: nessuna richiesta raggiunge i servizi esterni e nessun allenamento reale viene modificato. Le API secondarie non simulate restituiscono errori controllati. Queste prove verificano l'interfaccia e le richieste che produce, non la correttezza dei servizi Garmin/Strava/AI.

Scenari verificati:

- Cinque destinazioni e assenza di overflow orizzontale a 360, 390, 430 e 1440 px; sidebar senza sovrapposizione ai contenuti.
- Ricerca nello storico, aggiornamento immediato e mantenimento del periodo dopo ricaricamento. Corretto il problema delle lettere perse durante navigazioni concorrenti della ricerca.
- Due sedute visibili in Oggi.
- Apertura del dettaglio e ritorno alla settimana non corrente di provenienza.
- Spostamento con selezione data, richiesta di aggiornamento della seduta e controllo compatibilità esistente.
- Elenco di due programmi, accesso agli obiettivi e richiesta di generazione indirizzata al programma selezionato; il destinatario resta visibile durante il risultato/errore.
- Importazione inizialmente impostata su piano separato; ritorno a Programmi.
- Rifiuto di una destinazione esterna nel parametro di ritorno.
- Stati vuoti di Oggi/Piano/Attività e stato errore con Riprova nello storico.
- Nessun errore JavaScript di runtime nei percorsi verificati.

Anteprime acquisite e ispezionate in `/private/tmp/passo-ux-foundations/`, incluse Oggi, calendario, storico e programmi. Per ripetere le prove servono un server Next sulla porta 3100 e Chromium; sono configurabili `UX_PREVIEW_ORIGIN`, `UX_BROWSER_PATH`, `UX_SCREENSHOTS`. Il percorso browser predefinito corrisponde alla cache Playwright locale. L'ambiente attuale usa SWC WebAssembly: per lo sviluppo usare Next con `--webpack`.

## Limiti e incrementi successivi

Questo incremento non completa l'intero redesign. La pagina Obiettivi espone le gare supportate oggi; forma fisica, forza e altri obiettivi con metriche e valutazioni dedicate richiedono l'estensione del dominio.

AI e importazione mantengono il comportamento attuale di salvataggio. L'importazione propone un programma separato per evitare una sostituzione implicita, ma non introduce bozze persistenti né un nuovo passaggio di attivazione. La generazione può essere indirizzata a un programma esistente; non è ancora un percorso completo per creare un nuovo programma AI con obiettivo e verifica congiunta dei programmi attivi.

Il comando Sposta riutilizza il comportamento corrente: aggiornamento ottimistico e controllo successivo, con eventuale foglio degli avvisi. Non introduce una validazione preventiva del nuovo calendario né migliora la segnalazione del rollback su errore del servizio esistente.

Restano pianificati: creazione guidata unica AI/file, bozze e revisione prima dell'attivazione, obiettivi generalizzati e valutazioni, coordinamento tra programmi compatibili e carico complessivo, revisione completa degli editor, di Recupero e dei percorsi Nutrizione. Nessun modello per generare allenamenti nell'app è stato scelto o cambiato.

# Revisione architetturale in corso

30 ottobre 2026. Revisione Astra del primo sviluppo backend, prima dell'integrazione e dei test. I seguenti punti sono stati trasmessi al responsabile dei servizi e **non costituiscono un'approvazione del codice**. Verificare nuovamente i file dopo le correzioni.

| Priorità | Punto da verificare nella revisione finale |
|---|---|
| P1 | La sostituzione deve limitarsi all'intervallo esplicito della bozza; non eliminare tutte le sedute future del programma. Conservare oggi/passatо e completate in assenza di abbinamento certo. |
| P1 | Il lock globale BEFORE STATEMENT non protegge dall'inversione se helper legacy prendono prima SELECT FOR UPDATE. Tutti i percorsi devono prendere il lock di pianificazione prima dei lock di riga. |
| P1 | Il controllo storico del generatore ammette solo corsa: una richiesta di forza non deve produrre silenziosamente fallback corsa. |
| P1 | Le strade legacy di attivazione/generazione non devono aggirare la revisione e la compatibilità imposte dalla nuova esperienza. |
| P1 | Modificare un obiettivo gara indipendente deve mantenere coerenti gli adapter legacy usati da generazione e valutazione gara. |
| P1 | Gli errori delle nuove route devono usare il formato top-level message/category/details letto da apiClient, altrimenti conflitti e correzioni spariscono dalla UI. |
| P1 | Un job interrotto appena prima del riavvio non deve rimanere generating per sempre: recuperare lease scadute anche durante lettura/retry, non solo al riavvio successivo. |
| P2 | Calcolare compatibilità sulla variante breve effettiva; un intervallo di passo non dimostra una durata esatta usando la sola media. |
| P2 | Conservare anche un nuovo contenuto YAML invalido inviato via PATCH; mostrare l'obiettivo eventualmente letto dal file senza associarlo per deduzione. |
| P2 | Esporre associazioni programma-obiettivo aggiornabili, con ruolo principale coerente e versionato. |
| P2 | Le valutazioni devono distinguere data della valutazione e freschezza delle attività usate. |

La serializzazione globale è una possibile scelta conservativa per il servizio attuale, ma limita la concorrenza tra utenti. Il passaggio dalla proposta di lock per utente va documentato solo dopo avere eliminato le inversioni e valutato le prove di transazione. Questa nota iniziale precedeva la disponibilità dell'istanza PostgreSQL locale: vedere l'aggiornamento sotto per le prove successive.

## Aggiornamento della verifica locale

È stata utilizzata un'istanza PostgreSQL 16.6 temporanea sulla porta 55439. Dopo i 28 test del blocco backend precedente, gli 8 test aggiunti per migrazioni, adapter, valutazioni, bypass legacy e conferma nutrizione sono passati. La regressione browser AI/file → ripresa → revisione → attivazione è passata con fixture isolate, inclusa la correzione della conferma dei dati insufficienti legata al token corrente. TypeScript, lint mirato e build finale passati. Prove e limiti in [verification.md](verification.md).

Questo aggiornamento non equivale a una nuova approvazione Astra né a una verifica visuale Terra. La tabella iniziale rimane il riferimento della revisione critica; la chiusura complessiva richiede ancora le prove indicate nei task aperti.

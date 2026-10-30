# Verifica circoscritta: programmi e obiettivi

30 ottobre 2026. Questo blocco verifica il percorso AI/file → bozza salvata → ripresa → revisione → attivazione e l'associazione a un obiettivo. Non rappresenta la chiusura dell'intera riprogettazione.

## Prove eseguite in questo blocco

- **Backend: 8 test passati**, 28 esclusi perché già verificati nel blocco precedente. PostgreSQL 16.6 temporaneo su `127.0.0.1:55439`, ruolo `passo_test`, schemi casuali creati e rimossi dalle fixture. Test: migrazione ripetuta e cambio obiettivo principale, adapter obiettivi archiviati/standalone, anteprima nutrizione separata dal diario e conferma idempotente, costanza con settimane vuote, valutazione gara dell'obiettivo specifico, ownership valutazioni con 404, blocco bypass legacy `PUT /plan`.
- **Browser: PASS**, con richieste API intercettate e risposte locali. Creazione AI e importazione YAML incollata; associazione esplicita dell'obiettivo; uscita e ripresa della bozza server; generazione con `expected_revision`; conflitto che impedisce l'attivazione; 409 per contesto cambiato, nuova verifica e attivazione; conferma esplicita dei dati insufficienti; nessuna richiesta di pubblicazione Garmin. Nessun errore JavaScript rilevato.
- **Regressione corretta:** la conferma dei limiti ora è legata al token della verifica corrente. Una nuova verifica richiede una nuova conferma, anche dopo un conflitto di revisione. La fixture usa token diversi e prova che l'attivazione resta bloccata fino alla nuova conferma.
- **Frontend finale:** TypeScript senza emissione, ESLint sulle route programmi/obiettivi, hook DTO, form obiettivi e harness; build di produzione Webpack completata con esito positivo.

Harness ripetibile: `web/scripts/verify-complete-experience.mjs`; `UX_JOURNEYS_ONLY=1` evita di ripetere la matrice di schermate. Il click dell'harness centra il controllo prima del click per evitare sovrapposizioni con la barra mobile. Risultato e build locali: `/private/tmp/passo-complete-experience/browser-verification.json` e `build.log`.

## Limiti e lavoro residuo

Le API nel browser sono fixture: il test dimostra l'integrazione UI con i contratti simulati, mentre persistenza e atomicità sono verificate separatamente dai test PostgreSQL. Non dimostra una sessione completa browser→backend reale né una generazione con un servizio AI reale. Import tramite selettore file, ripresa prima del salvataggio da un altro dispositivo, race di completamento della generazione e tutti gli stati di pubblicazione restano fuori da questo controllo.

La matrice visuale completa 360/390/430/768/1440, testo ingrandito, tastiera, tecnologie assistive, revisione Terra e nuova revisione Astra non sono state eseguite in questo blocco. Non sono stati usati servizi esterni, account Garmin o database remoti; nessun commit o deploy. I punti complessivi 8.1–8.7 restano aperti dove comprendono queste prove ulteriori.

## Ripristino

Il fix circoscritto si ripristina riportando l'acknowledgement della pagina bozza allo stato precedente; non introduce migrazioni o modifiche ai dati. Le modifiche pregresse della riprogettazione restano locali e richiedono la propria verifica prima di un rilascio.

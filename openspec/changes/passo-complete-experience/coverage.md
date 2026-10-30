# Copertura del piano e verifica residua

30 ottobre 2026 · documento di lavoro, non attestazione di rilascio.

| Percorso | Sede e contratto | Capacità riusata / nuova | Stato verificabile |
|---|---|---|---|
| Navigazione, Oggi, calendario e storico | cinque tab; `TodayView`, `WeekView`, `/activities` | Fondamenta già completate | Verifica precedente in `passo-ux-foundations/verification.md`; regressione integrata ancora da eseguire. |
| Nuovo programma AI/file | `/week/programs/new`, `/plan/drafts` | Nuove bozze server; parsing YAML e motore corsa riusati | Persistenza/revisione backend provate; frontend in allineamento e browser test. AI dichiara correttamente il limite corsa; gli altri sport usano importazione. |
| Ripresa/modifica/revisione/attivazione | `/week/programs/drafts/[id]`, generate/validate/activate | Nuove revisioni, lease, transazione e ricevuta | Test PostgreSQL per isolamento, rollback, retry e contesto obsoleto; impatto leggibile, editor e stati UI in verifica. |
| Programmi multipli | `/week/programs`, constraints, activation-review/toggle | Multi-programma esistente; nuova compatibilità/riattivazione | Vincoli numerici verificati; carico fisiologico comune non disponibile e impegni solo Garmin da dichiarare come limite. Migrazione collegamenti al riavvio in correzione. |
| Obiettivi | `/week/goals`, `/goals`, `/plan/{id}/goals` | Nuovi ID/versioni/collegamenti; race adapter | CRUD e versioni provati; migrazione/adapter standalone e archiviati ancora da chiudere. |
| Valutazioni non gara | `/goals/{id}/evaluations` | Nuove osservazioni datate da attività canoniche | Costanza/mantenimento: frequenza osservata; distribuzione settimanale da correggere. Forza/prestazione/fitness: limiti dati espliciti, nessun punteggio inventato. |
| Valutazione gara | `/plan/goal-fit`, `/plan/goal-prediction`, `/settings/goal` | Servizi esistenti | Riutilizzo per l'obiettivo indipendente specifico non ancora dimostrato; link generico al piano corrente non basta per più gare. |
| Dettaglio/editor/spostamento/versione breve | `/session/[id]`, `/workout/[id]`, `WorkoutEditor`, `moveWarnings` | Editor/varianti riusati; separazione invio e preflight da completare | Salvataggio locale corretto; testo Garmin errato e scorciatoia sposta che inviava direttamente identificati; fix e prova browser pendenti. |
| Pubblicazione Garmin | `/diff`, `/confirm-deletions`, `/sync`, `/sync/result` | Preview e conferme esistenti | Auto-push backend rimosso. Esito sconosciuto/404 e riconciliazione da completare in tutti gli ingressi; nessuna scrittura Garmin live eseguita. |
| Attività e analisi | `/activities`, `/coach/*`, `/summary`, `/progress` | Identità canonica e letture esistenti | Storico e destinazioni esistono. Dettaglio svolto/confronti omogenei e ritorni devono essere dimostrati su dati rappresentativi, non dedotti dalla sola presenza dei link. |
| Recupero | `/body`, approfondimenti e Tendenze | Dati e grafici esistenti | Etichette/fonte/data/mancanti migliorati. Ispezione grafici, stati degradati e accessibilità ancora pendente. |
| Nutrizione | `/nutrition`, `/body/fuel`, diario; estimate/confirm | Indicazioni/diario esistenti; nuova stima non salvata e conferma idempotente | Preview/confirm in implementazione concordata; data selezionata, correzione quantità, ritorno e doppio invio ancora da provare. |
| Profilo/connessioni/primo accesso | `/settings`, connect routes, guards | Funzioni esistenti | Link obiettivi riallineato. Gruppi, optionalità Strava e prosecuzione senza storico da verificare: nessuna dichiarazione di completamento basata solo sui link. |
| Ripristino e accessibilità | Flag nuovi programmi; route legacy; focus/motion/tracking | Fondamenta e convenzioni riusate | Flag ancora da applicare; prove cinque larghezze/200%/tastiera/focus/stati e revisione Terra pendenti. |

Le prove automatiche isolate non attestano l'efficacia con utenti, l'accessibilità completa con tecnologie assistive o il comportamento dei servizi esterni. Queste verifiche vanno riportate separatamente dagli esiti locali realmente ottenuti.

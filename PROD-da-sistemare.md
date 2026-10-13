# Da sistemare prima di un ambiente di produzione

Oggi esiste un solo ambiente deployato (`development` → `passo-api.onrender.com`), usato
come se fosse produzione. Qui sotto i problemi trovati durante il lavoro su logging e
agenti (ottobre 2026) che vanno chiusi prima di aprire un vero ambiente `prod` o di dare
l'app ad altre persone. Ogni voce dice dove sta il problema e cosa fare. Quando una voce è
chiusa, si cancella.

## Sicurezza

- **Token `dev-athlete` accettato sempre.** `training_plan/api/auth.py` (`current_claims`)
  accetta `Authorization: Bearer dev-athlete` in qualunque ambiente: chiunque può
  chiamare l'API come l'utente finto `dev-athlete` e scrivere dati a suo nome. Non vede i
  dati degli altri né la pagina admin. Fix: accettarlo solo con una env esplicita (es.
  `DEV_AUTH_ALLOW_DEV_TOKEN=1`) che in prod non c'è.
- **`DEV_AUTH_BYPASS_USER_ID` mai impostata in prod.** Se c'è, ogni richiesta senza
  token diventa quell'utente. Verificare che su Render non ci sia, e valutare un controllo
  all'avvio che rifiuti di partire se è impostata insieme a `SUPABASE_URL`.
- **Gli errori 500 restituiscono `str(exc)` al client** (`_unhandled_error_handler` in
  `training_plan/api/app.py`). Può esporre dettagli interni (SQL, percorsi, messaggi di
  librerie). In prod: messaggio generico al client, dettaglio solo nei log.
- **Admin di base nella env.** `PASSO_ADMIN_USER_IDS` su Render contiene l'UID del
  proprietario. In un nuovo ambiente va reimpostata (gli admin aggiunti per email stanno
  nella tabella `app_admins`, che è per-database).

## Dati e ambienti

- **Un solo database.** Il `DATABASE_URL` del `.env` locale è lo stesso del servizio
  deployato: sviluppo locale e "produzione" scrivono negli stessi dati. Un ambiente prod
  vuole un database suo (e il locale uno di sviluppo o un branch).
- **Test che richiedono Postgres.** 26 test falliscono da prima di questo lavoro
  (`test_db.py`, parti di `test_api*.py`, `test_plan_routes.py`,
  `test_nutrition_compliance.py`, `test_api_coach.py`): servono un Postgres di test e
  l'allineamento alle API cambiate (vedi `tests/conftest.py`). Senza, la suite non può
  fare da cancello prima di un deploy in prod.
- **Schema creato all'avvio.** Tabelle e viste nascono con `CREATE ... IF NOT EXISTS` /
  `CREATE OR REPLACE VIEW` nello startup di FastAPI. Va bene con un solo processo; con più
  istanze o modifiche di colonne serve un passo di migrazione esplicito.
- **Retention dei log solo all'avvio.** `interactions.purge_old()` (60 giorni) gira solo
  quando il server riparte. Con un server che resta su a lungo serve un job periodico
  (si può agganciare al cron degli agenti).

## Processi e affidabilità

- **Rate limit in memoria.** Il limite di `/events/batch` (20 batch/min per utente) vive
  nel processo: con più istanze ognuna ha il suo contatore. In prod: contatore condiviso
  (Postgres o Redis) o limite al proxy.
- **Agenti in thread del processo web.** `runtime.run_in_background` usa thread daemon:
  un riavvio a metà esecuzione lascia la riga `agent_runs` in stato `running` (blocca nuove
  esecuzioni dello stesso agente per 60 minuti, poi si sblocca da sola). In prod: worker
  separato, oppure segnare come `failed` le esecuzioni `running` all'avvio.
- **Render free va in sleep.** Il cron degli agenti dipende da GitHub Actions
  (`.github/workflows/agents-cron.yml`), che sveglia il servizio con retry. Su un piano a
  pagamento si può usare un Cron Job di Render e togliere il workflow.
- **`@app.on_event("startup")` è deprecato** in FastAPI: passare a `lifespan` prima di un
  aggiornamento di versione.

## Privacy

- **Tracciamento attivo di default.** Va bene per un'app personale; con altri utenti
  serve un'informativa vera (cosa si registra, per quanto, a cosa serve) prima del primo
  evento, e valutare il default spento.
- **Testo di fallback dei target.** Per gli elementi senza `data-track` il log salva fino
  a 40 caratteri di testo visibile (cifre mascherate). Prima della prod, portare sotto
  il 10% i tap con target di fallback (vista `ux_tracking_coverage`) così quasi nessun
  testo dell'interfaccia finisce nei log.

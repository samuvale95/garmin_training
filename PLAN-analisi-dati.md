# Piano — come analizzare i dati

Quali dati Passo ha, cosa si può dire onestamente a partire da quelli, e chi calcola
cosa. Scritto dopo aver implementato il livello nutrizione, e vale anche per la parte
obiettivo/confidenza che non è ancora stata scritta.

## La regola che tiene tutto insieme

**Ogni numero mostrato è deterministico e riproducibile a mano. Il modello scrive solo
la prosa.**

Non è purismo: è la conseguenza diretta del fatto che l'app dice "il file resta la
verità". Un'app che mostra un 73% che nessuno può ricontrollare ha già rotto quella
promessa. E una percentuale generata da un LLM cambia da un giorno all'altro senza che
esista una ragione ispezionabile.

L'unica eccezione, ed è tale perché non esiste alternativa: **leggere una foto di un
piatto**. Non c'è formula chiusa che trasformi dei pixel in grammi di carboidrati. Lì il
modello percepisce, e infatti il risultato è etichettato "stima", porta una confidenza, ed
è sempre modificabile.

## Le sorgenti, e cosa vale ognuna

| Sorgente | Cosa dà | Affidabilità | Note |
|---|---|---|---|
| File del piano (device) | sessioni, passi, ritmi obiettivo | **alta** — è l'intento, non la misura | Il server non ne ha copia: viaggia nella richiesta |
| Strava attività | distanza, tempo, ritmo, FC reali | **alta** | Già matchate alle sessioni da `strava_sync` |
| Garmin `/body/today` | prontezza, sonno, HRV, FC riposo, stress | **media** | Campi non documentati, degradano a `None` |
| Garmin `/body/load` | carico acuto, rapporto acuto:cronico, VO₂max | **media** | ⚠️ `completed_load` **non è volume** |
| Garmin `body_metrics` | peso, altezza, età | **variabile** | Bilancia (datata) o profilo (potenzialmente di anni fa) |
| SQLite `food_entry` | pasti, macro, confidenza, corretto sì/no | **bassa se non corretta** | Il flag `corrected` è ciò che separa un dato da una supposizione |

Tre trappole già viste, da non ripetere:

1. **`completed_load` non sono chilometri.** È il punteggio di carico di Garmin. Il
   grafico di Carico li metteva sullo stesso asse dei km previsti; ora ogni serie è
   scalata sul proprio massimo. L'aderenza al volume deve venire dalla distanza
   matchata su Strava, mai da quel campo.
2. **Uno step a tempo senza ritmo non è 0 km.** Risolto in `format.ts` e
   `strava_sync.py`, che devono restare d'accordo. Da oggi la stessa matematica sta in
   `models.py` lato Python — un'implementazione sola.
3. **La durata pianificata ha due significati.** `strava_sync._planned_summary` somma
   solo gli step a tempo, perché quel numero viene confrontato con il tempo *misurato*
   da Strava. `models.session_duration_minutes` converte anche gli step a distanza,
   perché il rifornimento dipende dai minuti sulle gambe. Sono due funzioni diverse di
   proposito.

## Livello 1 — Aritmetica (fatto, o da fare senza modello)

### Nutrizione — implementato

- **Classificazione del carico**: durata reale della sessione (step a tempo + step a
  distanza convertiti al ritmo) e presenza di lavoro di qualità (uno step almeno 20 s/km
  più veloce del ritmo più lento che la sessione stessa nomina). Legge i ritmi, non i
  tipi di step: ogni piano scrive `interval` anche per il fondo da 40', e classificare
  sul tipo renderebbe dura ogni sessione.
- **Target**: range di consenso × peso. Carboidrati 3-5 / 5-7 / 7-10 / 10-12 g/kg per
  riposo-facile / moderato / duro / molto lungo. Proteine 1,6-2,0 g/kg sempre.
- **Back-to-back**: due giorni duri consecutivi alzano di una fascia la sera prima. È
  l'unico caso che la tabella piatta non copre.
- **Degradazione del peso**: bilancia → profilo Garmin → inserito a mano → 70 kg di
  riferimento, con `weight_source` che dice sempre quale dei quattro ha risposto.

### Confidenza obiettivo — da fare (fase 2, nessun modello coinvolto)

- **Riegel** `T₂ = T₁ × (D₂/D₁)^1.06` dal migliore sforzo di qualità delle ultime 8
  settimane. Riscontro incrociato col VO₂max di Garmin: se divergono di più del ~5%, si
  mostra un intervallo invece di scegliere un vincitore.
  **Il modo di fallire onesto è la parte più importante di tutta la fase.** Riegel ha
  bisogno di uno sforzo davvero duro recente. Chi fa solo volume facile non ha niente da
  estrapolare, e l'app deve dire *"non ho una prestazione recente su cui basarmi"*, non
  inventare un tempo.
- **Aderenza** su 42 giorni: sessioni matchate / sessioni previste, km completati / km
  previsti (da Strava, vedi trappola 1).
- **Rischio**: acuto:cronico fuori da 0,8-1,3; tendenza della prontezza su 14 giorni;
  rampa settimanale richiesta per arrivare al volume obiettivo.
- **Fascia** dal gap fra tempo previsto e obiettivo, con modificatori (aderenza < 0,7
  scende di una fascia; > 12 settimane ammorbidisce il linguaggio).

### Nutrizione longitudinale — da fare quando ci sono dati (fase 6)

Con qualche settimana di diario diventano calcolabili, tutte senza modello:

- **Copertura**: quanti giorni sono stati registrati almeno in parte. Va mostrata prima
  di qualsiasi altra statistica sul cibo: una media su 3 giorni su 30 non è una media.
- **Aderenza al target di carboidrati** nei giorni pre-sessione dura, che è l'unico
  taglio con un senso fisiologico — non la media su tutti i giorni.
- **Rifornimento vs. sessione riuscita**: incrociare i carboidrati del giorno prima con
  l'esito Strava della sessione dura. **Correlazione, non causa**, e con n piccolo va
  detto esplicitamente. Utile come osservazione (*"le tue sessioni dure vanno meglio
  quando la sera prima superi i 400 g"*), pericoloso come prescrizione.
- **Qualità del dato**: quota di voci `corrected`. Se è bassa, tutte le analisi sopra
  vanno presentate come stime del modello, perché è quello che sono.

## Livello 2 — Percezione (il modello, solo qui)

**Foto → macro.** `qwen/qwen3-vl-235b-a22b-instruct` via OpenRouter. JSON richiesto
esplicitamente, validato con Pydantic, un solo ritentativo. Restituisce la propria
confidenza, che pilota come il numero appare a schermo. Fuori range (grammi negativi,
confidenza inventata) → si scarta e si offre l'inserimento manuale.

Verificato dal vivo: su un'immagine senza cibo il modello prende correttamente il ramo
`"nessun cibo riconosciuto"` con valori a zero.

## Livello 3 — Prosa (il modello, sopra numeri già calcolati)

`deepseek/deepseek-v3.2` riceve un dizionario piccolo e già derivato — niente dati di
allenamento grezzi, niente identificativi, nemmeno il peso — e restituisce una o due
frasi in italiano.

```json
{"domani_sessione": "lungo 30 km", "domani_carico": "molto_lungo",
 "domani_carboidrati_g": [700, 840], "oggi_carico": "facile", "peso_stimato": false}
```

Il prompt di sistema porta la voce editoriale e due divieti che reggono tutto: **non
inventare numeri** e **mai il registro della restrizione**. Se il modello non risponde,
non risponde in tempo, o non è configurato, esce la frase template — che è scritta per
reggersi da sola, non per essere un ripiego visibile.

## Cosa non calcolare, e perché

- **Fabbisogno calorico giornaliero.** Le formule (Harris-Benedict, Mifflin-St Jeor)
  hanno un errore individuale del ±20%, e presentarle come un numero singolo invita
  esattamente il confronto entrate/uscite che questa funzione rifiuta di fare.
- **Composizione corporea, proiezioni di peso, tendenze del grasso corporeo.** Garmin le
  fornisce. Sono l'inizio della scivolata verso l'app che giudica.
- **"Stai mangiando bene?"** Non è una domanda con una risposta. Il rifornimento in
  funzione del carico sì.
- **Punteggi compositi.** Un unico "punteggio Passo" che fonde forma, aderenza, sonno e
  cibo nasconderebbe proprio la cosa che serve vedere: *quale* dei quattro sta
  trascinando giù il quadro.

## Ordine consigliato

1. **Adesso**: UI nutrizione sui contratti già serviti dal backend (fasi 4-6 del piano
   originale sono di fatto tutte servite lato server).
2. **Poi**: obiettivo nel YAML + `goal.py` deterministico (fasi 1-2). L'adapter LLM è già
   pronto e ha già la sua funzione `write_goal_narrative`.
3. **Quando ci sono 3-4 settimane di diario**: le analisi longitudinali, partendo dalla
   copertura del dato — che è anche l'unica che dice se le altre hanno senso.

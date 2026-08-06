# Plan — Race goal, goal confidence, and daily fuelling

Planning document for three related features, written to be implemented in phases.
Each phase ships something usable on its own; nothing later is a prerequisite for
anything earlier.

Written in English to match the rest of the repo (README, `openspec/changes/*`).
All user-facing strings stay Italian, as everywhere else in Passo.

---

## Decisions already made

| Question | Decision |
|---|---|
| Where the goal lives | In the YAML plan file, not `localStorage` — "il file resta la verità" |
| How confidence is computed | Deterministic sports-science math produces every number; an LLM only writes the Italian sentence that explains it |
| Food input method | Photo of the plate → vision model estimates macros |
| Food log storage | Local SQLite on the backend (the app's first genuinely append-only time series) |
| LLM provider | **Not Anthropic.** Qwen and/or DeepSeek, via their OpenAI-compatible endpoints |

### Provider constraint discovered while planning

DeepSeek's public API is **text-only** (`deepseek-chat`, `deepseek-reasoner`) — it has
no vision model, so it cannot read a plate photo. Qwen does (`qwen-vl-max` / `qwen3-vl`
family, via Alibaba DashScope's OpenAI-compatible endpoint).

The adapter therefore has **two independent roles**, each separately configurable:

- `LLM_TEXT_MODEL` — the goal-confidence narrative. Either provider works.
- `LLM_VISION_MODEL` — the food photo. Needs a vision-capable model (Qwen today).

Both providers speak the OpenAI wire format, so a single client library covers both —
and the same adapter points at a local Ollama/vLLM server without a code change, if the
photos-leave-the-house question ever becomes a concern.

**Verify current model availability at implementation time.** This landscape moves fast
and the note above reflects what was true when this plan was written.

---

## Part 1 — Race goal

The smallest of the three, and the one that gives the other two their meaning.

### File format

A new optional top-level `goal:` key, alongside `sessions:`:

```yaml
goal:
  race_date: "2026-11-15"
  name: "Maratona di Firenze"
  distance_km: 42.195
  target_time: "3:15:00"     # optional — a goal can be "finish it"
sessions:
  - date: "2026-08-10"
    ...
```

Validation rules, mirroring the strictness `parser.py` already applies to sessions:

- `race_date` — `YYYY-MM-DD`, must parse; may be in the past (the app then shows the
  result state rather than a countdown)
- `distance_km` — positive float. Accept the common named distances as sugar
  (`5k`, `10k`, `half`, `marathon`) and normalise to km at parse time
- `target_time` — `H:MM:SS` or `MM:SS`; optional
- `name` — free text, optional

### Code changes

| File | Change |
|---|---|
| `training_plan/models.py` | New `RaceGoal` dataclass; `TrainingPlan` gains an optional `goal` field |
| `training_plan/parser.py` | Parse and validate the `goal:` block; errors join the existing `TrainingPlanValidationError` list |
| `training_plan/api/schemas.py` | `RaceGoalOut` on the parse/diff responses |
| `web/src/lib/types.ts` | `RaceGoal` type on `Plan` |
| `web/src/lib/planYaml.ts` | Round-trip `goal:` on download — **critical**, otherwise downloading the plan silently drops the goal |

### Derived: training phase

Weeks-to-race drives a phase label used across the app. Pure function, no config:

```
weeks_left > 12       → "base"
12 >= weeks_left > 4  → "costruzione"
4 >= weeks_left > 1   → "picco"
weeks_left <= 1       → "scarico"
weeks_left < 0        → "gara passata"
```

This is deliberately crude — it labels where you are in the calendar, not what the plan
actually periodises. Do not present it as an assessment of the plan.

### UI

- **Oggi** — countdown card: *"Maratona di Firenze · fra 11 settimane · costruzione"*.
  Renders nothing when the plan has no goal; no empty-state nagging.
- **Carico** — the phase feeds the chart caption, replacing the hardcoded
  "Tre settimane in crescita e una di scarico in arrivo" that currently lies
  ([load/page.tsx:64-68](web/src/app/(tabs)/body/load/page.tsx#L64-L68)).
- **Impostazioni** — read-only display of the goal, with a note that it's edited in the
  YAML. No goal editor in v1; the file is the source of truth.

---

## Part 2 — Goal confidence

### Principle

**Every number is deterministic and reproducible. The model only writes prose.**

A percentage produced by an LLM drifts day to day for no reason the user can inspect,
and an app whose whole voice is "the file is the truth" cannot then show an opaque 73%.
Everything below is arithmetic the user could redo by hand.

### The three inputs

Each is independently computed and independently displayed, so the user can see *which*
one is dragging the assessment.

**1. Fitness — predicted race time**

Riegel's endurance formula, from the best recent quality effort:

```
T₂ = T₁ × (D₂ / D₁) ^ 1.06
```

- `T₁`, `D₁` — the best effort in the last 8 weeks, from Strava activities
  (already available via `/strava/activity-matches` and `/garmin/activities`)
- `D₂` — the goal distance
- Exponent 1.06 is Riegel's standard value

Cross-check against Garmin's VO₂max (already read by `body_insights.fetch_load_snapshot`).
If the two disagree by more than ~5%, widen the displayed prediction into a range rather
than picking a winner.

> **Honest failure mode, and it matters.** Riegel needs a genuinely hard recent effort. A
> runner doing only easy volume has nothing to extrapolate from, and an extrapolation
> from an easy run predicts a nonsense race time. When no effort in the window exceeds a
> quality threshold (say, ≥20 min at a pace meaningfully faster than the 8-week average),
> the app must say **"non ho una prestazione recente su cui basarmi"** and offer to use
> VO₂max alone as a weaker estimate. It must not invent a prediction.

**2. Adherence — did you do what you wrote?**

Over the last 42 days:

```
session_adherence = matched_sessions / planned_sessions
volume_adherence  = completed_km / planned_km
```

`matched_sessions` comes straight from the existing Strava matching. Both are already
computable with today's endpoints — no new data source.

**3. Risk — is the training sustainable?**

- Acute:chronic ratio (already in `/body/load`); outside 0.8–1.3 is a flag
- Readiness trend over 14 days (already in `/body/today`)
- Required weekly ramp to reach goal volume vs. weeks remaining

### Combining into a band

Not a percentage. A qualitative band plus the three drivers shown explicitly.

```
gap = (predicted_seconds - target_seconds) / target_seconds

gap <= -0.01          → "sei avanti"
-0.01 < gap <= 0.02   → "in linea"
 0.02 < gap <= 0.06   → "ambizioso"
 gap > 0.06           → "fuori portata a questo ritmo"
```

Modifiers, applied after:

- `session_adherence < 0.7` → drop one band (the plan isn't being run)
- `weeks_left > 12` → soften the wording; there is time for the picture to change
- No usable prediction → no band at all, just the missing-data message

Goals with no `target_time` skip the band entirely and show only fitness trend,
adherence, and risk.

### Where the LLM comes in

Input is a small deterministic dict — no raw training data, no personal identifiers:

```json
{
  "predicted": "3:22:00",
  "target": "3:15:00",
  "band": "ambizioso",
  "session_adherence": 0.82,
  "acwr": 1.45,
  "weeks_left": 11,
  "phase": "costruzione"
}
```

Output is **one or two sentences in Italian**, in Passo's editorial voice. The system
prompt carries the voice guidance and the hard rule that it must not invent numbers or
contradict the band.

Degradation is mandatory, not optional: with no API key configured, or on any error or
timeout, fall back to a templated Italian sentence per band. The screen must never
depend on the model being reachable.

### Endpoint

Following the existing `/body/conflict` pattern — the goal lives client-side in the plan,
so the client posts it:

```
POST /goal/confidence
  body: { goal: RaceGoal, sessions: [TrainingSession] }
  →     { predicted_time, prediction_basis, band, drivers: {...}, narrative, narrative_source }
```

`prediction_basis` names the effort the prediction came from (*"dal tuo 10 km del 3
agosto"*), so the number is traceable. `narrative_source` is `"model"` or `"template"` —
useful for debugging and for being honest in the UI if you ever want to be.

### New files

- `training_plan/goal.py` — pure: Riegel, adherence, risk, band. No I/O, no printing.
  Fully unit-testable, and it should be tested — this is the kind of arithmetic that is
  easy to get subtly wrong and impossible to notice.
- `training_plan/api/routes_goal.py` — thin adapter, same discipline as the others.

---

## Part 3 — Daily fuelling

### Scope, and the framing decision

The scope is deliberately narrow and defensible: **carbohydrate and protein availability
matched to the training load of today and tomorrow.** That is real sports nutrition with
solid consensus behind it. "Are you eating correctly" in the general case is not a
question with an answer, and the app should not pretend otherwise.

**The framing is fuelling, never restriction.** This is a design constraint, not a
preference:

- *"Domani hai il lungo: stasera carboidrati, colazione almeno due ore prima."* ✅
- *"Hai sforato di 300 kcal."* ❌

No calorie deficits, no weight targets, no judgement about what was eaten. A training app
that scolds you about food does real harm to a non-trivial fraction of endurance runners,
and the fuelling frame is also simply the more useful one for performance. The word
"dieta" should not appear in the UI.

Every screen carries a quiet note that this is general sports-nutrition guidance, not
clinical advice.

### Targets (deterministic, no model involved)

Standard consensus ranges, scaled by the next day's session:

| Tomorrow's session | Carbohydrate |
|---|---|
| Rest, or easy < 60 min | 3–5 g/kg |
| Moderate, ~1 h | 5–7 g/kg |
| Hard or long, 1–3 h | 7–10 g/kg |
| Very long > 3 h, or back-to-back | 10–12 g/kg |

Protein: 1.6–2.0 g/kg/day regardless of session. Fluids: a reminder, not a target.

Body weight comes from Garmin — `get_body_composition` exists on the client (verified).
Without a weight, show the ranges as absolute grams for a stated reference weight and say
so, rather than silently guessing.

Session intensity is classified from the plan's own steps, reusing the heuristic already
in [sessionVisuals.ts](web/src/lib/sessionVisuals.ts) rather than inventing a second one.

### Screen states

**1. Nothing logged today (the default, and the one that matters most)**

Requires zero input — the app already knows tomorrow's session (`nextPlanSession` is
computed on Oggi today) and today's load:

> *Domani 18 km col medio. Stasera pasta, e colazione almeno due ore prima.*

This is included even though photo logging is the chosen input method, because the screen
needs a state for "you haven't photographed anything yet" — and this is both the honest
one and the most useful. It is the fallback state, not extra scope.

**2. Photo logged**

Today's estimated intake against today's target, plus tomorrow's requirement. Estimates
are always labelled as estimates and are always editable.

**3. Degraded**

No plan, no weight, or no model configured — each degrades to the next-most-useful thing
and says which piece is missing. Same discipline as `body_insights.py`.

### Photo → macros

```
POST /nutrition/photo   (multipart: image, date)
  → { id, description, kcal, carb_g, protein_g, fat_g, confidence }
```

The vision model receives the image and a prompt asking for a strict JSON object. Ask for
JSON explicitly and **validate with Pydantic, retrying once on a parse failure** — do not
assume the provider supports strict `json_schema` enforcement; support varies and is
worth checking per provider rather than relying on.

The model also returns its own `confidence` (`low`/`medium`/`high`), which drives how the
number is presented. A low-confidence estimate should read as a guess, because it is one.

**Corrections are a first-class path, not an afterthought.** Macro estimation from a photo
is genuinely imprecise — portion size especially. Every entry is editable, and an edited
entry is marked as user-corrected so the history knows which numbers are trustworthy.

### Database

First persistent server-side state in the project. This does break the current
"no server-side database" invariant — accepted deliberately, because a food diary is a
longitudinal record and `localStorage` would lose it to a browser reset.

```sql
CREATE TABLE food_entry (
  id           INTEGER PRIMARY KEY,
  date         TEXT NOT NULL,        -- YYYY-MM-DD, local calendar date
  logged_at    TEXT NOT NULL,        -- ISO 8601
  source       TEXT NOT NULL,        -- 'photo' | 'manual'
  description  TEXT,                 -- the model's reading of the plate
  kcal         REAL,
  carb_g       REAL,
  protein_g    REAL,
  fat_g        REAL,
  confidence   TEXT,                 -- 'low' | 'medium' | 'high'
  corrected    INTEGER NOT NULL DEFAULT 0,
  image_path   TEXT                  -- local file, nullable
);
CREATE INDEX idx_food_entry_date ON food_entry(date);
```

Path from `PASSO_DB_PATH`, defaulting alongside the existing tokenstores in `~/`. Plain
`sqlite3` from the standard library — no ORM; the schema is one table.

Photos are stored locally next to the DB, never uploaded anywhere except to the vision
model at estimation time. Add a retention setting later if it matters; don't build it now.

### Endpoints

```
POST   /nutrition/photo          multipart → estimate + store
GET    /nutrition/day?date=      entries + totals + targets for that date
PATCH  /nutrition/entry/{id}     correct an estimate
DELETE /nutrition/entry/{id}
GET    /nutrition/targets?date=  targets alone (no log needed — powers state 1)
```

### New files

- `training_plan/nutrition.py` — pure: load → carb/protein targets. No I/O.
- `training_plan/db.py` — SQLite connection, schema init, entry CRUD.
- `training_plan/api/routes_nutrition.py` — thin adapter.

---

## Cross-cutting: the LLM adapter

One module, `training_plan/llm/`, owning every model call. Nothing else in the codebase
imports a provider SDK.

```
LLM_BASE_URL      e.g. https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY
LLM_TEXT_MODEL    e.g. qwen-plus, or deepseek-chat
LLM_VISION_MODEL  e.g. qwen-vl-max          (must be vision-capable)
LLM_TIMEOUT_S     default 20
```

Both Qwen and DeepSeek expose OpenAI-compatible endpoints, so the `openai` Python client
pointed at `LLM_BASE_URL` covers both — and a local Ollama/vLLM server too, unchanged.

Two functions, both of which **must degrade rather than raise**:

```python
def write_goal_narrative(facts: dict) -> str | None
def estimate_macros_from_photo(image_bytes: bytes) -> MacroEstimate | None
```

`None` means "unavailable" and the caller falls back to a template or an explicit
"non disponibile" — the same defensive discipline `body_insights.py` already uses for
Garmin's undocumented wellness fields.

**Privacy note, stated plainly rather than buried:** food photos and derived body metrics
leave the machine when a hosted provider is configured. This should be opt-in, off by
default, and clearly stated in Settings. The adapter's provider-agnosticism means a fully
local vision model is a config change, not a rewrite — worth keeping that door open.

---

## Implementation order

Each phase is independently shippable and independently useful.

| # | Phase | Depends on | Ships |
|---|---|---|---|
| 1 | Goal in YAML + countdown + phase | — | Countdown on Oggi; Carico stops lying |
| 2 | Deterministic confidence + templated Italian | 1 | The whole feature, no AI, no new deps |
| 3 | LLM adapter + narrative swap-in | 2 | Better prose; nothing breaks if it's off |
| 4 | Nutrition targets + zero-input fuelling advice | 1 | Useful nutrition screen, no DB, no AI |
| 5 | SQLite + photo logging + vision model | 3, 4 | The logging loop |
| 6 | Corrections + history view | 5 | Trustworthy longitudinal data |

Phases 1–2 and 4 involve no LLM at all. If phases 5–6 never happen, phases 1–4 still
stand on their own as complete features — which is the point of ordering it this way.

### Prerequisite — done

The data-correctness bugs from the earlier review, fixed before phase 1 since both
features build on the same screens and the same numbers.

- **Time-based steps with no `target_pace` counted as 0 km.** Fixed in
  [format.ts](web/src/lib/format.ts) and its backend mirror
  [strava_sync.py](training_plan/strava_sync.py), which had the same bug and feeds
  `planned_distance_km` on the Strava comparison. An unpaced step is now estimated at
  the slowest pace its own session names, falling back to 6:00/km when the session
  names none; `rest` stays at 0 km, being time spent standing still. The two
  implementations must keep agreeing — same constant, same rule.
- **Hardcoded copy in [load/page.tsx](web/src/app/(tabs)/body/load/page.tsx).** Headline,
  caption, deload call-out and the acute:chronic note are now all derived from the weeks
  on screen. Phase 1 replaces the caption again with the phase label; the rest stands.
- **Third one, found while fixing the second: the Carico chart shared one axis between
  two different quantities** — "fatto" is Garmin's acute training-load score, "previsto"
  is kilometres off the plan. The bars invited a comparison that meant nothing. Each
  series is now scaled against its own maximum, with the legend and a note saying so.
  Worth remembering in phase 2: `/body/load`'s `completed_load` is *not* volume, so
  adherence must come from Strava-matched distance, never from that field.

---

## Risks and open questions

**Riegel needs a hard recent effort.** Covered above; the honest missing-data path is the
single most important detail in part 2. Getting it wrong means the app confidently
predicts a race time from an easy jog.

**Photo macro estimation is imprecise**, portion size especially. Mitigated by showing
confidence, making everything editable, and never presenting an estimate as measured.

**Vision model availability.** Verify Qwen-VL model IDs and DeepSeek's vision status at
implementation time rather than trusting this document.

**The no-database invariant.** Phase 5 breaks it knowingly. Worth confirming the tradeoff
is still wanted when you get there — phases 1–4 don't need it, so the decision can wait.

**Not decided yet:**

- Whether to also read Garmin's own nutrition log. `get_nutrition_daily_food_log`,
  `get_nutrition_daily_meals`, and `get_nutrition_daily_settings` all exist on the
  `garminconnect` client (verified), and populate from a MyFitnessPal sync. If you ever
  use MyFitnessPal, this is zero-friction food data with no photo required. Not in scope
  now; noted because it's cheap to add later and the endpoints are confirmed to exist.
- Multi-goal / A-B-C race priorities. One goal for now.
- Whether the goal should be editable in-app or stay file-only. File-only in v1.

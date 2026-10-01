# Design: Personal Biometric Norms and ACWR Limits

## Context

Passo guides training adaptations and recovery alerts using biometric signals from Garmin Connect and planned workouts. Currently, the system relies on static values:
- Resting Heart Rate: triggers alerts on hardcoded `+3 bpm` (moderate) or `+6 bpm` (strong) rises against a 7-day average.
- Overnight HRV: triggers alerts on a fixed `-10%` or `-20%` drop below the 7-day mean.
- ACWR (Acute:Chronic Workload Ratio): is computed in `body_insights.py` and rendered passively on `/body/load`, but is not evaluated by `plan_limits.py` or `moveWarnings.ts` when moving or editing workouts.

With the Venice Marathon approaching, athlete recovery needs individualized variance estimation to avoid false alarms during taper, and move warnings need active ACWR protection against acute overload.

## Goals / Non-Goals

**Goals:**
- Provide a statistical baseline calculation (rolling mean $\mu$, sample standard deviation $\sigma$, confidence bounds) for resting heart rate and rMSSD HRV over available history (up to 60 days).
- Evaluate daily biometric status against these personal norms in `readiness.py`, producing `cauto` (at $1.5\sigma$) and `scarico` (at $2.0\sigma$) signals with clear textual context.
- Fall back gracefully to existing 7-day averages when historical depth is less than 14 days.
- Implement ACWR check in `plan_limits.py` and client-side move validation in `moveWarnings.ts`.
- Surface clear, helpful warnings when a workout rescheduling pushes the projected 7-day ACWR into the injury danger zone (> 1.35 or > 1.50).

**Non-Goals:**
- Machine-learning predictive models (simple statistical distributions are transparent and auditable).
- Redesigning the entire Garmin sync engine.
- Modifying historical completed activity data retroactively.

## Decisions

### 1. Statistical Norm Band vs Fixed Delta
- **Choice**: Use Gaussian confidence bounds $[\mu - 1.5\sigma, \mu + 1.5\sigma]$ on rolling 28–60 days for normal variation.
- **Rationale**: Individual HRV has wide interpersonal variation; for some athletes, 8% is daily noise, while for others it indicates sickness. Standard deviations normalize this variation per individual.
- **Alternatives considered**: Fixed percentage drops (current approach, too noisy); machine learning classifiers (opaque, requires months of training labels).

### 2. Graceful Fallback for Limited History
- **Choice**: Require $\ge 14$ days of readings for full personal norm activation. Between 3 and 13 days, fallback to the 7-day average percentage delta. With $< 3$ days, return unknown.
- **Rationale**: Standard deviation with fewer than 10-14 samples is unstable and produces artificially narrow or wide bands.

### 3. ACWR in Move Warnings
- **Choice**: Compute projected 7-day acute workload divided by 28-day chronic baseline during move validation.
- **Rationale**: Moving a long run from Sunday to Tuesday right after an interval session can suddenly compress acute load into a single rolling 7-day window. If ACWR exceeds 1.35, the app prompts "Attenzione al sovraccarico acuto".
- **Alternatives considered**: Only checking weekly calendar boundaries (Monday-Sunday). Rejected because rolling 7 days catches midweek back-to-back load spikes that calendar weeks hide.

## Risks / Trade-offs

- **[Risk] Insufficient historical data**: New users don't have 60 days of Garmin data yet.
  - *Mitigation*: Fallback pipeline smoothly switches from personal norm to 7-day mean.
- **[Risk] Too many move warnings**: If ACWR threshold is set too low (e.g. 1.2), normal training progressions might annoy the user.
  - *Mitigation*: Safe zone is 0.8–1.30. Warning starts strictly at 1.35, critical at 1.50, aligned with established sports science consensus (Gabbett et al.).

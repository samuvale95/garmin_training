# Proposal: Personal Biometric Norms and Active ACWR Injury Prevention Limits

## Why

Currently, Passo uses static, one-size-fits-all thresholds to assess biometric readiness and injury risk:
1. Resting Heart Rate (RHR) warns the athlete based on a fixed +3 / +6 bpm rise over a simple 7-day average, and HRV compares against a raw 7-night mean without variance or confidence bands. During marathon tapering (such as the final 3 weeks before the Venice Marathon on October 25), physiological supercompensation naturally shifts these numbers, causing either false alarms or missed overreaching signals.
2. Acute-to-Chronic Workload Ratio (ACWR) is currently computed and displayed in `/body/load`, but it is completely passive: neither the plan generation, weekly plan checks, nor the session move warnings (`moveWarnings.ts`) enforce ACWR as an active limit to protect the athlete against acute overload.

Personalizing biometric thresholds using statistical baseline norms (mean ± standard deviation over a rolling window) and activating ACWR as an enforced safety rule in move warnings and plan checks directly protects the athlete's health and training consistency when it matters most.

## What Changes

- **Personal Biometric Norms (RHR & HRV)**:
  - Compute individual baseline statistics (rolling 28–60 day historical distribution: mean, standard deviation, and normal range band) for resting heart rate (RHR) and overnight HRV (rMSSD).
  - Replace static `+3 bpm` / `+6 bpm` and `-10%` / `-20%` thresholds in `readiness.py` with personalized z-score / standard-deviation bounds (`normal`, `cauto` if outside 1.5 SD, `scarico`/stop if outside 2.0 SD).
  - Gracefully degrade to existing conservative 7-day fallbacks when fewer than 14 nights of historical data exist.
- **Active ACWR Limits in Move Warnings and Plan Checks**:
  - Integrate ACWR computation into `plan_limits.py` and `moveWarnings.ts`.
  - When moving, adding, or modifying a workout causes the projected acute workload to spike above the safe ACWR zone (ACWR > 1.35 warning, ACWR > 1.50 high injury risk), raise an active warning in `MoveWarningSheet` and in plan validation.
  - Expose the athlete's current ACWR state and projected post-move ACWR clearly.

## Capabilities

### New Capabilities
- `personal-biometric-norm`: Computes rolling personal biometric baseline norms (RHR and HRV mean ± standard deviation) from historical health metrics and generates individualized readiness and recovery signals.

### Modified Capabilities
- `plan-limits`: Adds an active Acute:Chronic Workload Ratio (ACWR) safety rule to plan validation and session move warning checks, preventing sudden acute volume spikes above 1.35–1.50.

## Impact

- **Backend (`training_plan`)**:
  - `readiness.py`: Updated to accept and evaluate personal norm bounds for RHR and HRV.
  - `body_insights.py`: Extracts and calculates rolling baseline distributions for RHR and HRV from Garmin health history.
  - `plan_limits.py`: Adds ACWR evaluation to rule checks.
  - API schemas: Expose personal norm ranges and ACWR check details in readiness and move validation responses.
- **Frontend (`web/src`)**:
  - `moveWarnings.ts` and `MoveWarningSheet.tsx`: Surface ACWR overload warnings when rescheduling or extending sessions.
  - `DayStateCard.tsx` and `BodyCards.tsx`: Display whether RHR/HRV are within personal baseline norms.

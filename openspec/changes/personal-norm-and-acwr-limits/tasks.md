## 1. Personal Biometric Norm Backend Calculation

- [x] 1.1 Add statistical distribution calculator (mean, standard deviation, normal range bounds) for RHR and HRV in `training_plan/body_insights.py`
- [x] 1.2 Update `readiness.py` to evaluate RHR and HRV against personal norms with fallback to 7-day delta when history is short
- [x] 1.3 Expose personal norm ranges and status flags in `training_plan/api/schemas.py` and `routes.py`
- [x] 1.4 Add unit tests for personal biometric norms calculation and fallback in `tests/test_readiness.py`

## 2. ACWR Limits in Backend Plan Logic

- [x] 2.1 Implement rolling ACWR calculation in `training_plan/plan_limits.py`
- [x] 2.2 Add ACWR rule check to plan evaluation and reschedule validation in backend
- [x] 2.3 Add unit tests for ACWR rule violations (safe vs spike > 1.35 and > 1.50) in `tests/test_plan_limits.py`

## 3. Frontend Move Warnings & UI Integration

- [x] 3.1 Update `web/src/lib/moveWarnings.ts` to compute and check projected ACWR before and after session move
- [x] 3.2 Add ACWR warning message and visual badge in `MoveWarningSheet.tsx`
- [x] 3.3 Display personal norm ranges and indicator in `DayStateCard.tsx` and `BodyCards.tsx`

## 4. Verification and End-to-End Testing

- [x] 4.1 Run backend pytest suite to verify all readiness and limit tests pass
- [x] 4.2 Run frontend typecheck and build to confirm clean UI integration

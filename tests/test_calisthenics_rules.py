from datetime import date
from training_plan.models import TrainingSession, Step, RepeatBlock, PaceTarget
from training_plan.plan_rules import validate, RuleContext


def test_calisthenics_does_not_trigger_strength_before_hard():
    # Tuesday: calisthenics (upper body / core)
    # Wednesday: hard intervals running
    calisthenics_sess = TrainingSession(
        date=date(2026, 11, 3),
        sport="calisthenics",
        title="Parco: Trazioni e Dip",
        steps=[
            RepeatBlock(
                reps=4,
                steps=[
                    Step(type="interval", duration_type="time", duration_value=2, note="Trazioni"),
                    Step(type="rest", duration_type="time", duration_value=2),
                ],
            )
        ],
    )

    interval_sess = TrainingSession(
        date=date(2026, 11, 4),
        sport="running",
        title="Ripetute 5x1000m",
        steps=[
            Step(type="warmup", duration_type="time", duration_value=15, target_pace=PaceTarget(360, 350)),
            RepeatBlock(
                reps=5,
                steps=[
                    Step(type="interval", duration_type="distance", duration_value=1.0, target_pace=PaceTarget(260, 250)),
                    Step(type="recovery", duration_type="time", duration_value=2.0, target_pace=PaceTarget(360, 350)),
                ],
            ),
            Step(type="cooldown", duration_type="time", duration_value=10, target_pace=PaceTarget(360, 350)),
        ],
    )

    ctx = RuleContext(
        effective_level=1,
        recent_weekly_minutes=150.0,
        recent_longest_run=60.0,
        today=date(2026, 11, 2),
    )

    violations = validate([calisthenics_sess, interval_sess], ctx)
    rule_keys = [v.key for v in violations]
    # Calisthenics should NOT trigger strength_before_hard
    assert "strength_before_hard" not in rule_keys


def test_strength_training_does_trigger_strength_before_hard():
    # Tuesday: heavy leg strength
    # Wednesday: hard intervals running
    strength_sess = TrainingSession(
        date=date(2026, 11, 3),
        sport="strength_training",
        title="Gambe e Squat Pesante",
        steps=[
            Step(type="interval", duration_type="time", duration_value=45),
        ],
    )

    interval_sess = TrainingSession(
        date=date(2026, 11, 4),
        sport="running",
        title="Ripetute 5x1000m",
        steps=[
            Step(type="warmup", duration_type="time", duration_value=15, target_pace=PaceTarget(360, 350)),
            RepeatBlock(
                reps=5,
                steps=[
                    Step(type="interval", duration_type="distance", duration_value=1.0, target_pace=PaceTarget(260, 250)),
                    Step(type="recovery", duration_type="time", duration_value=2.0, target_pace=PaceTarget(360, 350)),
                ],
            ),
            Step(type="cooldown", duration_type="time", duration_value=10, target_pace=PaceTarget(360, 350)),
        ],
    )

    ctx = RuleContext(
        effective_level=1,
        recent_weekly_minutes=150.0,
        recent_longest_run=60.0,
        today=date(2026, 11, 2),
    )

    violations = validate([strength_sess, interval_sess], ctx)
    rule_keys = [v.key for v in violations]
    # Strength training before hard intervals DOES trigger strength_before_hard
    assert "strength_before_hard" in rule_keys

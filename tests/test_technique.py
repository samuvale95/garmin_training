"""Technique bands, read against summaries shaped like Garmin's own."""

from datetime import date

from training_plan import technique


def _form(summary, sport="running", laps=None):
    return technique.analyse_activity(
        summary, activity_id=1, sport=sport, title="Seduta", day=date(2026, 9, 11), laps=laps
    )


def _metric(form, key):
    return next((m for m in form.metrics if m.key == key), None)


RUN_SUMMARY = {
    "distance": 12000,
    "duration": 3600,
    "averageRunningCadenceInStepsPerMinute": 178,
    "avgGroundContactTime": 232,
    "avgVerticalOscillation": 7.4,
    "avgVerticalRatio": 6.2,
    "avgGroundContactBalance": 50.2,
    "avgStrideLength": 122.0,
    "averageHR": 152,
}


# ---- running ------------------------------------------------------------------------


def test_a_clean_run_has_nothing_to_work_on():
    form = _form(RUN_SUMMARY)
    assert form.headline == "Niente fuori posto in questa seduta"
    assert form.focus is None
    assert all(m.verdict != technique.VERDICT_WORK for m in form.metrics)


def test_a_low_cadence_gets_a_drill_not_a_diagnosis():
    form = _form({**RUN_SUMMARY, "averageRunningCadenceInStepsPerMinute": 152})
    cadence = _metric(form, "cadenza")
    assert cadence.verdict == technique.VERDICT_WORK
    assert "passi" in cadence.cue


def test_a_slow_run_reports_contact_time_without_judging_it():
    """Ground contact time falls with pace. At 7:00/km the reference band, drawn from
    runs at effort, is measuring a jog and says nothing."""
    form = _form({**RUN_SUMMARY, "duration": 5040, "avgGroundContactTime": 295})
    assert _metric(form, "contatto").verdict == technique.VERDICT_NEUTRAL


def test_the_same_contact_time_at_pace_is_a_finding():
    form = _form({**RUN_SUMMARY, "avgGroundContactTime": 295})
    assert _metric(form, "contatto").verdict == technique.VERDICT_WORK


def test_vertical_oscillation_in_millimetres_is_recognised():
    """Garmin reports centimetres on some responses and millimetres on others; 84 mm
    read as 84 cm would be a person bouncing most of a metre per step."""
    form = _form({**RUN_SUMMARY, "avgVerticalOscillation": 84.0})
    assert _metric(form, "oscillazione").value == 8.4


def test_an_uneven_footstrike_names_the_side():
    form = _form({**RUN_SUMMARY, "avgGroundContactBalance": 53.4})
    balance = _metric(form, "bilanciamento")
    assert balance.verdict == technique.VERDICT_WORK
    assert "sinistra" in balance.cue


def test_stride_length_is_reported_without_a_verdict():
    """It grows with pace on its own. A target for it is how people acquire injuries."""
    assert _metric(_form(RUN_SUMMARY), "passo").verdict == technique.VERDICT_NEUTRAL


def test_a_watch_with_no_running_dynamics_says_so():
    form = _form({"distance": 8000, "duration": 2700})
    assert not form.has_metrics
    assert form.headline == "L'orologio non ha registrato dati di tecnica"


# ---- pacing -------------------------------------------------------------------------


def test_a_positive_split_is_the_thing_to_work_on():
    laps = [{"distance": 6000, "duration": 1740}, {"distance": 6000, "duration": 1900}]
    form = _form(RUN_SUMMARY, laps=laps)
    assert form.pacing.kind == "positivo"
    assert form.headline == "Da lavorarci: come distribuisci il ritmo"
    assert "Parti più piano" in form.focus


def test_pacing_outranks_a_form_metric():
    """A card that is titled after its vertical oscillation and then advises about
    pacing is a card arguing with itself."""
    laps = [{"distance": 6000, "duration": 1740}, {"distance": 6000, "duration": 1900}]
    form = _form({**RUN_SUMMARY, "avgVerticalOscillation": 11.5}, laps=laps)
    assert "ritmo" in form.headline
    assert "Parti più piano" in form.focus


def test_an_even_run_is_not_flagged():
    laps = [{"distance": 5000, "duration": 1500}, {"distance": 5000, "duration": 1515}]
    assert _form(RUN_SUMMARY, laps=laps).pacing.kind == "regolare"


def test_a_negative_split_is_good_news():
    laps = [{"distance": 5000, "duration": 1560}, {"distance": 5000, "duration": 1470}]
    pacing = _form(RUN_SUMMARY, laps=laps).pacing
    assert pacing.kind == "negativo"
    assert pacing.verdict == technique.VERDICT_GOOD


def test_a_lap_straddling_the_midpoint_is_split_proportionally():
    """With 5 km laps on a 15 km run, assigning whole laps moves the halfway mark by
    2.5 km and invents a split that is not in the data."""
    laps = [{"distance": 5000, "duration": 1500}] * 3
    pacing = technique.read_pacing(laps)
    assert pacing.kind == "regolare"
    assert pacing.drift_percent == 0.0


def test_one_lap_is_not_a_distribution():
    assert technique.read_pacing([{"distance": 10000, "duration": 3000}]) is None


# ---- other sports -------------------------------------------------------------------


def test_grinding_a_big_gear_is_a_finding():
    form = _form({"distance": 40000, "duration": 4800, "averageBikingCadenceInRevPerMinute": 68}, sport="cycling")
    cadence = _metric(form, "cadenza_bici")
    assert cadence.verdict == technique.VERDICT_WORK
    assert "85 rpm" in cadence.cue


def test_a_surging_ride_is_read_from_normalized_power():
    form = _form(
        {"distance": 40000, "duration": 4800, "avgPower": 180, "normPower": 225}, sport="cycling"
    )
    assert _metric(form, "regolarita").verdict == technique.VERDICT_WORK


def test_a_steady_ride_is_not():
    form = _form(
        {"distance": 40000, "duration": 4800, "avgPower": 200, "normPower": 204}, sport="cycling"
    )
    assert _metric(form, "regolarita").verdict == technique.VERDICT_GOOD


def test_swolf_is_only_judged_in_a_pool_the_bands_know():
    known = _form({"avgSwolf": 52, "poolLength": 25}, sport="swimming")
    assert _metric(known, "swolf").verdict == technique.VERDICT_WORK
    unknown = _form({"avgSwolf": 52, "poolLength": 50}, sport="swimming")
    assert _metric(unknown, "swolf").verdict == technique.VERDICT_NEUTRAL


def test_a_sport_with_no_reader_degrades_to_an_empty_read():
    form = _form({"distance": 5000, "duration": 3000}, sport="strength_training")
    assert form.metrics == []
    assert not form.has_metrics


# ---- what the model is allowed to see -------------------------------------------------


def test_the_facts_carry_the_conclusion_already_reached():
    laps = [{"distance": 6000, "duration": 1740}, {"distance": 6000, "duration": 1900}]
    facts = technique.coach_facts(_form(RUN_SUMMARY, laps=laps))
    assert set(facts) <= {"sport", "seduta", "distanza_km", "durata_min", "misure", "andatura", "da_fare"}
    assert facts["andatura"]["tipo"] == "positivo"
    assert all(set(m) == {"cosa", "valore", "giudizio", "riferimento"} for m in facts["misure"])


# ---- the same metric across sessions --------------------------------------------------


def _run(day, **summary):
    """One September run, dated by `day` -- the trend needs several, on different days."""
    return technique.analyse_activity(
        {**RUN_SUMMARY, **summary}, activity_id=day, sport="running", title="Run", day=date(2026, 9, day)
    )


def test_a_metric_moving_the_right_way_is_an_improvement():
    forms = [_run(d, avgGroundContactTime=gct) for d, gct in [(1, 285), (4, 280), (8, 276), (12, 255)]]
    contact = next(t for t in technique.build_trends(forms) if t.key == "contatto")
    assert contact.direction == technique.DIRECTION_BETTER
    assert contact.delta < 0


def test_the_same_movement_the_other_way_is_not():
    forms = [_run(d, averageRunningCadenceInStepsPerMinute=c) for d, c in [(1, 180), (4, 178), (8, 176), (12, 162)]]
    cadence = next(t for t in technique.build_trends(forms) if t.key == "cadenza")
    assert cadence.direction == technique.DIRECTION_WORSE


def test_noise_is_not_a_trend():
    """Session-to-session scatter -- terrain, shoes, how the watch sat -- explains a
    couple of percent just as well as any change in form does."""
    forms = [_run(d, avgGroundContactTime=gct) for d, gct in [(1, 268), (4, 270), (8, 267), (12, 266)]]
    contact = next(t for t in technique.build_trends(forms) if t.key == "contatto")
    assert contact.direction == technique.DIRECTION_STABLE


def test_a_metric_with_no_better_direction_gets_no_verdict():
    """Stride length grows with pace. A green arrow on it would be inventing a
    judgement this module has no basis for."""
    forms = [_run(d, avgStrideLength=s) for d, s in [(1, 110.0), (4, 112.0), (8, 115.0), (12, 130.0)]]
    stride = next(t for t in technique.build_trends(forms) if t.key == "passo")
    assert stride.direction == technique.DIRECTION_MOVED


def test_two_sessions_are_not_a_trend():
    forms = [_run(1), _run(4)]
    assert technique.build_trends(forms) == []


def test_the_sparkline_runs_forwards_in_time():
    """`forms` arrives newest-first, and a chart that reads right-to-left is a chart
    read backwards."""
    forms = [_run(12), _run(8), _run(4), _run(1)]
    points = technique.build_trends(forms)[0].points
    assert [p.date.day for p in points] == [1, 4, 8, 12]


def test_the_latest_reading_is_the_current_value():
    forms = [_run(d, avgGroundContactTime=gct) for d, gct in [(1, 285), (12, 255), (4, 280), (8, 276)]]
    contact = next(t for t in technique.build_trends(forms) if t.key == "contatto")
    assert contact.current == 255
    assert contact.baseline == round((285 + 280 + 276) / 3, 2)


def test_a_metric_missing_from_some_sessions_still_trends_on_the_rest():
    """A watch that recorded running dynamics on four runs out of six has four data
    points, not zero."""
    forms = [
        _run(1),
        technique.analyse_activity(
            {"distance": 8000, "duration": 2700}, activity_id=2, sport="running", title="Tapis", day=date(2026, 9, 2)
        ),
        _run(4),
        _run(8),
    ]
    cadence = next(t for t in technique.build_trends(forms) if t.key == "cadenza")
    assert len(cadence.points) == 3


def test_the_movers_come_before_the_stable_ones():
    """A list sorted by metric name buries the only row worth reading."""
    forms = [
        _run(d, avgGroundContactTime=gct, averageRunningCadenceInStepsPerMinute=178)
        for d, gct in [(1, 285), (4, 282), (8, 280), (12, 240)]
    ]
    trends = technique.build_trends(forms)
    assert trends[0].key == "contatto"
    assert trends[-1].direction == technique.DIRECTION_STABLE

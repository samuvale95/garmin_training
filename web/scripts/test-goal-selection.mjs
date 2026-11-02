import { strict as assert } from "node:assert";
import { parseGoalTargetTime } from "../src/lib/goalTargetTime.ts";
import { raceAssessment, selectRaceGoal } from "../src/lib/selectedRaceGoal.ts";

assert.equal(parseGoalTargetTime("1:45:09"), 6309);
assert.equal(parseGoalTargetTime("42:30"), 2550);
for (const invalid of ["", "45", "1:60:00", "1:00:60", "0:00", "a:30", "1:2:3", "1:2:3:4"]) {
  assert.equal(parseGoalTargetTime(invalid), null, invalid);
}

const goals = [{ id: "race-a", type: "race", name: "Prima gara" }, { id: "race-b", type: "race", name: "Seconda gara" }, { id: "fit", type: "fitness", name: "Forma" }];
assert.equal(selectRaceGoal(goals, "race-b")?.name, "Seconda gara");
assert.equal(selectRaceGoal(goals, "fit"), undefined);
const evidence = [{ metric: "race_prediction", assessment: { headline: "Seconda gara", predicted_time_seconds: 6309 } }, { metric: "race_plan_fit", assessment: { sessions_ahead: 8 } }];
assert.equal(raceAssessment(evidence, "race_prediction")?.headline, "Seconda gara");
assert.equal(raceAssessment(evidence, "race_plan_fit")?.sessions_ahead, 8);
assert.equal(raceAssessment([], "race_prediction"), null);

console.log("Goal selection and target time: OK");

import type { EngineActivity } from "../engine/calculate";
import {
  formatGrade,
  gradedFullHours,
  QUALITY_GRADES,
} from "../engine/calculate";
import type { Choice } from "./choice";
import { formatHours } from "./hours";

/** `75% (1h30)` once the activity is known, `75%` before (D60). */
export function qualityChoices(
  activity?: Pick<EngineActivity, "calcMode" | "value">,
  durationMinutes: number | null = null,
): readonly Choice[] {
  return QUALITY_GRADES.map((grade) => {
    const hours =
      activity === undefined
        ? null
        : gradedFullHours(activity, durationMinutes, grade);

    return {
      value: grade,
      label:
        hours === null
          ? formatGrade(grade)
          : `${formatGrade(grade)} (${formatHours(hours)})`,
    };
  });
}

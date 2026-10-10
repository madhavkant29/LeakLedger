/**
 * Canonical scenario identifiers shared by the Replay Lab selector and the
 * backend replay state. Keep this list as the single source of truth.
 */
export const SCENARIOS = [
  ["normal", "Normal — balanced campus"],
  ["hidden-leak", "Hidden Hostel B loss"],
  ["missing-reading", "Missing meter — fail closed"],
  ["counter-reset", "Counter reset"],
  ["repair", "Successful repair verification"],
  ["failed-repair", "Failed repair verification"],
] as const;

export type ScenarioId = (typeof SCENARIOS)[number][0];

export function scenarioLabel(id: string | null | undefined): string {
  const found = SCENARIOS.find(([value]) => value === id);
  return found ? found[1] : "Unknown scenario";
}

/**
 * The backend replay state is the source of truth for the active scenario.
 * `pending` is only set when the user deliberately picks a different scenario,
 * and is cleared when Reset applies it. Until replay state has loaded (server
 * value null/undefined) and with no pending choice, the selector stays unset so
 * it never claims a scenario that is not actually active.
 */
export function nextScenarioSelection(
  serverScenario: string | null | undefined,
  pending: string | null
): string | null {
  return pending ?? serverScenario ?? null;
}

import { CREATE_WALKTHROUGHS } from "./catalog-create";
import { REMEDIATE_WALKTHROUGHS } from "./catalog-remediate";
import type { Walkthrough, WalkthroughCategory } from "./types";

export * from "./types";
export { consoleUrl, consoleServiceLabel, type ConsoleServiceId, type ConsoleTarget } from "./console";

export const WALKTHROUGHS: readonly Walkthrough[] = [...CREATE_WALKTHROUGHS, ...REMEDIATE_WALKTHROUGHS];

const BY_ID = new Map(WALKTHROUGHS.map((w) => [w.id, w]));

const BY_RULE_ID = new Map<string, Walkthrough>();
for (const w of WALKTHROUGHS) for (const rule of w.fixesRuleIds ?? []) BY_RULE_ID.set(rule, w);

export function getWalkthrough(id: string): Walkthrough | undefined {
  return BY_ID.get(id);
}

/** The walkthrough that fixes a given security finding, if there is one. */
export function walkthroughForRule(ruleId: string): Walkthrough | undefined {
  return BY_RULE_ID.get(ruleId);
}

export function walkthroughsByCategory(category: WalkthroughCategory): Walkthrough[] {
  return WALKTHROUGHS.filter((w) => w.category === category);
}

/** Total number of discrete steps, used for the reading-time estimate on cards. */
export function stepCount(w: Walkthrough): number {
  return w.steps.length;
}

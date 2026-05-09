import type { EvaluatedRule } from "./types.js";

export function applyMutualExclusions(
  matchedRules: EvaluatedRule[],
  groups: string[][]
): EvaluatedRule[] {
  let result = [...matchedRules];

  for (const group of groups) {
    const inGroup = result.filter((r) => group.includes(r.name));
    if (inGroup.length <= 1) continue;

    const toKeep = inGroup.reduce((best, cur) => {
      if (cur.weight > best.weight) return cur;
      if (cur.weight === best.weight) {
        return group.indexOf(cur.name) < group.indexOf(best.name) ? cur : best;
      }
      return best;
    });

    result = result.filter((r) => !group.includes(r.name) || r.name === toKeep.name);
  }

  return result;
}

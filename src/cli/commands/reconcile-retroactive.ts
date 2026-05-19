import { getDedupGeoRadiusMeters, getRetroactiveDedupThreshold } from "../../modules/discovery/config.js";
import {
  buildRetroactiveReconciliationPlan,
  describeRetroactiveGroup,
} from "../../modules/discovery/reconciliation.js";
import { loadAllLeads } from "../../storage/leads.js";
import { detectOwnerGroups } from "../../storage/owner-group.js";
import { reconcileLeadIntoPrimary } from "../../storage/reconciliation.js";

export interface ReconcileRetroactiveOptions {
  apply: boolean;
  limit?: number;
}

function printPlanSummary(plan: ReturnType<typeof buildRetroactiveReconciliationPlan>): void {
  console.log("Retroactive cross-source reconciliation");
  console.log(`  Total leads:           ${plan.total_leads}`);
  console.log(`  Match groups:          ${plan.groups_with_matches}`);
  console.log(`  Leads to absorb:       ${plan.matched_secondaries}`);
  console.log(`  Expected remaining:    ${plan.expected_remaining_leads}`);
  console.log(`  Threshold:             ${plan.threshold}`);
  console.log(`  Geo radius (meters):   ${plan.geo_radius_meters}`);
  console.log(`  Phone conflicts:       ${plan.phone_conflicts}`);
  console.log(`  Email conflicts:       ${plan.email_conflicts}`);

  const sourcePairs = Object.entries(plan.by_source_pair);
  if (sourcePairs.length > 0) {
    console.log("  By source pair:");
    for (const [pair, count] of sourcePairs) {
      console.log(`    - ${pair}: ${count}`);
    }
  }

  if (plan.groups.length > 0) {
    console.log("  Candidate groups:");
    for (const group of plan.groups.slice(0, 20)) {
      console.log(`    - ${describeRetroactiveGroup(group)} -> absorb ${group.secondaries.length}`);
    }
    if (plan.groups.length > 20) {
      console.log(`    - ... ${plan.groups.length - 20} more groups`);
    }
  }
}

export async function reconcileRetroactiveCommand(
  opts: ReconcileRetroactiveOptions
): Promise<void> {
  const leads = await loadAllLeads();
  const plan = buildRetroactiveReconciliationPlan(leads, {
    threshold: getRetroactiveDedupThreshold(),
    geoRadiusMeters: getDedupGeoRadiusMeters(),
  });

  printPlanSummary(plan);

  if (!opts.apply) {
    console.log("  Mode:                  dry-run");
    return;
  }

  const groups = opts.limit !== undefined
    ? plan.groups.slice(0, opts.limit)
    : plan.groups;

  let appliedGroups = 0;
  let absorbedLeads = 0;

  for (const group of groups) {
    for (const secondary of group.secondaries) {
      await reconcileLeadIntoPrimary(group.primary.id, secondary.id);
      absorbedLeads++;
    }
    appliedGroups++;
  }

  if (appliedGroups > 0) {
    await detectOwnerGroups();
  }

  console.log("Retroactive reconciliation applied");
  console.log(`  Groups applied:        ${appliedGroups}`);
  console.log(`  Leads absorbed:        ${absorbedLeads}`);
}

import { rejectJobFilters, searchCities } from "../config/job-filters.ts";
import { evaluateJobEligibility } from "../domain/policy.ts";

// Transitional configuration binding; domain never reads deployment settings.
export function hardReject(job) {
  return evaluateJobEligibility(job, searchCities(), rejectJobFilters);
}

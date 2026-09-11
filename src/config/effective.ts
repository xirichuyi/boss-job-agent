import { AGENT } from "./agent.ts";
import {
  loadJobFilters,
  searchCities,
  nativeFiltersForSearch,
} from "./job-filters.ts";
import { MODEL, REASONING_EFFORT } from "./model.ts";
import { executionConfig } from "../runtime/coordinator.ts";
import { configFile } from "./files.ts";

export function effectiveConfig() {
  const filters = loadJobFilters();
  nativeFiltersForSearch(0, 1, filters);
  const { city, cityCode, ...search } = AGENT.search;
  const { conversationPages, ...workflow } = AGENT.workflow;
  return {
    sources: Object.fromEntries(
      ["agent", "job-filters", "model", "execution"].map((n) => [
        n,
        configFile(n),
      ]),
    ),
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    search: { ...search, cities: searchCities() },
    jobFilters: filters,
    schedule: AGENT.schedule,
    workflow: {
      ...workflow,
      conversationPages: filters.conversationPages,
      conversationLookupMs: filters.conversationLookupMs,
    },
    resumeFile: AGENT.resumeFile,
    browser: AGENT.browser,
    codex: AGENT.codex,
    execution: executionConfig(),
    warnings: [
      ...(city !== undefined || cityCode !== undefined
        ? ["agent.search.city/cityCode 已弃用；实际城市来自 job-filters.cities"]
        : []),
      ...(conversationPages !== undefined
        ? [
            "agent.workflow.conversationPages 已弃用；实际页数来自 job-filters.conversationPages",
          ]
        : []),
    ],
  };
}

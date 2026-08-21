# Pull request template

## Context

- **Why this matters:**
- **What changed:**

## Layered architecture impact

Use this section when the change crosses the application layers. If it is unrelated to the layered architecture, omit this section or write `Not applicable`.

- **API / client contract:** Are there new API endpoints, ACP methods, events, fields, or changes to existing behavior?
- **Service layer:** What orchestration, business logic, runtime, or domain-service changes were made?
- **Repository / data access:** Were repository interfaces, queries, persistence adapters, or stored data behaviors changed?
- **Database:** Were there schema, migration, index, seed-data, or data-retention changes?

## Tests

- **Added:** [count]. [One-line summary of the high-level surfaces or behaviors covered.]
- **Updated:** [count]. [One-line summary of the high-level behavior changes covered.]
- **Removed:** [count]. [One-line explanation, if applicable.]

## Notes

Examples of optional notes to include:

- **Backwards compatibility:** State `None` when there is no compatibility code. If this PR retains a shim, fallback, migration bridge, or other backwards-compatibility behavior, flag it explicitly with `THIS IS FOR BACKWARDS COMPATIBILITY` and explain what is being preserved.
- **Rollout or migration:** Mention deployment sequencing, data migration, configuration, or operational considerations when relevant.
- **Follow-up:** Mention deferred work, known limitations, or useful follow-up when relevant.

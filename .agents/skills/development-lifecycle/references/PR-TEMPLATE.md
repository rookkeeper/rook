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

- **Added:** [count] — high-level surfaces or behaviors covered:
- **Updated:** [count] — high-level behavior changes covered:
- **Removed:** [count] — why, if applicable:
- **Validation:** Builds, checks, smoke tests, or other relevant commands:

## Notes

- Compatibility, rollout, migration, or follow-up notes:

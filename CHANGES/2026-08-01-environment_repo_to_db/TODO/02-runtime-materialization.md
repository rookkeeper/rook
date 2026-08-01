# Project 2: Build session runtime materialization

## Demonstration

Given today's directory-backed bundles, build a session working directory and inspect the generated skills and readable `AGENTS.md` sections.

## Pause point

Stop for review after confirming the materialized files match the current runtime behavior.

This project introduces the runtime working-directory seam without changing repository storage. It should consume today's existing `EnvironmentBundle` objects first.

- [ ] Build each session's agent working directory from resolved bundles.
- [ ] Materialize skills and their nested files in the runtime's expected locations.
- [ ] Generate readable environment and bundle sections in `AGENTS.md`.
- [ ] Keep generated files distinguishable from editable source files.
- [ ] Preserve current runtime behavior while replacing direct repository-path assumptions.
- [ ] Test the materializer against the current directory-backed repository.
- [ ] Defer full startup/restart re-injection until the materialization path is established.

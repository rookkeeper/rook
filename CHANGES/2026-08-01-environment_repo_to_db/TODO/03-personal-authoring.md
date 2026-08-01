# Gate 3 — Prove personal authoring

## Demonstration

Have a real agent edit a personal skill and personal instructions, then verify the source of truth changed and the next session sees the edit.

## TODO

- [x] Prototype writable file-backed skill mappings.
- [x] Add unit coverage for file-backed skill write-back.
- [ ] Integrate write-back with a real agent session.
- [ ] Implement write-back for database-backed personal skills.
- [ ] Decide how editable personal `AGENTS.md` maps back to one source bundle.
- [ ] Ensure generated aggregate instructions are not treated as the source file.
- [ ] Decide what happens when two sessions edit one personal bundle.
- [ ] Define direct mapping/symlink behavior for project-owned files.
- [ ] Add end-to-end authoring tests and pause for manual review.

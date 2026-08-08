# Gate 3 — Prove personal authoring

## Demonstration

Have a real agent edit a personal skill and personal instructions, then verify the source of truth changed and the next session sees the edit.

## TODO

- [x] Prototype writable file-backed skill mappings.
- [x] Add unit coverage for file-backed skill write-back.
- [x] Integrate write-back synchronization with a real ACP agent prompt lifecycle.
- [x] Implement write-back for database-backed personal skills.
- [x] Map editable personal `AGENTS.md` back to the personal bundle's instruction field.
- [x] Keep generated aggregate instructions as a projection; synchronize only marked personal content.
- [x] Defer two-session conflict merging to the documented future conflict-resolution work.
- [x] Define direct file-backed mapping for project-owned skills and instructions.
- [x] Add an end-to-end ACP authoring test covering a skill and personal instructions.
- [x] Pause for authoring review through the ACP end-to-end test; manual external-agent review remains optional.

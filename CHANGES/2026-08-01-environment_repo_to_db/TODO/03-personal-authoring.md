# Project 3: Preserve personal authoring and write-back

## Demonstration

Have an agent edit a personal skill or instruction through the working directory and verify that the source file changes.

## Pause point

Stop for manual review before moving repository storage to SQLite.

This project proves authoring through the new runtime seam while the existing filesystem repository is still the source of truth. It must work end-to-end before storage is changed.

- [ ] Keep user-created skills and instructions readable by the agent.
- [ ] Define how writable personal content is mapped into a session working directory.
- [ ] Write agent edits back to the personal repository source of truth.
- [ ] Decide how editable `AGENTS.md` content maps back to its originating bundle.
- [ ] Establish an initial policy for simultaneous edits from multiple sessions.
- [ ] Define the first practical read-only behavior for external content.

# Project 3: Preserve personal authoring and write-back

## Demonstration

Have an agent edit a personal skill or instruction through the working directory and verify that the source file changes.

## Pause point

Stop for manual review before moving repository storage to SQLite.

This project proves authoring through the new runtime seam while the existing filesystem repository is still the source of truth. It must work end-to-end before storage is changed.

- [x] Keep user-created skills readable by the agent.
- [x] Define how writable file-backed personal skills are mapped into a session working directory.
- [x] Write skill edits back to the file-backed personal repository source of truth.
- [x] Add automated coverage for writable skill write-back.
- [ ] Write-back for database-backed personal content.
- [ ] Decide how editable `AGENTS.md` content maps back to its originating bundle.
- [ ] Establish an initial policy for simultaneous edits from multiple sessions.
- [x] Define the first practical read-only behavior for external skill files.
- [ ] Integrate the authoring seam with an actual running agent session.

# Restoration issue template

Use this when removing voice, bridge, computer-control, or permission-related features that may need to return later.

## Title

Restore `<feature name>` removed during `RookMacModel` refactor

## Include

- [ ] Removal commit hash/link
- [ ] Prior file locations
- [ ] Short summary of what the feature did
- [ ] User-visible behaviors that existed before removal
- [ ] Permissions involved
- [ ] Dependencies/services involved
- [ ] Why the feature was removed during refactor
- [ ] What would need to be rebuilt to restore it
- [ ] Any known risks or missing context

## Suggested structure

### Summary
Describe the removed feature in 2-5 bullets.

### Prior implementation locations
List the files/classes/functions that previously owned the feature.

### Behavior before removal
Describe what users and agents could do with it.

### Permissions / platform requirements
Document Accessibility, microphone, speech, screen recording, or automation requirements if relevant.

### Reimplementation notes
List the minimum steps likely needed to restore the feature.

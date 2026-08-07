# Relationship between Sessions and Environments

An environment is a context the user finds themselves in — a website, a physical location, a directory, a Mac app surface, or any other recognizable domain. Each environment can have zero or more **capability bundles** associated with it. A bundle contains skills, MCP servers, and app instructions that an agent can use while the user is in that environment.

## Bundle decisions and scope

When a bundle is presented to the user as an environment offer, the user makes a decision about that specific bundle (identified by its content hash).

- **Accept** / **Ignore**: ephemeral. The current implementation stores these decisions in memory for the affected session while its environment visit is active. When that session exits or the environment expires, the decision is forgotten and the bundle can be offered again.

- **Approve** / **Reject**: persistent and app-wide. The decision is stored in the database, keyed by the bundle's content hash (a Merkle tree of every file in the bundle directory). The same bundle will never be offered again across sessions once approved or rejected.

This session-scoped ephemeral behavior is the current product contract. A future change to make Accept/Ignore app-wide would need explicit product and security review because it changes cross-session capability exposure.
## How sessions consume environments

When any session wants to join an environment, it receives all bundles of that environment whose **effective decision** is positive (accepted or approved). The session does not make its own decisions about bundles — it inherits the app-wide decisions.

This means:
- If you accept a Lowe's bundle while in your shopping session, then switch to your coding session, the coding session will also gain Lowe's skills if it enters that environment.
- Use "Ignore" (not "Reject") if you only want to skip a bundle for the current visit without affecting other sessions.
- Use "Reject" to permanently opt out of a bundle everywhere.

## What about session-specific concerns?

The current implementation keeps ephemeral decisions per session to avoid cross-contamination (e.g., Lowe's skills leaking into a coding session). The resolution is:

1. Sessions don't auto-enter environments from mere availability — they only enter environments the user or agent explicitly joins.
2. Entering an environment is literal — joining `mac:md.obsidian/Rooknanigans` does not implicitly join `mac:md.obsidian`.
3. The agent can help decide whether to enter an environment based on the current session's context.
4. The UI provides affordances to see and manage which environments are active for a session.

If session-specific bundle gating is needed in the future, it would be a separate layer on top of the app-wide bundle decisions.

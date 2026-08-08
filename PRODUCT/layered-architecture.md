# Layered architecture

This is the general layering preference for Rook’s code.

- **API** — The external boundary, when one exists. It handles protocol concerns, validation, and translation, then delegates to services.
- **Service** — Business logic and orchestration. Services coordinate behavior and depend on repositories rather than persistence details.
- **Repository** — Rook-owned code that directly interfaces with a concrete data store. Repositories translate between application concepts and SQLite, the filesystem, Redis, MySQL, or another persistence system.
- **Data store** — The concrete persistence system itself, not a required additional code abstraction. SQLite databases, files, Redis, and MySQL are data stores; repositories may use them directly.

The usual dependency direction is:

```text
API → Service → Repository → Data store
```

This separation also improves testing. Services can be tested without an API or a real data store by injecting a repository fake, stub, or mock. API tests can focus on protocol behavior, while repository tests can separately verify the concrete data-store integration.

Not every feature needs every layer. Avoid adding intermediary abstractions that do not provide meaningful business or boundary value. Composition and bootstrap code may construct and wire the layers together.

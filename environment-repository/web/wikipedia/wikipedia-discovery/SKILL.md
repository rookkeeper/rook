---
name: wikipedia-discovery
description: Use when navigating Wikipedia inside the split-pane extension—finding articles from a topic or phrase, teaching or routing the user toward articles, choosing what to explore next, Wikimedia REST or Action APIs with paging, or sending message_parent url_change (optional section `#fragment` on the same wiki). Use for Wikipedia search, summaries, links/backlinks, or updating the mirrored page URL.
compatibility: Calls go to the active wiki host (e.g. en.wikipedia.org). The localhost panel must implement postMessage handling for tool message_parent with type url_change when navigation is required.
---

# Wikipedia discovery

Use the **current wiki hostname** (e.g. `en.wikipedia.org`) for all API requests unless you intentionally switch language wiki.

## Helping someone learn (user-facing)

When the user wants to **learn** about something, **steer them toward concrete articles** (and **sections by heading** when helpful). In **natural language**:

- Name **articles by title** and briefly say **why each is relevant** to their question.
- **Do not** paste full **URLs**, **do not** use **markdown links**, and **do not** bullet raw links—readers use **`url_change`** on their own; your job in chat is **titles + relevance** only.

Behind the scenes, when it is time to open the mirror, use **`message_parent`** with a full Wikipedia **`url`** (optional **`#`** section / anchor per below); that string is **not** for display in the user-visible reply.

## I have a phrase / topic — find articles

Search the index, return ranked titles/snippets, optionally narrow namespaces. Prefer **REST** search for simple JSON cards; use **Action API** `list=search` when you need Cirrus options, generators, or wikitext-era fields. **Paging:** Action `list=` modules return `continue` — merge those params on the next request until absent. REST search may use `limit` / `offset` where supported. Details: **`wikipedia-discovery/references/topic-search.md`**.

## I’m on (or chose) this article — what’s next?

Use **summary** for a short lead, **links** / **backlinks** to move outward in the graph, **extracts** for longer previews, **categories** / **random** when exploration fits. Same **continue** discipline for any prop/list that paginates. Details: **`wikipedia-discovery/references/article-next-steps.md`**.

## Changing the Wikipedia URL (`message_parent` / `url_change`)

When the mirrored page should change, call **`message_parent`** with:

```json
{"type": "url_change", "url": "<full https URL on wikipedia.org, optional #section-or-id>"}
```

**`url` must stay on Wikipedia** (`*.wikipedia.org` / `wikipedia.org`). **Query APIs first** when you only need metadata; send **`url_change`** when the left pane should actually load that resource.

**Section (scroll to heading):** append **`#` + heading** with **spaces → underscores**, correct **case**. Example payload (for the tool, not for pasting to the user):

```json
{"type": "url_change", "url": "https://en.wikipedia.org/wiki/Kitten#External_links"}
```

### Section headings (`#` fragment)

Append **`#` + section heading** with **spaces → underscores** (MediaWiki heading ids usually follow this). **Case-sensitive**; wrong casing may jump to the top. **Fragile:** renamed or removed headings break the target. If punctuation is odd, copy the heading’s **`id`** from the live DOM (`mw-headline` / stable anchor) instead of guessing.

### Custom anchors

**`Template:Anchor`** (or other fixed **`id`s**) — the fragment is **`#` + that `id`**, which may differ from the visible heading string. Prefer copying `#...` from the browser once, or inspect the element’s `id`.

The left pane is an **iframe**; **normal `#fragment` scrolling** (heading / `id`) is what **`url_change`** should rely on for deep-linking inside the mirror.

The parent extension **never** reloads the full tab or the **right** (localhost) pane: only the **left** iframe navigates. **`history.replaceState`** updates the address bar **only** when `url` is **same origin** as the tab; another `*.wikipedia.org` host still loads in the left iframe but the tab’s visible origin cannot change without a full navigation (which we avoid).

## Reference files

| File | Purpose |
|------|---------|
| `wikipedia-discovery/references/topic-search.md` | Topic → article discovery (APIs) |
| `wikipedia-discovery/references/article-next-steps.md` | “What next” from a known page (APIs) |

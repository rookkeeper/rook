---
name: wikipedia-discovery
description: Use when exploring Wikipedia on Mac—finding articles from a topic or phrase, helping the user learn by pointing to relevant pages or sections, opening Wikipedia URLs directly in the browser, or using Wikimedia REST / Action APIs with paging.
compatibility: Calls should target the current wiki host (for example en.wikipedia.org). When navigation is needed, use ordinary browser/macOS URL-opening behavior with full HTTPS URLs.
---

# Wikipedia discovery

Use the **current wiki hostname** (for example `en.wikipedia.org`) for all API requests unless you intentionally switch language wiki.

## Helping someone learn (user-facing)

When the user wants to **learn** about something, **steer them toward concrete articles** and, when useful, **specific sections inside those articles**.

In natural language:

- Name **articles by title** and briefly say **why each is relevant**.
- You may mention that you can **open the page** or **jump straight to a section**.
- It is fine to use full Wikipedia URLs when you actually need to open something in the browser.

## I have a phrase / topic — find articles

Search the index, return ranked titles/snippets, optionally narrow namespaces. Prefer **REST** search for simple JSON cards; use **Action API** `list=search` when you need Cirrus options, generators, or wikitext-era fields. **Paging:** Action `list=` modules return `continue` — merge those params on the next request until absent. REST search may use `limit` / `offset` where supported. Details: **`wikipedia-discovery/references/topic-search.md`**.

## I’m on (or chose) this article — what’s next?

Use **summary** for a short lead, **links** / **backlinks** to move outward in the graph, **extracts** for longer previews, **categories** / **random** when exploration fits. Same **continue** discipline for any prop/list that paginates. Details: **`wikipedia-discovery/references/article-next-steps.md`**.

## Opening pages directly in the browser

When it is time to navigate, use a normal full Wikipedia URL.

Examples:

- Article:
  - `https://en.wikipedia.org/wiki/Julius_Caesar`
- Section by heading:
  - `https://en.wikipedia.org/wiki/Julius_Caesar#Civil_war`
- Text highlight fragment:
  - `https://en.wikipedia.org/wiki/Julius_Caesar#:~:text=leading%20Caesar`
- Section + text fragment (when supported by the browser):
  - `https://en.wikipedia.org/wiki/Julius_Caesar#Civil_war:~:text=leading%20Caesar`

### Section fragments (`#Heading_name`)

To jump to a section, append:

- `#` + the section heading
- replace spaces with underscores
- keep the correct case where possible

Example:

- heading: `External links`
- fragment: `#External_links`

If punctuation or casing is uncertain, prefer copying the actual section id from the page instead of guessing.

### Text highlight fragments (`#:~:text=`)

Wikipedia pages support browser text fragments in Chromium-based browsers and some other modern browsers.

Format:

- `#:~:text=<URL-encoded text>`

Example:

- `#:~:text=leading%20Caesar`

Use this when the user wants to jump directly to a sentence or phrase on a page.

Reliability guidance:

- Prefer a **short, distinctive, plain-language substring** from the target sentence.
- Avoid long exact quotes when possible.
- Avoid fragments with **parentheses, numbers, citation markers, or special formatting**.
- Avoid text that may span **inline markup** such as citations, small-caps, superscripts, or links.
- Prefer stable prose near the **start of the sentence** over highly specific formatted text.
- If one fragment fails, retry with a **simpler substring** rather than a longer one.

## Reference files

| File | Purpose |
|------|---------|
| `wikipedia-discovery/references/topic-search.md` | Topic → article discovery (APIs) |
| `wikipedia-discovery/references/article-next-steps.md` | “What next” from a known page (APIs) |

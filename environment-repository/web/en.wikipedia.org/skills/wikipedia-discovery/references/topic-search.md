# Topic / phrase → articles (details)

Base URLs use the **active** wiki, e.g. `https://en.wikipedia.org`. Send a descriptive **User-Agent** on every request.

When you decide to navigate to a result, just open the normal Wikipedia URL for that title in the browser — no special parent-message bridge is assumed.

## REST Core (lightweight JSON)

- **`GET /w/rest.php/v1/search/page?q=...&limit=...&offset=...`** — page search with excerpts; good default for “find articles about X”. Use `offset` for paging when the wiki supports it for this endpoint.
- **`GET /w/rest.php/v1/search/title?q=...&limit=...`** — title-leaning hits; good for resolving names / autocomplete-style flows.

## Action API (full control)

- **`action=opensearch&search=...&limit=...&format=json`** — fast title-oriented suggestions; array-shaped JSON.
- **`list=prefixsearch&pssearch=...&pslimit=...&psoffset=...`** — prefix title search; use `psoffset` / continuation where returned.
- **`action=query&list=search&srsearch=...&srlimit=...&sroffset=...&format=json&formatversion=2`** — CirrusSearch. **`sroffset`** pages through results; watch **`continue`** in the JSON — append every `continue` key/value to the next GET until the field disappears. Use **`srnamespace`** (e.g. `0` for articles) to avoid talk/user noise unless you need them. **`srwhat`**: `title` vs `text` vs `nearmatch` depending on intent.

## Shared paging mental model

- **REST:** prefer documented `limit` / `offset` (endpoint-specific).
- **Action `list=search` (and many other lists):** **`continue`** object → repeat request with those parameters merged in. Do not assume a single response contains all hits.

## Lead card without full navigation

- **`GET /w/rest.php/v1/page/summary/{Title}`** — short extract + `content_urls.desktop.page`. URL-encode tricky titles (`/`, `?`, `#`, spaces).

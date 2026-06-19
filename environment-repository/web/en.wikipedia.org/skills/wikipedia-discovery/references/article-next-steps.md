# From a known article — what’s next (details)

Assume you know **`Title`** (normalized page name) on the **current** wiki host.

When you decide to open a related page, use the ordinary full Wikipedia URL for that article, optionally adding a `#Section_name` fragment or a `#:~:text=` fragment when helpful.

## Quick orientation

- **`GET /w/rest.php/v1/page/summary/{Title}`** — lead extract, display title, canonical URL, sometimes thumbnail. Good before deciding to navigate.

## Outward graph

- **`action=query&titles=Title&prop=links&plnamespace=0&pllimit=...&format=json`** — outgoing mainspace wikilinks. Use **`plcontinue`** / top-level **`continue`** until exhausted if you need the full set.
- **`action=query&list=backlinks&bltitle=Title&blnamespace=0&bllimit=...&format=json`** — pages that link here (“what links here”). Paginate with **`blcontinue`** / **`continue`**.

## More body text without HTML parse

- **`action=query&titles=Title&prop=extracts&exintro=1&explaintext=1&format=json`** — plain-ish lead; **`excontinue`** / **`continue`** if configured for continuation.

## Browsing modes (optional)

- **`action=query&list=random&rnnamespace=0&rnlimit=...`** — random article(s).
- **`action=query&list=categorymembers&cmtitle=Category:Foo&cmtype=page|subcat&cmlimit=...`** — drill into a category tree; **`cmcontinue`**.

## Shared paging mental model

Any **`prop=`** with continuation (`plcontinue`, `blcontinue`, …) or **`list=`** with **`continue`**: keep requesting until no continuation token is returned. Respect **`pllimit` / `bllimit`** caps.

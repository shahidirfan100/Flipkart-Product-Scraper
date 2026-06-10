## Selected API
- Endpoint: `GET https://www.flipkart.com/<listing-or-search-url>`
- Method: `GET`
- Auth: None
- Pagination: `page=<number>` query parameter on listing URLs
- Fields available: `window.__INITIAL_STATE__` contains product IDs, item IDs, listing IDs, titles, brand/category metadata, pricing, discount data, ratings, review counts, rating breakdown, key specs, warranty summary, availability/buyability flags, image URLs, marketplace data, and product URLs
- Fields currently missing in actor: no additional stable listing fields were confirmed as consistently richer than the current mapping during this run
- Field count: 30+ mapped fields from the embedded state object

## Why This Was Selected
- A direct `got-scraping` request with a Firefox-style desktop header profile returned a full listing page and a large `window.__INITIAL_STATE__` payload.
- The payload is already rich enough to satisfy the actor’s current output without product detail page visits.
- It works with plain `got-scraping` when the header profile is acceptable, which keeps the actor HTTP-based and within Apify QA time limits.

## Rejected Candidates
- URLScan public domain search:
  - Recent public results were unrelated to the target listing page, so they were not reliable for this actor.
- URLScan scan submission:
  - The scan API returned `401` because a key is now required for submission from this environment.
- `__NEXT_DATA__`:
  - Not present on the tested Flipkart listing page.
- JSON-LD:
  - Present but not rich enough for listing extraction and did not expose the same product coverage as `window.__INITIAL_STATE__`.
- Direct internal JSON endpoint:
  - No stable unauthenticated JSON endpoint was confirmed from this environment that was richer than the embedded state object.

## Headers And Diagnostics Notes
- Working request profile observed:
  - `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0`
  - `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8`
  - `Accept-Language: en-US,en;q=0.9`
  - `Upgrade-Insecure-Requests: 1`
- Failing request profile observed:
  - A Chromium-style request returned `403` with title `Flipkart reCAPTCHA`
- Diagnostic rule for the actor:
  - On fetch or extraction failure, read this file first, then re-test the listing URL and normalized fallback URL with `got-scraping` across multiple header profiles.
  - Record status code, final URL, title, body length, and whether `window.__INITIAL_STATE__` or JSON-LD is present.

## Implementation Guidance
- Stay HTTP-based with `got-scraping`.
- Normalize listing URLs because Flipkart may redirect category paths.
- Prefer `window.__INITIAL_STATE__`.
- If the state object path shifts, search the entire parsed state recursively for listing products instead of assuming a single property path.
- If no products are found, capture diagnostics and store them for review instead of silently returning an empty dataset.

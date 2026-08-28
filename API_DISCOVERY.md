## Selected API

- Endpoint: `GET https://www.flipkart.com/<listing-or-search-url>`
- Method: `GET`
- Auth: None
- Pagination: `page=<number>` query parameter on listing URLs
- Fields available: `window.__INITIAL_STATE__` contains product IDs, item IDs, listing IDs, titles, brand/category metadata, pricing, discount data, ratings, review counts, rating breakdown, key specs, warranty summary, availability/buyability flags, image URLs, marketplace data, and product URLs
- Fields currently missing in actor: no additional stable listing fields were confirmed as consistently richer than the current mapping during this run
- Field count: 30+ mapped fields from the embedded state object

## Request-flow evidence

| Candidate | Impit profile | Result | Decision |
|---|---|---|---|
| Category listing HTML | `firefox144` desktop | HTTP 200, full HTML, `window.__INITIAL_STATE__` present | Selected |
| Keyword + sort | `firefox144` desktop | HTTP 200, full HTML, state present for `q=laptop under 50000` and `sort=price_asc` | Selected |
| Chrome desktop | `chrome` | Previously observed HTTP 403 with `Flipkart reCAPTCHA`; later direct probes were intermittently successful | Not used |
| iOS mobile | `ios18` | TLS `ConnectError` against this target | Rejected |
| Android/app profile | `okhttp4` | Returned listing HTML, but no stable app endpoint was discovered | Rejected |
| Internal JSON endpoint | N/A | No stable unauthenticated endpoint richer than the embedded state | Rejected |

## Why This Was Selected

- A direct browser-style GET returns a rich listing page and a large `window.__INITIAL_STATE__` payload without authentication.
- The supplied category URL can return a 301 to a canonical category path; following redirects and using the final URL preserves the browser flow.
- Flipkart's browser URLs accept `q` and `sort` parameters. Verified examples include `sort=price_asc`.
- The same HTML/state extraction supports category URLs and keyword searches without product detail page visits, preserving coverage and speed.

## Headers, Cookies, And Session Notes

- The discovery run found a working Firefox-style desktop request with `Accept`, `Accept-Language`, `Upgrade-Insecure-Requests`, and a Firefox desktop user agent.
- The installed Impit version supports `firefox144`, so the actor uses `browser: 'firefox144'` rather than overriding the generated user agent with an unsupported Firefox version.
- Impit generates the browser fingerprint headers and TLS profile. The actor does not manually override `User-Agent`, `Accept`, `Accept-Language`, `Sec-CH-UA`, or `Sec-Fetch-*`.
- The target sets session cookies, including `ud`, on the initial HTML response. One cookie-aware Impit client is reused for all pages in a transport session.
- The initial browser navigation has no synthetic `Origin` or `Referer` requirement. The actor does not add either header to the document GET, avoiding an inconsistent cross-context request.
- Requests remain sequential because pagination is an ordered browser navigation flow. Normal successful requests have no artificial delay; bounded backoff is used only for network errors, 408, 425, 429, and 5xx responses.

## Query, Pagination, And Recovery Notes

- A run accepts one source: `startUrl` for a category/search URL or `keyword` for a keyword search. When both are supplied, the keyword is the active source and the actor performs one run, not two.
- If a user supplies no source, the schema/local QA URL is the only fallback; user-provided fields are never replaced with `INPUT.json` values.
- `keyword` switches to Flipkart's `/search` path and sets `q` plus `otracker=search`.
- `sort` supports `relevance`, `popularity`, `price_asc`, `price_desc`, and `newest`.
- Query parameters already present in a user-supplied URL are preserved unless an explicit keyword or sort input replaces the same parameter.
- Price sorting is normalized locally when `price_asc` or `price_desc` is requested, while other sort modes retain the service order.
- Pagination follows the state/page links and retains the keyword, sort, and URL query parameters. Duplicate pages are stopped using stable product keys.
- Permanent 4xx responses are not retried. Temporary failures receive at most the configured bounded retries, then the actor tries the alternate URL/transport and stores structured diagnostics.

## Implementation Guidance

- Stay HTTP-based with Impit and use the supported Firefox desktop profile selected above.
- Normalize listing URLs because Flipkart may redirect category paths.
- Prefer `window.__INITIAL_STATE__` and retain JSON-LD only as the existing fallback.
- If the state object path shifts, search the entire parsed state recursively for listing products instead of assuming a single property path.
- If no products are found, capture diagnostics and store them for review instead of silently returning an empty dataset.

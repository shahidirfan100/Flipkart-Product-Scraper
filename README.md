## What does Flipkart Product Scraper do?

Flipkart Product Scraper collects structured product listings from Flipkart.com. Provide a category or search results URL, or search by keyword, and the Actor returns product titles, prices, ratings, specifications, availability, and seller metadata. The extracted data works for price monitoring, catalog research, competitive analysis, and ecommerce intelligence workflows.

## Why use Flipkart Product Scraper?

- **Structured product data at scale** - Collect hundreds of product records from Flipkart in a single run without manual browsing or copy-paste.
- **Rich product-level fields** - Extract pricing (current, original, discount), ratings, review counts, rating breakdowns, specifications, and availability indicators in normalized formats.
- **Automation-ready output** - Export results to JSON, CSV, Excel, or connect the Actor to schedules, webhooks, and integrations for recurring data collection.
- **Resilient extraction** - The Actor retries with alternative request profiles and stores structured diagnostics if a page blocks or stops returning listing products.

## What data can you extract from Flipkart?

| Field | Description |
|-------|-------------|
| `title` | Product title |
| `brand` | Product brand |
| `price` | Current selling price |
| `original_price` | Original or MRP |
| `discount_percent` | Discount percentage |
| `rating` | Average customer rating |
| `rating_count` | Total rating count |
| `review_count` | Total review count |
| `specifications` | Structured specification key-values |
| `availability_status` | Stock availability state |
| `image_url` | Product image URL |
| `url` | Direct product URL |

## How to use Flipkart Product Scraper

1. Open the Actor on Apify Store.
2. Enter a Flipkart category/search URL or a keyword.
3. Choose an optional sort order and set the maximum number of products to collect.
4. Optionally configure proxy settings for larger runs.
5. Run the Actor.
6. Download the dataset or connect it to your workflow.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | Category URL prefill | Optional category or search URL. Use this or `keyword`, not both. |
| `keyword` | String | No | Empty | Optional keyword search. Use this or `startUrl`, not both. If both are supplied, the keyword takes priority. |
| `sort` | String | No | `relevance` | `relevance`, `popularity`, `price_asc`, `price_desc`, or `newest`. |
| `results_wanted` | Integer | No | `20` | Maximum number of products to return. |
| `proxyConfiguration` | Object | No | Direct | Optional proxy settings for larger runs. |

Use exactly one search source: provide `startUrl` or `keyword`. The form's category URL is only a fallback example when no user source is supplied. If both sources are present, the keyword takes priority and the Actor performs one run only.

## Output Data

| Field | Type | Description |
|-------|------|-------------|
| `id` | String or Null | Product identifier |
| `item_id` | String or Null | Item identifier when available |
| `listing_id` | String or Null | Listing identifier |
| `title` | String or Null | Product title |
| `brand` | String or Null | Product brand |
| `category` | String or Null | Category label |
| `price` | Number or Null | Current selling price |
| `price_text` | String or Null | Current price as formatted text |
| `original_price` | Number or Null | Original or MRP price |
| `original_price_text` | String or Null | Original MRP as formatted text |
| `discount_percent` | Number or Null | Discount percentage |
| `discount_amount` | Number or Null | Discount amount |
| `discount_text` | String or Null | Discount text label |
| `rating` | Number or Null | Average customer rating |
| `rating_count` | Number or Null | Total rating count |
| `review_count` | Number or Null | Total review count |
| `rating_breakdown` | Object or Null | Count per rating bucket (1-5) |
| `specifications` | Object or Null | Structured specification key-values |
| `key_specs` | Array or Null | Key specification bullets |
| `warranty_summary` | String or Null | Warranty summary text |
| `availability_status` | String or Null | Availability state |
| `is_available` | Boolean or Null | Availability flag |
| `buyability_intent` | String or Null | Buyability intent from listing state |
| `is_flipkart_advantage` | Boolean or Null | Flipkart Advantage flag when present |
| `swatch_available` | Boolean or Null | Indicates whether listing swatches are available |
| `currency` | String or Null | Currency code |
| `analytics_category` | String or Null | Analytics category label |
| `analytics_sub_category` | String or Null | Analytics sub-category label |
| `market_place` | String or Null | Marketplace label |
| `image_url` | String or Null | Product image URL |
| `url` | String or Null | Product URL |
| `fetched_at` | String | Extraction timestamp in ISO format |

## Usage Examples

### Basic Product Extraction

Collect the first set of products from a Flipkart category page:

```json
{
  "startUrl": "https://www.flipkart.com/computers/computer-components/monitors-accessories/monitors/pr?sid=6bo,g0i,unb,pp8&marketplace=FLIPKART",
  "results_wanted": 20
}
```

### Large Collection Run

Request a larger batch of products from a mobile phones category:

```json
{
  "startUrl": "https://www.flipkart.com/mobiles/pr?sid=tyy,4io&marketplace=FLIPKART",
  "results_wanted": 300,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

### Keyword Search And Sorting

Use a keyword instead of a URL, then choose a sort order. Leave `startUrl` empty when calling the Actor directly with a keyword:

```json
{
  "keyword": "laptop",
  "sort": "price_desc",
  "results_wanted": 20
}
```

Use either `startUrl` or `keyword` as the search source. The Actor runs one source per run, never both. User-provided search and sort values are used as supplied.

## Sample Output

```json
{
  "id": "MONH3H7XYMMSJBCB",
  "listing_id": "LSTMONH3H7XYMMSJBCBCQNQPE",
  "title": "Frontech Ultima Series 55.88 cm (22 inch) Full HD LED Backlit VA Panel Monitor",
  "brand": "Frontech",
  "category": "monitor",
  "price": 5772,
  "original_price": 19500,
  "discount_percent": 70,
  "discount_amount": 13728,
  "rating": 4.1,
  "rating_count": 1388,
  "review_count": 130,
  "rating_breakdown": {
    "1": 141,
    "2": 63,
    "3": 113,
    "4": 241,
    "5": 830
  },
  "availability_status": "IN_STOCK",
  "is_available": true,
  "buyability_intent": "POSITIVE",
  "is_flipkart_advantage": true,
  "swatch_available": false,
  "currency": "INR",
  "analytics_category": "ComputerComponents",
  "analytics_sub_category": "Monitors",
  "image_url": "https://rukmini1.flixcart.com/image/1500/1500/xif0q/monitor/l/v/a/mon-0079c-full-hd-22-2024-mon-0079c-frontech-original-imahkm4mftzgg96g.jpeg?q=70",
  "url": "https://www.flipkart.com/frontech-ultima-series-55-88-cm-22-inch-full-hd-led-backlit-va-panel-monitor/p/itm1c7e1c7e1c7e1",
  "fetched_at": "2026-02-13T06:57:02.015Z"
}
```

## Tips for Best Results

- Use complete, public Flipkart category or search URLs. Validate that the URL opens product listings in your browser before running.
- Start with a smaller `results_wanted` value for testing. Increase it gradually to estimate runtime for your category.
- Use residential proxies for larger runs and categories that may have stricter request handling.
- If certain fields return null, check whether the source listing page exposes that information. Some categories use different listing layouts.

## Integrations

Connect your extracted Flipkart data with:

- **Google Sheets** - Build live price tracking and inventory sheets.
- **Airtable** - Create searchable product databases.
- **Make** - Automate downstream workflows with no-code connectors.
- **Zapier** - Trigger actions in business tools after each run.
- **Webhooks** - Push data into your own systems programmatically.

### Export Formats

- **JSON** - Best for APIs and developers.
- **CSV** - Best for spreadsheets and BI tools.
- **Excel** - Best for operational reporting.
- **HTML** - Quick human-readable preview.

## Frequently Asked Questions

### Can I export Flipkart data to CSV or Excel?

Yes. Apify datasets can be downloaded in CSV, Excel, JSON, XML, and other supported formats from the Apify Console.

### Can I run this Actor on a schedule?

Yes. You can schedule the Actor in Apify Console to refresh Flipkart product data hourly, daily, weekly, or at another interval.

### Does the Actor paginate until it reaches my requested count?

Yes. The Actor paginates through Flipkart listing pages to reach your `results_wanted` count when enough products are available.

### Why are some fields null?

Some products or Flipkart categories do not expose every field consistently. Null values are expected when the source page does not include that information.

### What happens if Flipkart changes its page structure?

The Actor retries with alternative request profiles and stores a structured diagnostic report if a page blocks or stops returning product listings.

### Can I search with a URL or a keyword?

Yes. Provide either `startUrl` for a category or search page, or `keyword` for a keyword search. If both are present, the keyword is the active source and the Actor performs one run only.

### How many products can I collect in one run?

You can request large volumes. Practical limits depend on category depth, page availability, and runtime constraints.

### Is it legal to scrape Flipkart?

Scraping public web data can be legal, but you are responsible for complying with applicable laws, Flipkart's terms of service, and privacy regulations.

## Related Actors

- [Shopify Product Scraper](https://apify.com/shahidirfan/shopify-product-scraper) - Extract product catalogs from any Shopify store with variant-level detail.
- [Walmart Product Scraper](https://apify.com/shahidirfan/walmart-product-scraper) - Collect Walmart product listings, pricing, ratings, and seller info.
- [Target Product Scraper](https://apify.com/shahidirfan/target-product-scraper) - Scrape Target.com product data with prices, reviews, and inventory levels.

## Support

For issues, feature requests, or custom Actor work, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal Notice

This Actor is designed for legitimate data collection from publicly available pages on Flipkart.com. Users are responsible for using the data responsibly and complying with applicable laws and website terms.
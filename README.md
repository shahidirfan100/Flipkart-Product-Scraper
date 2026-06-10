# Flipkart Product Scraper

Extract Flipkart product listings at scale with reliable, structured output. Collect pricing, ratings, availability, and product metadata for research, monitoring, and analytics. Built for fast collection, strict result targeting, and resilient reruns when Flipkart shifts request behavior.

## Features

- **Fast collection mode** - Prioritizes speed by extracting directly from listing pages.
- **Strict target pagination** - Continues pagination to reach your requested `results_wanted` count when products are available.
- **Rich structured output** - Returns normalized numeric/text fields ready for analysis.
- **Self-healing request strategy** - Tries multiple safe request profiles and normalized listing URLs before failing.
- **Failure diagnostics** - Stores a structured diagnostic report when a page blocks or stops exposing listing products.

## Use Cases

### Price Monitoring
Track selling price, original price, and discount changes across categories. Use repeated runs to monitor promotions and pricing trends.

### Catalog Intelligence
Build product datasets with IDs, listings, brand/category metadata, and key specs. Useful for product benchmarking and catalog enrichment.

### Seller and Availability Tracking
Capture listing availability and buyability indicators. Helpful for operational market monitoring.

### Competitive Analysis
Compare rating volume and review volume across similar products. Identify fast-moving and high-engagement listings.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `startUrl` | String | No | Flipkart monitors listing URL | Flipkart category or search URL to scrape. |
| `results_wanted` | Integer | No | `20` | Maximum number of products to return. |
| `proxyConfiguration` | Object | No | Apify proxy preset | Proxy settings for reliability at scale. |

---

## Output Data

Each dataset item may contain:

| Field | Type | Description |
|---|---|---|
| `id` | String\|Null | Product identifier. |
| `item_id` | String\|Null | Item identifier if available. |
| `listing_id` | String\|Null | Listing identifier. |
| `title` | String\|Null | Product title. |
| `brand` | String\|Null | Product brand. |
| `category` | String\|Null | Category/vertical label. |
| `price` | Number\|Null | Current price. |
| `price_text` | String\|Null | Current price as formatted text. |
| `original_price` | Number\|Null | Original/MRP price. |
| `original_price_text` | String\|Null | Original/MRP as formatted text. |
| `discount_percent` | Number\|Null | Discount percentage. |
| `discount_amount` | Number\|Null | Discount amount. |
| `discount_text` | String\|Null | Discount text label. |
| `rating` | Number\|Null | Average rating. |
| `rating_count` | Number\|Null | Total rating count. |
| `review_count` | Number\|Null | Total review count. |
| `rating_breakdown` | Object\|Null | Count per rating bucket (1-5). |
| `specifications` | Object\|Null | Structured specification key-values. |
| `key_specs` | String[]\|Null | Key specification bullets. |
| `warranty_summary` | String\|Null | Warranty summary text. |
| `availability_status` | String\|Null | Availability state. |
| `is_available` | Boolean\|Null | Availability flag. |
| `buyability_intent` | String\|Null | Buyability intent exposed by the listing state. |
| `is_flipkart_advantage` | Boolean\|Null | Flipkart advantage style flag when present. |
| `swatch_available` | Boolean\|Null | Indicates whether listing swatches are available. |
| `currency` | String\|Null | Currency code. |
| `analytics_category` | String\|Null | Analytics category label from Flipkart state. |
| `analytics_sub_category` | String\|Null | Analytics sub-category label from Flipkart state. |
| `market_place` | String\|Null | Marketplace label. |
| `image_url` | String\|Null | Product image URL. |
| `url` | String\|Null | Product URL. |
| `fetched_at` | String | Extraction timestamp in ISO format. |

---

## Usage Examples

### Fast Extraction (Recommended)

Use default fast mode for maximum speed.

```json
{
  "startUrl": "https://www.flipkart.com/computers/computer-components/monitors/pr?sid=6bo,g0i,9no&marketplace=FLIPKART",
  "results_wanted": 100
}
```

### High-Volume Collection with Proxies

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

---

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
  "url": "https://www.flipkart.com/...",
  "fetched_at": "2026-02-13T06:57:02.015Z"
}
```

---

## Tips for Best Results

### Prioritize Fast Mode
- Use the default settings for the fastest runs.
- Increase `results_wanted` gradually to estimate runtime for your category.

### Use Stable Listing URLs
- Prefer category and search URLs that show normal product listings.
- Validate that the URL opens product cards in your browser before running.

### Scale Safely
- Use residential proxies for larger runs and stricter categories.
- Keep request volume realistic for the target category depth.

---

## Integrations

Connect your extracted dataset with:

- **Google Sheets** - Build live tracking sheets.
- **Airtable** - Create searchable product databases.
- **Make** - Automate downstream workflows.
- **Zapier** - Trigger actions in business tools.
- **Webhooks** - Push data into your own systems.

### Export Formats

- **JSON** - Best for APIs and developers.
- **CSV** - Best for spreadsheets and BI tools.
- **Excel** - Best for operational reporting.
- **HTML** - Quick human-readable preview.

---

## Frequently Asked Questions

### Does it paginate until my requested count?
Yes. The actor paginates listing pages to reach `results_wanted` when enough products are available.

### Which mode is fastest?
The actor runs in an optimized fast mode by default and is recommended for bulk extraction.

### Can available fields vary by category?
Yes. Some fields depend on what each listing exposes, so certain attributes may be null in some categories.

### Why are some fields null?
Some products or listings do not expose every field consistently. Null values are expected in such cases.

### What happens if Flipkart changes request behavior?
The actor retries with alternative request fingerprints and stores structured diagnostics if a page blocks or stops returning listing products.

### Can I scrape search URLs and category URLs?
Yes. Both are supported as long as they return product listing pages.

### How many products can I collect?
You can request large volumes; practical limits depend on page availability, category depth, and runtime constraints.

---

## Support

For issues or feature requests, use the actor issue tracker in Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Apify Schedules](https://docs.apify.com/platform/schedules)

---

## Legal Notice

This actor is intended for legitimate data collection and analysis use cases. You are responsible for complying with applicable laws, platform terms, and responsible usage practices.

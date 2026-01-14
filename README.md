# Flipkart Product Scraper

> **Extract product data from Flipkart.com** — India's largest e-commerce platform. Get comprehensive product information including prices, ratings, specifications, and more for market research, price monitoring, and competitive analysis.

## What does Flipkart Product Scraper do?

Flipkart Product Scraper extracts detailed product listings from any Flipkart category or search results page. Perfect for:

- **Price Monitoring** — Track prices across thousands of products
- **Market Research** — Analyze product trends, ratings, and reviews
- **Competitive Intelligence** — Monitor competitor pricing strategies
- **E-commerce Analytics** — Build product databases for analysis
- **Dropshipping Research** — Find profitable products with pricing data

## Features

- **Comprehensive Data Extraction** — Title, price, MRP, discount, rating, reviews, specifications
- **Category Scraping** — Extract from any Flipkart category page
- **Search Results** — Scrape products from search queries
- **High Performance** — Fast extraction with optimized pagination
- **Reliable Output** — Structured JSON data ready for analysis
- **Production Ready** — Built-in error handling and retry mechanisms

## How to use Flipkart Product Scraper

### Quick Start Guide

1. Navigate to [Flipkart.com](https://www.flipkart.com) and find your desired category or search
2. Copy the URL from your browser
3. Paste the URL into the **Flipkart URL** input field
4. Set your desired **Maximum Products** limit
5. Click **Start** to begin extraction

### Input Examples

#### Scrape Monitor Listings

```json
{
  "startUrl": "https://www.flipkart.com/computers/computer-components/monitors/pr?sid=6bo,g0i,9no&marketplace=FLIPKART",
  "results_wanted": 50,
  "max_pages": 5
}
```

#### Scrape Mobile Phones

```json
{
  "startUrl": "https://www.flipkart.com/mobiles/pr?sid=tyy,4io&marketplace=FLIPKART",
  "results_wanted": 100,
  "max_pages": 10
}
```

#### Scrape Laptops with Proxies

```json
{
  "startUrl": "https://www.flipkart.com/laptops/pr?sid=6bo,b5g&marketplace=FLIPKART",
  "results_wanted": 200,
  "max_pages": 15,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `startUrl` | String | Yes | Flipkart category or search URL to scrape |
| `results_wanted` | Integer | No | Maximum products to extract (default: 20) |
| `max_pages` | Integer | No | Maximum pages to process (default: 3) |
| `proxyConfiguration` | Object | No | Proxy settings for reliable extraction |

## Output Data

Each extracted product contains the following fields:

```json
{
  "id": "MONHG2GFZYW6GS7H",
  "title": "Frontech - 48.26 cm (19 inch) HD LED Backlit VA Panel Monitor",
  "price": 2584,
  "price_text": "₹2,584",
  "original_price": 7500,
  "original_price_text": "₹7,500",
  "discount_percent": 65,
  "discount_text": "65% off",
  "rating": 3.8,
  "rating_count": 21,
  "review_count": 3,
  "specifications": {
    "Panel Type": "VA Panel",
    "Screen Resolution Type": "HD",
    "Brightness": "250 nits",
    "Response Time": "5 ms",
    "Refresh Rate": "60 Hz"
  },
  "image_url": "https://rukminim2.flixcart.com/image/312/312/product.jpg",
  "url": "https://www.flipkart.com/frontech-monitor/p/itmb2451999c24db",
  "fetched_at": "2024-01-15T10:30:00.000Z"
}
```

### Output Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Unique Flipkart product identifier |
| `title` | String | Product name and description |
| `price` | Number | Current selling price in INR |
| `price_text` | String | Formatted price with currency symbol |
| `original_price` | Number | Original MRP before discount |
| `original_price_text` | String | Formatted MRP with currency |
| `discount_percent` | Number | Discount percentage |
| `discount_text` | String | Formatted discount text |
| `rating` | Number | Average customer rating (1-5) |
| `rating_count` | Number | Total number of ratings |
| `review_count` | Number | Total number of reviews |
| `specifications` | Object | Product specifications and features |
| `image_url` | String | Product image URL |
| `url` | String | Direct link to product page |
| `fetched_at` | String | ISO timestamp of extraction |

## Use Cases

### Price Monitoring and Tracking

Monitor price changes across product categories. Set up scheduled runs to track:
- Daily price fluctuations
- Discount patterns during sales
- Competitor pricing strategies

### Market Research

Analyze product trends and consumer preferences:
- Popular products by rating and reviews
- Price distribution across categories
- Feature comparison for specifications

### E-commerce Intelligence

Build comprehensive product databases:
- Catalog synchronization
- Inventory analysis
- Product gap identification

### Academic Research

Gather e-commerce data for studies on:
- Pricing algorithms
- Consumer behavior
- Market dynamics

## Performance and Cost

### Speed Estimates

| Products | Pages | Estimated Time |
|----------|-------|----------------|
| 20 | 1-2 | ~30 seconds |
| 50 | 3-4 | ~1 minute |
| 100 | 5-6 | ~2 minutes |
| 500 | 20-25 | ~8 minutes |

### Cost Optimization Tips

1. **Start small** — Test with 20-50 products first
2. **Use datacenter proxies** — Residential proxies cost more
3. **Limit pages** — Each page adds extraction time
4. **Schedule wisely** — Run during off-peak hours

## Best Practices

### Recommended Settings

For reliable extraction without blocking:

- Enable proxy configuration for large runs
- Use residential proxies for best success rates
- Start with smaller product limits for testing

### Handling Large Datasets

For extracting thousands of products:

1. Split into multiple category URLs
2. Run parallel actors for different categories
3. Use scheduled runs for regular updates

## Troubleshooting

### No Products Found

- Verify the URL is a valid Flipkart product listing page
- Check if the page loads products (not an error page)
- Try with a different category URL

### Timeout Errors

- Reduce `max_pages` and `results_wanted`
- Lower `maxConcurrency` setting
- Enable proxy configuration

### Missing Data Fields

- Some products may not have all fields (e.g., no discount, no rating)
- Specifications vary by product category
- This is normal behavior based on Flipkart's data

## Integrations

Export your data in multiple formats:

- **JSON** — Raw structured data
- **CSV** — Spreadsheet compatible
- **Excel** — Microsoft Excel format
- **XML** — Standard markup format

Integrate with your tools via:

- **Apify API** — Programmatic access
- **Webhooks** — Real-time notifications
- **Google Sheets** — Direct export
- **Zapier** — Workflow automation

## Legal and Compliance

This actor extracts publicly available product data from Flipkart.com for legitimate business purposes including market research, price monitoring, and competitive analysis. Users are responsible for ensuring their use case complies with applicable laws and Flipkart's terms of service.

## Support and Updates

For questions, issues, or feature requests:

- Check the input configuration matches your requirements
- Verify the Flipkart URL structure is correct
- Test with smaller datasets first

---

**Related searches**: Flipkart scraper, Flipkart product data, e-commerce scraper India, price monitoring Flipkart, product data extraction, Flipkart API alternative, Flipkart price tracker, online shopping data, e-commerce intelligence India
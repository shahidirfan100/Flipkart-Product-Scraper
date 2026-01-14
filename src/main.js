// Flipkart Product Scraper - HTTP + HTML parsing with stealth
import { Actor, log } from 'apify';
import { Dataset, gotScraping, sleep } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';

// Flipkart product selectors (verified for list view)
const SELECTORS = {
    productCard: 'div[data-id]',
    title: '.RG5Slk, .KzDlHZ, ._4rR01T',
    salePrice: '.hZ3P6w, .Nx9bqj, ._30jeq3',
    originalPrice: '.y6Y9S4, ._3I9_wc, ._27UcVY',
    discount: '.HQe8jr, .UkUFwK, ._3Ay6Sb',
    rating: '.MKiFS6, ._3LWZlK',
    ratingCount: '.PvbNMB, ._2_R_DZ',
    image: 'img.UCc1lI, img.DByoQZ, img._396cs4',
    productUrl: 'a.k7wcnx, a.CGtC98, a._1fQZEK, a.rPDeLR',
    specifications: 'ul.HwRTzP, ul._1xgFaf',
    nextButton: 'a._1LKTO3 span:contains("Next"), a.jgg0SZ',
};

// Stealth headers rotation pool
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const getStealthHeaders = () => ({
    'User-Agent': getRandomUserAgent(),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    Connection: 'keep-alive',
});

// Concurrency limiter
const createLimiter = (maxConcurrency) => {
    let active = 0;
    const queue = [];
    const next = () => {
        if (active >= maxConcurrency || queue.length === 0) return;
        active += 1;
        const { task, resolve, reject } = queue.shift();
        task()
            .then(resolve)
            .catch(reject)
            .finally(() => {
                active -= 1;
                next();
            });
    };
    return (task) =>
        new Promise((resolve, reject) => {
            queue.push({ task, resolve, reject });
            next();
        });
};

// Retry with exponential backoff
const requestWithRetry = async (fn, context, maxRetries = 4) => {
    let attempt = 0;
    let lastError;
    while (attempt < maxRetries) {
        attempt += 1;
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const statusCode = error.response?.statusCode;
            if (statusCode === 404) throw error;

            log.warning(`${context} failed (Attempt ${attempt}/${maxRetries}): ${error.message}`);

            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1500;
                await sleep(delay);
            }
        }
    }
    throw lastError;
};

// Proxy URL picker
const pickProxyUrl = async (proxyConfiguration) =>
    proxyConfiguration ? proxyConfiguration.newUrl() : undefined;

// Build paginated URL
const buildPageUrl = (baseUrl, page) => {
    const url = new URL(baseUrl);
    if (page > 1) {
        url.searchParams.set('page', String(page));
    }
    return url.href;
};

// Parse price string to number
const parsePrice = (priceStr) => {
    if (!priceStr) return null;
    const cleaned = priceStr.replace(/[₹,\s]/g, '');
    const num = parseInt(cleaned, 10);
    return Number.isFinite(num) ? num : null;
};

// Parse rating string
const parseRating = (ratingStr) => {
    if (!ratingStr) return null;
    const match = ratingStr.match(/(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : null;
};

// Parse rating count (e.g., "21 Ratings & 3 Reviews")
const parseRatingCount = (countStr) => {
    if (!countStr) return { ratings: null, reviews: null };
    const ratingsMatch = countStr.match(/([\d,]+)\s*Ratings?/i);
    const reviewsMatch = countStr.match(/([\d,]+)\s*Reviews?/i);
    return {
        ratings: ratingsMatch ? parseInt(ratingsMatch[1].replace(/,/g, ''), 10) : null,
        reviews: reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g, ''), 10) : null,
    };
};

// Parse discount string
const parseDiscount = (discountStr) => {
    if (!discountStr) return null;
    const match = discountStr.match(/(\d+)\s*%/);
    return match ? parseInt(match[1], 10) : null;
};

// Clean image URL (remove query params for cleaner URL)
const cleanImageUrl = (imgUrl) => {
    if (!imgUrl) return null;
    try {
        const url = new URL(imgUrl);
        return `${url.origin}${url.pathname}`;
    } catch {
        return imgUrl;
    }
};

// Extract specifications from list
const parseSpecifications = ($, specsEl) => {
    const specs = {};
    if (!specsEl || !specsEl.length) return specs;

    specsEl.find('li').each((_, li) => {
        const text = $(li).text().trim();
        // Try to split on common patterns
        if (text.includes(':')) {
            const [key, ...valueParts] = text.split(':');
            specs[key.trim()] = valueParts.join(':').trim();
        } else if (text.includes(' - ')) {
            const [key, ...valueParts] = text.split(' - ');
            specs[key.trim()] = valueParts.join(' - ').trim();
        } else {
            // Store as is with index
            specs[`spec_${Object.keys(specs).length + 1}`] = text;
        }
    });

    return Object.keys(specs).length > 0 ? specs : null;
};

// Extract product data from a card element
const extractProduct = ($, cardEl) => {
    const card = $(cardEl);
    const productId = card.attr('data-id');

    // Title - try multiple selectors
    let title = null;
    for (const sel of SELECTORS.title.split(', ')) {
        const el = card.find(sel).first();
        if (el.length) {
            title = el.text().trim();
            break;
        }
    }

    // Sale price
    let salePrice = null;
    for (const sel of SELECTORS.salePrice.split(', ')) {
        const el = card.find(sel).first();
        if (el.length) {
            salePrice = el.text().trim();
            break;
        }
    }

    // Original price
    let originalPrice = null;
    for (const sel of SELECTORS.originalPrice.split(', ')) {
        const el = card.find(sel).first();
        if (el.length) {
            originalPrice = el.text().trim();
            break;
        }
    }

    // Discount
    let discount = null;
    for (const sel of SELECTORS.discount.split(', ')) {
        const el = card.find(sel).first();
        if (el.length) {
            discount = el.text().trim();
            break;
        }
    }

    // Rating
    let rating = null;
    for (const sel of SELECTORS.rating.split(', ')) {
        const el = card.find(sel).first();
        if (el.length) {
            rating = el.text().trim();
            break;
        }
    }

    // Rating count
    let ratingCountText = null;
    for (const sel of SELECTORS.ratingCount.split(', ')) {
        const el = card.find(sel).first();
        if (el.length) {
            ratingCountText = el.text().trim();
            break;
        }
    }

    // Image
    let imageUrl = null;
    for (const sel of SELECTORS.image.split(', ')) {
        const el = card.find(sel).first();
        if (el.length) {
            imageUrl = el.attr('src') || el.attr('data-src');
            break;
        }
    }

    // Product URL
    let productUrl = null;
    for (const sel of SELECTORS.productUrl.split(', ')) {
        const el = card.find(sel).first();
        if (el.length) {
            productUrl = el.attr('href');
            break;
        }
    }
    // Fallback: find any link with /p/ in href
    if (!productUrl) {
        const anyLink = card.find('a[href*="/p/"]').first();
        if (anyLink.length) {
            productUrl = anyLink.attr('href');
        }
    }

    // Specifications
    let specifications = null;
    for (const sel of SELECTORS.specifications.split(', ')) {
        const el = card.find(sel).first();
        if (el.length) {
            specifications = parseSpecifications($, el);
            break;
        }
    }

    // Parse values
    const ratingCounts = parseRatingCount(ratingCountText);

    return {
        id: productId || null,
        title: title || null,
        price: parsePrice(salePrice),
        price_text: salePrice || null,
        original_price: parsePrice(originalPrice),
        original_price_text: originalPrice || null,
        discount_percent: parseDiscount(discount),
        discount_text: discount || null,
        rating: parseRating(rating),
        rating_count: ratingCounts.ratings,
        review_count: ratingCounts.reviews,
        specifications,
        image_url: cleanImageUrl(imageUrl),
        url: productUrl ? new URL(productUrl, 'https://www.flipkart.com').href : null,
        fetched_at: new Date().toISOString(),
    };
};

// Fetch a listing page
const fetchListingPage = async (url, proxyConfiguration) => {
    return requestWithRetry(
        async () => {
            // Random delay for stealth (500-2000ms)
            await sleep(500 + Math.random() * 1500);

            const res = await gotScraping({
                url,
                headers: getStealthHeaders(),
                responseType: 'text',
                proxyUrl: await pickProxyUrl(proxyConfiguration),
                timeout: { request: 30000 },
                throwHttpErrors: false,
                followRedirect: true,
                retry: { limit: 0 }, // We handle retries ourselves
            });

            if (res.statusCode >= 400) {
                throw new Error(`HTTP ${res.statusCode} for ${url}`);
            }

            return res.body;
        },
        `Fetch ${url}`,
        4
    );
};

// Main scraper logic
await Actor.init();

try {
    const input = (await Actor.getInput()) || {};
    const {
        startUrl = 'https://www.flipkart.com/computers/computer-components/monitors/pr?sid=6bo,g0i,9no&marketplace=FLIPKART',
        results_wanted: resultsWantedRaw = 20,
        max_pages: maxPagesRaw = 5,
        maxConcurrency = 3,
        proxyConfiguration,
    } = input;

    const resultsWanted = Number.isFinite(+resultsWantedRaw) ? Math.max(1, +resultsWantedRaw) : 20;
    const maxPages = Number.isFinite(+maxPagesRaw) ? Math.max(1, +maxPagesRaw) : 5;
    const proxyConf = proxyConfiguration
        ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
        : undefined;

    log.info(`🚀 Starting Flipkart Product Scraper`);
    log.info(`📋 Target: ${startUrl}`);
    log.info(`📊 Goals: ${resultsWanted} products, max ${maxPages} pages`);

    const seenIds = new Set();
    const allProducts = [];
    const startTime = Date.now();
    const MAX_RUNTIME_MS = 4 * 60 * 1000; // 4 minutes safety for QA

    let stats = { pagesProcessed: 0, productsFound: 0, errors: 0 };

    for (let page = 1; page <= maxPages && allProducts.length < resultsWanted; page += 1) {
        // Timeout safety
        if (Date.now() - startTime > MAX_RUNTIME_MS) {
            log.info(`⏱️ Approaching timeout. Stopping gracefully at ${allProducts.length} products.`);
            break;
        }

        const pageUrl = buildPageUrl(startUrl, page);
        log.info(`📄 Fetching page ${page}: ${pageUrl}`);

        let html;
        try {
            html = await fetchListingPage(pageUrl, proxyConf);
            stats.pagesProcessed += 1;
        } catch (err) {
            stats.errors += 1;
            log.error(`❌ Failed to fetch page ${page}: ${err.message}`);
            if (page === 1) {
                // Critical: first page failed
                throw new Error(`Failed to fetch first page: ${err.message}`);
            }
            continue;
        }

        const $ = cheerioLoad(html);
        const productCards = $(SELECTORS.productCard);
        log.info(`🔍 Found ${productCards.length} product cards on page ${page}`);

        if (productCards.length === 0) {
            log.warning(`⚠️ No products found on page ${page}. Stopping pagination.`);
            break;
        }

        productCards.each((_, cardEl) => {
            if (allProducts.length >= resultsWanted) return false; // Break early

            try {
                const product = extractProduct($, cardEl);

                // Skip duplicates
                if (product.id && seenIds.has(product.id)) return;
                if (product.id) seenIds.add(product.id);

                // Skip invalid products
                if (!product.title && !product.price) return;

                allProducts.push(product);
                stats.productsFound += 1;
            } catch (err) {
                stats.errors += 1;
                log.warning(`⚠️ Failed to extract product: ${err.message}`);
            }
        });

        log.info(`✅ Page ${page} complete. Total products: ${allProducts.length}/${resultsWanted}`);

        // Check if we have enough
        if (allProducts.length >= resultsWanted) {
            log.info(`🎯 Reached target of ${resultsWanted} products.`);
            break;
        }

        // Random delay between pages for stealth
        if (page < maxPages) {
            const pageDelay = 1000 + Math.random() * 2000;
            log.info(`⏳ Waiting ${Math.round(pageDelay)}ms before next page...`);
            await sleep(pageDelay);
        }
    }

    // Push all products to dataset
    if (allProducts.length > 0) {
        // Batch push for efficiency
        const batchSize = 50;
        for (let i = 0; i < allProducts.length; i += batchSize) {
            const batch = allProducts.slice(i, i + batchSize);
            await Dataset.pushData(batch);
        }
    }

    const totalTime = (Date.now() - startTime) / 1000;

    // Final statistics
    log.info('='.repeat(60));
    log.info('📊 FLIPKART SCRAPER STATISTICS');
    log.info('='.repeat(60));
    log.info(`✅ Products extracted: ${allProducts.length}/${resultsWanted}`);
    log.info(`📄 Pages processed: ${stats.pagesProcessed}/${maxPages}`);
    log.info(`⚠️  Errors: ${stats.errors}`);
    log.info(`⏱️  Runtime: ${totalTime.toFixed(2)}s`);
    log.info(`⚡ Speed: ${(allProducts.length / totalTime).toFixed(2)} products/sec`);
    log.info('='.repeat(60));

    // QA validation
    if (allProducts.length === 0) {
        const errorMsg = 'No products extracted. Check if URL is valid and page structure has not changed.';
        log.error(`❌ ${errorMsg}`);
        await Actor.fail(errorMsg);
    } else {
        log.info(`🎉 SUCCESS: Extracted ${allProducts.length} products!`);
        await Actor.setValue('OUTPUT_SUMMARY', {
            productsExtracted: allProducts.length,
            pagesProcessed: stats.pagesProcessed,
            runtime: totalTime,
            success: true,
        });
    }
} catch (error) {
    log.error(`❌ CRITICAL ERROR: ${error.message}`);
    log.exception(error, 'Actor failed with exception');
    await Actor.fail(`Actor failed: ${error.message}`);
} finally {
    await Actor.exit();
}

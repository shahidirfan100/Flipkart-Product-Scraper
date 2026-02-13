// Flipkart Product Scraper - listing API/state extraction only (no product page visits)
import { Actor, log } from 'apify';
import { Dataset, gotScraping, sleep } from 'crawlee';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

const BLOCK_TITLE_PATTERNS = ['access denied', 'captcha', 'robot check', 'unusual activity'];

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const getStealthHeaders = () => ({
    'User-Agent': getRandomUserAgent(),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="122", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    Connection: 'keep-alive',
});

const requestWithRetry = async (fn, context, maxRetries = 3) => {
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

            log.warning(`${context} failed (attempt ${attempt}/${maxRetries}): ${error.message}`);

            if (attempt < maxRetries) {
                const delayMs = (2 ** attempt) * 400 + Math.random() * 700;
                await sleep(delayMs);
            }
        }
    }

    throw lastError;
};

const pickProxyUrl = async (proxyConfiguration) =>
    proxyConfiguration ? proxyConfiguration.newUrl() : undefined;

const buildPageUrl = (baseUrl, page) => {
    const url = new URL(baseUrl);
    if (page > 1) url.searchParams.set('page', String(page));
    return url.href;
};

const toNumber = (value) => {
    if (value === null || value === undefined) return null;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : null;
};

const toBoolean = (value) => (typeof value === 'boolean' ? value : null);

const parseDiscountPercent = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const match = String(value).match(/(\d+)\s*%/);
    return match ? parseInt(match[1], 10) : null;
};

const asText = (value) => (value === null || value === undefined ? null : String(value).trim() || null);

const asTextArray = (value) => {
    if (Array.isArray(value)) {
        const list = value.map((item) => asText(item)).filter(Boolean);
        return list.length > 0 ? list : null;
    }

    if (value && typeof value === 'object') {
        const list = Object.values(value).map((item) => asText(item)).filter(Boolean);
        return list.length > 0 ? list : null;
    }

    const text = asText(value);
    return text ? [text] : null;
};

const parseSchemaToken = (value) => {
    const str = asText(value);
    if (!str) return null;
    if (!str.includes('/')) return str;
    return str.split('/').pop() || null;
};

const normalizeAvailability = (value) => {
    const token = parseSchemaToken(value);
    if (!token) return null;

    const normalized = token.toUpperCase();
    if (normalized === 'INSTOCK') return 'IN_STOCK';
    if (normalized === 'OUTOFSTOCK') return 'OUT_OF_STOCK';
    if (normalized === 'PREORDER' || normalized === 'PREBOOK') return 'PREORDER';
    return normalized;
};

const buildRatingBreakdown = (values) => {
    if (!Array.isArray(values) || values.length === 0) return null;
    const breakdown = {};

    if (values.every((item) => typeof item === 'number')) {
        values.forEach((count, idx) => {
            breakdown[String(idx + 1)] = count;
        });
    } else {
        values.forEach((item) => {
            const ratingValue = asText(item?.ratingValue);
            const ratingCount = toNumber(item?.ratingCount);
            if (ratingValue && ratingCount !== null) breakdown[ratingValue] = ratingCount;
        });
    }

    return Object.keys(breakdown).length > 0 ? breakdown : null;
};

const formatInr = (value) => (value === null || value === undefined ? null : `₹${value}`);

const sanitizeImageUrl = (url) => {
    if (!url) return null;
    const raw = String(url).trim();
    if (!raw || raw.toLowerCase().includes('proxied content')) return null;
    return raw
        .replace('http://', 'https://')
        .replace('{@width}', '832')
        .replace('{@height}', '832')
        .replace('{@quality}', '75');
};

const buildDiscountText = (discountPercent) =>
    discountPercent !== null && discountPercent !== undefined ? `${discountPercent}% off` : null;

const ensureAbsoluteUrl = (rawUrl) => {
    if (!rawUrl) return null;
    try {
        return new URL(rawUrl, 'https://www.flipkart.com').href;
    } catch {
        return null;
    }
};

const extractItemIdFromUrl = (rawUrl) => {
    const absolute = ensureAbsoluteUrl(rawUrl);
    if (!absolute) return null;
    const match = absolute.match(/\/(itm[a-z0-9]+)/i);
    return match ? asText(match[1]) : null;
};

const getUrlQueryParam = (rawUrl, key) => {
    if (!rawUrl || !key) return null;
    try {
        const value = new URL(rawUrl, 'https://www.flipkart.com').searchParams.get(key);
        return asText(value);
    } catch {
        return null;
    }
};

const isLikelyBlocked = (html = '') => {
    const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim().toLowerCase() || '';
    return BLOCK_TITLE_PATTERNS.some((pattern) => title.includes(pattern));
};

const extractBalancedJsonObject = (text, startIndex) => {
    let i = startIndex;
    while (i < text.length && text[i] !== '{') i += 1;
    if (text[i] !== '{') return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let j = i; j < text.length; j += 1) {
        const ch = text[j];

        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                return text.slice(i, j + 1);
            }
        }
    }

    return null;
};

const parseInitialStateFromHtml = (html) => {
    const marker = 'window.__INITIAL_STATE__ = ';
    const index = html.indexOf(marker);
    if (index === -1) return null;

    const jsonText = extractBalancedJsonObject(html, index + marker.length);
    if (!jsonText) return null;

    try {
        return JSON.parse(jsonText);
    } catch (error) {
        log.warning(`Failed to parse window.__INITIAL_STATE__: ${error.message}`);
        return null;
    }
};

const findStateListingProducts = (state) => {
    const products = [];
    const visited = new WeakSet();

    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (visited.has(node)) return;
        visited.add(node);

        if (Array.isArray(node)) {
            for (const item of node) walk(item);
            return;
        }

        if (Array.isArray(node.products)) {
            for (const product of node.products) {
                if (product?.productInfo?.value?.id || product?.productInfo?.action?.url) {
                    products.push(product);
                }
            }
        }

        for (const value of Object.values(node)) {
            walk(value);
        }
    };

    walk(state?.pageDataV4?.page?.data);
    return products;
};

const getListingPrices = (value) => {
    const pricing = value?.pricing || {};
    const prices = Array.isArray(pricing?.prices) ? pricing.prices : [];

    const specialPriceObj = prices.find((p) => p?.priceType === 'SPECIAL_PRICE')
        || prices.find((p) => String(p?.name || '').toLowerCase().includes('special'));
    const originalPriceObj = prices.find((p) => p?.strikeOff === true)
        || prices.find((p) => p?.priceType === 'FSP')
        || null;
    const nonStrikeOffPriceObj = prices.find((p) => p?.strikeOff === false);

    const salePrice = toNumber(specialPriceObj?.value)
        ?? toNumber(nonStrikeOffPriceObj?.value)
        ?? toNumber(pricing?.finalPrice?.value)
        ?? toNumber(pricing?.sellingPrice?.value)
        ?? toNumber(pricing?.discountedPrice?.value)
        ?? toNumber(prices[0]?.value);

    const originalPrice = toNumber(originalPriceObj?.value)
        ?? toNumber(pricing?.basePrice?.value)
        ?? toNumber(pricing?.mrp?.value)
        ?? toNumber(pricing?.maxRetailPrice?.value);

    let discountPercent = toNumber(pricing?.totalDiscount)
        ?? parseDiscountPercent(pricing?.discountLabel)
        ?? parseDiscountPercent(value?.discountLabel);

    if (discountPercent === null && originalPrice && salePrice) {
        discountPercent = Math.round(((originalPrice - salePrice) / originalPrice) * 100);
    }

    const discountAmount = toNumber(pricing?.discountAmount)
        ?? ((originalPrice !== null && salePrice !== null) ? originalPrice - salePrice : null);

    const currency = asText(prices.find((p) => p?.currency)?.currency)
        ?? asText(pricing?.finalPrice?.currency)
        ?? asText(pricing?.currency)
        ?? 'INR';

    return { salePrice, originalPrice, discountPercent, discountAmount, currency };
};

const buildBaseSpecifications = (value) => {
    const specs = {};
    const subtitle = asText(value?.titles?.subtitle);
    const coSubtitle = asText(value?.titles?.coSubtitle);
    const superTitle = asText(value?.titles?.superTitle);
    const vertical = asText(value?.analyticsData?.vertical);
    const analyticsCategory = asText(value?.analyticsData?.category);
    const analyticsSubCategory = asText(value?.analyticsData?.subCategory);

    if (subtitle) specs.subtitle = subtitle;
    if (coSubtitle) specs.variant = coSubtitle;
    if (superTitle) specs.brand = superTitle;
    if (vertical) specs.category = vertical;
    if (analyticsCategory) specs.analytics_category = analyticsCategory;
    if (analyticsSubCategory) specs.analytics_sub_category = analyticsSubCategory;

    const keySpecs = asTextArray(value?.keySpecs);
    if (keySpecs) {
        for (const spec of keySpecs) {
            const [rawKey, ...rawVal] = spec.split(':');
            const k = asText(rawKey);
            const v = asText(rawVal.join(':'));
            if (k && v && !specs[k]) specs[k] = v;
        }
    }

    return Object.keys(specs).length > 0 ? specs : null;
};

const mapListingProduct = (product) => {
    const value = product?.productInfo?.value || {};
    const actionUrl = product?.productInfo?.action?.url || value?.baseUrl || value?.url || null;

    const { salePrice, originalPrice, discountPercent, discountAmount, currency } = getListingPrices(value);

    const listingAvailability = normalizeAvailability(
        value?.availability?.displayState || value?.availability?.status || value?.availabilityStatus
    );
    const buyabilityIntent = asText(value?.buyability?.intent)?.toUpperCase() || null;
    let fallbackAvailability = null;
    if (buyabilityIntent === 'POSITIVE') fallbackAvailability = 'IN_STOCK';
    else if (buyabilityIntent === 'NEGATIVE') fallbackAvailability = 'OUT_OF_STOCK';
    const resolvedAvailability = listingAvailability || fallbackAvailability;

    const fallbackBrand = asText(value?.titles?.title)?.split(' ')?.[0] || null;
    const specs = buildBaseSpecifications(value);

    const resolvedUrl = ensureAbsoluteUrl(actionUrl);
    const resolvedItemId = asText(value?.itemId) || extractItemIdFromUrl(actionUrl);
    const marketPlace = getUrlQueryParam(actionUrl, 'marketplace')
        || asText(value?.marketPlace)
        || 'FLIPKART';

    let isAvailableFromStatus = null;
    if (resolvedAvailability === 'IN_STOCK') isAvailableFromStatus = true;
    else if (resolvedAvailability === 'OUT_OF_STOCK') isAvailableFromStatus = false;

    return {
        id: asText(value?.id || value?.productId),
        item_id: resolvedItemId,
        listing_id: asText(value?.listingId),
        title: asText(value?.titles?.title || value?.titles?.newTitle || value?.title),
        brand: asText(value?.productBrand || value?.brand || value?.titles?.superTitle || fallbackBrand),
        category: asText(value?.analyticsData?.vertical || value?.vertical || value?.category),
        price: salePrice,
        price_text: formatInr(salePrice),
        original_price: originalPrice,
        original_price_text: formatInr(originalPrice),
        discount_percent: discountPercent,
        discount_amount: discountAmount,
        discount_text: buildDiscountText(discountPercent),
        rating: toNumber(value?.rating?.average || value?.rating?.value),
        rating_count: toNumber(value?.rating?.count || value?.ratingCount),
        review_count: toNumber(value?.rating?.reviewCount || value?.reviewCount),
        rating_breakdown: buildRatingBreakdown(value?.rating?.breakup || value?.ratingBreakdown),
        specifications: specs,
        key_specs: asTextArray(value?.keySpecs),
        warranty_summary: asText(value?.warrantySummary),
        availability_status: resolvedAvailability,
        is_available: isAvailableFromStatus ?? toBoolean(value?.availability?.isAvailable),
        buyability_intent: buyabilityIntent,
        is_flipkart_advantage: toBoolean(value?.flags?.enableFlipkartAdvantage),
        swatch_available: toBoolean(value?.flags?.swatchAvailableOnBrowsePage),
        currency,
        analytics_category: asText(value?.analyticsData?.category),
        analytics_sub_category: asText(value?.analyticsData?.subCategory),
        market_place: marketPlace,
        image_url: sanitizeImageUrl(value?.media?.images?.[0]?.url || value?.imageUrl),
        url: resolvedUrl,
        fetched_at: new Date().toISOString(),
    };
};

const fetchHtml = async (url, proxyConfiguration, options = {}) =>
    requestWithRetry(
        async () => {
            const {
                minDelayMs = 20,
                maxDelayMs = 90,
                timeoutMs = 20000,
            } = options;

            await sleep(minDelayMs + Math.random() * Math.max(0, maxDelayMs - minDelayMs));

            const response = await gotScraping({
                url,
                headers: getStealthHeaders(),
                responseType: 'text',
                proxyUrl: await pickProxyUrl(proxyConfiguration),
                timeout: { request: timeoutMs },
                throwHttpErrors: false,
                followRedirect: true,
                retry: { limit: 0 },
            });

            if (response.statusCode >= 400) {
                throw new Error(`HTTP ${response.statusCode} for ${url}`);
            }

            const html = response.body || '';
            if (!html || html.length < 800) {
                throw new Error(`Unexpectedly short response for ${url}`);
            }

            if (isLikelyBlocked(html)) {
                throw new Error(`Likely blocked page content for ${url}`);
            }

            return html;
        },
        `Fetch ${url}`,
        options.maxRetries ?? 2
    );

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};
    const {
        startUrl = 'https://www.flipkart.com/computers/computer-components/monitors/pr?sid=6bo,g0i,9no&marketplace=FLIPKART',
        results_wanted: resultsWantedRaw = 20,
        proxyConfiguration,
    } = input;

    const resultsWanted = Number.isFinite(+resultsWantedRaw) ? Math.max(1, +resultsWantedRaw) : 20;
    const productsPerPageEstimate = 40;
    const maxPages = Math.ceil(resultsWanted / productsPerPageEstimate) + 6;
    const batchSize = 40;
    const maxRuntimeMs = 4 * 60 * 1000;

    const proxyConf = proxyConfiguration
        ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
        : undefined;

    log.info('Starting Flipkart Product Scraper (listing API/state only)');
    log.info(`Target URL: ${startUrl}`);
    log.info(`Requested products: ${resultsWanted}`);
    log.info('Mode: fast listing only (no product detail page visits)');

    const seenIds = new Set();
    const seenUrls = new Set();
    const pendingProducts = [];

    const startTime = Date.now();
    let totalPushed = 0;
    let consecutiveEmptyPages = 0;

    const stats = {
        pagesProcessed: 0,
        listingProductsSeen: 0,
        productsExtracted: 0,
        duplicateProducts: 0,
        errors: 0,
    };

    const pushBatch = async (force = false) => {
        if (pendingProducts.length >= batchSize || (force && pendingProducts.length > 0)) {
            const batch = pendingProducts.splice(0, batchSize);
            await Dataset.pushData(batch);
            totalPushed += batch.length;
            log.info(`Pushed batch of ${batch.length} products (total ${totalPushed})`);
        }
    };

    for (let page = 1; page <= maxPages && (totalPushed + pendingProducts.length) < resultsWanted; page += 1) {
        if (Date.now() - startTime > maxRuntimeMs) {
            log.info(`Stopping near timeout with ${totalPushed + pendingProducts.length} products prepared`);
            break;
        }

        const pageUrl = buildPageUrl(startUrl, page);
        log.info(`Fetching listing page ${page}: ${pageUrl}`);

        let listingHtml;
        try {
            listingHtml = await fetchHtml(pageUrl, proxyConf, {
                minDelayMs: 20,
                maxDelayMs: 90,
                timeoutMs: 20000,
                maxRetries: 2,
            });
            stats.pagesProcessed += 1;
        } catch (error) {
            stats.errors += 1;
            log.error(`Failed to fetch listing page ${page}: ${error.message}`);
            if (page === 1) throw new Error(`Failed to fetch first page: ${error.message}`);
            continue;
        }

        const listingState = parseInitialStateFromHtml(listingHtml);
        const stateProducts = listingState ? findStateListingProducts(listingState) : [];
        log.info(`Found ${stateProducts.length} products in listing state on page ${page}`);

        if (stateProducts.length === 0) {
            consecutiveEmptyPages += 1;
            const debugTitle = listingHtml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || 'unknown';
            log.warning(`No listing products found in state JSON. Title: ${debugTitle}`);
            if (page === 1) {
                await Actor.setValue('debug-listing-html', listingHtml, { contentType: 'text/html' });
            }
            if (consecutiveEmptyPages >= 2) break;
            continue;
        }

        consecutiveEmptyPages = 0;

        let pageUnique = 0;
        for (const stateProduct of stateProducts) {
            if ((totalPushed + pendingProducts.length) >= resultsWanted) break;

            const mapped = mapListingProduct(stateProduct);
            stats.listingProductsSeen += 1;

            if (!mapped.id && !mapped.url && !mapped.listing_id) continue;

            if (mapped.id && seenIds.has(mapped.id)) {
                stats.duplicateProducts += 1;
                continue;
            }

            if (mapped.url && seenUrls.has(mapped.url)) {
                stats.duplicateProducts += 1;
                continue;
            }

            if (mapped.id) seenIds.add(mapped.id);
            if (mapped.url) seenUrls.add(mapped.url);

            pendingProducts.push(mapped);
            pageUnique += 1;
            stats.productsExtracted += 1;

            await pushBatch();
        }

        const prepared = totalPushed + pendingProducts.length;
        log.info(`Page ${page} complete. Added ${pageUnique} unique products. Prepared ${prepared}/${resultsWanted}`);

        if (prepared >= resultsWanted) break;

        if (pageUnique === 0) {
            consecutiveEmptyPages += 1;
            if (consecutiveEmptyPages >= 2) break;
        }

        await sleep(25 + Math.random() * 80);
    }

    await pushBatch(true);

    const runtimeSec = (Date.now() - startTime) / 1000;
    const totalProducts = totalPushed;

    log.info('='.repeat(60));
    log.info('FLIPKART SCRAPER STATISTICS');
    log.info('='.repeat(60));
    log.info(`Products extracted: ${totalProducts}/${resultsWanted}`);
    log.info(`Pages processed: ${stats.pagesProcessed}`);
    log.info(`Listing products seen: ${stats.listingProductsSeen}`);
    log.info(`Duplicates skipped: ${stats.duplicateProducts}`);
    log.info(`Errors: ${stats.errors}`);
    log.info(`Runtime: ${runtimeSec.toFixed(2)}s`);
    log.info(`Speed: ${(totalProducts / Math.max(runtimeSec, 1)).toFixed(2)} products/sec`);
    log.info('='.repeat(60));

    if (totalProducts === 0) {
        const errorMsg = 'No products extracted from listing API state. Check URL, proxy, or page accessibility.';
        log.error(errorMsg);
        await Actor.fail(errorMsg);
    } else {
        await Actor.setValue('OUTPUT_SUMMARY', {
            productsExtracted: totalProducts,
            pagesProcessed: stats.pagesProcessed,
            listingProductsSeen: stats.listingProductsSeen,
            duplicateProducts: stats.duplicateProducts,
            runtime: runtimeSec,
            success: true,
        });
    }
} catch (error) {
    log.error(`CRITICAL ERROR: ${error.message}`);
    log.exception(error, 'Actor failed with exception');
    await Actor.fail(`Actor failed: ${error.message}`);
} finally {
    await Actor.exit();
}

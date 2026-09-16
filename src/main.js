// Flipkart Product Scraper - listing state extraction with failure diagnostics
import { readFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { Impit } from 'impit';
import { CookieJar } from 'tough-cookie';

const DISCOVERY_FILE = 'API_DISCOVERY.md';
const DEFAULT_SEARCH_URL = 'https://www.flipkart.com/search';
const DEFAULT_RESULTS_WANTED = 20;
const BLOCK_TITLE_PATTERNS = ['access denied', 'captcha', 'flipkart recaptcha', 'robot check', 'unusual activity'];
const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

const getErrorStatusCode = (error) =>
    error.statusCode ?? error.response?.statusCode ?? error.summary?.statusCode ?? null;

const isRetryableFailure = (error) => {
    const statusCode = getErrorStatusCode(error);
    if (statusCode === null) return true;
    if ([408, 425, 429].includes(statusCode)) return true;
    return statusCode >= 500 && statusCode <= 599;
};

const requestWithRetry = async (fn, context, maxRetries = 3) => {
    let attempt = 0;
    let lastError;

    while (attempt < maxRetries) {
        attempt += 1;
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const statusCode = getErrorStatusCode(error);

            if (!isRetryableFailure(error) || statusCode === 404) throw error;

            log.warning(`${context} failed (attempt ${attempt}/${maxRetries}): ${error.message}`);

            if (attempt < maxRetries) {
                const delayMs = (2 ** attempt) * 400 + Math.random() * 700;
                await sleep(delayMs);
            }
        }
    }

    throw lastError;
};

const normalizeFlipkartUrl = (rawUrl) => {
    const url = new URL(rawUrl.trim());
    url.hash = '';
    if (!url.protocol.startsWith('http')) url.protocol = 'https:';
    url.searchParams.delete('otracker');
    url.searchParams.delete('otracker1');
    url.searchParams.delete('marketplace');
    if (!url.pathname.startsWith('/search')) url.searchParams.set('marketplace', 'FLIPKART');
    return url;
};

const toComparableNumber = (value) => {
    const number = Number(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(number) ? number : null;
};

const sortMappedProducts = (products, sort) => {
    if (!['price_asc', 'price_desc'].includes(sort)) return products;

    return [...products].sort((left, right) => {
        const leftPrice = toComparableNumber(left.price);
        const rightPrice = toComparableNumber(right.price);
        if (leftPrice === null && rightPrice === null) return 0;
        if (leftPrice === null) return 1;
        if (rightPrice === null) return -1;
        return sort === 'price_asc' ? leftPrice - rightPrice : rightPrice - leftPrice;
    });
};

const buildInputUrl = (rawUrl, { keyword, sort } = {}) => {
    const url = new URL(rawUrl.trim());
    const trimmedKeyword = typeof keyword === 'string' ? keyword.trim() : '';

    if (trimmedKeyword) {
        const preservedParams = [...url.searchParams.entries()]
            .filter(([key]) => !['q', 'sid', 'marketplace', 'page', 'otracker', 'otracker1'].includes(key));
        url.pathname = '/search';
        url.search = '';
        url.searchParams.set('q', trimmedKeyword);
        if (sort && sort !== 'relevance') url.searchParams.set('sort', String(sort));
        url.searchParams.set('otracker', 'search');
        for (const [key, value] of preservedParams) url.searchParams.append(key, value);
    } else if (sort === 'relevance') {
        url.searchParams.delete('sort');
    } else if (sort) {
        url.searchParams.set('sort', String(sort));
    }

    return url.href;
};

const getUrlType = (rawUrl) => {
    try {
        const url = new URL(rawUrl);
        if (url.pathname.startsWith('/search')) return 'search';
        if (url.pathname.includes('/brand/')) return 'brand';
        if (url.searchParams.has('sid')) return 'category';
        if (url.pathname.includes('/tag/')) return 'tag';
        if (/\/pr\/?$/i.test(url.pathname)) return 'listing';
        return 'listing';
    } catch {
        return 'listing';
    }
};

const buildPageUrl = (baseUrl, page) => {
    const url = normalizeFlipkartUrl(baseUrl);
    if (page > 1) url.searchParams.set('page', String(page));
    else url.searchParams.delete('page');
    return url.href;
};

const buildFallbackUrls = (rawUrl) => [normalizeFlipkartUrl(rawUrl).href];

const getPaginationBaseUrl = (rawUrl) => {
    const url = normalizeFlipkartUrl(rawUrl);
    url.searchParams.delete('page');
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

const normalizeProductUrlForKey = (rawUrl) => {
    const absolute = ensureAbsoluteUrl(rawUrl);
    if (!absolute) return null;

    try {
        const url = new URL(absolute);
        const preservedParams = ['pid', 'lid', 'marketplace'];
        const nextParams = new URLSearchParams();
        for (const key of preservedParams) {
            const value = url.searchParams.get(key);
            if (value) nextParams.set(key, value);
        }
        url.search = nextParams.toString();
        url.hash = '';
        return url.href;
    } catch {
        return absolute;
    }
};

const buildStableProductKey = (item) =>
    item.listing_id
    || item.item_id
    || normalizeProductUrlForKey(item.url)
    || item.id
    || null;

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

const parseJsonLdFromHtml = (html) => {
    const matches = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
    const payloads = [];

    for (const match of matches) {
        try {
            payloads.push(JSON.parse(match[1]));
        } catch (error) {
            log.warning(`Failed to parse JSON-LD payload: ${error.message}`);
        }
    }

    return payloads;
};

const isLikelyBlocked = (html = '') => {
    const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim().toLowerCase() || '';
    return BLOCK_TITLE_PATTERNS.some((pattern) => title.includes(pattern));
};

const summarizeHtml = (html, url, response) => ({
    url,
    finalUrl: response?.url || url,
    statusCode: response?.status ?? null,
    bodyLength: html.length,
    title: html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() || null,
    hasInitialState: html.includes('window.__INITIAL_STATE__'),
    hasNextData: html.includes('__NEXT_DATA__'),
    jsonLdCount: (html.match(/application\/ld\+json/gi) || []).length,
    blocked: isLikelyBlocked(html),
});

const extractNextPageUrlFromHtml = (html, currentUrl) => {
    const patterns = [
        /"nextUrl":"([^"]+)"/i,
        /<link[^>]+rel="next"[^>]+href="([^"]+)"/i,
        /<a[^>]+href="([^"]*?[?&]page=\d+[^"]*)"[^>]*>\s*Next/i,
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (!match?.[1]) continue;
        const normalized = match[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
        try {
            return new URL(normalized, currentUrl || 'https://www.flipkart.com').href;
        } catch {
            continue;
        }
    }

    return null;
};

const getSidSignature = (rawUrl) => {
    try {
        const url = new URL(rawUrl, 'https://www.flipkart.com');
        return url.searchParams.get('sid');
    } catch {
        return null;
    }
};

const extractStablePaginationBaseUrl = (html, currentUrl) => {
    const currentSid = getSidSignature(currentUrl);
    const matches = [
        ...html.matchAll(/href="([^"]*\/pr\?sid=[^"]*page=\d+[^"]*)"/g),
        ...html.matchAll(/(\/[^"'\\s<]*~cs-[^"'\\s<]*\/pr\?sid=[^"'\\s<]*page=\d+[^"'\\s<]*)/g),
    ].map((match) => match[1].replace(/&amp;/g, '&').replace(/\\u0026/g, '&'));

    const candidates = [...new Set(matches)]
        .map((candidate) => ensureAbsoluteUrl(candidate))
        .filter(Boolean)
        .filter((candidate) => !currentSid || getSidSignature(candidate) === currentSid)
        .sort((a, b) => {
            const aOsp = a.includes('/osp/');
            const bOsp = b.includes('/osp/');
            if (aOsp !== bOsp) return Number(aOsp) - Number(bOsp);
            return a.length - b.length;
        });

    const best = candidates[0];
    if (!best) return null;

    try {
        const url = new URL(best);
        url.searchParams.delete('page');
        return url.href;
    } catch {
        return best;
    }
};

const IMPIT_OPTIONS = {
    browser: 'firefox144',
    http3: false,
    followRedirects: true,
    ignoreTlsErrors: true,
    maxRedirects: 5,
};

const createImpit = (proxyUrl) => new Impit({
    ...IMPIT_OPTIONS,
    cookieJar: new CookieJar(),
    ...(proxyUrl ? { proxyUrl } : {}),
});

const createTransportStrategies = async (proxyConfiguration) => {
    const direct = { id: 'direct', client: createImpit() };
    if (!proxyConfiguration) return [direct];

    const proxyUrl = await proxyConfiguration.newUrl();
    return [
        { id: 'proxy', client: createImpit(proxyUrl) },
        direct,
    ];
};

const orderTransportStrategies = (transports, preferredTransportId) => {
    if (!preferredTransportId) return transports;
    return [
        ...transports.filter(({ id }) => id === preferredTransportId),
        ...transports.filter(({ id }) => id !== preferredTransportId),
    ];
};

const getPageDataBuckets = (state) => {
    const pageData = state?.pageDataV4?.page?.data;
    if (!pageData || typeof pageData !== 'object') return [];

    return Object.entries(pageData)
        .filter(([, value]) => Array.isArray(value))
        .map(([bucketKey, entries]) => ({ bucketKey, entries }));
};

const pickPrimaryListingBucket = (state) => {
    const buckets = getPageDataBuckets(state);
    const candidates = buckets.map(({ bucketKey, entries }) => {
        const productWidgets = entries.filter((entry) => Array.isArray(entry?.widget?.data?.products));
        const productCount = productWidgets.reduce((sum, entry) => sum + entry.widget.data.products.length, 0);
        const pagerEntry = entries.find((entry) =>
            entry?.widget?.data?.navigationPages
            || entry?.widget?.data?.totalPages
            || entry?.widget?.data?.currentPage
        );

        return {
            bucketKey,
            entries,
            productWidgets,
            productCount,
            pagerEntry,
            hasPager: Boolean(pagerEntry),
        };
    }).filter((candidate) => candidate.productWidgets.length > 0);

    candidates.sort((a, b) => {
        if (a.hasPager !== b.hasPager) return Number(b.hasPager) - Number(a.hasPager);
        return b.productCount - a.productCount;
    });

    return candidates[0] || null;
};

const getPaginationState = (state, html, currentUrl) => {
    const primaryBucket = pickPrimaryListingBucket(state);
    const pagerData = primaryBucket?.pagerEntry?.widget?.data || {};
    const browseMetadata = state?.browseMetadata || {};
    const pageData = state?.pageDataV4?.page?.pageData || {};
    const currentPage = toNumber(pagerData.currentPage) ?? toNumber(state?.pageDataV4?.page?.pageNumber) ?? 1;
    const navigationPages = Array.isArray(pagerData.navigationPages) ? pagerData.navigationPages : [];
    const nextNavigation = navigationPages.find((entry) => toNumber(entry?.number) === currentPage + 1);
    const nextFromPager = nextNavigation?.param
        ? (() => {
            try {
                const nextUrl = new URL(currentUrl || 'https://www.flipkart.com');
                const paramUrl = new URLSearchParams(nextNavigation.param);
                for (const [key, value] of paramUrl.entries()) {
                    nextUrl.searchParams.set(key, value);
                }
                return nextUrl.href;
            } catch {
                return null;
            }
        })()
        : null;
    const nextUrl = ensureAbsoluteUrl(browseMetadata?.seoPagination?.nextUrl)
        || nextFromPager
        || extractNextPageUrlFromHtml(html || '', currentUrl);

    return {
        currentPage,
        totalPages: toNumber(pagerData.totalPages),
        totalProducts: toNumber(browseMetadata.totalProducts)
            ?? toNumber(state?.pageDataV4?.page?.data?.['10004']?.[0]?.widget?.data?.totalProducts)
            ?? toNumber(pageData?.pageContext?.productCount),
        nextUrl,
        hasMorePages: pageData?.hasMorePages === true,
        isInfinitePage: pageData?.infinitePage === true,
        primaryBucketKey: primaryBucket?.bucketKey || null,
        primaryWidgetCount: primaryBucket?.productWidgets?.length || 0,
    };
};

const readApiDiscovery = async () => {
    try {
        const content = await readFile(new URL(`../${DISCOVERY_FILE}`, import.meta.url), 'utf8');
        const selectedApiLine = content.split('\n').find((line) => line.startsWith('- Endpoint:')) || null;
    return {
            available: true,
            path: DISCOVERY_FILE,
            selectedApiLine,
        };
    } catch (error) {
        return {
            available: false,
            path: DISCOVERY_FILE,
            error: error.message,
        };
    }
};

const readLocalInputFallback = async () => {
    try {
        const content = await readFile(new URL('../INPUT.json', import.meta.url), 'utf8');
        const parsed = JSON.parse(content);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const fetchHtmlWithProfile = async (url, transport, options = {}) =>
    requestWithRetry(
        async () => {
            const {
                timeoutMs = 20000,
            } = options;

            const signal = AbortSignal.timeout(timeoutMs + 5000);
            const response = await transport.client.fetch(url, {
                timeout: timeoutMs,
                signal,
            });

            const html = await response.text();
            const summary = summarizeHtml(html, url, response);

            if (response.status >= 400) {
                const error = new Error(`HTTP ${response.status} for ${url}`);
                error.statusCode = response.status;
                error.summary = summary;
                throw error;
            }

            if (!html || html.length < 800) {
                const error = new Error(`Unexpectedly short response for ${url}`);
                error.summary = summary;
                throw error;
            }

            if (summary.blocked) {
                const error = new Error(`Likely blocked page content for ${url}`);
                error.statusCode = response.status;
                error.summary = summary;
                throw error;
            }

            return { html, response, summary };
        },
        'Fetch page',
        options.maxRetries ?? 2
    );

const fetchListingHtml = async (rawUrl, transports, preferredTransportId, options = {}) => {
    const candidates = buildFallbackUrls(rawUrl);
    const failures = [];
    const strategies = orderTransportStrategies(transports, preferredTransportId);

    for (const url of candidates) {
        for (const strategy of strategies) {
            try {
                const result = await fetchHtmlWithProfile(url, strategy, options);
                if (failures.length > 0) log.debug(`Recovered using ${strategy.id} transport.`);
                return {
                    ...result,
                    failures,
                    transportId: strategy.id,
                };
            } catch (error) {
                failures.push({
                    transportId: strategy.id,
                    url,
                    message: error.message,
                    summary: error.summary || null,
                });
            }
        }
    }

    const finalError = new Error(`All fetch strategies failed for ${rawUrl}`);
    finalError.failures = failures;
    throw finalError;
};

const findRecursiveListingProducts = (state) => {
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

        if (node.productInfo?.value?.id || node.productInfo?.action?.url) {
            products.push(node);
        }

        for (const value of Object.values(node)) {
            walk(value);
        }
    };

    walk(state);
    return products;
};

const findStateListingProducts = (state) => {
    const primaryBucket = pickPrimaryListingBucket(state);
    if (primaryBucket) {
        return primaryBucket.productWidgets.flatMap((entry) => entry.widget.data.products || []);
    }

    return findRecursiveListingProducts(state);
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

const extractProductsFromJsonLd = (payloads) => {
    const products = [];

    for (const payload of payloads) {
        const items = Array.isArray(payload?.itemListElement) ? payload.itemListElement : [];
        for (const item of items) {
            const product = item?.item;
            if (!product) continue;
            products.push({
                id: asText(product['@id']) || asText(product.sku),
                item_id: asText(product.sku),
                listing_id: null,
                title: asText(product.name),
                brand: asText(product.brand?.name || product.brand),
                category: null,
                price: toNumber(product.offers?.price),
                price_text: formatInr(toNumber(product.offers?.price)),
                original_price: null,
                original_price_text: null,
                discount_percent: null,
                discount_amount: null,
                discount_text: null,
                rating: toNumber(product.aggregateRating?.ratingValue),
                rating_count: toNumber(product.aggregateRating?.ratingCount),
                review_count: toNumber(product.aggregateRating?.reviewCount),
                rating_breakdown: null,
                specifications: null,
                key_specs: null,
                warranty_summary: null,
                availability_status: normalizeAvailability(product.offers?.availability),
                is_available: null,
                buyability_intent: null,
                is_flipkart_advantage: null,
                swatch_available: null,
                currency: asText(product.offers?.priceCurrency) || 'INR',
                analytics_category: null,
                analytics_sub_category: null,
                market_place: 'FLIPKART',
                image_url: sanitizeImageUrl(Array.isArray(product.image) ? product.image[0] : product.image),
                url: ensureAbsoluteUrl(product.url),
                fetched_at: new Date().toISOString(),
            });
        }
    }

    return products;
};

const dedupeProducts = (items) => {
    const seen = new Set();
    const unique = [];

    for (const item of items) {
        const key = buildStableProductKey(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
    }

    return unique;
};

const diagnoseListingFailure = async ({
    discoveryInfo,
    rawUrl,
    transports,
    preferredTransportId,
    error,
    page,
}) => {
    const diagnostics = {
        at: new Date().toISOString(),
        page,
        rawUrl,
        discoveryInfo,
        errorMessage: error.message,
        fetchFailures: error.failures || [],
        probes: [],
    };

    if (discoveryInfo.available) {
        log.info('Running API-backed diagnostics.');
    } else {
        log.warning('Running fallback diagnostics without discovery context.');
    }

    for (const candidateUrl of buildFallbackUrls(rawUrl)) {
        for (const strategy of orderTransportStrategies(transports, preferredTransportId)) {
            try {
                const signal = AbortSignal.timeout(20000);
                const response = await strategy.client.fetch(candidateUrl, {
                    timeout: 15000,
                    signal,
                });
                const html = await response.text();
                diagnostics.probes.push({
                    transportId: strategy.id,
                    ...summarizeHtml(html, candidateUrl, response),
                });
            } catch (probeError) {
                diagnostics.probes.push({
                    transportId: strategy.id,
                    url: candidateUrl,
                    error: probeError.message,
                });
            }
        }
    }

    await Actor.setValue('LATEST_FAILURE_DIAGNOSTICS', diagnostics);
    const firstSuccessLike = diagnostics.probes.find((probe) => probe.hasInitialState || probe.jsonLdCount);
    if (firstSuccessLike) {
        log.warning(`Diagnostics found recoverable content via ${firstSuccessLike.transportId}.`);
    }

    return diagnostics;
};

await Actor.init();

try {
    const actorInput = (await Actor.getInput()) || {};
    const input = Object.keys(actorInput).length > 0 ? actorInput : await readLocalInputFallback();
    const {
        startUrl,
        keyword,
        sort,
        results_wanted: resultsWantedRaw = DEFAULT_RESULTS_WANTED,
        proxyConfiguration,
    } = input;

    const hasStartUrl = typeof startUrl === 'string' && startUrl.trim().length > 0;
    const hasKeyword = typeof keyword === 'string' && keyword.trim().length > 0;
    if (!hasStartUrl && !hasKeyword) {
        throw new Error('Provide either startUrl or keyword to select one Flipkart search source.');
    }

    const resultsWanted = Number.isFinite(+resultsWantedRaw) ? Math.max(1, +resultsWantedRaw) : DEFAULT_RESULTS_WANTED;
    const productsPerPageEstimate = 40;
    const maxPages = Math.ceil(resultsWanted / productsPerPageEstimate) + 6;
    const batchSize = 40;
    const maxRuntimeMs = 4 * 60 * 1000;

    const shouldUseProxy = proxyConfiguration?.useApifyProxy === true || Array.isArray(proxyConfiguration?.proxyUrls);
    const proxyConf = shouldUseProxy
        ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
        : undefined;
    const transports = await createTransportStrategies(proxyConf);

    const sourceUrl = hasStartUrl ? startUrl.trim() : DEFAULT_SEARCH_URL;
    const targetUrl = buildInputUrl(sourceUrl, { keyword, sort });
    const discoveryInfo = await readApiDiscovery();
    const inputUrlType = getUrlType(targetUrl);

    log.info('Starting Flipkart Product Scraper (listing state only)');
    log.info(`Input type: ${inputUrlType}`);
    log.info(`Requested products: ${resultsWanted}`);
    if (hasKeyword) log.info(`Keyword search enabled: ${keyword.trim()}`);
    if (hasStartUrl && hasKeyword) log.info('Keyword takes priority over startUrl; running one search source.');
    if (sort) log.info(`Sort: ${sort}`);
    log.info(`Transport preference: ${proxyConf ? 'proxy-first with direct fallback' : 'direct'}`);

    const seenProductKeys = new Set();
    const pendingProducts = [];
    let paginationBaseUrl = getPaginationBaseUrl(targetUrl);
    let nextPageUrl = paginationBaseUrl;
    let preferStablePageParamPagination = false;
    let preferredTransportId = transports[0].id;

    const startTime = Date.now();
    let totalPushed = 0;
    let consecutiveEmptyPages = 0;

    const stats = {
        pagesProcessed: 0,
        listingProductsSeen: 0,
        productsExtracted: 0,
        duplicateProducts: 0,
        duplicateProductsAcrossPages: 0,
        errors: 0,
        diagnosticsTriggered: 0,
    };
    let consecutiveNoGrowthPages = 0;

    const pushBatch = async (force = false) => {
        if (pendingProducts.length >= batchSize || (force && pendingProducts.length > 0)) {
            const batch = pendingProducts.splice(0, batchSize);
            await Actor.pushData(batch);
            totalPushed += batch.length;
            log.debug(`Pushed batch of ${batch.length} products (total ${totalPushed})`);
        }
    };

    for (let page = 1; page <= maxPages && (totalPushed + pendingProducts.length) < resultsWanted; page += 1) {
        if (Date.now() - startTime > maxRuntimeMs) {
            log.info(`Stopping near timeout with ${totalPushed + pendingProducts.length} products prepared`);
            break;
        }

        const pageUrl = nextPageUrl || buildPageUrl(paginationBaseUrl, page);
        log.debug(`Fetching page ${page}`);

        let listingHtml;
        let requestSummary;
        let responseUrl;
        try {
            const fetchResult = await fetchListingHtml(pageUrl, transports, preferredTransportId, {
                timeoutMs: 20000,
                maxRetries: 2,
            });
            listingHtml = fetchResult.html;
            requestSummary = fetchResult.summary;
            responseUrl = fetchResult.response.url || pageUrl;
            paginationBaseUrl = getPaginationBaseUrl(fetchResult.response.url || pageUrl);
            preferredTransportId = fetchResult.transportId;
            stats.pagesProcessed += 1;
            log.debug(`Fetched page ${page} with ${fetchResult.transportId} (${requestSummary.statusCode})`);
        } catch (error) {
            stats.errors += 1;
            stats.diagnosticsTriggered += 1;
            log.error(`Failed to fetch listing page ${page}: ${error.message}`);
            await diagnoseListingFailure({
                discoveryInfo,
                rawUrl: pageUrl,
                transports,
                preferredTransportId,
                error,
                page,
            });
            if (page === 1) throw new Error(`Failed to fetch first page: ${error.message}`);
            continue;
        }

        const listingState = parseInitialStateFromHtml(listingHtml);
        const stateProducts = listingState ? findStateListingProducts(listingState) : [];
        const jsonLdProducts = stateProducts.length === 0 ? extractProductsFromJsonLd(parseJsonLdFromHtml(listingHtml)) : [];
        const paginationState = listingState ? getPaginationState(listingState, listingHtml, responseUrl || pageUrl) : null;

        if (page === 1) {
            const stablePaginationBaseUrl = extractStablePaginationBaseUrl(listingHtml, responseUrl || pageUrl);
            if (stablePaginationBaseUrl && stablePaginationBaseUrl !== paginationBaseUrl) {
                paginationBaseUrl = stablePaginationBaseUrl;
                nextPageUrl = buildPageUrl(paginationBaseUrl, 2);
                preferStablePageParamPagination = true;
                log.info('Using canonical pagination base discovered from page links.');
            } else if ((responseUrl || pageUrl).includes('/osp/')) {
                preferStablePageParamPagination = true;
            }
        }

        log.debug(`Found ${stateProducts.length} products in listing state on page ${page}`);
        if (paginationState?.totalProducts && page === 1) {
            log.info(`Catalog reports ${paginationState.totalProducts} products across ${paginationState.totalPages || '?'} pages.`);
        }
        if (jsonLdProducts.length > 0) {
            log.info(`JSON-LD fallback exposed ${jsonLdProducts.length} products on page ${page}`);
        }

        if (stateProducts.length === 0 && jsonLdProducts.length === 0) {
            consecutiveEmptyPages += 1;
            stats.diagnosticsTriggered += 1;
            log.warning(`No listing products found on page ${page}. Triggering diagnostics.`);
            await diagnoseListingFailure({
                discoveryInfo,
                rawUrl: pageUrl,
                transports,
                preferredTransportId,
                error: new Error('No listing products found in state or JSON-LD'),
                page,
            });
            if (page === 1) {
                await Actor.setValue('debug-listing-html', listingHtml, { contentType: 'text/html' });
            }
            if (consecutiveEmptyPages >= 2) break;
            continue;
        }

        consecutiveEmptyPages = 0;

        const candidateProducts = dedupeProducts([
            ...stateProducts.map((product) => mapListingProduct(product)),
            ...jsonLdProducts,
        ]);
        const mappedProducts = sortMappedProducts(candidateProducts, sort);

        let pageUnique = 0;
        for (const mapped of mappedProducts) {
            if ((totalPushed + pendingProducts.length) >= resultsWanted) break;

            stats.listingProductsSeen += 1;

            if (!mapped.id && !mapped.url && !mapped.listing_id) continue;

            const stableKey = buildStableProductKey(mapped);
            if (!stableKey) continue;

            if (seenProductKeys.has(stableKey)) {
                stats.duplicateProducts += 1;
                stats.duplicateProductsAcrossPages += 1;
                continue;
            }

            seenProductKeys.add(stableKey);

            pendingProducts.push(mapped);
            pageUnique += 1;
            stats.productsExtracted += 1;

            await pushBatch();
        }

        const prepared = totalPushed + pendingProducts.length;
        log.debug(`Page ${page} complete. Added ${pageUnique} unique products. Prepared ${prepared}/${resultsWanted}`);

        const nextUrlDriftsStore = paginationState?.nextUrl
            && getSidSignature(paginationState.nextUrl)
            && getSidSignature(paginationBaseUrl)
            && getSidSignature(paginationState.nextUrl) !== getSidSignature(paginationBaseUrl);

        if (!preferStablePageParamPagination && paginationState?.nextUrl && !nextUrlDriftsStore) {
            nextPageUrl = paginationState.nextUrl;
        } else if (paginationState?.hasMorePages === false) {
            nextPageUrl = null;
        } else {
            nextPageUrl = buildPageUrl(paginationBaseUrl, page + 1);
        }

        if (pageUnique === 0) consecutiveNoGrowthPages += 1;
        else consecutiveNoGrowthPages = 0;

        if (prepared >= resultsWanted) break;
        if (!nextPageUrl) {
            log.info('Stopping because the page does not expose a next pagination URL.');
            break;
        }

        const noGrowthStopThreshold = paginationState?.totalPages && paginationState.totalPages > 6 ? 4 : 2;

        if (pageUnique === 0) {
            consecutiveEmptyPages += 1;
            if (consecutiveEmptyPages >= noGrowthStopThreshold || consecutiveNoGrowthPages >= noGrowthStopThreshold) {
                log.info('Stopping because pagination is repeating previously captured listings.');
                break;
            }
        } else {
            consecutiveEmptyPages = 0;
        }

    }

    await pushBatch(true);

    const runtimeSec = (Date.now() - startTime) / 1000;
    const totalProducts = totalPushed;

    log.info(`Products extracted: ${totalProducts}/${resultsWanted}`);
    log.info(`Pages processed: ${stats.pagesProcessed}`);
    log.info(`Listing products seen: ${stats.listingProductsSeen}`);
    log.info(`Duplicates skipped: ${stats.duplicateProducts}`);
    log.info(`Runtime: ${runtimeSec.toFixed(2)}s, errors: ${stats.errors}, diagnostics: ${stats.diagnosticsTriggered}`);

    if (totalProducts === 0) {
        const errorMsg = 'No products extracted from listing state. Check URL, proxy, or latest failure diagnostics.';
        log.error(errorMsg);
        await Actor.fail(errorMsg);
    } else {
        await Actor.setValue('OUTPUT_SUMMARY', {
            productsExtracted: totalProducts,
            pagesProcessed: stats.pagesProcessed,
            listingProductsSeen: stats.listingProductsSeen,
            duplicateProducts: stats.duplicateProducts,
            duplicateProductsAcrossPages: stats.duplicateProductsAcrossPages,
            runtime: runtimeSec,
            diagnosticsTriggered: stats.diagnosticsTriggered,
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

/**
 * api.js - Core functionality for fetching data from the CheapShark API
 * CheapShark API Docs: https://apidocs.cheapshark.com/
 */

import * as Currency from './currency.js';
export { Currency };

const BASE_URL = 'https://www.cheapshark.com/api/1.0';
const PROXY_URL = '/.netlify/functions/cheapshark-proxy';

/**
 * A centralized, resilient fetch utility that handles proxy failover,
 * environment detection, and standardized error handling.
 */
async function stableFetch(targetUrl, options = {}, internalProxy = null, useWrapper = false) {
    const attempts = [];
    
    // 1. PROJECT PROXY (Netlify Function) - Primary for Production
    if (internalProxy) {
        attempts.push({ name: 'project-proxy', url: internalProxy, type: 'direct' });
    }

    // 2. DIRECT FETCH - Primary for Local Dev (if lucky) or if CORS is enabled on API
    attempts.push({ name: 'direct', url: targetUrl, type: 'direct' });

    // 3. PUBLIC CORS PROXIES - Fail-safe fallbacks
    attempts.push({ name: 'corsproxy.io', url: `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`, type: 'direct' });
    attempts.push({ name: 'allorigins', url: `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`, type: 'wrapper' });

    for (const attempt of attempts) {
        try {
            console.log(`[API] Attempting ${attempt.name} -> ${attempt.url}`);
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 8000);
            
            const res = await fetch(attempt.url, { ...options, signal: controller.signal });
            clearTimeout(id);

            if (res.ok) {
                if (attempt.type === 'wrapper') {
                    try {
                        const outer = await res.json();
                        if (!outer.contents) throw new Error("Wrapper contents missing");
                        const inner = typeof outer.contents === 'string' ? JSON.parse(outer.contents) : outer.contents;
                        return {
                            ok: true,
                            json: async () => inner,
                            text: async () => typeof outer.contents === 'string' ? outer.contents : JSON.stringify(outer.contents),
                            headers: new Headers()
                        };
                    } catch (e) {
                        console.warn(`[API] ${attempt.name} parse error:`, e.message);
                        continue;
                    }
                }
                return res;
            }
            console.warn(`[API] ${attempt.name} failed with status ${res.status}`);
        } catch (e) {
            console.warn(`[API] ${attempt.name} error:`, e.message);
        }
    }
    throw new Error(`All fetch attempts failed for: ${targetUrl}`);
}

/**
 * Fetch a list of deals based on query parameters.
 * @param {Object} params - Query parameters (e.g., { storeID: 1, upperPrice: 15, sortBy: 'Price' })
 * @returns {Promise<Object>} Object containing deals array and totalPages
 */
export async function fetchDeals(params = {}) {
    try {
        const query = new URLSearchParams(params).toString();
        const targetUrl = `${BASE_URL}/deals?${query}`;
        const internalProxy = `${PROXY_URL}?endpoint=deals&${query}`;

        const res = await stableFetch(targetUrl, {}, internalProxy);
        const deals = await res.json();
        const totalPages = parseInt(res.headers.get('X-Total-Page-Count')) || 1;
        
        return { deals, totalPages };
    } catch (error) {
        console.error("Could not fetch deals:", error);
        return { deals: [], totalPages: 0 };
    }
}

export async function fetchGameDetails(gameId) {
    if (!gameId) return null;
    try {
        const targetUrl = `${BASE_URL}/games?id=${gameId}`;
        const internalProxy = `${PROXY_URL}?endpoint=games&id=${gameId}`;

        const res = await stableFetch(targetUrl, {}, internalProxy);
        return await res.json();
    } catch (error) {
        console.error("Could not fetch game details:", error);
        return null;
    }
}

/**
 * Search for games by title.
 * @param {string} title - The title to search for
 * @returns {Promise<Array>} Array of game objects { gameID, steamAppID, cheapest, cheapestDealID, external }
 */
export async function searchGames(title) {
    if (!title || title.length < 2) return [];

    try {
        const targetUrl = `${BASE_URL}/games?title=${encodeURIComponent(title)}&limit=8`;
        const internalProxy = `${PROXY_URL}?endpoint=games&title=${encodeURIComponent(title)}&limit=8`;

        const res = await stableFetch(targetUrl, {}, internalProxy);
        return await res.json();
    } catch (error) {
        console.error("Search failed:", error);
        return [];
    }
}

/**
 * Fetch the list of active stores to map storeID to store names and logos.
 * Uses sessionStorage to cache the list and prevent redundant API calls.
 * @returns {Promise<Array>} Array of store objects
 */
export async function fetchStores() {
    const cachedStores = sessionStorage.getItem('cheapshark_stores');
    if (cachedStores) return JSON.parse(cachedStores);

    try {
        const targetUrl = `${BASE_URL}/stores`;
        const internalProxy = `${PROXY_URL}?endpoint=stores`;

        const res = await stableFetch(targetUrl, {}, internalProxy);
        const stores = await res.json();
        
        const activeStores = stores.filter(store => store.isActive === 1);
        sessionStorage.setItem('cheapshark_stores', JSON.stringify(activeStores));
        return activeStores;
    } catch (error) {
        console.error("Could not fetch stores:", error);
        return [];
    }
}

/**
 * Helper to get the full URL for a store icon.
 * CheapShark returns relative paths (e.g. "/img/stores/icons/0.png").
 * @param {string} relativePath - The path provided by the API
 * @returns {string} Full URL to the image
 */
export function getStoreIconUrl(relativePath) {
    if (!relativePath) return '';
    return `https://www.cheapshark.com${relativePath}`;
}

export async function fetchDealDetails(dealId) {
    if (!dealId) return null;
    
    try {
        const targetUrl = `${BASE_URL}/deals?id=${encodeURIComponent(dealId)}`;
        const internalProxy = `${PROXY_URL}?endpoint=deals&id=${encodeURIComponent(dealId)}`;

        const res = await stableFetch(targetUrl, {}, internalProxy);
        return await res.json();
    } catch (error) {
        console.error("Could not fetch deal details:", error);
        return null;
    }
}

/**
 * Fetch media (screenshots, trailers) from Steam APIs if a steamAppID is available.
 * Tries multiple CORS proxies in sequence for reliability.
 * @param {string} steamAppID 
 * @param {string} lang The language to fetch description in ('ko' or 'en')
 * @returns {Promise<Object|null>} Steam app details object or null
 */
export async function fetchSteamAppDetails(steamAppID, lang = 'ko') {
    if (!steamAppID) return null;

    const steamLang = lang === 'en' ? 'english' : 'korean';
    const steamUrl = `https://store.steampowered.com/api/appdetails?appids=${steamAppID}&l=${steamLang}`;
    const internalProxy = `/.netlify/functions/steam-details?appids=${steamAppID}&l=${steamLang}`;

    try {
        const res = await stableFetch(steamUrl, {}, internalProxy);
        const data = await res.json();
        
        const appKey = Object.keys(data)[0];
        if (appKey && data[appKey] && data[appKey].success) {
            let steamData = data[appKey].data;
            
            // Force HTTPS for mixed content prevention
            const forceHttps = (obj) => {
                for (let key in obj) {
                    if (typeof obj[key] === 'string' && obj[key].startsWith('http://')) {
                        obj[key] = obj[key].replace('http://', 'https://');
                    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                        forceHttps(obj[key]);
                    }
                }
            };
            forceHttps(steamData);
            return steamData;
        }
    } catch (error) {
        console.error(`Steam details failed for ${steamAppID}:`, error.message);
    }
    return null;
}

export function extractSteamAppIDFromThumb(thumbUrl) {
    if (!thumbUrl) return null;
    // Standard: images.akamai.steamstatic.com/steam/apps/APPID/... 
    // New CDN (Fastly/Cloudflare): shared.fastly.steamstatic.com/store_item_assets/steam/apps/APPID/...
    const match = thumbUrl.match(/\/apps\/(\d+)\//);
    if (match) return match[1];
    
    // Fallback for some other patterns
    const matchAlt = thumbUrl.match(/[\/](\d+)[\/]capsule/);
    return matchAlt ? matchAlt[1] : null;
}

/**
 * Checks whether the given text contains any Korean characters.
 * @param {string} text
 * @returns {boolean}
 */
export function containsKorean(text) {
    if (!text) return false;
    return /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(text);
}

/**
 * Translate plain text from English to Korean using the unofficial Google Translate API.
 * Splits long texts into chunks to stay within URL length limits.
 * Returns original text on failure (graceful degradation).
 * @param {string} text  Plain text (no HTML tags)
 * @returns {Promise<string>}  Translated text, or original on failure
 */
export async function translateToKorean(text) {
    if (!text || containsKorean(text)) return text;

    // Split into manageable chunks (~4000 chars to stay under URL limit)
    const CHUNK_SIZE = 4000;
    const chunks = [];
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
        chunks.push(text.slice(i, i + CHUNK_SIZE));
    }

    try {
        const translatedChunks = await Promise.all(chunks.map(async (chunk) => {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=${encodeURIComponent(chunk)}`;
            const res = await stableFetch(url);
            const data = await res.json();
            return data[0].map(part => part[0]).join('');
        }));
        return translatedChunks.join('');
    } catch (err) {
        console.warn('Auto-translation failed, showing original text:', err.message);
        return text; // Graceful fallback to source language
    }
}
/**
 * Sanitize HTML content to prevent XSS attacks.
 * Uses DOMPurify (should be loaded globally in HTML).
 * @param {string} html 
 * @returns {string} Safe HTML
 */
export function sanitizeHTML(html) {
    if (!html) return '';
    if (typeof DOMPurify !== 'undefined') {
        return DOMPurify.sanitize(html, {
            ALLOWED_TAGS: [
                'p', 'br', 'b', 'i', 'em', 'strong', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'img', 'a',
                'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'blockquote', 'code', 'pre',
                'article', 'header', 'footer', 'button', 'svg', 'path', 'circle', 'line', 'polyline', 'polygon', 'g',
                'video', 'source'
            ],
            ALLOWED_ATTR: [
                'src', 'alt', 'style', 'class', 'href', 'target', 'data-ko', 'data-en', 
                'title', 'onclick', 'width', 'height', 'viewBox', 'fill', 'none', 'stroke', 
                'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'onerror',
                'cx', 'cy', 'r', 'x1', 'x2', 'y1', 'y2', 'points', 'rel',
                'autoplay', 'muted', 'loop', 'playsinline', 'poster', 'type'
            ]
        });
    }
    // Fallback if DOMPurify is not loaded (return original but warned)
    console.warn('DOMPurify is not loaded. Application might be vulnerable to XSS.');
    return html; 
}

/**
 * Validate that a string is a valid ID (numeric or alphanumeric).
 * @param {string} id 
 * @returns {boolean}
 */
export function isValidID(id) {
    if (!id) return false;
    // CheapShark IDs (especially dealIDs) are often base64-encoded, 
    // which can include '+', '/', and '='.
    return /^[a-zA-Z0-9\-_+/=%]+$/.test(id);
}

/**
 * Fetch user reviews for a specific Steam app.
 * @param {string} steamAppID 
 * @param {number} count Number of reviews to fetch (default 20)
 * @returns {Promise<Array|null>} Array of review objects or null
 */
export async function fetchSteamReviews(steamAppID, count = 20) {
    if (!steamAppID) return null;

    const baseUrl = `https://store.steampowered.com/appreviews/${steamAppID}?json=1&language=all&num_per_page=${count}`;
    const internalProxy = `/.netlify/functions/steam-reviews?appid=${steamAppID}&count=${count}`;

    try {
        const res = await stableFetch(baseUrl, {}, internalProxy);
        const data = await res.json();

        if (data && data.success && data.reviews) {
            return data.reviews;
        }
    } catch (error) {
        console.error(`Steam reviews failed for ${steamAppID}:`, error.message);
    }
    return null;
}

/**
 * Set or manage price alerts for a specific game and email.
 * @param {Object} params - { action: 'set'|'delete', email: string, gameID: string, price: number }
 * @returns {Promise<boolean>} Success status
 */
export async function setPriceAlert({ action = 'set', email, gameID, price }) {
    if (!email || !gameID) return false;

    try {
        const query = new URLSearchParams({ action, email, gameID, ...(price && { price }) }).toString();
        const targetUrl = `${BASE_URL}/alerts?${query}`;
        const internalProxy = `${PROXY_URL}?endpoint=alerts&${query}`;

        const res = await stableFetch(targetUrl, {}, internalProxy);
        const result = await res.text();
        return result.trim() === '1' || result.trim() === 'true';
    } catch (error) {
        console.error("Could not set price alert:", error);
        return false;
    }
}
/**
 * Fetch top seller games from Steam and map them to CheapShark deals.
 * Returns the top 10 sellers that have an active deal on CheapShark.
 * @returns {Promise<Array>} Array of deal objects
 */
export async function fetchTopSellers() {
    // 0. Check cache first (5-minute expiry)
    const CACHE_KEY = 'top_sellers_cache';
    const CACHE_TIME_KEY = 'top_sellers_cache_time';
    const CACHE_VERSION = 'v1.3'; // Bump this to force refresh after mapping fix
    const cacheKey = `top_sellers_cache_${CACHE_VERSION}`;
    const cachedData = localStorage.getItem(cacheKey);
    if (cachedData) {
        console.log("Returning cached Top Sellers");
        return JSON.parse(cachedData);
    }
    // Clear old versions
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('top_sellers_cache_') && key !== cacheKey) {
            localStorage.removeItem(key);
        }
    }

    try {
        const steamApiUrl = 'https://store.steampowered.com/api/featuredcategories?l=english';
        const internalProxy = '/.netlify/functions/steam-top-sellers';
        
        let items = [];
        try {
            // Try our custom combined top-sellers function first (Fastest)
            const res = await stableFetch(steamApiUrl, {}, internalProxy);
            const data = await res.json();
            
            // The Netlify function returns { top_sellers: { items: [ { title, salePrice, ... } ] } }
            // Raw Steam API returns { top_sellers: { items: [ { id, name, ... } ] } }
            if (data.top_sellers?.items) {
                const firstItem = data.top_sellers.items[0];
                // Check if it's already mapped (has title or salePrice) or raw Steam (has name or id)
                if (firstItem && (firstItem.title || firstItem.salePrice)) {
                    items = data.top_sellers.items;
                } else {
                    // It's raw Steam data, we need to map it ourselves
                    throw new Error("Raw Steam data received, needs mapping");
                }
            }
        } catch (e) {
            console.log("Using manual mapping for Top Sellers...");
        }

        if (items.length === 0) {
            // Fallback: Fetch from Steam categories and map manually via stableFetch
            const res = await stableFetch(steamApiUrl);
            const data = await res.json();
            
            const combinedIDs = [];
            const seenIDs = new Set();
            ['top_sellers', 'new_releases', 'specials', 'coming_soon'].forEach(cat => {
                if (data[cat] && data[cat].items) {
                    data[cat].items.forEach(item => {
                        if (!seenIDs.has(item.id)) {
                            seenIDs.add(item.id);
                            combinedIDs.push(item.id);
                        }
                    });
                }
            });

            const validDeals = [];
            const seenGameIDs = new Set();
            const BATCH_SIZE = 4;

            for (let i = 0; i < combinedIDs.length; i += BATCH_SIZE) {
                const batch = combinedIDs.slice(i, i + BATCH_SIZE);
                const batchResults = await Promise.all(batch.map(async (appID) => {
                    const rawItem = [].concat(...Object.values(data).map(c => c.items || [])).find(i => i.id === appID);
                    if (!rawItem) return null;

                    try {
                        const { deals } = await fetchDeals({ steamAppID: appID, pageSize: 1, sortBy: 'Price' });
                        if (deals.length > 0) {
                            const deal = deals[0];
                            const clean = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
                            const sTitle = clean(rawItem.name || '');
                            const dTitle = clean(deal.title || '');
                            
                            // To be valid, one must contain a significant part of the other
                            const isMatch = (sTitle && dTitle) && (sTitle.includes(dTitle) || dTitle.includes(sTitle));
                            
                            if (isMatch) {
                                if (!seenGameIDs.has(deal.gameID)) {
                                    seenGameIDs.add(deal.gameID);
                                    return deal;
                                }
                            } else {
                                console.warn(`[Top Sellers] Mismatch for ID ${appID}: Steam Title "${rawItem.name}" vs CheapShark Title "${deal.title}"`);
                            }
                        }
                    } catch (err) {}
                    
                    // Fallback for this specific item: Use raw Steam data if CheapShark failed or mismatched
                    return {
                        title: rawItem.name || `Steam Game #${appID}`,
                        gameID: `steam_${appID}`,
                        salePrice: rawItem.final_price ? (rawItem.final_price / 100).toString() : '0',
                        normalPrice: rawItem.original_price ? (rawItem.original_price / 100).toString() : '0',
                        savings: (rawItem.discount_percent || 0).toString(),
                        thumb: rawItem.large_capsule_image || rawItem.small_capsule_image || '',
                        external: `https://store.steampowered.com/app/${appID}`
                    };
                }));

                validDeals.push(...batchResults.filter(d => d !== null));
                if (validDeals.length >= 10) break; 
            }

            // Ensure savings is calculated if discount_percent is 0 but price is lower (Last resort fix)
            validDeals.forEach(deal => {
                if (deal.savings === '0' && parseFloat(deal.salePrice) < parseFloat(deal.normalPrice)) {
                    const diff = parseFloat(deal.normalPrice) - parseFloat(deal.salePrice);
                    deal.savings = Math.round((diff / parseFloat(deal.normalPrice)) * 100).toString();
                }
            });

            items = validDeals.slice(0, 10).map((deal, idx) => ({ ...deal, rank: idx + 1 }));
        }
        
        // Cache the result
        localStorage.setItem(`top_sellers_cache_${CACHE_VERSION}`, JSON.stringify(items));
        return items;
    } catch (error) {
        console.error("Could not fetch top sellers:", error);
        return [];
    }
}

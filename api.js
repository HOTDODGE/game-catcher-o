/**
 * api.js - Core functionality for fetching data from the CheapShark API
 * CheapShark API Docs: https://apidocs.cheapshark.com/
 */

const BASE_URL = 'https://www.cheapshark.com/api/1.0';
const PROXY_URL = '/.netlify/functions/cheapshark-proxy';

/**
 * Fetch a list of deals based on query parameters.
 * @param {Object} params - Query parameters (e.g., { storeID: 1, upperPrice: 15, sortBy: 'Price' })
 * @returns {Promise<Object>} Object containing deals array and totalPages
 */
export async function fetchDeals(params = {}) {
    try {
        // Prepare URL for Proxy
        const proxyUrl = new URL(window.location.origin + PROXY_URL);
        proxyUrl.searchParams.append('endpoint', 'deals');
        Object.keys(params).forEach(key => proxyUrl.searchParams.append(key, params[key]));

        console.log(`Fetching deals via proxy: ${proxyUrl}`);
        let response = await fetch(proxyUrl);
        
        let deals, totalPages;

        if (response.ok) {
            deals = await response.json();
            totalPages = parseInt(response.headers.get('X-Total-Page-Count')) || 1;
            return { deals, totalPages };
        } 
        
        // If Proxy failed (likely 404 on local or 500 on server), try next methods
        console.warn("CheapShark Proxy failed, trying direct or public CORS proxies...");
        
        const directUrl = new URL(`${BASE_URL}/deals`);
        Object.keys(params).forEach(key => directUrl.searchParams.append(key, params[key]));
        const fullUrl = directUrl.toString();

        // Sequential attempts for maximum resilience
        const attempts = [
            { name: 'direct', url: fullUrl, type: 'direct' },
            { name: 'corsproxy.io', url: `https://corsproxy.io/?url=${encodeURIComponent(fullUrl)}`, type: 'direct' },
            { name: 'allorigins', url: `https://api.allorigins.win/get?url=${encodeURIComponent(fullUrl)}`, type: 'wrapper' }
        ];

        for (const attempt of attempts) {
            try {
                console.log(`Attempting ${attempt.name} fetch: ${attempt.url}`);
                const res = await fetch(attempt.url);
                if (res.ok) {
                    const data = await res.json();
                    if (attempt.type === 'wrapper') {
                        deals = JSON.parse(data.contents);
                        totalPages = 1; 
                    } else {
                        deals = data;
                        totalPages = parseInt(res.headers.get('X-Total-Page-Count')) || 1;
                    }
                    console.log(`Successfully fetched deals via ${attempt.name}`);
                    return { deals, totalPages };
                }
            } catch (e) {
                console.warn(`${attempt.name} failed:`, e.message);
            }
        }
        
        throw new Error("All fetching methods failed for deals");
    } catch (error) {
        console.error("Could not fetch deals:", error);
        return { deals: [], totalPages: 0 };
    }
}

export async function fetchGameDetails(gameId, retries = 2) {
    if (!gameId) return null;
    
    try {
        const proxyUrl = `${PROXY_URL}?endpoint=games&id=${gameId}`;
        const response = await fetch(proxyUrl);
        if (response.ok) return await response.json();
    } catch (e) {
        console.warn("Proxy failed for fetchGameDetails, trying direct...");
    }

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(`${BASE_URL}/games?id=${gameId}`);
            if (!response.ok) {
                if (response.status === 429) {
                    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
                    continue;
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            if (i === retries - 1) return null;
            await new Promise(r => setTimeout(r, 500));
        }
    }
    return null;
}

/**
 * Search for games by title.
 * @param {string} title - The title to search for
 * @returns {Promise<Array>} Array of game objects { gameID, steamAppID, cheapest, cheapestDealID, external }
 */
export async function searchGames(title) {
    if (!title || title.length < 2) return [];

    try {
        const proxyUrl = `${PROXY_URL}?endpoint=games&title=${encodeURIComponent(title)}&limit=8`;
        const response = await fetch(proxyUrl);
        if (response.ok) return await response.json();
    } catch (e) {
        console.warn("Proxy failed for searchGames, trying direct...");
    }

    try {
        const response = await fetch(`${BASE_URL}/games?title=${encodeURIComponent(title)}&limit=8`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
    } catch (error) {
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
        const proxyUrl = `${PROXY_URL}?endpoint=stores`;
        let response = await fetch(proxyUrl);
        
        let stores;
        if (response.ok) {
            stores = await response.json();
        } else {
            console.warn("CheapShark Stores Proxy failed, falling back to direct...");
            response = await fetch(`${BASE_URL}/stores`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            stores = await response.json();
        }
        
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

export async function fetchDealDetails(dealId, retries = 2) {
    if (!dealId) return null;
    
    try {
        const proxyUrl = `${PROXY_URL}?endpoint=deals&id=${encodeURIComponent(dealId)}`;
        const response = await fetch(proxyUrl);
        if (response.ok) return await response.json();
    } catch (e) {
        console.warn("Proxy failed for fetchDealDetails, trying direct...");
    }

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(`${BASE_URL}/deals?id=${encodeURIComponent(dealId)}`);
            if (!response.ok) {
                if (response.status === 429) {
                    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
                    continue;
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            if (i === retries - 1) return null;
            await new Promise(r => setTimeout(r, 500));
        }
    }
    return null;
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

    // Map our internal lang ('ko', 'en') to Steam API's expected 'l' parameter
    const steamLang = lang === 'en' ? 'english' : 'korean';
    const steamUrl = `https://store.steampowered.com/api/appdetails?appids=${steamAppID}&l=${steamLang}`;

    // Priority: Use our own Netlify functions (Zero CORS issues, very fast)
    // Fallback: Existing public proxies (for local dev without netlify-cli)
    const proxies = [
        { name: 'netlify-func', url: `/.netlify/functions/steam-details?appids=${steamAppID}&l=${steamLang}`, type: 'json' },
        { name: 'allorigins-raw', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(steamUrl)}`, type: 'json' },
        { name: 'codetabs', url: `https://api.codetabs.com/v1/proxy?url=${encodeURIComponent(steamUrl)}`, type: 'json' },
        { name: 'allorigins-get', url: `https://api.allorigins.win/get?url=${encodeURIComponent(steamUrl)}`, type: 'wrapper' },
    ];

    for (const proxy of proxies) {
        try {
            console.log(`Attempting fetch via ${proxy.name}...`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000); // Shorter timeout for faster failover

            const response = await fetch(proxy.url, { 
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                console.warn(`Proxy ${proxy.name} failed with status ${response.status}`);
                continue;
            }

            let data;
            const textData = await response.text();
            
            try {
                if (proxy.type === 'wrapper') {
                    const wrapper = JSON.parse(textData);
                    data = JSON.parse(wrapper.contents);
                } else {
                    data = JSON.parse(textData);
                }
            } catch (e) {
                console.warn(`Failed to parse JSON from ${proxy.name}:`, e.message);
                continue;
            }

            // Steam API returns { "APPID": { success: true, data: { ... } } }
            const appKey = Object.keys(data)[0];
            if (appKey && data[appKey] && data[appKey].success) {
                console.log(`Successfully fetched Steam data via proxy: ${proxy.url}`);
                
                let steamData = data[appKey].data;
                // Force HTTPS for all Steam-hosted assets to avoid mixed content issues on GitHub Pages
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
            console.warn(`Steam API success false for app ${steamAppID} via ${proxy.url}`);
            continue; 
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn(`CORS proxy TIMEOUT (${proxy.url})`);
            } else {
                console.warn(`CORS proxy Error (${proxy.url}):`, error.message);
            }
            continue; 
        }
    }

    console.error(`Could not fetch Steam details for app ${steamAppID} via any proxy.`);
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
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            // Response shape: [[["translated","original",...], ...], ...]
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
    const proxies = [
        { name: 'netlify-func', url: `/.netlify/functions/steam-reviews?appid=${steamAppID}&count=${count}`, type: 'json' },
        { name: 'allorigins-raw', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(baseUrl)}`, type: 'json' },
        { name: 'codetabs', url: `https://api.codetabs.com/v1/proxy?url=${encodeURIComponent(baseUrl)}`, type: 'json' }
    ];

    for (const proxy of proxies) {
        try {
            console.log(`Attempting fetch reviews via ${proxy.name}...`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);

            const response = await fetch(proxy.url, { 
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) continue;

            const textData = await response.text();
            let data;
            try {
                if (proxy.type === 'wrapper') {
                    const wrapper = JSON.parse(textData);
                    data = JSON.parse(wrapper.contents);
                } else {
                    data = JSON.parse(textData);
                }
            } catch (e) {
                continue;
            }

            if (data && data.success && data.reviews) {
                console.log(`Successfully fetched Steam reviews via proxy: ${proxy.url}`);
                
                // Force HTTPS for any URLs in reviews if present
                const forceHttps = (obj) => {
                    for (let key in obj) {
                        if (typeof obj[key] === 'string' && obj[key].startsWith('http://')) {
                            obj[key] = obj[key].replace('http://', 'https://');
                        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                            forceHttps(obj[key]);
                        }
                    }
                };
                forceHttps(data.reviews);
                
                return data.reviews;
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn(`Steam reviews TIMEOUT (${proxy.url})`);
            } else {
                console.warn(`Steam reviews proxy failed (${proxy.url}):`, error.message);
            }
            continue;
        }
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
        const url = new URL(`${BASE_URL}/alerts`);
        url.searchParams.append('action', action);
        url.searchParams.append('email', email);
        url.searchParams.append('gameID', gameID);
        if (price) url.searchParams.append('price', price);

        const response = await fetch(url);
        // CheapShark /alerts returns 1 (true) for success, 0 (false) for failure
        const result = await response.text();
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
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

    const cachedData = sessionStorage.getItem(CACHE_KEY);
    const cachedTime = sessionStorage.getItem(CACHE_TIME_KEY);
    
    if (cachedData && cachedTime && (Date.now() - parseInt(cachedTime) < CACHE_DURATION)) {
        console.log("Returning cached Top Sellers");
        return JSON.parse(cachedData);
    }

    try {
        // 1. Try Netlify Function first (Recommended for production)
        const netlifyFuncUrl = '/.netlify/functions/steam-top-sellers';
        
        try {
            const response = await fetch(netlifyFuncUrl);
            if (response.ok) {
                const data = await response.json();
                const items = data.top_sellers?.items || [];
                sessionStorage.setItem(CACHE_KEY, JSON.stringify(items));
                sessionStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
                return items;
            }
        } catch (e) {}

        // Fallback: Client-side mapping
        // (Existing robust logic remains but we cache the final result)
        const fetchFromProxy = async (proxyBase) => {
            const steamApiUrl = 'https://store.steampowered.com/api/featuredcategories?l=english';
            const url = `${proxyBase}${encodeURIComponent(steamApiUrl)}`;
            try {
                const res = await fetch(url);
                if (!res.ok) return [];
                const data = proxyBase.includes('allorigins') 
                    ? JSON.parse((await res.json()).contents) 
                    : await res.json();
                
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
                return combinedIDs;
            } catch (err) { return []; }
        };

        let candidateAppIDs = await fetchFromProxy('https://corsproxy.io/?url=');
        if (candidateAppIDs.length === 0) {
            candidateAppIDs = await fetchFromProxy('https://api.allorigins.win/get?url=');
        }

        if (candidateAppIDs.length === 0) return [];

        const validDeals = [];
        const seenGameIDs = new Set();
        const BATCH_SIZE = 4; // Smaller batch for lower rate-limit risk

        for (let i = 0; i < candidateAppIDs.length; i += BATCH_SIZE) {
            const batch = candidateAppIDs.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(async (appID) => {
                try {
                    const { deals } = await fetchDeals({ steamAppID: appID, pageSize: 1 });
                    if (deals.length > 0 && !seenGameIDs.has(deals[0].gameID)) {
                        seenGameIDs.add(deals[0].gameID);
                        return deals[0];
                    }
                } catch (err) {}
                return null;
            }));

            validDeals.push(...batchResults.filter(d => d !== null));
            if (validDeals.length >= 10) break;
            // Subtle delay between batches if we are client-side mapping
            await new Promise(r => setTimeout(r, 100));
        }

        const finalDeals = validDeals.slice(0, 10).map((deal, idx) => ({ ...deal, rank: idx + 1 }));
        
        // Cache the result
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(finalDeals));
        sessionStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
        
        return finalDeals;
    } catch (error) {
        console.error("Could not fetch top sellers:", error);
        return [];
    }
}

/**
 * api.js - Core functionality for fetching data from the CheapShark API
 * CheapShark API Docs: https://apidocs.cheapshark.com/
 */

const BASE_URL = 'https://www.cheapshark.com/api/1.0';

/**
 * Fetch a list of deals based on query parameters.
 * @param {Object} params - Query parameters (e.g., { storeID: 1, upperPrice: 15, sortBy: 'Price' })
 * @returns {Promise<Object>} Object containing deals array and totalPages
 */
export async function fetchDeals(params = {}) {
    try {
        const url = new URL(`${BASE_URL}/deals`);
        // Append all params to URL
        Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
        
        console.log(`Fetching deals from: ${url}`);
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const deals = await response.json();
        const totalPages = parseInt(response.headers.get('X-Total-Page-Count')) || 1;
        
        return { deals, totalPages };
    } catch (error) {
        console.error("Could not fetch deals:", error);
        return { deals: [], totalPages: 0 };
    }
}

/**
 * Fetch detailed information for a specific game by its internal GameID.
 * @param {string|number} gameId - The ID of the game
 * @returns {Promise<Object|null>} Game details object or null on error
 */
export async function fetchGameDetails(gameId) {
    if (!gameId) return null;
    
    try {
        const response = await fetch(`${BASE_URL}/games?id=${gameId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Could not fetch details for game ${gameId}:`, error);
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
        const response = await fetch(`${BASE_URL}/games?title=${encodeURIComponent(title)}&limit=8`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Could not search for games with title "${title}":`, error);
        return [];
    }
}

/**
 * Fetch the list of active stores to map storeID to store names and logos.
 * Uses sessionStorage to cache the list and prevent redundant API calls.
 * @returns {Promise<Array>} Array of store objects
 */
export async function fetchStores() {
    // Check if we already have it in session storage to save network requests
    const cachedStores = sessionStorage.getItem('cheapshark_stores');
    if (cachedStores) {
        return JSON.parse(cachedStores);
    }

    try {
        const response = await fetch(`${BASE_URL}/stores`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const stores = await response.json();
        const activeStores = stores.filter(store => store.isActive === 1);
        
        // Cache the result
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

/**
 * Fetch detailed information for a specific deal by its dealID.
 * This provides richer data like Metacritic score and Steam ratings.
 * @param {string} dealId - The DEAL ID
 * @returns {Promise<Object|null>} Deal details object or null on error
 */
export async function fetchDealDetails(dealId) {
    if (!dealId) return null;
    
    try {
        const response = await fetch(`${BASE_URL}/deals?id=${encodeURIComponent(dealId)}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Could not fetch details for deal ${dealId}:`, error);
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

    // Map our internal lang ('ko', 'en') to Steam API's expected 'l' parameter
    const steamLang = lang === 'en' ? 'english' : 'korean';
    const steamUrl = `https://store.steampowered.com/api/appdetails?appids=${steamAppID}&l=${steamLang}&v=${Date.now()}`;

    // Try multiple CORS proxies in sequence for reliability
    // Re-ordered to prioritize allorigins as corsproxy.io is blocking GitHub Pages
    const proxies = [
        { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(steamUrl)}`, headers: {} },
        { url: `https://proxy.cors.sh/${steamUrl}`, headers: { 'x-cors-gratis': 'true' } },
        { url: `https://corsproxy.io/?${encodeURIComponent(steamUrl)}`, headers: {} },
    ];

    for (const proxy of proxies) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s per proxy

            const response = await fetch(proxy.url, { 
                signal: controller.signal,
                headers: { 
                    ...proxy.headers,
                    'x-requested-with': 'XMLHttpRequest'
                }
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                console.warn(`Proxy ${proxy.url} returned status ${response.status}`);
                continue;
            }

            const data = await response.json();

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

    // Use CORS proxies to reach Steam API
    const proxies = [
        `https://corsproxy.io/?${encodeURIComponent(`https://store.steampowered.com/appreviews/${steamAppID}?json=1&language=all&num_per_page=${count}`)}`,
        `https://api.allorigins.win/get?url=${encodeURIComponent(`https://store.steampowered.com/appreviews/${steamAppID}?json=1&language=all&num_per_page=${count}`)}`,
        `https://proxy.cors.sh/https://store.steampowered.com/appreviews/${steamAppID}?json=1&language=all&num_per_page=${count}`
    ];

    for (const proxyUrl of proxies) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const fetchOptions = { signal: controller.signal };
            if (proxyUrl.includes('proxy.cors.sh')) {
                fetchOptions.headers = { 'x-cors-gratis': 'true' };
            }

            const response = await fetch(proxyUrl, fetchOptions);
            clearTimeout(timeoutId);

            if (!response.ok) continue;

            const rawData = await response.json();
            const data = rawData.contents ? JSON.parse(rawData.contents) : rawData;

            if (data && data.success && data.reviews) {
                console.log(`Successfully fetched Steam reviews via proxy: ${proxyUrl}`);
                
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
                console.warn(`Steam reviews TIMEOUT (${proxyUrl})`);
            } else {
                console.warn(`Steam reviews proxy failed (${proxyUrl}):`, error.message);
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
        return result === '1' || result === 'true';
    } catch (error) {
        console.error("Could not set price alert:", error);
        return false;
    }
}

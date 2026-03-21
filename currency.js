/**
 * currency.js - Utility for automatic currency conversion based on user location.
 */

const EXCHANGE_RATE_API = 'https://open.er-api.com/v6/latest/USD';
const GEO_IP_API = 'https://ipapi.co/json/';
const CACHE_KEY_RATES = 'gamecatcher_exchange_rates';
const CACHE_KEY_USER = 'gamecatcher_user_info';
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

/**
 * Fetch and cache user info (country, currency) using IP-based geolocation.
 */
export async function getUserInfo() {
    const cached = localStorage.getItem(CACHE_KEY_USER);
    if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_TTL) {
            return parsed.data;
        }
    }

    try {
        let data;
        try {
            const response = await fetch(GEO_IP_API);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            data = await response.json();
        } catch (e) {
            console.warn("Direct IP API failed, trying proxies...", e);
            try {
                // Try corsproxy.io first (more direct)
                const cpRes = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(GEO_IP_API)}`);
                if (!cpRes.ok) throw new Error("CORSProxy failed");
                data = await cpRes.json();
            } catch (e2) {
                // Try allorigins as last resort
                const aoRes = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(GEO_IP_API)}`);
                if (!aoRes.ok) throw new Error("AllOrigins failed");
                const wrapped = await aoRes.json();
                data = JSON.parse(wrapped.contents);
            }
        }
        
        const userInfo = {
            country: data.country_code,
            currency: data.currency,
            countryName: data.country_name
        };

        localStorage.setItem(CACHE_KEY_USER, JSON.stringify({
            timestamp: Date.now(),
            data: userInfo
        }));
        
        return userInfo;
    } catch (error) {
        console.warn('Geolocation failed, falling back to USD:', error);
        return { country: 'US', currency: 'USD', countryName: 'United States' };
    }
}

/**
 * Fetch and cache exchange rates from USD to all other currencies.
 */
export async function getExchangeRates() {
    const cached = localStorage.getItem(CACHE_KEY_RATES);
    if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_TTL) {
            return parsed.data;
        }
    }

    try {
        let data;
        try {
            const response = await fetch(EXCHANGE_RATE_API);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            data = await response.json();
        } catch (e) {
            console.warn("Direct Rates API failed, trying proxies...", e);
            try {
                const cpRes = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(EXCHANGE_RATE_API)}`);
                if (!cpRes.ok) throw new Error("CORSProxy failed");
                data = await cpRes.json();
            } catch (e2) {
                const aoRes = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(EXCHANGE_RATE_API)}`);
                if (!aoRes.ok) throw new Error("AllOrigins failed");
                const wrapped = await aoRes.json();
                data = JSON.parse(wrapped.contents);
            }
        }
        
        if (data.result === 'success') {
            localStorage.setItem(CACHE_KEY_RATES, JSON.stringify({
                timestamp: Date.now(),
                data: data.rates
            }));
            return data.rates;
        }
        throw new Error('API returned error status');
    } catch (error) {
        console.warn('Exchange rate fetch failed:', error);
        return { USD: 1 }; // Fallback
    }
}

/**
 * Formats a USD price into the user's local currency.
 * @param {number|string} usdAmount 
 * @returns {Promise<string>} Formatted currency string
 */
export async function formatPrice(usdAmount) {
    const amount = parseFloat(usdAmount);
    if (isNaN(amount)) return 'N/A';

    const [userInfo, rates] = await Promise.all([
        getUserInfo(),
        getExchangeRates()
    ]);

    const targetCurrency = userInfo.currency || 'USD';
    const rate = rates[targetCurrency] || 1;
    const convertedAmount = amount * rate;

    try {
        // Use Intl.NumberFormat for professional formatting
        return new Intl.NumberFormat(navigator.language, {
            style: 'currency',
            currency: targetCurrency
        }).format(convertedAmount);
    } catch (e) {
        // Fallback for edge cases
        return `${targetCurrency} ${convertedAmount.toFixed(2)}`;
    }
}

/**
 * Lightweight version for immediate UI rendering if data is already cached.
 * Returns null if cache is empty.
 */
export function formatPriceSync(usdAmount) {
    const amount = parseFloat(usdAmount);
    if (isNaN(amount)) return 'N/A';

    const userCached = localStorage.getItem(CACHE_KEY_USER);
    const ratesCached = localStorage.getItem(CACHE_KEY_RATES);

    if (userCached && ratesCached) {
        const userInfo = JSON.parse(userCached).data;
        const rates = JSON.parse(ratesCached).data;
        
        const targetCurrency = userInfo.currency || 'USD';
        const rate = rates[targetCurrency] || 1;
        const convertedAmount = amount * rate;

        try {
            return new Intl.NumberFormat(navigator.language, {
                style: 'currency',
                currency: targetCurrency
            }).format(convertedAmount);
        } catch (e) {
            return `${targetCurrency} ${convertedAmount.toFixed(2)}`;
        }
    }
    
    // Default to USD formatting if not cached yet
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

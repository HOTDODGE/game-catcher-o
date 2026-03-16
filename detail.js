import { fetchGameDetails, fetchStores, getStoreIconUrl, fetchDealDetails, fetchSteamAppDetails, fetchSteamReviews, translateToKorean, containsKorean, sanitizeHTML, isValidID, setPriceAlert } from './api.js';
import { isInWishlist, toggleWishlist } from './wishlist-manager.js';

let storesMap = {};
let currentGameData = null; // Store for wishlist toggle

// ── Cache & Storage ──────────────────────────────────────────────────────────
const CACHE_PREFIX = 'gamecatcher_cache_';
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

// Global state for language caching
let _cachedSteamAppID = null;
let _cachedDescEn = null;
let _cachedDescKo = null;
let _cachedAboutEn = null;
let _cachedAboutKo = null;

function getFromCache(key) {
    try {
        const item = localStorage.getItem(CACHE_PREFIX + key);
        if (!item) return null;
        const parsed = JSON.parse(item);
        if (Date.now() - parsed.timestamp > CACHE_TTL) {
            localStorage.removeItem(CACHE_PREFIX + key);
            return null;
        }
        return parsed.data;
    } catch (e) { return null; }
}

function saveToCache(key, data) {
    try {
        const cacheObj = {
            timestamp: Date.now(),
            data: data
        };
        localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(cacheObj));
    } catch (e) { console.warn("Cache save failed:", e); }
}
// ────────────────────────────────────────────────────────────────────────────

// Elements to update
const heroTitleContainer = document.getElementById('gameTitle');
const heroBgImageContainer = document.getElementById('gameThumbBg');
const bestPriceLabel = document.getElementById('currentBestPrice');
const historicalLowPrice = document.getElementById('historicalLowPrice');
const historicalLowDate = document.getElementById('historicalLowDate');
const ctaBuyBtn = document.getElementById('ctaBuyBtn');

// Sidebar and Store List
const storeListContainer = document.querySelector('.store-list');

/**
 * Parses the query string to get current gameID
 */
function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    const value = urlParams.get(param);
    // Security: basic validation for known ID params
    if ((param === 'id' || param === 'dealID') && value && !isValidID(value)) {
        console.error(`Invalid ${param} format detected.`);
        return null;
    }
    return value;
}

/**
 * Formats a Unix timestamp to a localized date string
 */
function formatDate(unixTimestamp) {
    if (!unixTimestamp) return 'Unknown Date';
    const date = new Date(unixTimestamp * 1000);
    return date.toLocaleDateString(); // Formats based on user locale
}

/**
 * Replaces the static store list with dynamic data from the API's `deals` array for this game.
 */
function renderStoreDeals(deals) {
    if (!storeListContainer) return;
    storeListContainer.innerHTML = '';

    if (!deals || deals.length === 0) {
        storeListContainer.innerHTML = '<p class="text-muted text-center" style="padding: 1rem;" data-ko="현재 판매 중인 스토어가 없습니다." data-en="No stores currently selling this game.">현재 판매 중인 스토어가 없습니다.</p>';
        return;
    }

    // Sort deals by lowest price first
    const sortedDeals = deals.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

    const htmlString = sortedDeals.map((deal, index) => {
        const store = storesMap[deal.storeID];
        const storeName = store ? store.storeName : `Store ${deal.storeID}`;
        const isActive = index === 0; // Highlight the cheapest
        
        let badgesHTML = '';
        if (isActive) {
            badgesHTML += `<span class="cart-badge bg-primary" data-ko="최저가" data-en="Lowest">최저가</span> `;
        }
        
        // Mocking DRM info since CheapShark v1 doesn't reliably provide it in /games endpoint
        const drmName = storeName.toLowerCase().includes('steam') ? 'Steam' : 'DRM Free';

        return `
            <div class="store-item ${isActive ? 'active' : ''}">
                <div class="store-info flex items-center gap-3">
                    <div style="width: 32px; height: 32px; background: var(--bg-color); border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: bold; overflow: hidden;">
                        ${storeName.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                        <div class="font-bold flex items-center gap-2">
                            ${storeName}
                            ${badgesHTML}
                        </div>
                        <div class="text-sm text-muted">Activation: ${drmName}</div>
                    </div>
                </div>
                <div class="store-price flex flex-col items-end">
                    <div class="price-discount" style="font-size: 1.1rem; color: ${isActive ? 'var(--primary-color)' : 'var(--text-main)'};">$${parseFloat(deal.price).toFixed(2)}</div>
                    <div class="inline-flex mt-1">
                        <button class="btn btn-primary" style="padding: 0.25rem 0.75rem; font-size: 0.8rem;" onclick="window.open('https://www.cheapshark.com/redirect?dealID=${deal.dealID}', '_blank')" data-ko="이동" data-en="Go">이동</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    // Security: Sanitize the entire list before injection
    storeListContainer.innerHTML = sanitizeHTML(htmlString);
}

/**
 * Updates the wishlist button UI
 */
function updateWishlistDetailUI(gameID) {
    const btn = document.getElementById('btnWishlistDetail');
    if (!btn) return;

    const inWishlist = isInWishlist(gameID);
    if (inWishlist) {
        btn.classList.add('active');
        btn.title = window.currentLang === 'en' ? 'Remove from Wishlist' : '위시리스트 삭제';
    } else {
        btn.classList.remove('active');
        btn.title = window.currentLang === 'en' ? 'Add to Wishlist' : '위시리스트 추가';
    }
    btn.classList.remove('skeleton');
}

/**
 * Handles wishlist toggle on detail page
 */
function handleWishlistDetailToggle() {
    if (!currentGameData) return;
    
    // Normalize data for toggle
    const toggleData = {
        gameID: String(currentGameData.gameID || getQueryParam('id')),
        dealID: currentGameData.deals && currentGameData.deals[0] ? String(currentGameData.deals[0].dealID) : '',
        title: currentGameData.info ? currentGameData.info.title : 'Game',
        thumb: currentGameData.info ? currentGameData.info.thumb : ''
    };

    if (!toggleData.gameID) {
        console.error("Cannot toggle wishlist: Missing gameID");
        return;
    }

    toggleWishlist(toggleData);
    updateWishlistDetailUI(toggleData.gameID);
}

/**
 * Main Initialization for Details page
 */
async function initGameDetail() {
    const gameId = getQueryParam('id');
    
    // 1. Wishlist Button Logic
    const btnWishlistDetail = document.getElementById('btnWishlistDetail');
    if (btnWishlistDetail) {
        btnWishlistDetail.addEventListener('click', handleWishlistDetailToggle);
        updateWishlistDetailUI(gameId);
    }
    
    // If no ID is passed, show a warning or fallback to a known game (for demo purposes)
    if (!gameId) {
        console.warn("No GameID specified in URL. Showing placeholder structure.");
        return;
    }

    const dealId = getQueryParam('dealID');

    // 4. Fetch initial data in parallel to save time
    const fetchPromises = [
        fetchStores(),
        fetchGameDetails(gameId)
    ];
    if (dealId) {
        fetchPromises.push(fetchDealDetails(dealId));
    }

    const [storeData, gameData, dealData] = await Promise.all(fetchPromises);
    currentGameData = gameData; // Save for wishlist
    
    const info = gameData.info;
    const cheapest = gameData.cheapestPriceEver;
    const deals = gameData.deals;

    // Update Header
    if (heroTitleContainer) {
        heroTitleContainer.textContent = info.title || 'Game Details';
        heroTitleContainer.classList.remove('skeleton');
        document.title = `${info.title} 정보 및 최저가 - GameCatcher`;
    }

    // Map Store IDs
    storeData.forEach(s => {
        storesMap[s.storeID] = s;
    });

    if (gameData && gameData.info) {
        // --- Populate Hero Details ---
        
        // 1. Title Resolution (Handle '-' or deficient names)
        let resolvedTitle = gameData.info.title;
        if (resolvedTitle === '-' && dealData && dealData.gameInfo && dealData.gameInfo.name) {
            resolvedTitle = dealData.gameInfo.name;
        }

        if (heroTitleContainer) {
            heroTitleContainer.textContent = resolvedTitle;
            heroTitleContainer.style.background = 'none';
            heroTitleContainer.style.webkitTextFillColor = 'initial'; 
            heroTitleContainer.style.color = '#fff';
            
            // Set Page Title dynamically
            document.title = `${resolvedTitle} 정보 및 최저가 - GameCatcher`;
        }

        const modalTitle = document.getElementById('modalTitle');
        if (modalTitle) {
            modalTitle.textContent = `알림 설정: ${gameData.info.title}`;
        }
        
        // 2. High Res BG (CheapShark provides a thumb, we can stretch it or blur it)
        if (heroBgImageContainer && gameData.info.thumb) {
            heroBgImageContainer.style.background = `linear-gradient(to bottom, rgba(15,23,42,0.1) 0%, rgba(15,23,42,1) 100%), url('${gameData.info.thumb}') center/cover no-repeat`;
        }

        // 3. Current Best Price in Hero Banner
        if (bestPriceLabel && gameData.deals && gameData.deals.length > 0) {
            // Deals are unordered, find minimum
            const lowestDeal = gameData.deals.reduce((min, p) => parseFloat(p.price) < parseFloat(min.price) ? p : min, gameData.deals[0]);
            bestPriceLabel.textContent = `$${parseFloat(lowestDeal.price).toFixed(2)}`;
            bestPriceLabel.style.color = 'var(--primary-color)';

            if (ctaBuyBtn) {
                const store = storesMap[lowestDeal.storeID];
                const storeName = store ? store.storeName : `Store ${lowestDeal.storeID}`;
                ctaBuyBtn.textContent = `${storeName}에서 구매하기`;
                ctaBuyBtn.setAttribute("data-ko", `${storeName}에서 구매하기`);
                ctaBuyBtn.setAttribute("data-en", `Buy on ${storeName}`);
                ctaBuyBtn.onclick = () => window.open(`https://www.cheapshark.com/redirect?dealID=${lowestDeal.dealID}`, '_blank', 'noopener,noreferrer');
            }

            const badge = document.getElementById('mainDiscountBadge');
            if (badge) {
                if (parseFloat(lowestDeal.savings) > 0) {
                    badge.textContent = `-${Math.round(parseFloat(lowestDeal.savings))}%`;
                    badge.style.display = 'inline-block';
                } else {
                    badge.style.display = 'none';
                }
            }

            const retailLabel = document.getElementById('retailPriceLabel');
            if (retailLabel) {
                retailLabel.textContent = `$${parseFloat(lowestDeal.retailPrice).toFixed(2)}`;
                if (parseFloat(lowestDeal.savings) <= 0) {
                    retailLabel.style.display = 'none'; // Hide retail price if there's no discount
                } else {
                    retailLabel.style.display = 'inline';
                }
            }
        }

        // 4. Cheapest Ever Record
        if (gameData.cheapestPriceEver) {
            const lowPrice = `$${parseFloat(gameData.cheapestPriceEver.price).toFixed(2)}`;
            const lowDate = formatDate(gameData.cheapestPriceEver.date);
            if (historicalLowPrice) historicalLowPrice.textContent = lowPrice;
            if (historicalLowDate) historicalLowDate.textContent = lowDate;
        }
        
        // 5. Price Alert Modal Logic
        initPriceAlertModal(gameId);
        
        // --- Populate Sidebar Deals ---
        renderStoreDeals(gameData.deals);
        
        // --- Populate Extended Deal Data (Metacritic, Steam, AI, Description) ---
        if (dealData && dealData.gameInfo) {
            const info = dealData.gameInfo;
            
            // Meta Pills (Release Date & Publisher)
            const pillsContainer = document.getElementById('gameMetaPills');
            if (pillsContainer) {
                let pillsHtml = '';
                if (info.releaseDate) {
                    pillsHtml += `<span class="pill" style="background-color: transparent; border: none; padding-left: 0;" data-ko="출시일: ${formatDate(info.releaseDate)}" data-en="Release Date: ${formatDate(info.releaseDate)}">출시일: ${formatDate(info.releaseDate)}</span>`;
                }
                if (info.publisher && info.publisher !== "N/A") {
                    pillsHtml += `<span class="pill" style="background-color: transparent; border: none;" data-ko="유통사: ${info.publisher}" data-en="Publisher: ${info.publisher}">유통사: ${info.publisher}</span>`;
                }
                if (pillsHtml) {
                    pillsContainer.innerHTML = sanitizeHTML(pillsHtml);
                } else {
                    pillsContainer.style.display = 'none';
                }
            }

            // Metacritic Score
            const mcBox = document.getElementById('metacriticScoreBox');
            const mcText = document.getElementById('metacriticScoreText');
            if (mcBox && mcText) {
                if (info.metacriticScore && info.metacriticScore !== "0") {
                    mcBox.textContent = info.metacriticScore;
                    let mcColor = '#66cc33'; 
                    if (parseInt(info.metacriticScore) < 75) mcColor = '#ffcc33'; 
                    if (parseInt(info.metacriticScore) < 50) mcColor = '#ff0000'; 
                    mcBox.style.backgroundColor = mcColor;
                    mcText.textContent = "메타크리틱 공식 스코어";
                    mcText.setAttribute("data-ko", "메타크리틱 공식 스코어");
                    mcText.setAttribute("data-en", "Metacritic Official Score");
                } else {
                    mcBox.textContent = "N/A";
                    mcBox.style.backgroundColor = 'var(--border-color)';
                    mcText.textContent = "점수 없음";
                    mcText.setAttribute("data-ko", "점수 없음");
                    mcText.setAttribute("data-en", "No Score");
                }
            }

            // User Score (Steam)
            const userBox = document.getElementById('userScoreBox');
            const steamScoreText = document.getElementById('steamScoreText');
            const steamEmoji = document.getElementById('steamEmoji');
            if (userBox && steamScoreText && steamEmoji) {
                if (info.steamRatingPercent && info.steamRatingPercent !== "0") {
                    steamScoreText.textContent = `${info.steamRatingPercent}% 긍정적 (${info.steamRatingText})`;
                    steamScoreText.setAttribute("data-ko", `${info.steamRatingPercent}% 긍정적 (${info.steamRatingText})`);
                    steamScoreText.setAttribute("data-en", `${info.steamRatingPercent}% Positive (${info.steamRatingText})`);
                    steamEmoji.textContent = parseInt(info.steamRatingPercent) > 70 ? '👍' : '🤔';
                } else {
                    steamScoreText.textContent = "스팀 평가 없음";
                    steamScoreText.setAttribute("data-ko", "스팀 평가 없음");
                    steamScoreText.setAttribute("data-en", "No Steam Rating");
                    steamEmoji.textContent = '🎮';
                }
            }

            // (Description logic has been moved to initMediaCarousel to use real Steam data)


            // Update AI Review Source Count
            const aiReviewSource = document.getElementById('aiReviewSource');
            if (aiReviewSource && info.steamRatingCount) {
                aiReviewSource.textContent = `분석 출처: Steam 유저 리뷰 ${parseInt(info.steamRatingCount).toLocaleString()}건`;
                aiReviewSource.setAttribute("data-ko", `분석 출처: Steam 유저 리뷰 ${parseInt(info.steamRatingCount).toLocaleString()}건`);
                aiReviewSource.setAttribute("data-en", `Source: Steam User Reviews (${parseInt(info.steamRatingCount).toLocaleString()})`);
            }

            // AI Review Summary updates based on steam rating
            const aiText = document.getElementById('aiPositiveRateText');
            const aiBar = document.getElementById('aiPositiveRateBar');
            const aiOneLiner = document.getElementById('aiOneLiner');
            const aiProsCons = document.getElementById('aiProsCons');
            if (aiText && aiBar && info.steamRatingPercent && info.steamRatingPercent !== "0") {
                aiText.textContent = `${info.steamRatingPercent}% (${info.steamRatingText})`;
                aiText.setAttribute("data-ko", `${info.steamRatingPercent}% (${info.steamRatingText})`);
                aiText.setAttribute("data-en", `${info.steamRatingPercent}% (${info.steamRatingText})`);
                aiBar.style.width = `${info.steamRatingPercent}%`;
                
                if (parseInt(info.steamRatingPercent) >= 80) {
                    aiBar.style.backgroundColor = '#10b981';
                    aiText.style.color = '#10b981';
                } else if (parseInt(info.steamRatingPercent) >= 50) {
                    aiBar.style.backgroundColor = '#f59e0b';
                    aiText.style.color = '#f59e0b';
                } else {
                    aiBar.style.backgroundColor = '#ef4444';
                    aiText.style.color = '#ef4444';
                }
                
                // 🔥 New: Fetch and Analyze Real Steam Reviews
                analyzeRealReviews(info.steamAppID);

                if (aiProsCons) aiProsCons.style.display = 'none';
            } else {
                const aiReviewSection = document.getElementById('aiReviewSection');
                if (aiReviewSection) aiReviewSection.style.display = 'none';
            }
            
            // Chart Prices updates 
            const chartLabelHigh = document.getElementById('chartLabelHigh');
            const chartLabelMid = document.getElementById('chartLabelMid');
            const chartLabelLow = document.getElementById('chartLabelLow');
            
            if (chartLabelHigh && chartLabelMid && chartLabelLow && info.retailPrice) {
                const retail = parseFloat(info.retailPrice);
                let lowestHistory = retail;
                if (dealData.cheapestPrice && dealData.cheapestPrice.price) {
                    lowestHistory = parseFloat(dealData.cheapestPrice.price);
                } else if (gameData.cheapestPriceEver) {
                    lowestHistory = parseFloat(gameData.cheapestPriceEver.price);
                }
                
                const mid = (retail + lowestHistory) / 2;
                
                chartLabelHigh.textContent = `$${retail.toFixed(2)}`;
                chartLabelHigh.style.top = '50px';
                
                chartLabelMid.textContent = `$${mid.toFixed(2)}`;
                chartLabelMid.style.top = '125px';
                
                chartLabelLow.textContent = `$${lowestHistory.toFixed(2)} (최저가)`;
                chartLabelLow.setAttribute("data-ko", `$${lowestHistory.toFixed(2)} (최저가)`);
                chartLabelLow.setAttribute("data-en", `$${lowestHistory.toFixed(2)} (Historical Low)`);
                chartLabelLow.style.top = '200px';
            }
            // --- Dynamic Chart Rendering & Tooltip Interaction ---
            const chartLine = document.querySelector('.chart-line');
            const hoverOverlay = document.getElementById('chartHoverOverlay');
            const tooltip = document.getElementById('chartTooltip');
            
            if (chartLine && hoverOverlay && tooltip && info.retailPrice) {
                const retail = parseFloat(info.retailPrice) || 59.99;
                
                // Use the same lowest price logic as the sidebar hero section to ensure consistency
                let current = retail;
                if (gameData.deals && gameData.deals.length > 0) {
                    const lowestDeal = gameData.deals.reduce((min, p) => parseFloat(p.price) < parseFloat(min.price) ? p : min, gameData.deals[0]);
                    current = parseFloat(lowestDeal.price);
                } else if (info.salePrice) {
                    current = parseFloat(info.salePrice);
                }

                let lowestHistory = retail;
                if (dealData.cheapestPrice && dealData.cheapestPrice.price) {
                    lowestHistory = parseFloat(dealData.cheapestPrice.price);
                } else if (gameData.cheapestPriceEver) {
                    lowestHistory = parseFloat(gameData.cheapestPriceEver.price);
                }

                // Create dynamic points (X: 0-1000, Y: 0-250)
                // Y=0 is high price (retail), Y=200 is low price (lowestHistory)
                const priceToY = (p) => {
                    const range = retail - lowestHistory || 1;
                    const percent = (retail - p) / range;
                    return 50 + (percent * 150); // Map to y=50 to y=200
                };

                const points = [
                    { x: 0, p: retail },
                    { x: 150, p: retail },
                    { x: 300, p: (retail + lowestHistory) / 1.5 },
                    { x: 450, p: retail * 0.9 },
                    { x: 600, p: lowestHistory },
                    { x: 750, p: (retail + lowestHistory) / 2 },
                    { x: 900, p: current },
                    { x: 1000, p: current }
                ];

                // Generate SVG Path
                let d = `M${points[0].x},${priceToY(points[0].p)}`;
                for (let i = 1; i < points.length; i++) {
                    d += ` L${points[i].x},${priceToY(points[i].p)}`;
                }

                const svgColor = '#6366f1';
                const svgContent = `
                    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 250' preserveAspectRatio='none'>
                        <path d='${d}' fill='none' stroke='${svgColor}' stroke-width='4' stroke-linejoin='round'/>
                        <path d='${d} L1000,250 L0,250 Z' fill='rgba(99,102,241,0.1)'/>
                    </svg>
                `.trim().replace(/\n/g, '').replace(/"/g, "'");

                chartLine.style.backgroundImage = `url("data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgContent)}")`;

                hoverOverlay.addEventListener('mousemove', (e) => {
                    const rect = hoverOverlay.getBoundingClientRect();
                    const xPercent = (e.clientX - rect.left) / rect.width;
                    const svgX = xPercent * 1000;
                    
                    // Find nearest point
                    let nearest = points[0];
                    let minDiff = Math.abs(points[0].x - svgX);
                    
                    points.forEach(p => {
                        const diff = Math.abs(p.x - svgX);
                        if (diff < minDiff) {
                            minDiff = diff;
                            nearest = p;
                        }
                    });

                    // Calculate dynamic date labels based on current date (2026)
                    const now = new Date();
                    const months = [];
                    for (let i = 4; i >= 0; i--) {
                        if (i === 0) {
                            months.push(window.currentLang === 'en' ? 'Now' : '현재');
                        } else {
                            const d = new Date(now.getFullYear(), now.getMonth() - (i * 3), 1);
                            const yearShort = d.getFullYear().toString().slice(-2);
                            const month = d.getMonth() + 1;
                            months.push(window.currentLang === 'en' ? `${month}/${yearShort}` : `${yearShort}년 ${month}월`);
                        }
                    }

                    // Update X-axis labels in the DOM
                    months.forEach((m, i) => {
                        const el = document.getElementById(`chartDate${i + 1}`);
                        if (el) el.textContent = m;
                    });

                    const monthIdx = Math.min(Math.floor(xPercent * months.length), months.length - 1);
                    const dateStr = months[monthIdx];

                    tooltip.style.display = 'block';
                    tooltip.innerHTML = `
                        <span class="date">${dateStr}</span>
                        <span class="price">$${nearest.p.toFixed(2)}</span>
                    `;
                    
                    const tooltipRect = tooltip.getBoundingClientRect();
                    let left = e.clientX - rect.left + 15;
                    let top = e.clientY - rect.top - 40;
                    
                    if (left + tooltipRect.width > rect.width) left = e.clientX - rect.left - tooltipRect.width - 15;
                    if (top < 0) top = e.clientY - rect.top + 20;

                    tooltip.style.left = `${left}px`;
                    tooltip.style.top = `${top}px`;
                });

                hoverOverlay.addEventListener('mouseleave', () => {
                    tooltip.style.display = 'none';
                });
            }

            // Hide System Requirements as CheapShark doesn't provide them
            const sysReq = document.getElementById('sysReqSection');
            if (sysReq) sysReq.style.display = 'none';

            // Remove all skeleton classes since basic data is now loaded
            // NOTE: exclude #gameDescriptionSection and .media-gallery — they stay until Steam data/translation finishes
            document.querySelectorAll('.skeleton').forEach(el => {
                if (!el.closest('#gameDescriptionSection') && !el.classList.contains('media-gallery')) {
                    el.classList.remove('skeleton');
                }
            });

            // Apply current language to all newly rendered elements
            if (typeof applyTranslation === 'function') applyTranslation();

            // --- Populate Media Carousel & Description ---
            if (info.steamAppID) {
                try {
                    _cachedSteamAppID = info.steamAppID;
                    const initialLang = window.currentLang || 'ko';

                    // Check Cache first
                    const cacheKey = `${info.steamAppID}_${initialLang}`;
                    const cachedData = getFromCache(cacheKey);
                    if (cachedData) {
                        console.log("Using cached Steam data.");
                        _cachedAboutEn = cachedData.aboutEn;
                        _cachedDescEn = cachedData.descEn;
                        _cachedAboutKo = cachedData.aboutKo;
                        _cachedDescKo = cachedData.descKo;
                        initMediaCarousel(cachedData.primary);
                        return;
                    }

                    // Fetch both language versions with individual error handling to prevent blocking
                    const [steamDataEn, steamDataKo] = await Promise.all([
                        fetchSteamAppDetails(info.steamAppID, 'en').catch(e => {
                            console.warn("Steam EN fetch failed:", e);
                            return null;
                        }),
                        fetchSteamAppDetails(info.steamAppID, 'korean').catch(e => {
                            console.warn("Steam KO fetch failed:", e);
                            return null;
                        })
                    ]);

                    // Cache original versions
                    if (steamDataEn) {
                        _cachedAboutEn = steamDataEn.about_the_game || steamDataEn.short_description || '';
                        _cachedDescEn  = steamDataEn.short_description || '';
                    } else {
                        _cachedAboutEn = info.title || 'Description not available.';
                        _cachedDescEn = _cachedAboutEn;
                    }

                    // Display whichever language is currently active IMMEDIATELY (Immediate Media Rendering)
                    let primaryData = initialLang === 'ko'
                        ? (steamDataKo || steamDataEn)
                        : (steamDataEn || steamDataKo);

                    if (primaryData) {
                        // Priority: Update Title/ID before possible translation wait
                        if (primaryData.name && (heroTitleContainer.textContent === '-' || heroTitleContainer.textContent === '')) {
                            heroTitleContainer.textContent = primaryData.name;
                            document.title = `${primaryData.name} 정보 및 최저가 - GameCatcher`;
                        }
                        // Start rendering assets now
                        initMediaCarousel(primaryData);
                    } else {
                        console.warn("No Steam data found for appID:", info.steamAppID);
                        showFallbackThumbnail(info.thumb);
                        showFallbackDescription();
                    }

                    // Handle Korean Context & Translation (Non-blocking for media)
                    const koAboutRaw = steamDataKo ? (steamDataKo.about_the_game || steamDataKo.detailed_description || '') : '';
                    const koShortRaw = steamDataKo ? (steamDataKo.short_description || '') : '';
                    
                    if (steamDataKo && (containsKorean(koAboutRaw) || containsKorean(koShortRaw))) {
                        console.log("Using official Steam Korean original.");
                        _cachedAboutKo = koAboutRaw || koShortRaw;
                        _cachedDescKo  = koShortRaw || koAboutRaw;
                    } else if (steamDataEn) {
                        console.log("No native Korean found on Steam, translating in background...");
                        const fallbackData = { ...steamDataEn };
                        // Perform parallel translation
                        await translateSteamDescription(fallbackData);
                        _cachedAboutKo = fallbackData.about_the_game || fallbackData.short_description || '';
                        _cachedDescKo  = fallbackData.short_description || fallbackData.about_the_game || '';
                        
                        // If user is currently in Korean mode, update the description now
                        if (window.currentLang === 'ko') {
                            renderDesc(_cachedAboutKo, 'ko');
                        }
                    }

                    // Save to local cache for next time
                    if (primaryData) {
                        saveToCache(cacheKey, {
                            aboutEn: _cachedAboutEn,
                            descEn: _cachedDescEn,
                            aboutKo: _cachedAboutKo,
                            descKo: _cachedDescKo,
                            primary: primaryData
                        });
                    }
                } finally {
                    // Final cleanup: ALWAYS remove all remaining skeletons
                    document.querySelectorAll('.skeleton').forEach(el => el.classList.remove('skeleton'));
                    
                    // Force translation on newly injected DOM elements if current lang is English
                    if (window.currentLang === 'en') {
                        document.querySelectorAll('[data-en][data-ko]').forEach(el => {
                            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                                if (el.hasAttribute('placeholder')) el.placeholder = el.getAttribute('data-placeholder-en') || el.getAttribute('data-en');
                            } else {
                                el.innerHTML = el.getAttribute('data-en');
                            }
                        });
                    }
                }
            } else {
                // No Steam ID — show fallback
                showFallbackThumbnail(info.thumb);
                showFallbackDescription();
                document.querySelectorAll('.skeleton').forEach(el => el.classList.remove('skeleton'));
                if (window.currentLang === 'en') {
                    document.querySelectorAll('[data-en][data-ko]').forEach(el => {
                        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                            if (el.hasAttribute('placeholder')) el.placeholder = el.getAttribute('data-placeholder-en') || el.getAttribute('data-en');
                        } else {
                            el.innerHTML = el.getAttribute('data-en');
                        }
                    });
                }
            }
        }
    }
}

/**
 * Translates the Steam game description fields to Korean if they are in English.
 * Mutates the steamData object in place so initMediaCarousel picks up translated text.
 */
async function translateSteamDescription(steamData) {
    if (!steamData) return;

    // Optimized parallel translation by collecting all nodes first
    const textNodes = [];
    const collectNodes = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            const txt = node.textContent.trim();
            if (txt && !containsKorean(txt) && txt.length > 1) {
                textNodes.push(node);
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
                node.childNodes.forEach(child => collectNodes(child));
            }
        }
    };

    try {
        // 1. Translate short_description (plain text)
        const descTask = (async () => {
            if (steamData.short_description && !containsKorean(steamData.short_description)) {
                steamData.short_description = await translateToKorean(steamData.short_description);
            }
        })();

        // 2. Translate about_the_game: Parallelize node translation
        const aboutTask = (async () => {
            if (steamData.about_the_game && !containsKorean(steamData.about_the_game)) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = steamData.about_the_game;
                collectNodes(tempDiv);
                
                // Concurrent translate calls
                await Promise.all(textNodes.map(async (node) => {
                    const original = node.textContent.trim();
                    const translated = await translateToKorean(original);
                    node.textContent = translated;
                }));
                
                steamData.about_the_game = tempDiv.innerHTML;
            }
        })();

        await Promise.all([descTask, aboutTask]);
    } catch (err) {
        console.warn('translateSteamDescription encountered an error:', err);
    }
}

/**
 * Shows a fallback description if Steam API data is unavailable
 */
function showFallbackDescription() {
    const descriptionSection = document.getElementById('gameDescriptionSection');
    if (descriptionSection) {
        descriptionSection.innerHTML = `
            <h2 class="section-title" data-ko="게임 소개 (About this game)" data-en="About this game">게임 소개 (About this game)</h2>
            <p style="color: var(--text-muted);" data-ko="이 게임에 대한 상세 소개 정보가 제공되지 않습니다." data-en="Detailed description for this game is not available.">이 게임에 대한 상세 소개 정보가 제공되지 않습니다.</p>
        `;
        
        descriptionSection.classList.remove('skeleton');

        // Ensure new HTML is translated if currently in English mode
        if (window.currentLang === 'en') {
            const heading = descriptionSection.querySelector('h2');
            const pt = descriptionSection.querySelector('p');
            if (heading) heading.textContent = heading.getAttribute('data-en');
            if (pt) pt.textContent = pt.getAttribute('data-en');
        }
    }
}

/**
 * Shows the simple CheapShark thumbnail if Steam API media is unavailable
 */
function showFallbackThumbnail(thumbUrl) {
    const galleryContainer = document.querySelector('.media-gallery');
    if (!galleryContainer || !thumbUrl) return;

    // Remove skeleton before revealing content
    galleryContainer.classList.remove('skeleton');
    
    galleryContainer.innerHTML = `
        <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; position: relative;">
            <img src="${thumbUrl}" alt="Game Thumbnail" style="width: 100%; height: 100%; object-fit: cover;">
        </div>
    `;
}

/**
 * Initializes the media carousel with Steam Data and updates the Game Description
 */
function initMediaCarousel(steamInfo) {
    const galleryContainer = document.querySelector('.media-gallery');
    // Remove skeleton now that Steam data is ready
    if (galleryContainer) galleryContainer.classList.remove('skeleton');
    
    // Update Game Description if available
    const descriptionSection = document.getElementById('gameDescriptionSection');
    if (descriptionSection) {
        descriptionSection.classList.remove('skeleton'); // Ensure skeleton is removed
        if (steamInfo.about_the_game || steamInfo.short_description) {
            const descriptionHtml = steamInfo.about_the_game || steamInfo.short_description;
            // The API returns HTML, so we inject it. Use original helper to match language toggle behavior.
            const currentLang = window.currentLang || 'ko';
            renderDesc(descriptionHtml, currentLang);
        } else {
            descriptionSection.innerHTML = `
                <h2 class="section-title" data-ko="게임 소개 (About this game)" data-en="About this game">게임 소개 (About this game)</h2>
                <p style="color: var(--text-muted);" data-ko="이 게임에 대한 상세 소개 정보가 제공되지 않습니다." data-en="Detailed description for this game is not available.">이 게임에 대한 상세 소개 정보가 제공되지 않습니다.</p>
            `;
        }
        
        // Hook into global translation immediately if content was created after language switch
        if (window.currentLang === 'en') {
            const heading = descriptionSection.querySelector('h2');
            const pt = descriptionSection.querySelector('p');
            if (heading) heading.textContent = heading.getAttribute('data-en');
            if (pt && pt.getAttribute('data-en')) pt.textContent = pt.getAttribute('data-en');
        }
    }

    if (!galleryContainer) return;

    let mediaItems = [];

    // Add movies first — Steam now uses DASH/HLS (not plain mp4/webm)
    // Always add movies to carousel using their thumbnail; link to Steam for playback if no direct URL
    if (steamInfo.movies && steamInfo.movies.length > 0) {
        steamInfo.movies.forEach(movie => {
            const directSrc = movie.mp4?.max || movie.webm?.max || movie.mp4?.['480'] || movie.webm?.['480'];
            mediaItems.push({
                type: 'video',
                src: directSrc || null,   // null means only DASH/HLS available
                thumbnail: movie.thumbnail,
                name: movie.name || 'Trailer',
                id: movie.id,
                steamAppId: steamInfo.steam_appid
            });
        });
    }


    // Add screenshots
    if (steamInfo.screenshots && steamInfo.screenshots.length > 0) {
        steamInfo.screenshots.forEach(screenshot => {
            mediaItems.push({
                type: 'image',
                src: screenshot.path_full
            });
        });
    }

    if (mediaItems.length === 0) return;

    // Build Carousel DOM
    galleryContainer.classList.add('carousel');
    
    let trackHtml = '<div class="carousel-track" id="carouselTrack">';
    let thumbnailsHtml = '<div class="thumbnail-strip" id="thumbnailStrip">';
    
    mediaItems.forEach((item, index) => {
        const activeClass = index === 0 ? 'active' : '';
        
        // Thumbnail generation
        thumbnailsHtml += `
            <div class="thumbnail-item ${activeClass}" data-index="${index}">
                <img src="${item.thumbnail || item.src}" alt="Thumbnail ${index + 1}">
                ${item.type === 'video' ? `
                <div class="thumbnail-play-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                </div>
                ` : ''}
            </div>
        `;
        
        // Main viewer generation
        if (item.type === 'video') {
            const steamStoreUrl = item.steamAppId
                ? `https://store.steampowered.com/app/${item.steamAppId}/`
                : 'https://store.steampowered.com';
            
            if (item.src) {
                // Has a direct mp4/webm URL — show poster with play button overlay
                // Clicking the play button swaps poster with autoplay <video>
                trackHtml += `
                    <div class="carousel-slide" data-index="${index}" data-video-src="${item.src}">
                        <img src="${item.thumbnail}" alt="${item.name || 'Trailer'}" class="video-poster" style="width:100%;height:100%;object-fit:cover;background:#000;">
                        <div class="video-play-btn">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        </div>
                    </div>
                `;
            } else {
                // DASH/HLS only — play button opens Steam store in new tab
                trackHtml += `
                    <div class="carousel-slide" data-index="${index}">
                        <img src="${item.thumbnail}" alt="${item.name || 'Trailer'}" style="width:100%;height:100%;object-fit:cover;background:#000;">
                        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);gap:0.75rem;">
                            <div class="video-play-btn" onclick="window.open('${steamStoreUrl}', '_blank');event.stopPropagation();">
                                <svg width="30" height="30" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            </div>
                            <span style="color:#fff;font-size:0.9rem;font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,0.9);">${item.name || '트레일러'}</span>
                            <span style="color:rgba(255,255,255,0.75);font-size:0.78rem;background:rgba(0,0,0,0.4);padding:0.2rem 0.6rem;border-radius:99px;">Steam에서 재생 ↗</span>
                        </div>
                    </div>
                `;
            }
        } else {
            trackHtml += `
                <div class="carousel-slide" data-index="${index}">
                    <img src="${item.src}" alt="Screenshot ${index + 1}">
                </div>
            `;
        }
    });

    trackHtml += '</div>';
    thumbnailsHtml += '</div>';

    let controlsHtml = '';
    if (mediaItems.length > 1) {
        controlsHtml = `
            <button class="carousel-btn prev" id="carouselPrev">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <button class="carousel-btn next" id="carouselNext">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
        `;
    }

    // Notice we place thumbnailsHtml AFTER the relative parent container is closed or just at the bottom
    // The galleryContainer will now wrap both the viewer and the strip
    galleryContainer.innerHTML = `
        <div style="position: relative; width: 100%; height: calc(100% - 80px); overflow: hidden;">
            ${trackHtml}
            ${controlsHtml}
        </div>
        ${thumbnailsHtml}
    `;

    // ---- Wire up inline video play buttons (direct mp4 slides) ----
    // Clicking play replaces the poster img with an autoplay <video> element
    document.querySelectorAll('.carousel-slide[data-video-src]').forEach(slide => {
        const playBtn = slide.querySelector('.video-play-btn');
        if (!playBtn) return;
        playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const videoSrc = slide.getAttribute('data-video-src');
            if (!videoSrc) return;
            slide.innerHTML = `
                <video autoplay controls style="width:100%;height:100%;object-fit:contain;background:#000;">
                    <source src="${videoSrc}" type="video/mp4">
                    <source src="${videoSrc}" type="video/webm">
                </video>
            `;
        });
    });

    // ---- Carousel Navigation Logic ----
    let currentIndex = 0;
    const track = document.getElementById('carouselTrack');
    const thumbnails = document.querySelectorAll('.thumbnail-item');
    const prevBtn = document.getElementById('carouselPrev');
    const nextBtn = document.getElementById('carouselNext');

    const updateCarousel = (index) => {
        // Pause any playing inline video on the current slide
        if (track) {
            const currentSlide = track.querySelector(`.carousel-slide[data-index="${currentIndex}"]`);
            if (currentSlide) {
                const video = currentSlide.querySelector('video');
                if (video) video.pause();
            }
        }

        if (track) track.style.transform = `translateX(-${index * 100}%)`;
        thumbnails.forEach(t => t.classList.remove('active'));
        if (thumbnails[index]) {
            thumbnails[index].classList.add('active');
            thumbnails[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
        currentIndex = index;
    };

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            updateCarousel(currentIndex > 0 ? currentIndex - 1 : mediaItems.length - 1);
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            updateCarousel(currentIndex < mediaItems.length - 1 ? currentIndex + 1 : 0);
        });
    }
    thumbnails.forEach(thumb => {
        thumb.addEventListener('click', (e) => {
            updateCarousel(parseInt(e.currentTarget.getAttribute('data-index'), 10));
        });
    });
}

// ── Language toggle: refresh game description on language switch ─────────────

// Helper: write description HTML into the section
const renderDesc = (htmlContent, lang) => {
    if (!htmlContent) return;
    const descSection = document.getElementById('gameDescriptionSection');
    if (!descSection) return;
    
    const title = lang === 'en' ? 'About this game' : '게임 소개 (About this game)';
    // Ensure description area is visible and not a skeleton
    descSection.classList.remove('skeleton');
    
    // Inject sanitized HTML to maintain security while matching initial/toggle logic
    descSection.innerHTML = `
        <h2 class="section-title" data-ko="게임 소개 (About this game)" data-en="About this game">${title}</h2>
        <div class="steam-description">
            ${sanitizeHTML(htmlContent)}
        </div>
    `;
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
} else {
    initAll();
}

function initAll() {
    initGameDetail();

    // Listen for the custom event dispatched by translation.js after every toggle
    window.addEventListener('languageChanged', async (e) => {
        const newLang = e.detail?.lang || window.currentLang || 'ko';

        // ── Case 1: instant switch from cache ────────────────────────────────
        if (newLang === 'en' && _cachedAboutEn) {
            renderDesc(_cachedAboutEn, 'en');
            return;
        }
        if (newLang === 'ko' && _cachedAboutKo) {
            renderDesc(_cachedAboutKo, 'ko');
            return;
        }

        // ── Case 2: cache miss → re-fetch from Steam ─────────────────────────
        if (!_cachedSteamAppID) return;

        try {
            const steamData = await fetchSteamAppDetails(_cachedSteamAppID, 'en');
            if (!steamData) return;

            // Always cache the English original
            _cachedAboutEn = steamData.about_the_game || steamData.short_description || '';
            _cachedDescEn  = steamData.short_description || '';

            if (newLang === 'ko') {
                await translateSteamDescription(steamData);
                _cachedAboutKo = steamData.about_the_game || '';
                _cachedDescKo  = steamData.short_description || '';
                renderDesc(_cachedAboutKo, 'ko');
            } else {
                renderDesc(_cachedAboutEn, 'en');
            }
        } catch (err) {
            console.error('Language switch: failed to re-fetch steam description', err);
        }
    });
}

/**
 * Fetches real reviews and updates the AI summary with actual insights.
 */
async function analyzeRealReviews(steamAppID) {
    if (!steamAppID) return;
    
    try {
        const reviews = await fetchSteamReviews(steamAppID, 30);
        if (!reviews || reviews.length === 0) return;

        const aiOneLiner = document.getElementById('aiOneLiner');
        const aiProsCons = document.getElementById('aiProsCons');
        
        // Basic Keyword Analysis (Client-side simulation of AI)
        const keywords = {
            pros: [
                { key: ['graphic', 'beautiful', 'visual', '그래픽', '비주얼'], label: { ko: '그래픽/비주얼', en: 'Graphics/Visuals' } },
                { key: ['story', 'narrative', 'plot', '스토리', '서사'], label: { ko: '스토리/서사', en: 'Story/Narrative' } },
                { key: ['optimal', 'performance', 'smooth', '최적화', '성능'], label: { ko: '최적화/성능', en: 'Optimization/Performance' } },
                { key: ['music', 'sound', 'ost', '음악', '사운드'], label: { ko: '음악/사운드', en: 'Music/Sound' } },
                { key: ['fun', 'addict', 'play', '재미', '몰입감'], label: { ko: '게임성/몰입감', en: 'Gameplay/Immersion' } }
            ],
            cons: [
                { key: ['bug', 'crash', 'glitch', '버그', '충돌'], label: { ko: '버그/불안정성', en: 'Bugs/Instability' } },
                { key: ['repetitive', 'boring', 'tedious', '반복적', '지루함'], label: { ko: '반복적인 플레이', en: 'Repetitive Gameplay' } },
                { key: ['expensive', 'overprice', 'price', '비쌈', '가격'], label: { ko: '가성비/가격', en: 'Price/Value' } },
                { key: ['hard', 'difficulty', 'unfair', '난이도', '불합리'], label: { ko: '높은 난이도', en: 'High Difficulty' } },
                { key: ['short', 'length', 'playtime', '짧은', '플레이타임'], label: { ko: '짧은 볼륨', en: 'Short Playtime' } }
            ]
        };

        let foundPros = new Set();
        let foundCons = new Set();
        let positiveTexts = [];

        reviews.forEach(r => {
            const text = (r.review || '').toLowerCase();
            if (r.voted_up) positiveTexts.push(text);
            
            keywords.pros.forEach(k => {
                if (k.key.some(word => text.includes(word))) foundPros.add(k.label);
            });
            keywords.cons.forEach(k => {
                if (k.key.some(word => text.includes(word))) foundCons.add(k.label);
            });
        });

        // Update UI if findings exist
        if (foundPros.size > 0 || foundCons.size > 0) {
            const currentLang = window.currentLang || 'ko';
            
            if (aiProsCons) {
                aiProsCons.style.display = 'grid';
                aiProsCons.classList.remove('skeleton');
                
                const prosArray = Array.from(foundPros).slice(0, 3);
                const consArray = Array.from(foundCons).slice(0, 3);

                const prosHtml = prosArray.map(p => `<li data-ko="${p.ko}" data-en="${p.en}">${currentLang === 'en' ? p.en : p.ko}</li>`).join('') || `<li data-ko="전반적으로 만족스러운 경험" data-en="Overall satisfied experience">${currentLang === 'en' ? 'Overall satisfied experience' : '전반적으로 만족스러운 경험'}</li>`;
                const consHtml = consArray.map(c => `<li data-ko="${c.ko}" data-en="${c.en}">${currentLang === 'en' ? c.en : c.ko}</li>`).join('') || `<li data-ko="특이사항 없음" data-en="No specific issues">${currentLang === 'en' ? 'No specific issues' : '특이사항 없음'}</li>`;

                aiProsCons.innerHTML = `
                    <div class="pros-col">
                        <h4 class="mb-2" style="color: #10b981; display: flex; align-items: center; gap: 0.5rem;" data-ko="👍 주요 장점" data-en="👍 Key Pros">${currentLang === 'en' ? '👍 Key Pros' : '👍 주요 장점'}</h4>
                        <ul>${prosHtml}</ul>
                    </div>
                    <div class="cons-col">
                        <h4 class="mb-2" style="color: #ef4444; display: flex; align-items: center; gap: 0.5rem;" data-ko="👎 주요 단점" data-en="👎 Key Cons">${currentLang === 'en' ? '👎 Key Cons' : '👎 주요 단점'}</h4>
                        <ul>${consHtml}</ul>
                    </div>
                `;
            }

            if (aiOneLiner) {
                let summaryKo = "";
                let summaryEn = "";
                
                if (foundPros.size > 0) {
                    const topPro = Array.from(foundPros)[0];
                    summaryKo = `"${topPro.ko} 면에서 특히 유저들의 호평을 받고 있습니다. `;
                    summaryEn = `"Users are highly praising the game for its ${topPro.en.toLowerCase()}. `;
                }
                
                if (foundCons.size > 0) {
                    const topCon = Array.from(foundCons)[0];
                    summaryKo += `다만 ${topCon.ko}에 대한 언급이 있으니 참고하세요."`;
                    summaryEn += `However, there are mentions about ${topCon.en.toLowerCase()}."`;
                } else {
                    summaryKo += `전반적으로 완성도가 높은 게임으로 평가받습니다."`;
                    summaryEn += `Overall, it's evaluated as a well-made game."`;
                }

                aiOneLiner.textContent = currentLang === 'en' ? summaryEn : summaryKo;
                aiOneLiner.classList.remove('skeleton');
                
                // Set data attributes for translation system
                aiOneLiner.setAttribute("data-ko", summaryKo);
                aiOneLiner.setAttribute("data-en", summaryEn);
            }
            
            // Remove skeletons once real data is ready
            if (aiReviewSource) aiReviewSource.classList.remove('skeleton');
            if (aiOneLiner) aiOneLiner.classList.remove('skeleton');
            const aiRateText = document.getElementById('aiPositiveRateText');
            const aiRateBarParent = document.querySelector('.ai-recommendation .progress-bg');
            if (aiRateText) aiRateText.classList.remove('skeleton');
            if (aiRateBarParent) aiRateBarParent.classList.remove('skeleton');
        }
    } catch (err) {
        console.warn('AI Review analysis failed:', err);
        // Fallback: Remove skeletons and show a basic message if analysis fails
        const aiOneLiner = document.getElementById('aiOneLiner');
        const aiReviewSource = document.getElementById('aiReviewSource');
        if (aiOneLiner) {
            aiOneLiner.classList.remove('skeleton');
            aiOneLiner.textContent = `"유저 리뷰 분석 결과를 가져올 수 없습니다. 평점 정보를 참고해 주세요."`;
        }
        if (aiReviewSource) aiReviewSource.classList.remove('skeleton');
        const aiRateText = document.getElementById('aiPositiveRateText');
        const aiRateBarParent = document.querySelector('.ai-recommendation .progress-bg');
        if (aiRateText) aiRateText.classList.remove('skeleton');
        if (aiRateBarParent) aiRateBarParent.classList.remove('skeleton');
    }
}

/**
 * Initializes Price Alert Modal logic: auto-filling email and handling submission.
 */
function initPriceAlertModal(gameID) {
    const btnSubmit = document.getElementById('btnSubmitAlert');
    const inputEmail = document.getElementById('alertEmail');
    const inputPrice = document.getElementById('alertPrice');
    const optIn = document.getElementById('emailOptIn');

    if (!btnSubmit || !inputEmail || !inputPrice) return;

    // 1. Auto-fill email if user is logged in
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            if (user && user.email) {
                inputEmail.value = user.email;
            }
        } catch (e) { console.error("Could not parse user session for email auto-fill."); }
    }

    // 2. Handle submission
    btnSubmit.addEventListener('click', async () => {
        const email = inputEmail.value.trim();
        const price = parseFloat(inputPrice.value);
        const isOptIn = optIn ? optIn.checked : false;

        // Validations
        if (!email || !email.includes('@')) {
            alert(window.currentLang === 'en' ? 'Please enter a valid email address.' : '유효한 이메일 주소를 입력해 주세요.');
            return;
        }
        if (isNaN(price) || price <= 0) {
            alert(window.currentLang === 'en' ? 'Please enter a valid target price.' : '유효한 목표 가격을 입력해 주세요.');
            return;
        }
        if (!isOptIn) {
            alert(window.currentLang === 'en' ? 'You must agree to receive notification emails.' : '알림 메일 수신에 동의해야 합니다.');
            return;
        }

        btnSubmit.disabled = true;
        const originalText = btnSubmit.textContent;
        btnSubmit.textContent = window.currentLang === 'en' ? 'Processing...' : '처리 중...';

        try {
            const success = await setPriceAlert({
                action: 'set',
                email: email,
                gameID: gameID,
                price: price
            });

            if (success) {
                alert(window.currentLang === 'en' ? 'Price alert has been set!' : '목표가 알림이 성공적으로 등록되었습니다!');
                if (typeof window.closeModal === 'function') window.closeModal();
                else if (document.getElementById('priceModal')) document.getElementById('priceModal').classList.remove('active');
            } else {
                alert(window.currentLang === 'en' ? 'Failed to set alert. Please try again.' : '알림 등록에 실패했습니다. 다시 시도해 주세요.');
            }
        } catch (err) {
            console.error("Alert registration error:", err);
            alert(window.currentLang === 'en' ? 'An error occurred. Please try again later.' : '오류가 발생했습니다. 나중에 다시 시도해 주세요.');
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.textContent = originalText;
        }
    });
}

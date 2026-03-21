import { fetchDeals, fetchStores, getStoreIconUrl, sanitizeHTML, searchGames, extractSteamAppIDFromThumb, fetchTopSellers, Currency } from './api.js';
import { isInWishlist, toggleWishlist } from './wishlist-manager.js';

// Elements
const historicLowsContainer = document.getElementById('historicLowsGrid');
const popularDealsContainer = document.getElementById('popularDealsGrid');
const topSellersContainer = document.getElementById('topSellersGrid');

let storesMap = {}; // Cache for quick store ID to Name/Icon lookups

// Platform → CheapShark storeID 매핑
// (storeID는 fetchStores() 결과에서 이름 매칭으로 동적으로 찾음)
const PLATFORM_STORE_MAP = {
    all:   null,   // 전체: storeID 파라미터 없음
    steam: '1',    // Steam
    epic:  '25',   // Epic Games Store
    gog:   '7',    // GOG
};

/** 현재 선택된 플랫폼 */
let currentPlatform = 'all';

/**
 * Creates the HTML boilerplate for a single game card.
 */
function createGameCardHTML(deal) {
    const defaultThumbnail = 'https://via.placeholder.com/400x225/1e293b/64748b?text=' + encodeURIComponent(deal.title);
    const thumbUrl = deal.thumb || defaultThumbnail;
    
    const store = storesMap[deal.storeID];
    const storeName = store ? store.storeName : 'Store';
    
    const discount = Math.round(deal.savings || 0);
    const isWishlisted = isInWishlist(deal.gameID);
    const isHistoricLow = discount > 80;
    const hlBadgeHTML = isHistoricLow
        ? `<span class="list-badge-hl-label" style="font-size:0.7rem; padding: 2px 4px; border: 1px solid var(--success-color); border-radius:3px; color: var(--success-color); margin-right:4px;">HL</span>`
        : '';
    
    const salePrice   = Currency.formatPriceSync(deal.salePrice);
    const normalPrice = Currency.formatPriceSync(deal.normalPrice);

    // 🔥 Correction: If title is "-" or empty, try extracting from thumb or display placeholder
    let displayedTitle = deal.title;
    if (!displayedTitle || displayedTitle === '-') {
        const extractedID = extractSteamAppIDFromThumb(deal.thumb);
        displayedTitle = extractedID ? `Steam Game #${extractedID}` : 'Unknown Game';
    }

    return `
        <article class="game-card" style="cursor: pointer; position: relative;" onclick="window.location.href='game-detail.html?id=${deal.gameID}&dealID=${deal.dealID}'">
            <div class="card-image-wrap">
                <div class="badge-discount">-${discount}%</div>
                <div class="badge-platform">${storeName}</div>
                <img src="${thumbUrl}" alt="${displayedTitle} cover" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='${defaultThumbnail}'" loading="lazy">
            </div>
            <div class="card-content">
                <h3 class="game-title" title="${displayedTitle}">${displayedTitle}</h3>
                <div class="game-meta">Steam Rating: <span style="color:var(--text-main); font-weight:bold;">${deal.steamRatingPercent || 'N/A'}%</span></div>
                <div class="card-footer" onclick="event.stopPropagation()">
                    <div class="flex items-center gap-2" style="margin-right: auto;">
                        ${deal.rank ? `<div class="rank-badge ${deal.rank <= 3 ? `rank-badge-${deal.rank}` : ''}">${deal.rank}</div>` : ''}
                        ${hlBadgeHTML}
                        <button class="btn-wishlist ${isWishlisted ? 'active' : ''}" 
                                title="위시리스트 추가" 
                                onclick="event.stopPropagation(); window.handleWishlistToggle(event, '${deal.gameID}', '${deal.dealID}', '${displayedTitle.replace(/'/g, "\\'")}', '${deal.thumb}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="${isWishlisted ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                        </button>
                    </div>
                    <div class="price-container">
                        <span class="price-original" data-price="${deal.normalPrice}">${normalPrice}</span>
                        <div class="flex items-center">
                            <span class="price-discount" data-price="${deal.salePrice}">${salePrice}</span>
                        </div>
                    </div>
                </div>
            </div>
        </article>
    `;
}

/**
 * Renders an array of deals into a specified container.
 */
function renderCards(deals, containerElement) {
    if (!containerElement) return;
    
    if (!deals || deals.length === 0) {
        containerElement.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--text-muted);">해당 플랫폼의 할인 게임을 찾을 수 없습니다.</div>`;
        return;
    }

    containerElement.innerHTML = sanitizeHTML(deals.map(deal => createGameCardHTML(deal)).join(''));
}

/**
 * 로딩 상태를 스켈레톤 카드로 표시
 */
function showLoadingState() {
    const skeletonHTML = `
        <div class="skeleton-card">
            <div class="skeleton-image skeleton"></div>
            <div class="skeleton-content">
                <div class="skeleton-title skeleton"></div>
                <div class="skeleton-meta skeleton"></div>
                <div class="skeleton-footer">
                    <div class="skeleton-btn skeleton"></div>
                    <div class="skeleton-price skeleton"></div>
                </div>
            </div>
        </div>
    `.repeat(3);

    if (historicLowsContainer) historicLowsContainer.innerHTML = skeletonHTML;
    if (popularDealsContainer) popularDealsContainer.innerHTML = skeletonHTML;
    
    if (topSellersContainer) {
        const topSellersSkeleton = `
            <div class="skeleton-card">
                <div class="skeleton-image skeleton" style="aspect-ratio: 16/9;"></div>
                <div class="skeleton-content">
                    <div class="skeleton-title skeleton"></div>
                </div>
            </div>
        `.repeat(10);
        topSellersContainer.innerHTML = topSellersSkeleton;
    }
}

/**
 * 주어진 플랫폼에 맞는 딜을 API에서 가져와 렌더링
 */
async function loadDealsForPlatform(platform) {
    showLoadingState();

    const storeID = PLATFORM_STORE_MAP[platform] ?? null;

    const baseHL  = { sortBy: 'Savings',     onSale: 1, pageSize: 3 };
    const basePop = { sortBy: 'Deal Rating',  onSale: 1, pageSize: 3 };

    if (storeID !== null) {
        baseHL.storeID  = storeID;
        basePop.storeID = storeID;
    }

    const [hlData, popData] = await Promise.all([
        fetchDeals(baseHL),
        fetchDeals(basePop),
    ]);

    if (historicLowsContainer) renderCards(hlData.deals,  historicLowsContainer);
    if (popularDealsContainer)  renderCards(popData.deals, popularDealsContainer);
}

/**
 * 전용 판매 순위 카드 렌더링
 */
async function loadTopSellers() {
    if (!topSellersContainer) return;

    try {
        const topSellers = await fetchTopSellers();
        
        if (!topSellers || topSellers.length === 0) {
            topSellersContainer.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--text-muted);">판매 순위 데이터를 불러올 수 없습니다.</div>`;
            return;
        }

        const html = topSellers.map((deal, index) => {
            // 순위 정보 추가
            deal.rank = index + 1;
            return createGameCardHTML(deal);
        }).join('');

        topSellersContainer.innerHTML = sanitizeHTML(html);
    } catch (e) {
        console.error("Failed to load top sellers:", e);
        topSellersContainer.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--danger-color);">데이터 로드 중 오류가 발생했습니다.</div>`;
    }
}

/**
 * 필터 버튼 이벤트 바인딩
 */
function setupFilterButtons() {
    const filterGroup = document.getElementById('platformFilterGroup');
    if (!filterGroup) return;

    filterGroup.addEventListener('click', async (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;

        const platform = btn.getAttribute('data-platform');
        if (!platform || platform === currentPlatform) return;

        // 활성 버튼 교체
        filterGroup.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPlatform = platform;

        await loadDealsForPlatform(platform);
    });
}

/**
 * 랜덤 게임 뽑기 기능 초기화
 */
async function initRandomPicker() {
    const drawBtn = document.getElementById('drawBtn');
    const display = document.getElementById('randomPickerDisplay');
    if (!drawBtn || !display) return;

    let dealsPool = [];
    let isDrawing = false;

    // 평가 좋은 게임 데이터 가져오기 (80% 이상 긍정적)
    try {
        const { deals } = await fetchDeals({ sortBy: 'Deal Rating', pageSize: 60, onSale: 1 });
        dealsPool = deals.filter(d => parseInt(d.steamRatingPercent) >= 80);
    } catch (e) {
        console.error("Failed to fetch deals for picker:", e);
    }

    drawBtn.addEventListener('click', async () => {
        if (isDrawing || dealsPool.length === 0) return;
        isDrawing = true;

        const pickerCard = document.querySelector('.hero-picker');

        // UI 상태 초기화
        drawBtn.disabled = true;
        display.classList.remove('empty');
        display.classList.add('active', 'shuffling');
        if (pickerCard) pickerCard.classList.add('shuffling-card');
        
        let shuffleCount = 0;
        const maxShuffle = 20;
        let shuffleSpeed = 50;

        const performShuffle = () => {
            if (shuffleCount < maxShuffle) {
                const randomGame = dealsPool[Math.floor(Math.random() * dealsPool.length)];
                display.innerHTML = `
                    <div class="picker-result-card" style="opacity: 0.7; filter: blur(1px);">
                        <img src="${randomGame.thumb}" class="picker-result-img" loading="lazy">
                    </div>
                `;
                shuffleCount++;
                shuffleSpeed += 25; // 감속폭을 약간 더 키움 (50 -> 75 -> 100...)
                
                // CSS 애니메이션 속도도 동기화
                if (pickerCard) {
                    pickerCard.style.setProperty('--shuffle-duration', (shuffleSpeed / 500) + 's');
                }
                
                setTimeout(performShuffle, shuffleSpeed);
            } else {
                // 최종 결과
                const luckyGame = dealsPool[Math.floor(Math.random() * dealsPool.length)];
                revealResult(luckyGame);
            }
        };

        const revealResult = (game) => {
            display.classList.remove('shuffling');
            if (pickerCard) pickerCard.classList.remove('shuffling-card');
            const store = storesMap[game.storeID];
            const storeName = store ? store.storeName : 'Store';

            display.innerHTML = sanitizeHTML(`
                <div class="picker-result-card" onclick="window.location.href='game-detail.html?id=${game.gameID}&dealID=${game.dealID}'" style="cursor: pointer;">
                    <img src="${game.thumb}" class="picker-result-img" onerror="this.src='https://via.placeholder.com/400x225/1e293b/64748b?text=Game'" loading="lazy">
                    <div class="picker-result-overlay">
                        <div class="picker-result-title">${game.title}</div>
                        <div class="picker-result-rating">★ ${game.steamRatingPercent}% Positive (${storeName})</div>
                    </div>
                </div>
            `);

            // 버튼 상태 복구
            drawBtn.disabled = false;
            drawBtn.textContent = window.currentLang === 'en' ? 'Try Again!' : '다시 뽑기!';
            drawBtn.classList.replace('btn-primary', 'btn-secondary');
            isDrawing = false;
        };

        performShuffle();
    });
}

/**
 * Initialization Sequence
 */
async function initDashboard() {
    // 1. 스토어 목록 먼저 캐시
    const storesArray = await fetchStores();
    storesArray.forEach(s => { storesMap[s.storeID] = s; });

    // 2. 필터 버튼 이벤트 연결
    setupFilterButtons();

    // 3. 초기 데이터 로드 (전체 플랫폼)
    await Promise.all([
        loadDealsForPlatform('all'),
        loadTopSellers()
    ]);

    // 4. 랜덤 뽑기 초기화
    await initRandomPicker();

    const searchInput = document.querySelector('.search-input');
    const searchSuggestions = document.getElementById('searchSuggestions');
    
    if (searchInput && searchSuggestions) {
        let debounceTimer;

        searchInput.addEventListener('input', function() {
            const query = this.value.trim();
            clearTimeout(debounceTimer);

            if (query.length < 2) {
                searchSuggestions.innerHTML = '';
                searchSuggestions.classList.remove('active');
                return;
            }

            debounceTimer = setTimeout(async () => {
                const results = await searchGames(query);
                renderSearchSuggestions(results);
            }, 300);
        });

        const renderSearchSuggestions = (results) => {
            if (!results || results.length === 0) {
                searchSuggestions.innerHTML = `<div class="suggestion-item"><div class="suggestion-info"><div class="suggestion-title text-muted" data-ko="검색 결과가 없습니다." data-en="No results found.">검색 결과가 없습니다.</div></div></div>`;
                searchSuggestions.classList.add('active');
                return;
            }

            const html = results.map(game => {
                const price = game.cheapest ? Currency.formatPriceSync(game.cheapest) : '';
                const usdPrice = game.cheapest || '';
                return `
                    <div class="suggestion-item" onclick="window.location.href='game-detail.html?id=${game.gameID}'">
                        <img src="${game.thumb}" alt="${game.external}" class="suggestion-thumb" onerror="this.src='https://via.placeholder.com/60x34/1e293b/64748b?text=Game'">
                        <div class="suggestion-info">
                            <div class="suggestion-title">${game.external}</div>
                            ${price ? `<div class="suggestion-price" data-price="${usdPrice}">${price}</div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            searchSuggestions.innerHTML = sanitizeHTML(html);
            searchSuggestions.classList.add('active');
        };

        // Close suggestions on outside click
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !searchSuggestions.contains(e.target)) {
                searchSuggestions.classList.remove('active');
            }
        });

        // Focus again to show if there's query
        searchInput.addEventListener('focus', function() {
            if (this.value.trim().length >= 2 && searchSuggestions.innerHTML !== '') {
                searchSuggestions.classList.add('active');
            }
        });

        searchInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                const query = this.value.trim();
                window.location.href = query
                    ? `all-games.html?search=${encodeURIComponent(query)}`
                    : 'all-games.html';
            }
        });
    }

    // 6. Global Wishlist Toggle Handler
    window.handleWishlistToggle = function(event, gameID, dealID, title, thumb) {
        event.preventDefault();
        event.stopPropagation();
        
        const isAdded = toggleWishlist({ gameID, dealID, title, thumb });
        const btn = event.currentTarget;
        const svg = btn.querySelector('svg');
        
        if (isAdded) {
            btn.classList.add('active');
            svg.setAttribute('fill', 'currentColor');
        } else {
            btn.classList.remove('active');
            svg.setAttribute('fill', 'none');
        }
    };

    refreshPrices(); // Start async price update
}

/**
 * Async function to refresh all displayed prices once currency data is loaded.
 */
async function refreshPrices() {
    await Currency.getExchangeRates();
    await Currency.getUserInfo();
    
    document.querySelectorAll('[data-price]').forEach(async (el) => {
        const usdPrice = el.getAttribute('data-price');
        if (usdPrice) {
            el.textContent = await Currency.formatPrice(usdPrice);
        }
    });
}

// Start immediately
document.addEventListener('DOMContentLoaded', initDashboard);

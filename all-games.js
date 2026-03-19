import { fetchDeals, fetchStores, sanitizeHTML, extractSteamAppIDFromThumb } from './api.js';
import { isInWishlist, toggleWishlist } from './wishlist-manager.js';

const allGamesList = document.getElementById('allGamesList');
let storesMap = {};

// Keep track of the current list view class (grid vs list)
let currentViewClass = 'grid-container grid-4'; 

// Pagination state
let currentPage = 0;
let totalPages = 1;

/**
 * Creates the HTML boilerplate for a single game card.
 * Reuse slightly modified logic from dashboard.js to support both list/grid wrappers better.
 */
function createGameCardHTML(deal) {
    const defaultThumbnail = 'https://via.placeholder.com/400x225/1e293b/64748b?text=' + encodeURIComponent(deal.title);
    const thumbUrl = deal.thumb || defaultThumbnail;
    
    const store = storesMap[deal.storeID];
    const storeName = store ? store.storeName : 'Store';
    
    const discount = Math.round(deal.savings || 0);
    const isWishlisted = isInWishlist(deal.gameID);
    const isHistoricLow = discount > 80; 
    const hlBadgeHTML = isHistoricLow ? `<span class="list-badge-hl-label">HL</span>` : '';
    
    const salePrice = `$${Number(deal.salePrice).toFixed(2)}`;
    const normalPrice = `$${Number(deal.normalPrice).toFixed(2)}`;

    // 🔥 Correction: If title is "-" or empty, try extracting from thumb or display placeholder
    let displayedTitle = deal.title;
    if (!displayedTitle || displayedTitle === '-') {
        const extractedID = extractSteamAppIDFromThumb(deal.thumb);
        displayedTitle = extractedID ? `Steam Game #${extractedID}` : 'Unknown Game';
    }

    return `
        <article class="game-card" style="cursor: pointer;" onclick="window.location.href='game-detail.html?id=${deal.gameID}&dealID=${deal.dealID}'">
            <div class="card-image-wrap">
                <div class="badge-discount">-${discount}%</div>
                <div class="badge-platform">${storeName}</div>
                <img src="${thumbUrl}" alt="${displayedTitle} cover" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='${defaultThumbnail}'" loading="lazy">
            </div>
            <div class="card-content">
                <div class="list-view-info-group">
                    <h3 class="game-title" title="${displayedTitle}">${displayedTitle}</h3>
                    <div class="game-meta">Steam Rating: <span style="color:var(--text-main); font-weight:bold;">${deal.steamRatingPercent || 'N/A'}%</span></div>
                </div>
                <div class="card-footer" onclick="event.stopPropagation()">
                    <div class="flex items-center gap-2" style="margin-right: auto;">
                        ${hlBadgeHTML}
                        <button class="btn-wishlist ${isWishlisted ? 'active' : ''}" 
                                title="위시리스트 추가" 
                                onclick="event.stopPropagation(); window.handleWishlistToggle(event, '${deal.gameID}', '${deal.dealID}', '${displayedTitle.replace(/'/g, "\\'")}', '${deal.thumb}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="${isWishlisted ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                        </button>
                    </div>
                    <div class="price-container">
                        ${discount > 0 ? `<span class="list-view-discount" style="display:none; color: var(--success-color); font-weight: bold; font-size: 0.8rem; line-height: 1;">-${discount}%</span>` : ''}
                        <span class="price-original">${normalPrice}</span>
                        <div class="flex items-center gap-2">
                            <span class="price-discount">${salePrice}</span>
                        </div>
                    </div>
                </div>
            </div>
        </article>
    `;
}

function renderCards(deals, containerElement) {
    if (!containerElement) return;
    
    // Clear loading or previous items
    containerElement.innerHTML = '';
    
    if (!deals || deals.length === 0) {
        containerElement.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 4rem; color: var(--text-muted);">No games found matching your criteria.</div>`;
        return;
    }

    const htmlString = deals.map(deal => createGameCardHTML(deal)).join('');
    containerElement.innerHTML = sanitizeHTML(htmlString);
}

/**
 * Main Fetch logic for All Games page with current filter states
 */
async function loadGamesWrapper(page = 0) {
    if(!allGamesList) return;
    
    // Failsafe in case event object is passed
    if (typeof page === 'object') page = 0;
    
    currentPage = page;
    
    // 스켈레톤 카드 8개로 로딩 상태 표시
    const skeletonCard = `
        <article class="game-card skeleton-card">
            <div class="card-image-wrap" style="background: rgba(255,255,255,0.06); border-radius: var(--radius-md) var(--radius-md) 0 0;">
                <div style="width:100%;height:100%;"></div>
            </div>
            <div class="card-content" style="gap: var(--spacing-3);">
                <div class="sk-block" style="height:1.1rem; width:75%; border-radius:4px;"></div>
                <div class="sk-block" style="height:0.85rem; width:50%; border-radius:4px;"></div>
                <div class="card-footer" style="margin-top:auto;">
                    <div class="sk-block" style="height:0.85rem; width:30%; border-radius:4px;"></div>
                    <div style="text-align:right;">
                        <div class="sk-block" style="height:0.75rem; width:3rem; margin-left:auto; border-radius:4px; margin-bottom:4px;"></div>
                        <div class="sk-block" style="height:1.2rem; width:4rem; margin-left:auto; border-radius:4px;"></div>
                    </div>
                </div>
            </div>
        </article>
    `;
    allGamesList.innerHTML = Array(8).fill(skeletonCard).join('');

    
    // Default params for a generic list initially
    const params = {
        onSale: 0,
        pageSize: 20,
        pageNumber: currentPage,
        sortBy: 'Recent' // Default sort by recent deals
    };

    // 0. Check Sort Filters
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
        params.sortBy = sortSelect.value;
    }

    // 1. Check Store Filters
    let selectedStores = [];
    if (document.getElementById('plat-steam')?.checked) selectedStores.push(1);
    if (document.getElementById('plat-epic')?.checked) selectedStores.push(25);
    if (document.getElementById('plat-gog')?.checked) selectedStores.push(7);
    if (document.getElementById('plat-humble')?.checked) selectedStores.push(11);
    
    if (selectedStores.length > 0) {
        params.storeID = selectedStores.join(','); 
    }

    // 2. Check Search Input
    const searchInput = document.querySelector('.search-container input');
    if (searchInput && searchInput.value.trim()) {
        params.title = searchInput.value.trim();
    }

    // 3. Check Max Price (convert KRW to USD)
    const priceSlider = document.getElementById('priceSliderInput');
    let maxKrw = 100000;
    if (priceSlider) {
        maxKrw = parseInt(priceSlider.value, 10);
        if (maxKrw < 100000) {
            params.upperPrice = Math.floor(maxKrw / 1300) || 1;
        }
    }

    // 4. Check Discount filter (using API's minSavings parameter)
    const discRadio = document.querySelector('input[name="discount"]:checked');
    if (discRadio && discRadio.id !== 'disc-any') {
        let minDisc = 0;
        if (discRadio.id === 'disc-30') minDisc = 30;
        if (discRadio.id === 'disc-50') minDisc = 50;
        if (discRadio.id === 'disc-75') minDisc = 75;
        
        if (minDisc > 0) {
            params.minSavings = minDisc;
        }
    }

    // 5. Fetch the exact needed page data from CheapShark
    const fetchedResult = await fetchDeals(params);
    let dealsData = fetchedResult.deals || [];
    totalPages = fetchedResult.totalPages || 1;

    renderCards(dealsData, allGamesList);
    renderPagination();
}

function renderPagination() {
    const paginationContainer = document.getElementById('paginationContainer');
    if (!paginationContainer) return;

    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }

    let html = '';
    
    // Prev Button
    const prevDisabled = currentPage === 0 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : '';
    html += `<button class="page-btn" ${prevDisabled} onclick="window.goToPage(${currentPage - 1})">&lt;</button>`;

    // calculate range: Show only 1 page before and after current for simplicity
    let startPage = Math.max(0, currentPage - 1);
    let endPage = Math.min(totalPages - 1, currentPage + 1);

    if (startPage > 0) {
        html += `<button class="page-btn" onclick="window.goToPage(0)">1</button>`;
        if (startPage > 1) html += `<span style="color:var(--text-muted); padding: 0 10px;">...</span>`;
    }

    for (let i = startPage; i <= endPage; i++) {
        const activeClass = i === currentPage ? 'active' : '';
        html += `<button class="page-btn ${activeClass}" onclick="window.goToPage(${i})">${i + 1}</button>`;
    }

    if (endPage < totalPages - 1) {
        if (endPage < totalPages - 2) html += `<span style="color:var(--text-muted); padding: 0 10px;">...</span>`;
        html += `<button class="page-btn" onclick="window.goToPage(${totalPages - 1})">${totalPages}</button>`;
    }

    // Next Button
    const nextDisabled = currentPage === totalPages - 1 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : '';
    html += `<button class="page-btn" ${nextDisabled} onclick="window.goToPage(${currentPage + 1})">&gt;</button>`;

    paginationContainer.innerHTML = html;
}

// Expose to window for inline HTML onclick handlers
window.goToPage = function(page) {
    if (page >= 0 && page < totalPages) {
        loadGamesWrapper(page);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

// Add event listeners to filters to reload the grid automatically
function setupFilters() {
    // Search Box
    const searchInput = document.querySelector('.search-container input');
    if(searchInput) {
        searchInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                loadGamesWrapper(0);
            }
        });
    }

    // Sort Dropdown
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => loadGamesWrapper(0));
    }

    // Apply Filter Button
    const btnApplyFilters = document.getElementById('btnApplyFilters');
    if (btnApplyFilters) {
        btnApplyFilters.addEventListener('click', () => loadGamesWrapper(0));
    }

    // Price Slider UI Update & Auto-reload
    const priceSlider = document.getElementById('priceSliderInput');
    const priceLabel = document.getElementById('priceSliderLabel');
    if (priceSlider && priceLabel) {
        priceSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            if(val >= 100000) {
                priceLabel.textContent = (document.documentElement.lang === 'en' ? 'No Limit' : '제한 없음');
            } else {
                priceLabel.textContent = `₩${val.toLocaleString()}` + (document.documentElement.lang === 'en' ? ' or less' : ' 이하');
            }
        });
        // Reload when the user stops sliding
        priceSlider.addEventListener('change', () => loadGamesWrapper(0));
    }

    // Auto-reload on Discount Radio change
    const discountRadios = document.querySelectorAll('input[name="discount"]');
    discountRadios.forEach(radio => {
        radio.addEventListener('change', () => loadGamesWrapper(0));
    });

    // Auto-reload on Platform Checkbox change
    const platformCheckboxes = document.querySelectorAll('.filter-custom-input[type="checkbox"]');
    platformCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => loadGamesWrapper(0));
    });

    // Auto-reload on Genre Checkbox change
    const genreCheckboxes = document.querySelectorAll('.checkbox-group input[type="checkbox"]');
    genreCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => loadGamesWrapper(0));
    });
}

async function initAllGames() {
    const storesArray = await fetchStores();
    storesArray.forEach(s => {
        storesMap[s.storeID] = s;
    });

    setupFilters();

    // Check URL for search parameter (e.g., from index.html redirection)
    const urlParams = new URLSearchParams(window.location.search);
    const searchQuery = urlParams.get('search');
    
    if (searchQuery) {
        const searchInput = document.querySelector('.search-container input');
        if (searchInput) {
            searchInput.value = searchQuery;
        }

        // Automatically set discount filter to 'Any' to show all search results
        const discAnyRadio = document.getElementById('disc-any');
        if (discAnyRadio) {
            discAnyRadio.checked = true;
        }
        
        // Automatically set price limit to 'No Limit'
        const priceSlider = document.getElementById('priceSliderInput');
        const priceLabel = document.getElementById('priceSliderLabel');
        if (priceSlider && priceLabel) {
            priceSlider.value = 100000;
            priceLabel.textContent = '제한 없음';
        }
    }

    await loadGamesWrapper();

    // Global Wishlist Toggle Handler (Synced with dashboard.js)
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
}

document.addEventListener('DOMContentLoaded', initAllGames);

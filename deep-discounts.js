import { fetchDeals, fetchStores, sanitizeHTML, Currency } from './api.js';
import { isInWishlist, toggleWishlist } from './wishlist-manager.js';

const grid = document.getElementById('deepDiscountsGrid');
let storesMap = {};

function createGameCardHTML(deal) {
    const thumbUrl = deal.thumb || 'https://via.placeholder.com/400x225/1e293b/64748b?text=' + encodeURIComponent(deal.title);
    const store = storesMap[deal.storeID];
    const storeName = store ? store.storeName : 'Store';
    const discount = Math.round(deal.savings || 0);
    const isWishlisted = isInWishlist(deal.gameID);
    
    return `
        <article class="game-card" style="cursor: pointer;" onclick="window.location.href='game-detail.html?id=${deal.gameID}&dealID=${deal.dealID}'">
            <div class="card-image-wrap">
                <div class="badge-discount" style="background-color: #ef4444;">-${discount}%</div>
                <div class="badge-platform">${storeName}</div>
                <img src="${thumbUrl}" alt="${deal.title} cover" style="width: 100%; height: 100%; object-fit: cover;">
            </div>
            <div class="card-content">
                <h3 class="game-title" title="${deal.title}">${deal.title}</h3>
                <div class="game-meta">Steam Rating: <span style="color:var(--text-main); font-weight:bold;">${deal.steamRatingPercent || 'N/A'}%</span></div>
                <div class="card-footer" onclick="event.stopPropagation()">
                    <div class="flex items-center gap-2" style="margin-right: auto;">
                        <button class="btn-wishlist ${isWishlisted ? 'active' : ''}" 
                                title="위시리스트 추가" 
                                onclick="event.stopPropagation(); window.handleWishlistToggle(event, '${deal.gameID}', '${deal.dealID}', '${deal.title.replace(/'/g, "\\'")}', '${deal.thumb}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="${isWishlisted ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                        </button>
                    </div>
                    <div class="price-container">
                        <span class="price-original" data-price="${deal.normalPrice}">${Currency.formatPriceSync(deal.normalPrice)}</span>
                        <span class="price-discount" data-price="${deal.salePrice}">${Currency.formatPriceSync(deal.salePrice)}</span>
                    </div>
                </div>
            </div>
        </article>
    `;
}

async function loadDeepDiscounts() {
    // Show skeleton
    grid.innerHTML = Array(8).fill('<div class="skeleton-card" style="height:300px; background: rgba(255,255,255,0.05); border-radius: var(--radius-lg);"></div>').join('');

    const { deals } = await fetchDeals({
        minSavings: 80,
        pageSize: 40,
        sortBy: 'Savings'
    });

    if (deals.length === 0) {
        grid.innerHTML = '<p class="text-center text-muted" style="grid-column: 1/-1;">현재 80% 이상의 파격 할인 게임이 없습니다.</p>';
        return;
    }

    grid.innerHTML = sanitizeHTML(deals.map(createGameCardHTML).join(''));
}

async function refreshPrices() {
    const priceElements = document.querySelectorAll('[data-price]');
    for (const el of priceElements) {
        const usdPrice = el.dataset.price;
        if (usdPrice) {
            el.textContent = await Currency.formatPrice(usdPrice);
        }
    }
}

async function init() {
    const storesArray = await fetchStores();
    storesArray.forEach(s => { storesMap[s.storeID] = s; });

    await loadDeepDiscounts();
    
    // Refresh prices after currency data is loaded
    refreshPrices();

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

document.addEventListener('DOMContentLoaded', init);

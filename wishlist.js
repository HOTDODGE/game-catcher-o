import { fetchStores, sanitizeHTML, fetchGameDetails, Currency } from './api.js';
import { getWishlist, toggleWishlist } from './wishlist-manager.js';

const wishlistGrid = document.getElementById('wishlistGrid');
const emptyState = document.getElementById('emptyState');
let storesMap = {};

/**
 * Creates game card HTML for wishlist items.
 * Wishlist items might need fresh price data, so we fetch details if possible.
 */
function createWishlistCardHTML(game, freshData = null) {
    const deal = freshData ? freshData.deals[0] : null;
    const salePrice = deal ? Currency.formatPriceSync(deal.price) : 'Check Price';
    const usdPrice = deal ? deal.price : '';
    const store = deal ? storesMap[deal.storeID] : null;
    const storeName = store ? store.storeName : '';
    
    const thumbUrl = game.thumb || 'https://via.placeholder.com/400x225/1e293b/64748b?text=Game';
    
    return `
        <article class="game-card" style="cursor: pointer;" onclick="window.location.href='game-detail.html?id=${game.gameID}${game.dealID ? '&dealID='+game.dealID : ''}'">
            <div class="card-image-wrap">
                ${deal && deal.savings > 0 ? `<div class="badge-discount">-${Math.round(deal.savings)}%</div>` : ''}
                ${storeName ? `<div class="badge-platform">${storeName}</div>` : ''}
                <img src="${thumbUrl}" alt="${game.title} cover" style="width: 100%; height: 100%; object-fit: cover;">
            </div>
            <div class="card-content">
                <h3 class="game-title" title="${game.title}">${game.title}</h3>
                <div class="card-footer" onclick="event.stopPropagation()">
                    <div class="flex items-center gap-2" style="margin-right: auto;">
                        <button class="btn-wishlist active" 
                                title="위시리스트 삭제" 
                                onclick="window.handleWishlistToggle(event, '${game.gameID}', '${game.dealID}', '${game.title.replace(/'/g, "\\'")}', '${game.thumb}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                        </button>
                    </div>
                    <div class="price-container">
                        <span class="price-discount" ${usdPrice ? `data-price="${usdPrice}"` : ''}>${salePrice}</span>
                    </div>
                </div>
            </div>
        </article>
    `;
}

async function renderWishlist() {
    const list = getWishlist();
    
    if (list.length === 0) {
        wishlistGrid.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    wishlistGrid.style.display = 'grid';
    emptyState.style.display = 'none';
    
    // Show placeholder/loading cards first
    wishlistGrid.innerHTML = list.map(item => createWishlistCardHTML(item)).join('');

    // Try to fetch fresh prices in parallel
    try {
        const freshDataList = await Promise.all(list.map(item => fetchGameDetails(item.gameID)));
        
        const html = list.map((item, index) => {
            const freshData = freshDataList[index];
            return createWishlistCardHTML(item, freshData);
        }).join('');
        
        wishlistGrid.innerHTML = sanitizeHTML(html);
    } catch (e) {
        console.warn("Failed to fetch fresh prices for wishlist:", e);
    }
}

async function initWishlist() {
    const storesArray = await fetchStores();
    storesArray.forEach(s => { storesMap[s.storeID] = s; });

    await renderWishlist();

    // Global Wishlist Toggle Handler
    window.handleWishlistToggle = function(event, gameID, dealID, title, thumb) {
        event.preventDefault();
        event.stopPropagation();
        
        toggleWishlist({ gameID, dealID, title, thumb });
        // Instead of toggling icon, we re-render since it's the wishlist page
        renderWishlist();
    };
    
    // Sync if updated from other tabs/modals
    window.addEventListener('wishlistUpdated', renderWishlist);

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

document.addEventListener('DOMContentLoaded', initWishlist);

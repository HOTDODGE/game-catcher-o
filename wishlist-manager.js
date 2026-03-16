/**
 * wishlist-manager.js
 * Manages game wishlist using browser localStorage.
 */

const WISHLIST_KEY = 'gamecatcher_wishlist';

/**
 * Get the current wishlist from localStorage.
 * @returns {Array} Array of objects { gameID, dealID, title, thumb, addedAt }
 */
export function getWishlist() {
    try {
        const stored = localStorage.getItem(WISHLIST_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error("Failed to parse wishlist from localStorage:", e);
        return [];
    }
}

/**
 * Check if a game is in the wishlist.
 * @param {string|number} gameId 
 * @returns {boolean}
 */
export function isInWishlist(gameId) {
    const list = getWishlist();
    return list.some(item => String(item.gameID) === String(gameId));
}

/**
 * Toggle a game in the wishlist.
 * @param {Object} gameData { gameID, dealID, title, thumb }
 * @returns {boolean} New state (true if added, false if removed)
 */
export function toggleWishlist(gameData) {
    if (!gameData || !gameData.gameID) return false;
    
    let list = getWishlist();
    const index = list.findIndex(item => String(item.gameID) === String(gameData.gameID));
    let added = false;

    if (index > -1) {
        // Remove
        list.splice(index, 1);
        added = false;
    } else {
        // Add
        list.push({
            gameID: String(gameData.gameID),
            dealID: String(gameData.dealID || ''),
            title: gameData.title,
            thumb: gameData.thumb,
            addedAt: Date.now()
        });
        added = true;
    }

    try {
        localStorage.setItem(WISHLIST_KEY, JSON.stringify(list));
        // Dispatch custom event for real-time UI updates across components
        window.dispatchEvent(new CustomEvent('wishlistUpdated', { 
            detail: { gameID: gameData.gameID, added } 
        }));
    } catch (e) {
        console.error("Failed to save wishlist to localStorage:", e);
    }

    return added;
}

/**
 * Remove a specific game from wishlist by ID.
 * @param {string|number} gameId 
 */
export function removeFromWishlist(gameId) {
    let list = getWishlist();
    const filtered = list.filter(item => String(item.gameID) !== String(gameId));
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(filtered));
    window.dispatchEvent(new CustomEvent('wishlistUpdated', { 
        detail: { gameID: gameId, added: false } 
    }));
}

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

        // 🔥 백엔드 동기화 추가
        const idToken = localStorage.getItem('google_id_token');
        if (idToken) {
            console.log("[Wishlist] Syncing toggle to backend...");
            fetch('/.netlify/functions/supabase-sync', {
                method: 'POST',
                body: JSON.stringify({
                    action: 'TOGGLE_WISHLIST',
                    idToken: idToken,
                    payload: { 
                        gameID: gameData.gameID, 
                        dealID: gameData.dealID,
                        title: gameData.title,
                        thumb: gameData.thumb,
                        added 
                    }
                })
            }).catch(err => console.error("[Wishlist] Backend toggle failed:", err));
        }
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

/**
 * 로그인 시 백엔드 데이터와 병합
 */
window.addEventListener('backendSynced', (event) => {
    const { wishlist } = event.detail;
    if (!wishlist) return;

    let localList = getWishlist();
    
    // 백엔드 데이터를 기준으로 로컬 업데이트 (백엔드 데이터 신뢰)
    // 실제로는 정교한 병합 로직(Timestamp 비교 등)이 필요할 수 있으나, 여기서는 백엔드 덮어쓰기/추가 형식 사용
    const merged = [...localList];
    
    wishlist.forEach(remoteItem => {
        const index = merged.findIndex(i => String(i.gameID) === String(remoteItem.game_id));
        const formattedItem = {
            gameID: String(remoteItem.game_id),
            dealID: String(remoteItem.deal_id || ''),
            title: remoteItem.title,
            thumb: remoteItem.thumb,
            addedAt: new Date(remoteItem.added_at).getTime()
        };

        if (index > -1) {
            merged[index] = formattedItem;
        } else {
            merged.push(formattedItem);
        }
    });

    localStorage.setItem(WISHLIST_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent('wishlistUpdated', { detail: { action: 'merge' } }));
    console.log("[Wishlist] Merged with backend data.");
});

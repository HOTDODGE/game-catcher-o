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
window.addEventListener('backendSynced', async (event) => {
    const { wishlist: remoteWishlist } = event.detail;
    if (!remoteWishlist) return;

    let localList = getWishlist();
    let hasLocalOnlyItems = false;
    
    // 1. 병합 로직: 로컬에만 있는 아이템이 있는지 확인
    const merged = [...localList];
    
    remoteWishlist.forEach(remoteItem => {
        const index = merged.findIndex(i => String(i.gameID) === String(remoteItem.game_id));
        const formattedItem = {
            gameID: String(remoteItem.game_id),
            dealID: String(remoteItem.deal_id || ''),
            title: remoteItem.title,
            thumb: remoteItem.thumb,
            addedAt: new Date(remoteItem.added_at).getTime()
        };

        if (index > -1) {
            // 이미 있으면 서버 데이터로 업데이트 (서버 우선)
            merged[index] = formattedItem;
        } else {
            // 서버에만 있는 데이터면 추가
            merged.push(formattedItem);
        }
    });

    // 2. 로컬에만 있던 아이템이 있는지 체크 (병합된 결과의 개수가 서버 데이터보다 많으면 로컬 데이터가 있었던 것)
    if (merged.length > remoteWishlist.length) {
        hasLocalOnlyItems = true;
    }

    // 3. 로컬 저장소 업데이트
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent('wishlistUpdated', { detail: { action: 'merge' } }));
    console.log("[Wishlist] Merged with backend data. Local items found:", hasLocalOnlyItems);

    // 4. 로컬에만 있던 아이템이 있다면 서버로 전체 리스트 전송 (양방향 동기화)
    if (hasLocalOnlyItems) {
        const idToken = localStorage.getItem('google_id_token');
        if (idToken) {
            console.log("[Wishlist] Pushing local items to backend for full sync...");
            fetch('/.netlify/functions/supabase-sync', {
                method: 'POST',
                body: JSON.stringify({
                    action: 'SYNC_WISHLIST',
                    idToken: idToken,
                    payload: { items: merged }
                })
            }).catch(err => console.error("[Wishlist] Initial sync push failed:", err));
        }
    }
});

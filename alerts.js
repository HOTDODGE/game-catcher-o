/**
 * alerts.js
 * Handles the alerts overlay when clicking the user profile.
 */

import { setPriceAlert, sanitizeHTML } from './api.js';

document.addEventListener('DOMContentLoaded', () => {
    initAlertsOverlay();
});

function initAlertsOverlay() {
    const userProfile = document.getElementById('userProfile');
    if (!userProfile) return;

    // Create Modal Structure if not exists
    let alertsModal = document.getElementById('alertsOverlayModal');
    if (!alertsModal) {
        alertsModal = document.createElement('div');
        alertsModal.id = 'alertsOverlayModal';
        alertsModal.className = 'modal-overlay';
        alertsModal.innerHTML = `
            <div class="modal-container">
                <div class="modal-header">
                    <h3 class="modal-title" data-ko="내 알림 목록" data-en="My Price Alerts">내 알림 목록</h3>
                    <button class="modal-close" id="closeAlertsOverlay">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <div class="modal-body">
                    <div id="alertsListContainer" class="alerts-list">
                        <!-- Alerts will be injected here -->
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(alertsModal);

        // Close logic
        const closeBtn = alertsModal.querySelector('#closeAlertsOverlay');
        closeBtn.onclick = () => alertsModal.classList.remove('active');
        alertsModal.onclick = (e) => {
            if (e.target === alertsModal) alertsModal.classList.remove('active');
        };
    }

    // Bind click to profile
    userProfile.addEventListener('click', (e) => {
        // Don't trigger if logout button was clicked
        if (e.target.id === 'logoutBtn') return;
        
        renderAlertsList();
        alertsModal.classList.add('active');
    });
}

async function renderAlertsList() {
    const container = document.getElementById('alertsListContainer');
    if (!container) return;

    const savedAlerts = JSON.parse(localStorage.getItem('user_alerts') || '[]');
    
    if (savedAlerts.length === 0) {
        const isEn = window.currentLang === 'en';
        container.innerHTML = `
            <div class="empty-alerts">
                <div class="empty-alerts-icon">🔔</div>
                <p>${isEn ? 'No active price alerts.' : '설정된 가격 알림이 없습니다.'}</p>
                <p style="font-size: 0.8rem; margin-top: 0.5rem; opacity: 0.7;">
                    ${isEn ? 'Set alerts on game detail pages to see them here.' : '게임 상세 페이지에서 알림을 설정해 보세요.'}
                </p>
            </div>
        `;
        return;
    }

    const html = savedAlerts.map(alert => {
        return `
            <div class="alert-item">
                <img src="${alert.thumb}" alt="${alert.title}" class="alert-thumb" onerror="this.src='https://via.placeholder.com/80x45?text=No+Image'">
                <div class="alert-info" onclick="location.href='game-detail.html?id=${alert.gameID}'" style="cursor: pointer;">
                    <div class="alert-game-title">${alert.title}</div>
                    <div class="alert-price-tag" data-ko="목표가: $${alert.targetPrice}" data-en="Target: $${alert.targetPrice}">목표가: $${alert.targetPrice}</div>
                </div>
                <button class="btn-delete-alert" title="알림 삭제" data-alert-id="${alert.gameID}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
            </div>
        `;
    }).join('');

    container.innerHTML = sanitizeHTML(html);

    // Bind delete buttons
    container.querySelectorAll('.btn-delete-alert').forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            const gameID = btn.getAttribute('data-alert-id');
            await deleteAlert(gameID);
        };
    });
}

async function deleteAlert(gameID) {
    const isEn = window.currentLang === 'en';
    if (!confirm(isEn ? 'Remove this price alert?' : '이 가격 알림을 삭제하시겠습니까?')) return;

    // 1. Remove from LocalStorage
    let alerts = JSON.parse(localStorage.getItem('user_alerts') || '[]');
    alerts = alerts.filter(a => String(a.gameID) !== String(gameID));
    localStorage.setItem('user_alerts', JSON.stringify(alerts));

    // 2. Try to remove from API (requires email)
    const savedUser = localStorage.getItem('user');
    const idToken = localStorage.getItem('google_id_token');

    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            if (user && user.email) {
                await setPriceAlert({
                    action: 'delete',
                    email: user.email,
                    gameID: gameID
                });
                console.log("[API] Price alert deleted from server.");
            }
        } catch (e) { console.error("API deletion failed:", e); }
    }

    // 🔥 백엔드 동기화 추가
    if (idToken) {
        console.log("[Alerts] Syncing deletion to backend...");
        fetch('/.netlify/functions/supabase-sync', {
            method: 'POST',
            body: JSON.stringify({
                action: 'TOGGLE_ALERT',
                idToken: idToken,
                payload: { 
                    action: 'delete',
                    gameID: gameID 
                }
            })
        }).catch(err => console.error("[Alerts] Backend deletion failed:", err));
    }

    // 3. Refresh List
    renderAlertsList();
}

/**
 * 로그인 시 백엔드 알림 데이터와 병합
 */
window.addEventListener('backendSynced', (event) => {
    const { notifications } = event.detail;
    if (!notifications) return;

    let localAlerts = JSON.parse(localStorage.getItem('user_alerts') || '[]');
    
    // 백엔드 데이터를 기준으로 로컬 업데이트
    const merged = [...localAlerts];
    
    notifications.forEach(remoteAlert => {
        const index = merged.findIndex(a => String(a.gameID) === String(remoteAlert.game_id));
        const formattedAlert = {
            gameID: String(remoteAlert.game_id),
            title: remoteAlert.title,
            thumb: remoteAlert.thumb || '', // 만약 백엔드에 thumb가 없다면 빈값
            targetPrice: parseFloat(remoteAlert.threshold_price),
            timestamp: new Date(remoteAlert.created_at).getTime()
        };

        if (index > -1) {
            merged[index] = formattedAlert;
        } else {
            merged.push(formattedAlert);
        }
    });

    localStorage.setItem('user_alerts', JSON.stringify(merged));
    // UI 업데이트를 위해 리스트가 열려있다면 다시 렌더링
    if (document.getElementById('alertsOverlayModal')?.classList.contains('active')) {
        renderAlertsList();
    }
    console.log("[Alerts] Merged with backend data.");
});

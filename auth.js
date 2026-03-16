/**
 * auth.js - Google Login & Session Management
 */

// Google Client ID (가급적 환경 변수나 설정 파일에서 관리하는 것이 좋으나, 여기서는 하드코딩 또는 플레이스홀더 사용)
const GOOGLE_CLIENT_ID = '551903219578-oku814in699bmhuce5svg8g84v7f0dbh.apps.googleusercontent.com'; // 사용자가 실제 자신의 ID로 변경해야 함

/**
 * JWT 토큰 디코딩 (구글 ID 토큰에서 사용자 정보 추출)
 */
function decodeJwtResponse(token) {
    let base64Url = token.split('.')[1];
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    let jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
}

/**
 * 로그인 상태 UI 업데이트
 */
function updateAuthUI(user) {
    const loginBtn = document.getElementById('g_id_signin');
    const userProfile = document.getElementById('userProfile');
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');

    if (user) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (userProfile) {
            userProfile.style.display = 'flex';
            userAvatar.src = user.picture;
            userName.textContent = user.name;
        }
    } else {
        if (loginBtn) {
            loginBtn.style.display = 'block';
            // 버튼이 내부적으로 렌더링되지 않았을 경우를 대비해 다시 렌더링 시도
            if (window.google && google.accounts && loginBtn.innerHTML === "") {
                renderGoogleButton();
            }
        }
        if (userProfile) userProfile.style.display = 'none';
    }
}

/**
 * 구글 로그인 콜백
 */
window.handleCredentialResponse = (response) => {
    const responsePayload = decodeJwtResponse(response.credential);

    // 세션 저장
    localStorage.setItem('user', JSON.stringify({
        name: responsePayload.name,
        picture: responsePayload.picture,
        email: responsePayload.email
    }));

    updateAuthUI(responsePayload);
};

/**
 * 로그아웃 처리
 */
function logout() {
    localStorage.removeItem('user');
    if (window.google && google.accounts) {
        google.accounts.id.disableAutoSelect();
    }
    updateAuthUI(null);
    location.reload(); 
}

/**
 * 구글 로그인 버튼 렌더링
 */
function renderGoogleButton() {
    const signinDiv = document.getElementById("g_id_signin");
    if (signinDiv && window.google) {
        google.accounts.id.renderButton(
            signinDiv,
            { theme: "outline", size: "medium", type: "standard", shape: "pill" }
        );
    }
}

/**
 * 구글 로그인 시스템 초기화
 */
window.initGoogleLogin = () => {
    if (!window.google || !google.accounts) {
        console.warn('Google Identity Services script not yet loaded.');
        return;
    }

    if (GOOGLE_CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com') {
        const signinDiv = document.getElementById("g_id_signin");
        if (signinDiv) {
            signinDiv.innerHTML = '<span style="font-size:0.7rem; color:var(--text-muted);">Client ID Configuration Required</span>';
        }
        return;
    }

    google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: window.handleCredentialResponse
    });

    renderGoogleButton();

    // 기존 로그인 세션 확인 (초기화 직후 UI 상태 동기화)
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
        updateAuthUI(JSON.parse(savedUser));
    }
};

/**
 * 페이지 로드 시 초기화 시도
 */
document.addEventListener('DOMContentLoaded', () => {
    // 1. 기존 세션이 있다면 즉시 UI 반영 (구글 스크립트 대기 없이 레이아웃 안정화)
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
        updateAuthUI(JSON.parse(savedUser));
    }

    // 2. 이미 구글 스크립트가 로드되었다면 즉시 초기화
    if (window.google && google.accounts) {
        initGoogleLogin();
    }

    // 3. 로그아웃 버튼 이벤트 리스너 등록
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
});

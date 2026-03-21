const { createClient } = require('@supabase/supabase-js');
const { OAuth2Client } = require('google-auth-library');

// Supabase 설정
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // 서비스 롤 키 권장
const supabase = createClient(supabaseUrl, supabaseKey);

// 구글 인증 설정
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

exports.handler = async (event, context) => {
  // CORS 처리
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      },
    };
  }

  try {
    const { action, idToken, payload } = JSON.parse(event.body);

    // 1. 구글 ID 토큰 검증
    const ticket = await client.verifyIdToken({
      idToken: idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const userPayload = ticket.getPayload();
    const googleId = userPayload['sub'];
    const email = userPayload['email'];

    // 2. 사용자 프로필 동기화 (Upsert)
    let { data: profile, error: profileError } = await supabase
      .from('profiles')
      .upsert({
        google_id: googleId,
        email: email,
        name: userPayload['name'],
        avatar_url: userPayload['picture'],
        updated_at: new Date(),
      }, { onConflict: 'google_id' })
      .select()
      .single();

    if (profileError) throw profileError;

    const userId = profile.id;

    // 3. 액션별 처리
    switch (action) {
      case 'LOGIN':
        // 최신 위시리스트와 알림 목록 반환
        const [wishlistRes, notifyRes] = await Promise.all([
          supabase.from('wishlist').select('*').eq('user_id', userId),
          supabase.from('notifications').select('*').eq('user_id', userId)
        ]);
        return {
          statusCode: 200,
          body: JSON.stringify({
            profile,
            wishlist: wishlistRes.data || [],
            notifications: notifyRes.data || []
          }),
        };

      case 'SYNC_WISHLIST':
        // 전체 리스트 동기화 (간단하게 구현하기 위해 Upsert 사용)
        if (Array.isArray(payload.items)) {
          const items = payload.items.map(item => ({
            user_id: userId,
            game_id: String(item.gameID),
            deal_id: String(item.dealID || ''),
            title: item.title,
            thumb: item.thumb,
            added_at: new Date(item.added_at || Date.now())
          }));
          
          const { error: syncError } = await supabase
            .from('wishlist')
            .upsert(items, { onConflict: 'user_id, game_id' });
            
          if (syncError) throw syncError;
        }
        return { statusCode: 200, body: JSON.stringify({ success: true }) };

      case 'TOGGLE_WISHLIST':
        if (payload.added) {
          // 추가
          await supabase.from('wishlist').upsert({
            user_id: userId,
            game_id: String(payload.gameID),
            deal_id: String(payload.dealID || ''),
            title: payload.title,
            thumb: payload.thumb,
            added_at: new Date()
          }, { onConflict: 'user_id, game_id' });
        } else {
          // 삭제
          await supabase.from('wishlist').delete().match({ user_id: userId, game_id: String(payload.gameID) });
        }
        return { statusCode: 200, body: JSON.stringify({ success: true }) };

      case 'TOGGLE_ALERT':
        if (payload.action === 'set') {
          await supabase.from('notifications').upsert({
            user_id: userId,
            game_id: String(payload.gameID),
            title: payload.title,
            threshold_price: payload.price,
            is_active: true,
            created_at: new Date()
          }, { onConflict: 'user_id, game_id' });
        } else {
          await supabase.from('notifications').delete().match({ user_id: userId, game_id: String(payload.gameID) });
        }
        return { statusCode: 200, body: JSON.stringify({ success: true }) };

      default:
        return { statusCode: 400, body: 'Invalid action' };
    }

  } catch (error) {
    console.error('Supabase Sync Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

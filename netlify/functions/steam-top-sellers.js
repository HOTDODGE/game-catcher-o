// netlify/functions/steam-top-sellers.js
// Node.js 18+ includes native fetch.

exports.handler = async (event, context) => {
  const steamUrl = 'https://store.steampowered.com/api/featuredcategories?l=english';
  const CHEAPSHARK_BASE_URL = 'https://www.cheapshark.com/api/1.0';

  try {
    console.log('Fetching Steam Categories...');
    const steamRes = await fetch(steamUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!steamRes.ok) {
      throw new Error(`Steam API responded with ${steamRes.status}`);
    }

    const steamData = await steamRes.json();
    
    // 1. Gather all candidate AppIDs from multiple sections
    const categories = ['top_sellers', 'new_releases', 'specials', 'coming_soon'];
    const candidateAppIDs = [];
    const seenAppIDs = new Set();

    categories.forEach(cat => {
      if (steamData[cat] && steamData[cat].items) {
        steamData[cat].items.forEach(item => {
          if (!seenAppIDs.has(item.id)) {
            seenAppIDs.add(item.id);
            candidateAppIDs.push(item.id);
          }
        });
      }
    });

    console.log(`Found ${candidateAppIDs.length} candidate AppIDs. Mapping to CheapShark...`);

    // 2. Map to CheapShark deals (Server-to-Server, no CORS issues)
    const validDeals = [];
    const seenGameIDs = new Set();
    const BATCH_SIZE = 8;

    // We only need 10 unique games
    for (let i = 0; i < candidateAppIDs.length; i += BATCH_SIZE) {
      const batch = candidateAppIDs.slice(i, i + BATCH_SIZE);
      
      const batchResults = await Promise.all(batch.map(async (appID) => {
        try {
          const csUrl = `${CHEAPSHARK_BASE_URL}/deals?steamAppID=${appID}&pageSize=1`;
          const csRes = await fetch(csUrl);
          if (!csRes.ok) return null;
          
          const deals = await csRes.json();
          if (deals && deals.length > 0) {
            const deal = deals[0];
            // Strict de-duplication by CheapShark gameID
            if (!seenGameIDs.has(deal.gameID)) {
              seenGameIDs.add(deal.gameID);
              // Add rank for the UI (1st encountered in candidates = rank 1)
              return deal;
            }
          }
          return null;
        } catch (err) {
          return null;
        }
      }));

      const filtered = batchResults.filter(d => d !== null);
      validDeals.push(...filtered);

      if (validDeals.length >= 10) break;
    }

    // Assign final ranks based on discovery order
    const finalDeals = validDeals.slice(0, 10).map((deal, index) => ({
        ...deal,
        rank: index + 1
    }));

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        top_sellers: {
          items: finalDeals
        }
      }),
    };
  } catch (error) {
    console.error('Steam Top Sellers Function Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

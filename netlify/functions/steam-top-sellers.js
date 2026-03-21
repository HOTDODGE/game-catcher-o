// netlify/functions/steam-top-sellers.js
// Node.js 18+ includes native fetch.

exports.handler = async (event, context) => {
  const steamUrl = 'https://store.steampowered.com/api/featuredcategories?l=english&cc=us';
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
          // Type 0 is for individual apps (games). Filter out bundles/packages (type 1, 2, etc.) 
          // to ensure detail page and CheapShark mapping work correctly.
          if (item.type === 0 && !seenAppIDs.has(item.id)) {
            seenAppIDs.add(item.id);
            candidateAppIDs.push(item.id);
          }
        });
      }
    });

    console.log(`Found ${candidateAppIDs.length} candidate AppIDs. Mapping to CheapShark...`);

    // 2. Map to CheapShark deals with strict filtering
    const finalItems = [];
    const seenGameIDs = new Set();
    const BATCH_SIZE = 8; // Faster batching

    for (let i = 0; i < candidateAppIDs.length; i += BATCH_SIZE) {
      const batch = candidateAppIDs.slice(i, i + BATCH_SIZE);
      
      const batchResults = await Promise.all(batch.map(async (appID) => {
        try {
          const csUrl = `${CHEAPSHARK_BASE_URL}/deals?steamAppID=${appID}&pageSize=1`;
          const csRes = await fetch(csUrl);
          if (csRes.ok) {
            const deals = await csRes.json();
            if (deals && deals.length > 0) {
              const deal = deals[0];
              // De-duplicate and ensure it's a valid deal object
              if (!seenGameIDs.has(deal.gameID)) {
                seenGameIDs.add(deal.gameID);
                return deal;
              }
            }
          }
        } catch (err) {
          console.error(`CheapShark fetch failed for ${appID}:`, err);
        }
        return null;
      }));

      const filtered = batchResults.filter(d => d !== null);
      finalItems.push(...filtered);

      // Stop once we have 10 genuine game deals
      if (finalItems.length >= 10) break;
    }

    // Assign final ranks
    const finalDeals = finalItems.slice(0, 10).map((deal, index) => ({
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

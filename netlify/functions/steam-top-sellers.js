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
    
    // 1. Gather candidate AppIDs primarily from 'top_sellers' to reduce workload
    const candidateAppIDs = [];
    const seenAppIDs = new Set();

    if (steamData.top_sellers && steamData.top_sellers.items) {
      // Limit to top 20 items to avoid rate limiting and timeouts on CheapShark API
      for (const item of steamData.top_sellers.items.slice(0, 20)) {
        if (item.type === 0 && !seenAppIDs.has(item.id)) {
          seenAppIDs.add(item.id);
          candidateAppIDs.push(item.id);
        }
      }
    }

    // If we don't have enough, grab some from 'new_releases' or 'specials' (up to 30 max)
    const backupCategories = ['new_releases', 'specials'];
    for (const cat of backupCategories) {
      if (candidateAppIDs.length >= 30) break;
      if (steamData[cat] && steamData[cat].items) {
        for (const item of steamData[cat].items.slice(0, 10)) {
          if (item.type === 0 && !seenAppIDs.has(item.id)) {
            seenAppIDs.add(item.id);
            candidateAppIDs.push(item.id);
          }
        }
      }
    }

    console.log(`Found ${candidateAppIDs.length} candidate AppIDs. Mapping to CheapShark...`);

    // 2. Map to CheapShark deals with strict filtering
    const finalItems = [];
    const seenGameIDs = new Set();
    const BATCH_SIZE = 5; // Reduced batch size to prevent 429 Too Many Requests

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
      
      // Delay to avoid hitting CheapShark rate limits (1 second pause per batch)
      if (i + BATCH_SIZE < candidateAppIDs.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
      }
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
        'Cache-Control': 'public, max-age=300' // Cache for 5 minutes at the edge
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

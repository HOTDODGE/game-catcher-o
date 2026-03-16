// Node.js 18+ includes native fetch. No need for node-fetch dependency.

exports.handler = async (event, context) => {
  const { appid, count } = event.queryStringParameters;

  if (!appid) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing appid parameter' }),
    };
  }

  const reviewCount = count || 20;
  const steamUrl = `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&num_per_page=${reviewCount}`;

  try {
    // Using global fetch (available in Node 18+)
    const response = await fetch(steamUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `Steam API responded with ${response.status}` }),
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.error('Steam Reviews Function Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

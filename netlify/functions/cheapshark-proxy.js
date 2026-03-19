// netlify/functions/cheapshark-proxy.js
// A generic proxy for CheapShark API endpoints to avoid CORS issues in production.

exports.handler = async (event, context) => {
  const { endpoint, ...params } = event.queryStringParameters;

  if (!endpoint) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing endpoint parameter' }),
    };
  }

  // Construct the CheapShark URL
  const baseUrl = 'https://www.cheapshark.com/api/1.0';
  const url = new URL(`${baseUrl}/${endpoint}`);
  
  // Append all other parameters to the CheapShark request
  Object.keys(params).forEach(key => {
    url.searchParams.append(key, params[key]);
  });

  try {
    console.log(`Proxying request to: ${url.toString()}`);
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `CheapShark API responded with ${response.status}` }),
      };
    }

    const data = await response.json();
    
    // We must forward important headers like X-Total-Page-Count for pagination
    const totalPages = response.headers.get('X-Total-Page-Count');

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'X-Total-Page-Count': totalPages || '1'
      },
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.error('CheapShark Proxy Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

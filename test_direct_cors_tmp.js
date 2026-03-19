// test_direct_cors.js
async function test() {
    try {
        const res = await fetch('https://www.cheapshark.com/api/1.0/deals?pageSize=1');
        console.log('Direct Fetch Status:', res.status);
        console.log('CORS Headers:', [...res.headers.entries()].filter(([k]) => k.toLowerCase().includes('access-control')));
    } catch (e) {
        console.error('Direct Fetch Failed (likely CORS):', e.message);
    }
}
test();

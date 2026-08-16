const axios = require('axios');
const fs = require('fs');

async function test() {
    try {
        // Step 1: Follow the /s/ redirect manually
        const shareUrl = 'https://novelquickapp.com/s/YIxzEfHfB08/';
        const step1 = await axios.get(shareUrl, {
            maxRedirects: 0,
            validateStatus: s => s < 400,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const redirectUrl = step1.headers.location;
        console.log('Redirect URL:', redirectUrl ? redirectUrl.substring(0, 100) + '...' : 'none');

        if (!redirectUrl) {
            console.log('No redirect, checking HTML of step1...');
            const hasRouter1 = step1.data.includes('_ROUTER_DATA');
            console.log('Has _ROUTER_DATA in step1:', hasRouter1);
            return;
        }

        // Step 2: Fetch the redirect URL with Desktop UA
        const step2 = await axios.get(redirectUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const html = step2.data;
        fs.writeFileSync('test_desktop.html', html);
        const hasRouter = html.includes('_ROUTER_DATA');
        const hasPlayUrl = html.includes('play_url');
        console.log('[Desktop UA] Has _ROUTER_DATA:', hasRouter);
        console.log('[Desktop UA] Has play_url:', hasPlayUrl);
        if (hasPlayUrl) {
            const m = html.match(/"play_url":"(https:[^"]+)"/);
            if (m) console.log('[Desktop UA] play_url:', m[1].replace(/\\u002F/g, '/').substring(0, 100));
        }
    } catch(e) {
        console.error('Error:', e.message);
    }
}

test();

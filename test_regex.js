const fs = require('fs');

const html = fs.readFileSync('page.html', 'utf8');
const routerDataMatch = html.match(/window\._ROUTER_DATA\s*=\s*({[\s\S]*?})<\/script>/);

if (routerDataMatch && routerDataMatch[1]) {
    console.log("Matched length:", routerDataMatch[1].length);
    try {
        const routerData = JSON.parse(routerDataMatch[1]);
        let pageData = null;
        const loaderData = routerData.loaderData || {};
        for (let key in loaderData) {
            if (loaderData[key] && loaderData[key].pageData && loaderData[key].pageData.series_data) {
                pageData = loaderData[key].pageData.series_data;
                break;
            }
        }
        if (pageData && pageData.play_url) {
            console.log("Found title:", pageData.title);
            console.log("Found url:", pageData.play_url);
        } else {
            console.log("pageData or play_url not found.");
        }
    } catch (e) {
        console.error("JSON parse error:", e.message);
    }
} else {
    console.log("Regex no match");
}

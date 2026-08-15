const axios = require('axios');
const fs = require('fs');

async function scrape() {
    try {
        const url = "https://novelquickapp.com/s/S3sQ8ySV-mE/";
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
            }
        });
        
        fs.writeFileSync('page.html', response.data);
        console.log("Saved page.html");
    } catch (error) {
        console.error("Error:", error.message);
    }
}

scrape();

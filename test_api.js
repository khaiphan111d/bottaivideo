const axios = require('axios');

async function test() {
    try {
        const url = "https://novelquickapp.com/s/S3sQ8ySV-mE/";
        console.log("Testing with URL:", url);
        
        // Test Pearktrue API
        const response = await axios.get("https://api.pearktrue.cn/api/video/douyin.php", {
            params: { url: url }
        });
        
        console.log("API Response:");
        console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error("Error calling API:", error.response ? error.response.data : error.message);
    }
}

test();

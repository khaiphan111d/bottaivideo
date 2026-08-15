const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { HttpsProxyAgent } = require('https-proxy-agent');

const configPath = path.join(__dirname, 'config.json');
let config = {
    apiEndpoint: "https://tenapi.cn/v2/video",
    method: "POST",
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
};
if (fs.existsSync(configPath)) {
    Object.assign(config, JSON.parse(fs.readFileSync(configPath, 'utf8')));
}

/**
 * Phân tích URL thông qua HTML (Bypass bảo mật) hoặc API
 * @param {string} shareUrl - URL cần phân tích
 * @param {string} [proxyUrl] - URL proxy dạng http://ip:port
 */
async function parseVideoUrl(shareUrl, proxyUrl = null) {
    try {
        let axiosConfig = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
            }
        };

        if (proxyUrl) {
            axiosConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
        }
        // Cải thiện regex để không lấy dấu phẩy hoặc ký tự tiếng Trung dính liền
        const urlMatch = shareUrl.match(/(https?:\/\/[a-zA-Z0-9-._~:/?#[\]@!$&'()*+;=%]+)/);
        const extractedUrl = urlMatch ? urlMatch[0] : shareUrl;

        // Nếu là link từ novelquickapp.com (Hồng Quả / Fanqie)
        if (extractedUrl.includes('novelquickapp.com')) {
            console.log("[INFO] Phát hiện link Hồng Quả, đang lấy link video trực tiếp không qua API...");

            // ── BƯỚC 1: Lấy URL thực sau khi redirect (link /s/ là shortlink) ──
            const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
            const step1Config = {
                maxRedirects: 0,
                validateStatus: s => s < 400,
                headers: { 'User-Agent': desktopUA }
            };
            if (proxyUrl) step1Config.httpsAgent = new HttpsProxyAgent(proxyUrl);

            let targetUrl = extractedUrl;
            try {
                const step1Res = await axios.get(extractedUrl, step1Config);
                if (step1Res.status >= 300 && step1Res.headers.location) {
                    targetUrl = step1Res.headers.location;
                    console.log(`[INFO] Redirect Hồng Quả -> ${targetUrl.substring(0, 80)}...`);
                }
            } catch (redirectErr) {
                console.log("[WARN] Không lấy được redirect, dùng URL gốc:", redirectErr.message);
            }

            // ── BƯỚC 2: Fetch trang đích bằng Desktop UA (quan trọng!) ──
            const step2Config = {
                headers: { 'User-Agent': desktopUA }
            };
            if (proxyUrl) step2Config.httpsAgent = new HttpsProxyAgent(proxyUrl);

            const htmlRes = await axios.get(targetUrl, step2Config);
            let html = htmlRes.data;

            // Đảm bảo html là một chuỗi (phòng trường hợp Axios tự parse thành Object/JSON)
            if (typeof html !== 'string') {
                html = JSON.stringify(html);
            }

            // Tìm kiếm chuỗi JSON trong window._ROUTER_DATA
            const routerDataMatch = html.match(/window\._ROUTER_DATA\s*=\s*({[\s\S]*?})<\/script>/);
            if (routerDataMatch && routerDataMatch[1]) {
                try {
                    const routerData = JSON.parse(routerDataMatch[1]);
                    
                    // Trích xuất play_url và title
                    let pageData = null;
                    const loaderData = routerData.loaderData || {};
                    for (let key in loaderData) {
                        if (loaderData[key] && loaderData[key].pageData && loaderData[key].pageData.series_data) {
                            pageData = loaderData[key].pageData.series_data;
                            break;
                        }
                    }

                    if (pageData && pageData.play_url) {
                        console.log(`[INFO] ✅ Lấy thành công video Hồng Quả: ${pageData.title}`);
                        // Loại bỏ giới hạn 30s của link chia sẻ
                        const fullVideoUrl = pageData.play_url.replace(/&end=\d+/g, '').replace(/&start=\d+/g, '');
                        return {
                            title: pageData.title || `hongguo_video_${Date.now()}`,
                            url: fullVideoUrl
                        };
                    }
                } catch (parseErr) {
                    console.log("[WARN] Lỗi parse JSON _ROUTER_DATA:", parseErr.message);
                }
            }
            console.log("[WARN] Không tìm thấy dữ liệu video trong HTML Hồng Quả, chuyển sang API dự phòng...");
        }

        // Nếu là link mạng khác hoặc phân tích HTML thất bại, dùng API dự phòng
        console.log(`[INFO] Sử dụng API dự phòng: ${config.apiEndpoint}`);
        let response;
        
        // Hợp nhất cấu hình proxy vào API requests
        const apiConfig = { ...axiosConfig };
        apiConfig.headers = { ...apiConfig.headers, ...config.headers };

        if (config.method.toUpperCase() === 'POST') {
            response = await axios.post(
                config.apiEndpoint,
                { url: extractedUrl },
                apiConfig
            );
        } else {
            apiConfig.params = { url: extractedUrl };
            response = await axios.get(config.apiEndpoint, apiConfig);
        }

        const data = response.data;
        if (data && data.code === 200) {
            const videoData = data.data || data;
            return {
                title: videoData.title || `video_${Date.now()}`,
                url: videoData.url || videoData.video || videoData.play_url
            };
        } else {
            throw new Error(data.msg || 'API trả về phản hồi không hợp lệ');
        }
    } catch (error) {
        let msg = error.response ? (error.response.data?.msg || error.message) : error.message;

        // Kiểm tra xem có phải lỗi do bị chặn IP hay không
        if (error.response) {
            const status = error.response.status;
            if ([403, 429, 401].includes(status)) {
                msg = `🛑 IP BỊ CHẶN (Mã ${status}): Web/API đã chặn kết nối. Vui lòng thử đổi IP (dùng 4G, VPN, Proxy) hoặc chờ một lát rồi thử lại.`;
            } else if (typeof error.response.data === 'string' && error.response.data.toLowerCase().includes('captcha')) {
                msg = `🛑 YÊU CẦU CAPTCHA: Web bắt xác minh, IP của bạn có thể đang bị hạn chế.`;
            }
        } else if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('econnreset') || msg.toLowerCase().includes('etimedout')) {
            msg = `🛑 LỖI KẾT NỐI: Server không phản hồi, có thể do mạng hoặc IP đã bị liệt vào danh sách đen.`;
        }

        throw new Error(msg);
    }
}

module.exports = {
    parseVideoUrl
};

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { HttpsProxyAgent } = require('https-proxy-agent');

const configPath = path.join(__dirname, 'config.json');
let config = {
    apiEndpoint: "https://tenapi.cn/v2/video",
    method: "POST",
    hongguoCookie: "",
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
};

function loadConfig() {
    if (fs.existsSync(configPath)) {
        try {
            Object.assign(config, JSON.parse(fs.readFileSync(configPath, 'utf8')));
        } catch (e) {
            console.error("[WARN] Lỗi đọc config.json:", e.message);
        }
    }
    return config;
}
loadConfig();

/**
 * Lấy cookie cấu hình (từ config hoặc tham số truyền vào)
 */
function getActiveCookie(customCookie = null) {
    if (customCookie) return customCookie;
    loadConfig();
    return config.hongguoCookie || "";
}

/**
 * CÁCH 3: Giả lập gọi API Native của App di động (ByteDance Fanqie / Hongguo App API)
 * @param {string} seriesId - ID bộ phim/truyện (series_id)
 * @param {string} itemId - ID tập video (item_id / vid)
 * @param {string} [cookie] - Cookie phiên
 * @param {string} [proxyUrl] - URL proxy nếu có
 */
async function fetchHongguoAppApi(seriesId, itemId, cookie = null, proxyUrl = null) {
    console.log(`[CÁCH 3 - APP API] Đang gọi Native App API với series_id=${seriesId}, item_id=${itemId}...`);
    
    // Header chuẩn của ứng dụng di động Hồng Quả (Android App)
    const appHeaders = {
        'User-Agent': 'com.dragon.read/6.2.0 (Linux; U; Android 14; vi_VN; SM-S918B; Build/UP1A.231005.007; Cronet/TTNetVersion:f931d8e1 2024-04-10 QuicVersion:46900f68 2024-03-05)',
        'Accept-Encoding': 'gzip, deflate',
        'sdk-version': '2',
        'passport-sdk-version': '20',
        'x-vc-bdturing-sdk-version': '2.3.0',
        ...(cookie ? { 'Cookie': cookie } : {})
    };

    const axiosOptions = {
        headers: appHeaders,
        timeout: 12000
    };
    if (proxyUrl) {
        axiosOptions.httpsAgent = new HttpsProxyAgent(proxyUrl);
    }

    // Các tham số giả lập Native App
    const params = {
        aid: '2329', // App ID của Hồng Quả / Cà Chua Kịch Ngắn
        app_name: 'novelapp',
        version_code: '620',
        version_name: '6.2.0',
        device_platform: 'android',
        os_version: '14',
        series_id: seriesId,
        item_id: itemId || '',
        channel: 'tengxun',
        device_type: 'SM-S918B'
    };

    // Danh sách các endpoint API nội bộ của App
    const endpoints = [
        `https://api5-normal-c-hl.fqnovel.com/api/drama/v1/detail/`,
        `https://novelquickapp.com/api/drama/v1/detail/`,
        `https://api3-normal-c-hl.fqnovel.com/drama/api/v1/series/detail/`
    ];

    for (const endpoint of endpoints) {
        try {
            const res = await axios.get(endpoint, { ...axiosOptions, params });
            if (res.data && (res.data.code === 0 || res.data.status_code === 0 || res.data.data)) {
                const data = res.data.data || res.data;
                const playUrl = data.play_url || data.video_url || data.stream_url || (data.video_list && data.video_list[0]?.play_url);
                const title = data.title || data.series_title || `hongguo_app_${Date.now()}`;
                
                if (playUrl) {
                    // Làm sạch URL: loại bỏ giới hạn thời lượng 30s
                    const cleanUrl = playUrl.replace(/&end=\d+/g, '').replace(/&start=\d+/g, '');
                    console.log(`[CÁCH 3 - APP API] ✅ Lấy thành công video qua App API: ${title}`);
                    return {
                        title: title,
                        url: cleanUrl,
                        source: 'app_native_api'
                    };
                }
            }
        } catch (e) {
            // Thử endpoint tiếp theo
            console.log(`[CÁCH 3 - APP API] Endpoint ${endpoint} thất bại: ${e.message}`);
        }
    }
    return null;
}

/**
 * Phân tích URL thông qua HTML (Bypass bảo mật), Native App API hoặc Third-party API
 * @param {string} shareUrl - URL cần phân tích
 * @param {string} [proxyUrl] - URL proxy dạng http://ip:port
 * @param {string} [customCookie] - Chuỗi cookie tuỳ chỉnh (tuỳ chọn)
 */
async function parseVideoUrl(shareUrl, proxyUrl = null, customCookie = null) {
    try {
        loadConfig();
        const cookie = getActiveCookie(customCookie);

        // Header giả lập Desktop hoặc Mobile trình duyệt kết hợp Cookie
        let baseHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,vi;q=0.7'
        };

        // CÁCH 4: Đính kèm Cookie nếu có (chống WAF chặn & mở khoá full video)
        if (cookie) {
            baseHeaders['Cookie'] = cookie;
            console.log("[CÁCH 4 - COOKIE] 🔑 Đã đính kèm Cookie tài khoản vào request.");
        }

        let axiosConfig = {
            headers: baseHeaders,
            timeout: 15000
        };

        if (proxyUrl) {
            axiosConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
        }

        // Cải thiện regex để không lấy dấu phẩy hoặc ký tự tiếng Trung dính liền
        const urlMatch = shareUrl.match(/(https?:\/\/[a-zA-Z0-9-._~:/?#[\]@!$&'()*+;=%]+)/);
        const extractedUrl = urlMatch ? urlMatch[0] : shareUrl;

        // =========================================================================
        // NẾU LÀ LINK HỒNG QUẢ (novelquickapp.com / fanqienovel / fqnovel)
        // =========================================================================
        if (extractedUrl.includes('novelquickapp.com') || extractedUrl.includes('fqnovel.com') || extractedUrl.includes('fanqie')) {
            console.log("[INFO] Phát hiện link Hồng Quả / Phiên Gia Kịch Ngắn...");

            // ── BƯỚC 1: Lấy URL thực sau khi redirect ──
            const step1Config = {
                maxRedirects: 0,
                validateStatus: s => s < 400,
                headers: baseHeaders
            };
            if (proxyUrl) step1Config.httpsAgent = new HttpsProxyAgent(proxyUrl);

            let targetUrl = extractedUrl;
            try {
                const step1Res = await axios.get(extractedUrl, step1Config);
                if (step1Res.status >= 300 && step1Res.headers.location) {
                    targetUrl = step1Res.headers.location;
                    console.log(`[INFO] Redirect Hồng Quả -> ${targetUrl.substring(0, 90)}...`);
                }
            } catch (redirectErr) {
                console.log("[WARN] Không lấy được redirect, dùng URL gốc:", redirectErr.message);
            }

            // ── BƯỚC 2: Cố gắng trích xuất series_id và item_id từ URL để dùng CÁCH 3 (App API) ──
            const seriesMatch = targetUrl.match(/series_id=([0-9]+)/) || targetUrl.match(/\/series\/([0-9]+)/);
            const itemMatch = targetUrl.match(/item_id=([0-9]+)/) || targetUrl.match(/vid=([0-9]+)/) || targetUrl.match(/\/item\/([0-9]+)/);

            if (seriesMatch && seriesMatch[1]) {
                const seriesId = seriesMatch[1];
                const itemId = itemMatch ? itemMatch[1] : '';
                const appResult = await fetchHongguoAppApi(seriesId, itemId, cookie, proxyUrl);
                if (appResult && appResult.url) {
                    return appResult;
                }
            }

            // ── BƯỚC 3: CÁCH 4 - Fetch trang web kèm Cookie và parse _ROUTER_DATA ──
            console.log("[CÁCH 4 - WEB PARSE] Đang phân tích dữ liệu trang web kèm Cookie...");
            const step2Config = {
                headers: baseHeaders
            };
            if (proxyUrl) step2Config.httpsAgent = new HttpsProxyAgent(proxyUrl);

            const htmlRes = await axios.get(targetUrl, step2Config);
            let html = htmlRes.data;

            if (typeof html !== 'string') {
                html = JSON.stringify(html);
            }

            // Tìm kiếm chuỗi JSON trong window._ROUTER_DATA
            const routerDataMatch = html.match(/window\._ROUTER_DATA\s*=\s*({[\s\S]*?})<\/script>/);
            if (routerDataMatch && routerDataMatch[1]) {
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
                        console.log(`[INFO] ✅ Lấy thành công video Hồng Quả: ${pageData.title}`);
                        
                        // Loại bỏ giới hạn 30s của link chia sẻ
                        let fullVideoUrl = pageData.play_url.replace(/&end=\d+/g, '').replace(/&start=\d+/g, '');
                        
                        // Đảm bảo không bị ký tự unicode escape \u002F
                        fullVideoUrl = fullVideoUrl.replace(/\\u002F/g, '/');

                        return {
                            title: pageData.title || `hongguo_video_${Date.now()}`,
                            url: fullVideoUrl,
                            source: 'web_router_data'
                        };
                    }
                } catch (parseErr) {
                    console.log("[WARN] Lỗi parse JSON _ROUTER_DATA:", parseErr.message);
                }
            }

            // Thử regex trực tiếp tìm play_url nếu _ROUTER_DATA bị minified
            const directPlayMatch = html.match(/"play_url"\s*:\s*"(https?:[^"]+)"/);
            if (directPlayMatch && directPlayMatch[1]) {
                let directUrl = directPlayMatch[1].replace(/\\u002F/g, '/').replace(/&end=\d+/g, '').replace(/&start=\d+/g, '');
                console.log(`[INFO] ✅ Lấy thành công play_url qua Direct Regex Match`);
                return {
                    title: `hongguo_video_${Date.now()}`,
                    url: directUrl,
                    source: 'direct_regex'
                };
            }

            console.log("[WARN] Không tìm thấy dữ liệu video trong HTML Hồng Quả, chuyển sang API dự phòng...");
        }

        // =========================================================================
        // NẾU LÀ LINK KHÁC HOẶC PARSE HỒNG QUẢ THẤT BẠI: DÙNG API DỰ PHÒNG (LAYER 3)
        // =========================================================================
        console.log(`[INFO] Sử dụng API dự phòng: ${config.apiEndpoint}`);
        let response;
        
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
        if (data && (data.code === 200 || data.code === 0 || data.status === 'success')) {
            const videoData = data.data || data;
            let finalUrl = videoData.url || videoData.video || videoData.play_url || videoData.video_url;
            if (finalUrl) {
                finalUrl = finalUrl.replace(/&end=\d+/g, '').replace(/&start=\d+/g, '');
            }
            return {
                title: videoData.title || `video_${Date.now()}`,
                url: finalUrl,
                source: 'third_party_api'
            };
        } else {
            throw new Error(data.msg || data.message || 'API trả về phản hồi không hợp lệ');
        }
    } catch (error) {
        let msg = error.response ? (error.response.data?.msg || error.message) : error.message;

        if (error.response) {
            const status = error.response.status;
            if ([403, 429, 401].includes(status)) {
                msg = `🛑 IP/SESSION BỊ TỪ CHỐI (Mã ${status}): Web/CDN đã chặn kết nối. Hãy thử thêm Cookie (/setcookie) hoặc đổi Proxy.`;
            } else if (typeof error.response.data === 'string' && error.response.data.toLowerCase().includes('captcha')) {
                msg = `🛑 YÊU CẦU CAPTCHA: Web bắt xác minh robot, cần cập nhật Cookie mới từ trình duyệt.`;
            }
        } else if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('econnreset') || msg.toLowerCase().includes('etimedout')) {
            msg = `🛑 LỖI KẾT NỐI: Server không phản hồi, có thể do mạng hoặc IP bị chặn.`;
        }

        throw new Error(msg);
    }
}

module.exports = {
    parseVideoUrl,
    fetchHongguoAppApi,
    getActiveCookie
};


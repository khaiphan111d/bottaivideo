const axios = require('axios');

/**
 * Lấy proxy từ KiotProxy
 * @param {string} apiKey - KiotProxy API Key
 * @param {string} region - Vùng (mặc định 'random', có thể là 'bac', 'trung', 'nam')
 * @returns {Promise<{ip: string, proxyUrl: string}>}
 */
async function getKiotProxy(apiKey, region = 'random') {
    if (!apiKey) return null;

    try {
        // Thử lấy proxy hiện tại trước
        const currentRes = await axios.get(`https://api.kiotproxy.com/api/v1/proxies/current?key=${apiKey}`);
        
        if (currentRes.data && currentRes.data.code === 200 && currentRes.data.data) {
            const data = currentRes.data.data;
            return {
                ip: data.realIpAddress,
                proxyUrl: `http://${data.http}`,
                location: data.location || "Không xác định"
            };
        }
    } catch (error) {
        // Nếu lỗi do chưa có proxy current (40001050), bỏ qua để lấy mới
        if (error.response && error.response.data && error.response.data.code === 40001050) {
            console.log("[INFO] Key chưa có proxy, đang tiến hành lấy proxy mới...");
        } else {
            console.error("[ERROR] Lỗi khi lấy proxy hiện tại:", error.message);
            throw new Error("Lỗi API khi lấy proxy hiện tại của KiotProxy.");
        }
    }

    // Nếu không có proxy hiện tại hoặc lấy lỗi, lấy proxy mới
    try {
        const url = region === 'random' 
            ? `https://api.kiotproxy.com/api/v1/proxies/new?key=${apiKey}`
            : `https://api.kiotproxy.com/api/v1/proxies/new?key=${apiKey}&region=${region}`;

        const newRes = await axios.get(url);
        
        if (newRes.data && newRes.data.code === 200 && newRes.data.data) {
            const data = newRes.data.data;
            return {
                ip: data.realIpAddress,
                proxyUrl: `http://${data.http}`,
                location: data.location || "Không xác định"
            };
        } else {
            throw new Error(newRes.data.message || "Lỗi không xác định từ KiotProxy");
        }
    } catch (error) {
        console.error("[ERROR] Lỗi khi đổi proxy mới:", error.message);
        throw new Error(error.response?.data?.message || error.message || "Lỗi API khi tạo proxy mới.");
    }
}

/**
 * Ép đổi sang proxy mới ngay lập tức
 */
async function forceNewKiotProxy(apiKey, region = 'random') {
    if (!apiKey) throw new Error("Chưa có API Key");

    try {
        const url = region === 'random' 
            ? `https://api.kiotproxy.com/api/v1/proxies/new?key=${apiKey}`
            : `https://api.kiotproxy.com/api/v1/proxies/new?key=${apiKey}&region=${region}`;

        const newRes = await axios.get(url);
        
        if (newRes.data && newRes.data.code === 200 && newRes.data.data) {
            const data = newRes.data.data;
            return {
                ip: data.realIpAddress,
                proxyUrl: `http://${data.http}`,
                location: data.location || "Không xác định"
            };
        } else {
            throw new Error(newRes.data.message || "Lỗi không xác định từ KiotProxy");
        }
    } catch (error) {
        throw new Error(error.response?.data?.message || error.message || "Lỗi API khi ép tạo proxy mới.");
    }
}

module.exports = {
    getKiotProxy,
    forceNewKiotProxy
};

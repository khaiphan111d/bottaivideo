const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const db = require('./db');

// Tắt kiểm tra chặt chẽ chứng chỉ SSL đối với các Proxy trung gian
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Bắt và bỏ qua các lỗi ECONNRESET do socket proxy chết ngắt kết nối ngầm
process.on('uncaughtException', (err) => {
    if (err && (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH' || err.message?.includes('socket') || err.message?.includes('Client network') || err.message?.includes('certificate'))) {
        return; // Bỏ qua lỗi ngắt kết nối proxy socket
    }
    console.error('[UNCAUGHT ERROR]', err);
});

// In-memory cache cho Proxy Pool
let activeChinaProxyPool = []; // Danh sách proxy TQ còn sống [{ proxyUrl, ip, location, latencyMs, lastTested }]
let lastPoolRefreshTime = 0;
let isRefreshing = false;
let failedProxyMap = new Map(); // Lưu proxy bị lỗi tạm thời: proxyUrl -> timestamp

/**
 * Khởi tạo Http / Https / Socks Agent tương ứng với loại proxy
 * @param {string} proxyUrl
 * @returns {HttpsProxyAgent|SocksProxyAgent|null}
 */
function createProxyAgent(proxyUrl) {
    if (!proxyUrl) return null;
    try {
        if (proxyUrl.startsWith('socks4') || proxyUrl.startsWith('socks5')) {
            return new SocksProxyAgent(proxyUrl, { rejectUnauthorized: false });
        }
        return new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false });
    } catch (e) {
        console.error(`[ERROR] Không thể tạo Proxy Agent cho ${proxyUrl}:`, e.message);
        return null;
    }
}

/**
 * Chuẩn hoá chuỗi proxy từ nhiều định dạng khác nhau:
 * - "1.2.3.4:8080" -> "http://1.2.3.4:8080"
 * - "1.2.3.4:8080:user:pass" -> "http://user:pass@1.2.3.4:8080"
 * - "http://user:pass@1.2.3.4:8080" -> "http://user:pass@1.2.3.4:8080"
 * - "socks5://1.2.3.4:1080" -> "socks5://1.2.3.4:1080"
 */
function parseProxyString(proxyStr) {
    if (!proxyStr || typeof proxyStr !== 'string') return null;
    let trimmed = proxyStr.trim();
    if (!trimmed) return null;

    // Định dạng đặc biệt: IP:PORT:USER:PASS (không có scheme)
    const ipPortUserPass = trimmed.match(/^([0-9]{1,3}(?:\.[0-9]{1,3}){3}):([0-9]+):([^:]+):(.+)$/);
    if (ipPortUserPass) {
        const [, host, port, user, pass] = ipPortUserPass;
        return `http://${user}:${pass}@${host}:${port}`;
    }

    // Dùng regex chung cho các định dạng còn lại
    const match = trimmed.match(/(?:(https?|socks4|socks5):\/\/)?(?:([^:@]+):([^@]+)@)?([0-9]{1,3}(?:\.[0-9]{1,3}){3}):([0-9]+)/);
    if (!match) return null;

    const [ , proto, user, pass, host, port ] = match;
    const protocol = proto || 'http';
    if (user && pass) {
        return `${protocol}://${user}:${pass}@${host}:${port}`;
    }
    return `${protocol}://${host}:${port}`;
}

/**
 * Kiểm tra kết nối và tính hợp lệ của 1 Proxy với server Trung Quốc
 * @param {string} proxyUrl 
 * @param {number} timeoutMs 
 * @returns {Promise<{isAlive: boolean, ip?: string, location?: string, latencyMs?: number, error?: string}>}
 */
async function testProxy(proxyUrl, timeoutMs = 3500) {
    const agent = createProxyAgent(proxyUrl);
    if (!agent) return { isAlive: false, error: "Invalid proxy URL" };

    const startTime = Date.now();
    try {
        const res = await axios.get('http://myip.ipip.net', {
            httpAgent: agent,
            httpsAgent: agent,
            timeout: timeoutMs,
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const elapsed = Date.now() - startTime;
        const body = String(res.data || '').trim();

        // myip.ipip.net trả về dạng: "当前 IP：1.2.3.4  来自于：中国 浙江 杭州  阿里云"
        const ipMatch = body.match(/IP[：:]\s*([0-9.]+)/i);
        const ip = ipMatch ? ipMatch[1] : (proxyUrl.replace(/^(http|https|socks4|socks5):\/\//, '').split(/[@:]/)[0] || 'Unknown');
        
        let location = "Trung Quốc";
        if (body.includes('来自于：')) {
            location = body.split('来自于：')[1].trim();
        }

        return {
            isAlive: true,
            ip: ip,
            location: location,
            latencyMs: elapsed
        };
    } catch (err) {
        return {
            isAlive: false,
            error: err.message
        };
    }
}

/**
 * Cào danh sách Proxy Trung Quốc từ các nguồn Free công khai
 * @returns {Promise<string[]>} Danh sách raw proxy URLs
 */
async function fetchRawChinaProxies() {
    const rawProxies = new Set();

    const sources = [
        {
            url: 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/CN/data.txt',
            type: 'text_lines'
        },
        {
            url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=cn',
            type: 'text_lines'
        },
        {
            url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=5000&country=cn',
            type: 'socks5_lines'
        },
        {
            url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks4&timeout=5000&country=cn',
            type: 'socks4_lines'
        },
        {
            url: 'https://proxylist.geonode.com/api/proxy-list?country=CN&limit=50&page=1&sort_by=lastChecked&sort_type=desc',
            type: 'geonode_json'
        },
        {
            url: 'https://raw.githubusercontent.com/fate0/proxylist/master/proxy.list',
            type: 'fate0_json'
        }
    ];

    await Promise.allSettled(sources.map(async (src) => {
        try {
            const res = await axios.get(src.url, { timeout: 4500 });
            if (src.type === 'text_lines' && typeof res.data === 'string') {
                const lines = res.data.split('\n').map(l => l.trim()).filter(Boolean);
                lines.forEach(l => {
                    const parsed = parseProxyString(l);
                    if (parsed) rawProxies.add(parsed);
                });
            } else if (src.type === 'socks5_lines' && typeof res.data === 'string') {
                const lines = res.data.split('\n').map(l => l.trim()).filter(Boolean);
                lines.forEach(l => {
                    const parsed = parseProxyString(l.startsWith('socks5') ? l : `socks5://${l}`);
                    if (parsed) rawProxies.add(parsed);
                });
            } else if (src.type === 'socks4_lines' && typeof res.data === 'string') {
                const lines = res.data.split('\n').map(l => l.trim()).filter(Boolean);
                lines.forEach(l => {
                    const parsed = parseProxyString(l.startsWith('socks4') ? l : `socks4://${l}`);
                    if (parsed) rawProxies.add(parsed);
                });
            } else if (src.type === 'geonode_json' && res.data && res.data.data) {
                for (const item of res.data.data) {
                    const proto = (item.protocols && item.protocols[0]) ? item.protocols[0] : 'http';
                    const parsed = parseProxyString(`${proto}://${item.ip}:${item.port}`);
                    if (parsed) rawProxies.add(parsed);
                }
            } else if (src.type === 'fate0_json' && typeof res.data === 'string') {
                const lines = res.data.split('\n').filter(Boolean);
                for (const line of lines) {
                    try {
                        const obj = JSON.parse(line);
                        if (obj.country === 'CN' && obj.host && obj.port) {
                            const parsed = parseProxyString(`${obj.type || 'http'}://${obj.host}:${obj.port}`);
                            if (parsed) rawProxies.add(parsed);
                        }
                    } catch (e) {}
                }
            }
        } catch (e) {
            // bỏ qua nguồn timeout
        }
    }));

    return Array.from(rawProxies);
}

/**
 * Làm mới và kiểm tra sức khỏe của Proxy Pool Trung Quốc (Tự động lọc IP sống)
 * @param {boolean} forceRefresh - Bắt buộc quét lại kể cả cache chưa hết hạn
 * @param {number} maxToTest - Số lượng tối đa cần kiểm tra
 * @returns {Promise<Array<{proxyUrl: string, ip: string, location: string, latencyMs: number}>>}
 */
async function refreshChinaProxyPool(forceRefresh = false, maxToTest = 120) {
    const now = Date.now();
    // Cache trong 10 phút nếu pool vẫn còn nhiều proxy sống
    if (!forceRefresh && activeChinaProxyPool.length >= 3 && (now - lastPoolRefreshTime) < 10 * 60 * 1000) {
        return activeChinaProxyPool;
    }

    if (isRefreshing) {
        return activeChinaProxyPool;
    }

    isRefreshing = true;
    console.log("[PROXY POOL] 🌐 Đang tìm kiếm và kiểm tra danh sách Proxy Trung Quốc Free Share...");

    try {
        const rawList = await fetchRawChinaProxies();
        console.log(`[PROXY POOL] Thu thập được ${rawList.length} proxy Trung Quốc. Đang kiểm tra song song (Health Check)...`);

        // Lọc bỏ những proxy vừa bị đánh dấu lỗi trong 5 phút qua
        const candidateList = rawList.filter(p => {
            const failedAt = failedProxyMap.get(p);
            return !failedAt || (now - failedAt) > 5 * 60 * 1000;
        }).slice(0, maxToTest);

        const liveProxies = [];
        const chunkSize = 25;

        for (let i = 0; i < candidateList.length; i += chunkSize) {
            const chunk = candidateList.slice(i, i + chunkSize);
            const chunkPromises = chunk.map(async (proxyUrl) => {
                try {
                    const check = await testProxy(proxyUrl, 4200);
                    if (check && check.isAlive) {
                        return {
                            proxyUrl: proxyUrl,
                            ip: check.ip,
                            location: check.location,
                            latencyMs: check.latencyMs,
                            lastTested: Date.now()
                        };
                    }
                } catch (e) {}
                return null;
            });

            const results = await Promise.allSettled(chunkPromises);
            results.forEach(r => {
                if (r.status === 'fulfilled' && r.value !== null) {
                    liveProxies.push(r.value);
                }
            });

            // Nếu đã tìm thấy từ 5 proxy sống nhanh trở lên, dừng sớm để tiết kiệm thời gian
            if (liveProxies.length >= 6) {
                break;
            }
        }

        liveProxies.sort((a, b) => a.latencyMs - b.latencyMs); // Ưu tiên ping thấp nhất
        activeChinaProxyPool = liveProxies;
        lastPoolRefreshTime = Date.now();

        console.log(`[PROXY POOL] ✅ Hoàn tất Health Check! Tìm thấy ${liveProxies.length} Proxy Trung Quốc hoạt động tốt:`);
        liveProxies.forEach(p => {
            console.log(`   👉 ${p.proxyUrl} (${p.latencyMs}ms) - ${p.location}`);
        });

        return activeChinaProxyPool;
    } catch (error) {
        console.error("[ERROR] Lỗi khi làm mới Proxy Pool:", error.message);
        return activeChinaProxyPool;
    } finally {
        isRefreshing = false;
    }
}

/**
 * Đánh dấu 1 proxy bị lỗi để loại khỏi pool và ưu tiên proxy khác
 * @param {string} proxyUrl 
 */
function markProxyFailed(proxyUrl) {
    if (!proxyUrl) return;
    failedProxyMap.set(proxyUrl, Date.now());
    activeChinaProxyPool = activeChinaProxyPool.filter(p => p.proxyUrl !== proxyUrl);
    console.log(`[PROXY POOL] ⚠️ Đã loại bỏ proxy lỗi khỏi pool: ${proxyUrl}. Còn lại: ${activeChinaProxyPool.length} proxy sống.`);
}

/**
 * Lấy proxy tốt nhất để tải video theo mức ưu tiên:
 * 1. Static Custom Proxy (nếu cấu hình Proxy302 / user key host:port:user:pass)
 * 2. Auto Free China Proxy Pool (Tự động xoay tua proxy TQ đang sống)
 * 3. KiotProxy (nếu có key)
 * 4. Fallback: null (IP gốc)
 * 
 * @param {string} [customKey] Key cấu hình từ DB/Env (có thể là static host:port:user:pass hoặc Kiot key)
 * @returns {Promise<{ip: string, proxyUrl: string, location: string, isFreePool?: boolean}>}
 */
async function getBestChinaProxy(customKey = null) {
    // 1. Kiểm tra nếu có Static Proxy Key (Proxy302 dạng host:port:user:pass hoặc URL)
    if (customKey && typeof customKey === 'string' && customKey.trim().length > 0) {
        const parts = customKey.trim().split(':');
        if (parts.length === 4) {
            const [host, port, user, pass] = parts;
            return {
                ip: host,
                proxyUrl: `http://${user}:${pass}@${host}:${port}`,
                location: '🌐 Static Proxy (Proxy302/Custom)'
            };
        } else if (customKey.startsWith('http://') || customKey.startsWith('socks5://')) {
            return {
                ip: customKey.split('@')[1] || customKey,
                proxyUrl: customKey,
                location: '🌐 Custom URL Proxy'
            };
        }
    }

    // 2. Chế độ Tự Động: Lấy từ Auto Free China Proxy Pool
    if (activeChinaProxyPool.length === 0) {
        await refreshChinaProxyPool(false, 30);
    }

    if (activeChinaProxyPool.length > 0) {
        // Lấy proxy đầu tiên (ping tốt nhất) và xoay vòng (round-robin)
        const chosen = activeChinaProxyPool.shift();
        activeChinaProxyPool.push(chosen); // Đưa về cuối mảng để xoay tua

        return {
            ip: chosen.ip,
            proxyUrl: chosen.proxyUrl,
            location: `🇨🇳 ${chosen.location} (${chosen.latencyMs}ms)`,
            isFreePool: true
        };
    }

    // 3. Fallback sang KiotProxy nếu key bắt đầu bằng chữ K
    if (customKey && customKey.startsWith('K')) {
        try {
            return await getKiotProxy(customKey, 'random');
        } catch (e) {
            console.log("[WARN] KiotProxy fallback thất bại:", e.message);
        }
    }

    return null;
}

/**
 * Lấy trạng thái tổng quan của hệ thống Proxy
 */
function getPoolStatus() {
    return {
        totalLive: activeChinaProxyPool.length,
        proxies: activeChinaProxyPool,
        lastRefresh: lastPoolRefreshTime ? new Date(lastPoolRefreshTime).toLocaleTimeString('vi-VN') : 'Chưa quét'
    };
}

/**
 * Lấy proxy từ KiotProxy (tương thích ngược)
 */
async function getKiotProxy(apiKey, region = 'random') {
    if (!apiKey) return null;

    try {
        const currentRes = await axios.get(`https://api.kiotproxy.com/api/v1/proxies/current?key=${apiKey}`);
        if (currentRes.data && currentRes.data.code === 200 && currentRes.data.data) {
            const data = currentRes.data.data;
            return {
                ip: data.realIpAddress,
                proxyUrl: `http://${data.http}`,
                location: data.location || "Việt Nam (KiotProxy)"
            };
        }
    } catch (error) {
        // Bỏ qua lỗi current để lấy mới
    }

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
                location: data.location || "Việt Nam (KiotProxy)"
            };
        }
    } catch (error) {
        throw new Error(error.response?.data?.message || error.message || "Lỗi API KiotProxy");
    }
}

/**
 * Ép đổi sang proxy mới ngay lập tức
 */
async function forceNewKiotProxy(apiKey, region = 'random') {
    if (apiKey && apiKey.startsWith('K')) {
        const url = region === 'random' 
            ? `https://api.kiotproxy.com/api/v1/proxies/new?key=${apiKey}`
            : `https://api.kiotproxy.com/api/v1/proxies/new?key=${apiKey}&region=${region}`;

        const newRes = await axios.get(url);
        if (newRes.data && newRes.data.code === 200 && newRes.data.data) {
            const data = newRes.data.data;
            return {
                ip: data.realIpAddress,
                proxyUrl: `http://${data.http}`,
                location: data.location || "KiotProxy Mới"
            };
        }
    }
    // Đối với Free Pool: quét mới và lấy proxy khác
    await refreshChinaProxyPool(true, 30);
    return await getBestChinaProxy(apiKey);
}

module.exports = {
    createProxyAgent,
    parseProxyString,
    testProxy,
    fetchRawChinaProxies,
    refreshChinaProxyPool,
    markProxyFailed,
    getBestChinaProxy,
    getPoolStatus,
    getKiotProxy,
    forceNewKiotProxy
};

let TelegramBot = require('node-telegram-bot-api');
if (typeof TelegramBot !== 'function') {
    TelegramBot = TelegramBot.default || TelegramBot.TelegramBot;
}
const fs = require('fs');
const path = require('path');
const { parseVideoUrl } = require('./parser');
const { downloadVideo, uploadToThirdParty } = require('./downloader');
const { getKiotProxy, forceNewKiotProxy } = require('./proxyHelper');
const db = require('./db'); // Sử dụng Database

const configPath = path.join(__dirname, 'config.json');
let config = {};
if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

const telegramToken = process.env.TELEGRAM_BOT_TOKEN || config.telegramBotToken;

if (telegramToken) {
    const bot = new TelegramBot(telegramToken, { polling: true });

    bot.setMyCommands([
        {command: 'start', description: 'Bắt đầu sử dụng bot'},
        {command: 'hd', description: 'Xem hướng dẫn tổng quan'},
        {command: 'hdcookie', description: '📖 Hướng dẫn cách lấy Cookie vượt chặn'},
        {command: 'setcookie', description: 'Thiết lập Cookie tài khoản (Bypass 403 & Full video)'},
        {command: 'getcookie', description: 'Kiểm tra trạng thái Cookie hiện tại'},
        {command: 'clearcookie', description: 'Xoá Cookie đã lưu'},
        {command: 'checkip', description: 'Kiểm tra IP Proxy đang kết nối'},
        {command: 'newip', description: 'Đổi sang Proxy mới ngay lập tức'},
        {command: 'setproxy', description: 'Thiết lập Key KiotProxy / Proxy302'},
        {command: 'adduser', description: 'Thêm ID được dùng Bot'},
        {command: 'deluser', description: 'Xóa ID khỏi danh sách'},
        {command: 'listuser', description: 'Xem danh sách người dùng'}
    ]).catch(err => console.error("Lỗi setMyCommands:", err));

    console.log("[INFO] Telegram Bot đã khởi động và kết nối Database...");

    async function getGlobalKiotProxyKey() {
        try {
            const { rows } = await db.query("SELECT value FROM system_config WHERE key = 'global_kiotproxy_key'");
            if (rows.length > 0 && rows[0].value) {
                let key = rows[0].value;
                if (typeof key === 'string') key = key.replace(/"/g, '');
                return key;
            }
        } catch (e) {
            console.error("Lỗi lấy kiotproxy key từ DB:", e);
        }
        return process.env.KIOTPROXY_KEY || config.kiotproxyKey;
    }

    async function getGlobalCookie() {
        try {
            const { rows } = await db.query("SELECT value FROM system_config WHERE key = 'hongguo_cookie'");
            if (rows.length > 0 && rows[0].value) {
                let val = rows[0].value;
                if (typeof val === 'string' && val.startsWith('"') && val.endsWith('"')) {
                    val = JSON.parse(val);
                }
                return val;
            }
        } catch (e) {
            console.error("Lỗi lấy Cookie từ DB:", e.message);
        }
        return config.hongguoCookie || "";
    }

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;

        if (!text) return;

        const MASTER_ADMIN_ID = "5964340237";
        let isAuthorized = String(chatId) === MASTER_ADMIN_ID;
        let role = isAuthorized ? 'admin' : 'user';

        // Kiểm tra quyền từ Database
        if (!isAuthorized) {
            try {
                const { rows } = await db.query('SELECT role FROM users WHERE telegram_id = $1', [chatId]);
                if (rows.length > 0) {
                    isAuthorized = true;
                    role = rows[0].role;
                } else if (config.telegramAdminIds && config.telegramAdminIds.includes(Number(chatId))) {
                    isAuthorized = true; // Fallback từ config cũ
                }
            } catch (err) {
                console.error("Lỗi kiểm tra quyền DB:", err);
            }
        }

        if (!isAuthorized) {
            bot.sendMessage(chatId, "⛔ Bạn không có quyền sử dụng Bot này.");
            return;
        }

        if (text === '/start') {
            bot.sendMessage(chatId, "Xin chào! Hãy gửi cho tôi link video, tôi sẽ tải và gửi lại cho bạn.\nNếu bạn bị chặn IP hoặc cắt 30s, hãy gửi `/setcookie [COOKIE]` hoặc dùng Proxy.\nGõ `/hd` để xem hướng dẫn chung hoặc `/hdcookie` để xem cách lấy Cookie.", {parse_mode: 'Markdown'});
            return;
        }

        if (text === '/hd') {
            const helpText = `
📖 **HƯỚNG DẪN SỬ DỤNG BOT TẢI FULL VIDEO**

**1. CÁCH TẢI VIDEO:**
🔸 Copy link video (Hồng Quả, Douyin, Kuaishou,...) và dán thẳng vào đây.
🔸 Bot mặc định sử dụng **Cách 3 (App Native API)** để lấy Full Video không cắt 30s.

**2. PHÒNG KHI BỊ CHẶN / TẬP VIP (CÁCH 4 - DÙNG COOKIE):**
🔸 Gõ \`/hdcookie\` để xem hướng dẫn từng bước cách lấy chuỗi Cookie.
🔸 Lệnh lưu Cookie: \`/setcookie [CHUỖI_COOKIE]\`
🔸 Lệnh kiểm tra: \`/getcookie\`
🔸 Lệnh xoá: \`/clearcookie\`

**3. CÁCH DÙNG PROXY (KIOTPROXY / PROXY302):**
🔸 Lệnh đổi Key: \`/setproxy MÃ_KEY_CỦA_BẠN\`
🔸 Lệnh kiểm tra IP: \`/checkip\`
🔸 Lệnh đổi IP mới: \`/newip\`

**4. QUẢN LÝ NGƯỜI DÙNG (CHỈ ADMIN):**
🔹 \`/adduser [ID]\` - Cấp quyền cho người khác.
🔹 \`/deluser [ID]\` - Thu hồi quyền.
🔹 \`/listuser\` - Xem danh sách người dùng được phép.
`;
            bot.sendMessage(chatId, helpText, {parse_mode: 'Markdown'});
            return;
        }

        if (text === '/hdcookie') {
            const cookieGuide = `
🍪 **HƯỚNG DẪN LẤY & CÀI ĐẶT COOKIE (CÁCH 4)**
_(Dùng khi Cách 3 bị lỗi, phim yêu cầu VIP, hoặc CDN chặn 403)_

━━━━━━━━━━━━━━━━━━━━
**📌 BƯỚC 1: LẤY COOKIE TỪ TRÌNH DUYỆT (CHROME/EDGE/CỐC CỐC)**
1. Mở máy tính, vào trang web: \`https://novelquickapp.com\` (hoặc mở 1 link video Hồng Quả).
2. Nhấn phím **F12** trên bàn phím (hoặc chuột phải chọn *Kiểm tra / Inspect*).
3. Chọn thẻ **Network (Mạng)** ở thanh trên cùng.
4. Nhấn phím **F5** để tải lại trang web.
5. Click vào dòng đầu tiên (dòng \`novelquickapp.com\` hoặc \`detail\`).
6. Ở khung bên phải, chọn thẻ **Headers** ➔ Cuộn xuống tìm mục **Request Headers** ➔ Tìm dòng **\`Cookie:\`**.
7. Bôi đen và **Copy toàn bộ chuỗi ký tự** phía sau chữ \`Cookie:\` (thường bắt đầu bằng \`ttwid=...\` hoặc \`sessionid=...\`).

━━━━━━━━━━━━━━━━━━━━
**📌 BƯỚC 2: NẠP COOKIE VÀO BOT**
Gửi tin nhắn vào Bot theo cú pháp:
👉 \`/setcookie [DÁN_CHUỖI_COOKIE_VÀO_ĐÂY]\`

*(Ví dụ: \`/setcookie ttwid=1%7C...; passport_csrf_token=...;\`)*

━━━━━━━━━━━━━━━━━━━━
**📌 BƯỚC 3: KIỂM TRA LẠI**
🔹 Gõ \`/getcookie\` để kiểm tra Bot đã nhận Cookie chưa.
🔹 Sau khi cài xong, bạn chỉ việc gửi lại link video để Bot tải Full Video bình thường!
`;
            bot.sendMessage(chatId, cookieGuide, {parse_mode: 'Markdown'});
            return;
        }

        if (text.startsWith('/adduser ')) {
            if (String(chatId) !== MASTER_ADMIN_ID && role !== 'admin') {
                bot.sendMessage(chatId, "⛔ Chỉ Admin mới được phép sử dụng lệnh này.");
                return;
            }
            
            const newIdStr = text.replace('/adduser ', '').trim();
            if (!/^[-]?\d+$/.test(newIdStr)) {
                bot.sendMessage(chatId, "⚠️ ID không hợp lệ.");
                return;
            }
            const newId = Number(newIdStr);

            try {
                const { rows } = await db.query('SELECT telegram_id FROM users WHERE telegram_id = $1', [newId]);
                if (rows.length > 0) {
                    bot.sendMessage(chatId, `⚠️ ID **${newId}** đã có sẵn quyền.`, {parse_mode: 'Markdown'});
                } else {
                    await db.query('INSERT INTO users (telegram_id, role) VALUES ($1, $2)', [newId, 'user']);
                    bot.sendMessage(chatId, `✅ Đã cấp quyền sử dụng Bot thành công cho ID: **${newId}**`, {parse_mode: 'Markdown'});
                }
            } catch (err) {
                bot.sendMessage(chatId, "❌ Lỗi DB: " + err.message);
            }
            return;
        }

        if (text.startsWith('/deluser ')) {
            if (String(chatId) !== MASTER_ADMIN_ID && role !== 'admin') {
                bot.sendMessage(chatId, "⛔ Chỉ Admin mới được phép sử dụng lệnh này.");
                return;
            }
            const delId = Number(text.replace('/deluser ', '').trim());
            if (String(delId) === MASTER_ADMIN_ID) {
                bot.sendMessage(chatId, "⚠️ Không thể thu hồi quyền của Chủ Bot!");
                return;
            }
            try {
                const res = await db.query('DELETE FROM users WHERE telegram_id = $1', [delId]);
                if (res.rowCount > 0) {
                    bot.sendMessage(chatId, `✅ Đã thu hồi quyền sử dụng Bot của ID: **${delId}**`, {parse_mode: 'Markdown'});
                } else {
                    bot.sendMessage(chatId, `⚠️ ID **${delId}** không tồn tại trong DB.`, {parse_mode: 'Markdown'});
                }
            } catch (err) {
                bot.sendMessage(chatId, "❌ Lỗi DB: " + err.message);
            }
            return;
        }

        if (text === '/listuser') {
            if (String(chatId) !== MASTER_ADMIN_ID && role !== 'admin') {
                bot.sendMessage(chatId, "⛔ Chỉ Admin mới được phép sử dụng lệnh này.");
                return;
            }
            try {
                const { rows } = await db.query('SELECT telegram_id, role FROM users');
                let listMsg = "👥 **DANH SÁCH TÀI KHOẢN ĐƯỢC PHÉP:**\n\n";
                listMsg += `1. \`${MASTER_ADMIN_ID}\` - 👑 Chủ Bot\n`;
                rows.forEach((r, index) => {
                    listMsg += `${index + 2}. \`${r.telegram_id}\` - ${r.role === 'admin' ? "🛡 Admin" : "👤 Người dùng"}\n`;
                });
                bot.sendMessage(chatId, listMsg, {parse_mode: 'Markdown'});
            } catch (err) {
                bot.sendMessage(chatId, "❌ Lỗi DB: " + err.message);
            }
            return;
        }

        if (text.startsWith('/setproxy ')) {
            if (String(chatId) !== MASTER_ADMIN_ID && role !== 'admin') {
                bot.sendMessage(chatId, "⛔ Chỉ Admin mới được phép sử dụng lệnh này.");
                return;
            }
            const newKey = text.replace('/setproxy ', '').trim();
            const parts = newKey.split(':');
            const isStaticProxy = parts.length === 4;
            try {
                await db.query("INSERT INTO system_config (key, value) VALUES ('global_kiotproxy_key', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(newKey)]);
                if (isStaticProxy) {
                    bot.sendMessage(chatId, `✅ Đã lưu **Proxy302 Static** thành công!\n🌐 Host: \`${parts[0]}:${parts[1]}\`\n👤 User: \`${parts[2]}\``, { parse_mode: 'Markdown' });
                } else {
                    bot.sendMessage(chatId, `✅ Đã lưu **KiotProxy Key** thành công vào Database!`);
                }
            } catch (err) {
                bot.sendMessage(chatId, "❌ Lỗi DB: " + err.message);
            }
            return;
        }

        if (text.startsWith('/setcookie ')) {
            if (String(chatId) !== MASTER_ADMIN_ID && role !== 'admin') {
                bot.sendMessage(chatId, "⛔ Chỉ Admin mới được phép sử dụng lệnh này.");
                return;
            }
            const newCookie = text.replace('/setcookie ', '').trim();
            if (!newCookie) {
                bot.sendMessage(chatId, "⚠️ Vui lòng nhập chuỗi Cookie hợp lệ.");
                return;
            }
            try {
                await db.query("INSERT INTO system_config (key, value) VALUES ('hongguo_cookie', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(newCookie)]);
                bot.sendMessage(chatId, `✅ **Đã lưu Cookie Hồng Quả thành công!**\n🔑 Độ dài: ${newCookie.length} ký tự.\nTừ bây giờ Bot sẽ đính kèm Cookie này để mở khoá Full Video và vượt qua kiểm tra IP/WAF.`, { parse_mode: 'Markdown' });
            } catch (err) {
                bot.sendMessage(chatId, "❌ Lỗi DB: " + err.message);
            }
            return;
        }

        if (text === '/getcookie') {
            if (String(chatId) !== MASTER_ADMIN_ID && role !== 'admin') {
                bot.sendMessage(chatId, "⛔ Chỉ Admin mới được phép sử dụng lệnh này.");
                return;
            }
            const activeCookie = await getGlobalCookie();
            if (activeCookie) {
                const preview = activeCookie.length > 60 ? activeCookie.substring(0, 60) + '...' : activeCookie;
                bot.sendMessage(chatId, `🔑 **TRẠNG THÁI COOKIE:** Đang kích hoạt\n📝 **Xem trước:** \`${preview}\`\n📏 **Độ dài:** ${activeCookie.length} ký tự`, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, `⚠️ Hiện tại chưa có Cookie nào được thiết lập.\n👉 Gõ \`/setcookie [CHUỖI_COOKIE]\` để thiết lập.`, { parse_mode: 'Markdown' });
            }
            return;
        }

        if (text === '/clearcookie') {
            if (String(chatId) !== MASTER_ADMIN_ID && role !== 'admin') {
                bot.sendMessage(chatId, "⛔ Chỉ Admin mới được phép sử dụng lệnh này.");
                return;
            }
            try {
                await db.query("DELETE FROM system_config WHERE key = 'hongguo_cookie'");
                bot.sendMessage(chatId, `🗑 **Đã xoá Cookie thành công!** Hệ thống sẽ chuyển về chế độ mặc định.`);
            } catch (err) {
                bot.sendMessage(chatId, "❌ Lỗi DB: " + err.message);
            }
            return;
        }

        const currentKiotKey = await getGlobalKiotProxyKey();

        // Nhận diện loại proxy: static (Proxy302) hay dynamic (KiotProxy)
        function isStaticProxyKey(key) {
            if (!key) return false;
            const parts = key.split(':');
            return parts.length === 4; // host:port:user:pass
        }
        function buildStaticProxyUrl(key) {
            const [host, port, user, pass] = key.split(':');
            return { ip: host, proxyUrl: `http://${user}:${pass}@${host}:${port}`, location: '🌐 Static Proxy302' };
        }

        if (text === '/newip') {
            if (!currentKiotKey) {
                bot.sendMessage(chatId, "⚠️ Bạn chưa thiết lập Key Proxy.", {parse_mode: 'Markdown'});
                return;
            }
            if (isStaticProxyKey(currentKiotKey)) {
                const p = buildStaticProxyUrl(currentKiotKey);
                bot.sendMessage(chatId, `ℹ️ Bạn đang dùng **Proxy302 Static IP** (IP cố định).\n🌐 IP: \`${p.ip}\`\nKhông cần đổi IP — đây là IP tĩnh Trung Quốc ổn định.`, { parse_mode: 'Markdown' });
                return;
            }
            const checkMsg = await bot.sendMessage(chatId, "⏳ Đang gửi yêu cầu đổi IP mới lên hệ thống...");
            try {
                const currentProxy = await forceNewKiotProxy(currentKiotKey, 'random');
                if (currentProxy) {
                    bot.editMessageText(`✅ **Đã đổi IP thành công!**\n🌐 **IP Mới:** \`${currentProxy.ip}\`\n📍 **Vị trí:** ${currentProxy.location}`, {
                        chat_id: chatId,
                        message_id: checkMsg.message_id,
                        parse_mode: 'Markdown'
                    });
                }
            } catch (err) {
                bot.editMessageText(`❌ **Đổi IP thất bại:**\n_${err.message}_`, { chat_id: chatId, message_id: checkMsg.message_id, parse_mode: 'Markdown' });
            }
            return;
        }

        if (text === '/checkip') {
            if (!currentKiotKey) {
                bot.sendMessage(chatId, "⚠️ Bạn chưa thiết lập Key Proxy.", {parse_mode: 'Markdown'});
                return;
            }
            const checkMsg = await bot.sendMessage(chatId, "⏳ Đang kiểm tra trạng thái mạng...");
            try {
                let currentProxy;
                if (isStaticProxyKey(currentKiotKey)) {
                    currentProxy = buildStaticProxyUrl(currentKiotKey);
                } else {
                    currentProxy = await getKiotProxy(currentKiotKey, 'random');
                }
                if (currentProxy) {
                    bot.editMessageText(`✅ **Hệ thống đang kết nối Proxy an toàn**\n🌐 **Địa chỉ IP:** \`${currentProxy.ip}\`\n📍 **Vị trí:** ${currentProxy.location}`, {
                        chat_id: chatId,
                        message_id: checkMsg.message_id,
                        parse_mode: 'Markdown'
                    });
                }
            } catch (err) {
                bot.editMessageText(`❌ **Không thể lấy Proxy:**\n_${err.message}_`, { chat_id: chatId, message_id: checkMsg.message_id, parse_mode: 'Markdown' });
            }
            return;
        }

        const urlMatch = text.match(/(https?:\/\/[^\s]+)/);
        if (urlMatch) {
            const url = urlMatch[0];
            
            try {
                const processingMsg = await bot.sendMessage(chatId, "⏳ Bắt đầu xử lý...");
                let currentProxy = null;
                if (currentKiotKey) {
                    if (isStaticProxyKey(currentKiotKey)) {
                        // Proxy302 static: dùng ngay, không cần gọi API
                        currentProxy = buildStaticProxyUrl(currentKiotKey);
                        await bot.editMessageText(`⏳ Đang phân tích link qua Proxy302 Static IP: ${currentProxy.ip}...`, { chat_id: chatId, message_id: processingMsg.message_id });
                    } else {
                        // KiotProxy dynamic
                        await bot.editMessageText(`⏳ Đang kết nối KiotProxy...`, { chat_id: chatId, message_id: processingMsg.message_id });
                        try {
                            currentProxy = await getKiotProxy(currentKiotKey, 'random');
                        } catch (err) {
                            bot.sendMessage(chatId, `⚠️ Lỗi lấy Proxy: ${err.message}. Thử tải bằng IP gốc.`);
                        }
                    }
                }

                if (currentProxy) {
                    await bot.editMessageText(`⏳ Đang phân tích link qua Proxy IP: ${currentProxy.ip}...`, { chat_id: chatId, message_id: processingMsg.message_id });
                } else {
                    await bot.editMessageText("⏳ Đang phân tích link bằng IP gốc...", { chat_id: chatId, message_id: processingMsg.message_id });
                }
                
                const proxyUrl = currentProxy ? currentProxy.proxyUrl : null;

                // CDN Hồng Quả (qznovel.com) chỉ cho phép IP Trung Quốc truy cập.
                // Nếu proxy không phải IP TQ → cảnh báo người dùng đổi IP.
                const isHongguoLink = url.includes('novelquickapp.com');
                if (isHongguoLink && currentProxy) {
                    const loc = (currentProxy.location || '').toLowerCase();
                    const isChineseIp = !loc.includes('việt') && !loc.includes('viet') && !loc.includes('miền') && !loc.includes('mien') && !loc.includes('bắc') && !loc.includes('nam') && !loc.includes('trung');
                    if (!isChineseIp) {
                        await bot.sendMessage(chatId, `⚠️ *Cảnh báo:* IP hiện tại (\`${currentProxy.ip}\` - ${currentProxy.location}) là IP Việt Nam. CDN Hồng Quả chỉ cho phép IP Trung Quốc tải về.\nĐang thử tải... nếu thất bại, gõ \`/newip\` vài lần cho đến khi lấy được IP Trung Quốc rồi thử lại.`, { parse_mode: 'Markdown' });
                    }
                }

                const currentCookie = await getGlobalCookie();
                const videoInfo = await parseVideoUrl(url, proxyUrl, currentCookie);

                if (videoInfo && videoInfo.url) {
                    await bot.editMessageText(`⏳ Đang tải video: ${videoInfo.title}...`, { chat_id: chatId, message_id: processingMsg.message_id });

                    const safeTitle = videoInfo.title.replace(/[\\/:*?"<>|]/g, '');
                    // Dùng cùng proxy cho cả download để tránh IP mismatch
                    const videoPath = await downloadVideo(videoInfo.url, safeTitle, proxyUrl);
                    
                    const stats = fs.statSync(videoPath);
                    const fileSizeMB = stats.size / (1024 * 1024);
                    console.log(`[INFO] Dung lượng file đã tải: ${fileSizeMB.toFixed(1)}MB`);

                    try {
                        let methodNote = "";
                        if (videoInfo.source === 'app_native_api') {
                            methodNote = "⚡ *Cơ chế:* Native App API (Full HD)\n";
                        } else if (currentCookie) {
                            methodNote = "🔑 *Cơ chế:* Cookie VIP Bypass\n";
                        }

                        let finalCaption = `🎬 **${videoInfo.title}**\n\n`;
                        finalCaption += methodNote;
                        finalCaption += currentProxy ? `🛡 *Kết nối Proxy:* \`${currentProxy.ip}\`` : `⚠️ *Tải bằng IP gốc*`;

                        if (fileSizeMB > 49.5) {
                            await bot.editMessageText(`⏳ Dung lượng video lớn (${fileSizeMB.toFixed(1)}MB). Đang upload lên web để lấy link tải...`, { chat_id: chatId, message_id: processingMsg.message_id });
                            const uploadLink = await uploadToThirdParty(videoPath);
                            
                            let webCaption = `🎬 **${videoInfo.title}**\n\n`;
                            webCaption += methodNote;
                            webCaption += `⚠️ *Video quá lớn để gửi trực tiếp \(>50MB\)\.*\n`;
                            webCaption += `👉 [BẤM VÀO ĐÂY ĐỂ TẢI VIDEO VỀ](${uploadLink})\n`;
                            webCaption += `_\(Link tải tự động xóa sau 12 giờ\)_\n\n`;
                            webCaption += currentProxy ? `🛡 *Kết nối Proxy:* \`${currentProxy.ip}\`` : `⚠️ *Tải bằng IP gốc*`;
                            
                            await bot.sendMessage(chatId, webCaption, { parse_mode: 'Markdown', disable_web_page_preview: true });
                            bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
                        } else {
                            await bot.editMessageText("📤 Đang gửi video...", { chat_id: chatId, message_id: processingMsg.message_id });
                            await bot.sendVideo(chatId, videoPath, { caption: finalCaption, parse_mode: 'Markdown' });
                            bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
                        }

                        // Lưu vào Database
                        try {
                            const proxyIp = currentProxy ? currentProxy.ip : null;
                            await db.query(`INSERT INTO downloads (telegram_id, original_url, video_title, proxy_ip) VALUES ($1, $2, $3, $4)`, 
                                [chatId, url, videoInfo.title, proxyIp]);
                        } catch (dbErr) {
                            console.error("Lỗi lưu lịch sử tải vào DB:", dbErr);
                        }

                    } catch (sendError) {
                        bot.sendMessage(chatId, `❌ Lỗi khi gửi/upload video: ${sendError.message}`);
                    } finally {
                        // Luôn xóa file tạm dù thành công hay lỗi
                        fs.unlink(videoPath, (err) => {
                            if (err) console.error(`[WARN] Không thể xóa file tạm: ${videoPath}`, err.message);
                            else console.log(`[INFO] Đã dọn file tạm: ${videoPath}`);
                        });
                    }
                } else {
                    bot.sendMessage(chatId, "❌ Không tìm thấy link video gốc.");
                }
            } catch (error) {
                let errHelp = `❌ **Lỗi:** ${error.message}`;
                if (error.message && (error.message.includes('403') || error.message.includes('CHẶN') || error.message.includes('TỪ CHỐI') || error.message.includes('CAPTCHA'))) {
                    errHelp += `\n\n💡 *Gợi ý khắc phục:* Nếu link bị chặn hoặc chỉ có bản 30s, bạn hãy gõ lệnh \`/hdcookie\` để xem cách nạp Cookie tài khoản thật vượt chặn 100%.`;
                }
                bot.sendMessage(chatId, errHelp, { parse_mode: 'Markdown' });
            }
        }
    });
} else {
    console.log("[INFO] Chưa cấu hình Telegram Bot Token (bỏ trống trong config.json và env). Bỏ qua khởi động Bot.");
}

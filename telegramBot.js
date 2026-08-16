let TelegramBot = require('node-telegram-bot-api');
if (typeof TelegramBot !== 'function') {
    TelegramBot = TelegramBot.default || TelegramBot.TelegramBot;
}
const fs = require('fs');
const path = require('path');
const { parseVideoUrl } = require('./parser');
const { downloadVideo, uploadToThirdParty } = require('./downloader');
const { 
    getBestChinaProxy, 
    refreshChinaProxyPool, 
    markProxyFailed, 
    getPoolStatus, 
    forceNewKiotProxy,
    testProxy 
} = require('./proxyHelper');
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
        {command: 'proxy', description: '🌐 Trạng thái Proxy & Pool Trung Quốc'},
        {command: 'scanproxy', description: '🔍 Quét tìm Proxy Trung Quốc sống mới'},
        {command: 'newip', description: '🔄 Đổi sang Proxy Trung Quốc khác'},
        {command: 'checkip', description: '📡 Kiểm tra IP & kết nối hiện tại'},
        {command: 'setproxy', description: '⚙️ Cài đặt Proxy (Free Pool / Proxy302)'},
        {command: 'hdproxy', description: '📖 Hướng dẫn chi tiết về Proxy'},
        {command: 'hdcookie', description: '🍪 Hướng dẫn cách lấy Cookie vượt chặn'},
        {command: 'setcookie', description: 'Thiết lập Cookie tài khoản'},
        {command: 'getcookie', description: 'Kiểm tra trạng thái Cookie hiện tại'},
        {command: 'clearcookie', description: 'Xoá Cookie đã lưu'},
        {command: 'adduser', description: 'Thêm ID được dùng Bot'},
        {command: 'deluser', description: 'Xóa ID khỏi danh sách'},
        {command: 'listuser', description: 'Xem danh sách người dùng'}
    ]).catch(err => console.error("Lỗi setMyCommands:", err));

    console.log("[INFO] Telegram Bot đã khởi động và kết nối Database...");

    // Tự động khởi động làm mới Proxy Pool Trung Quốc ngay khi bot bật
    refreshChinaProxyPool(false, 30).catch(e => console.log("[WARN] Không thể khởi động trước Proxy Pool:", e.message));

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
            bot.sendMessage(chatId, "Xin chào! Hãy gửi cho tôi link video, tôi sẽ tự động định tuyến qua Proxy Trung Quốc để tải Full Video không bị cắt 30s.\n\n📖 Gõ `/hd` để xem hướng dẫn tổng quan.\n🌐 Gõ `/proxy` để kiểm tra trạng thái Proxy Trung Quốc.\n🍪 Gõ `/hdcookie` để xem cách nạp Cookie tài khoản.", {parse_mode: 'Markdown'});
            return;
        }

        if (text === '/hd') {
            const helpText = `
📖 **HƯỚNG DẪN SỬ DỤNG BOT TẢI FULL VIDEO (KHÔNG CẮT 30S)**

━━━━━━━━━━━━━━━━━━━━
**1️⃣ CÁCH TẢI VIDEO:**
🔸 Gửi trực tiếp link video (Hồng Quả, Douyin, Kuaishou,...) vào khung chat.
🔸 Bot mặc định sử dụng **Native App API + Proxy Trung Quốc Share** để tải Full HD không bị cắt 30s.
*(Nếu video > 50MB, Bot sẽ tự động upload lên web và gửi link tải trực tiếp tốc độ cao)*

━━━━━━━━━━━━━━━━━━━━
**2️⃣ QUẢN LÝ PROXY TRUNG QUỐC:**
🔹 \`/proxy\` hoặc \`/checkip\` : Xem bảng trạng thái Proxy & số IP Trung Quốc đang sống.
🔹 \`/scanproxy\` (hoặc \`/refreshpool\`) : Quét tìm và kiểm tra sức khỏe danh sách Proxy Trung Quốc mới.
🔹 \`/newip\` : Tự động đổi sang một IP Trung Quốc khác trong Pool.
🔹 \`/setproxy auto\` : Bật chế độ Tự Động Thu Thập & Dùng Proxy TQ Share miễn phí (Phương án 1).
🔹 \`/setproxy IP:PORT:USER:PASS\` : Nạp Proxy riêng (Proxy302 / Static Proxy).
🔹 \`/setproxy off\` : Tắt proxy (Dùng IP gốc máy chủ).
🔹 \`/hdproxy\` : Xem hướng dẫn chi tiết về các chế độ Proxy.

━━━━━━━━━━━━━━━━━━━━
**3️⃣ QUẢN LÝ COOKIE (VƯỢT CHẶN 403 / MỞ KHÓA TẬP VIP):**
🔹 \`/setcookie [CHUỖI_COOKIE]\` : Thiết lập Cookie tài khoản từ trình duyệt.
🔹 \`/getcookie\` : Kiểm tra trạng thái Cookie hiện tại.
🔹 \`/clearcookie\` : Xoá Cookie đã lưu để về mặc định.
🔹 \`/hdcookie\` : Xem hướng dẫn từng bước cách lấy Cookie từ F12 trình duyệt.

━━━━━━━━━━━━━━━━━━━━
**4️⃣ QUẢN LÝ NGƯỜI DÙNG (CHỈ ADMIN):**
🔹 \`/adduser [ID]\` : Cấp quyền cho tài khoản Telegram khác sử dụng Bot.
🔹 \`/deluser [ID]\` : Thu hồi quyền sử dụng Bot của một ID.
🔹 \`/listuser\` : Xem danh sách tất cả người dùng được cấp phép.
`;
            bot.sendMessage(chatId, helpText, {parse_mode: 'Markdown'});
            return;
        }

        if (text === '/hdproxy') {
            const proxyGuide = `
🌐 **HƯỚNG DẪN HỆ THỐNG PROXY TRUNG QUỐC SHARE**

Bot hỗ trợ hệ thống Proxy thông minh đa phương án:

━━━━━━━━━━━━━━━━━━━━
**1️⃣ PHƯƠNG ÁN 1: TỰ ĐỘNG CÀO PROXY TRUNG QUỐC MIỄN PHÍ (MẶC ĐỊNH)**
🔸 Bot tự động thu thập Proxy từ các nguồn mở (GitHub, ProxyScrape, Geonode,...).
🔸 Tự động chạy Health Check kiểm tra IP sống & xoay vòng (Round-robin) liên tục.
👉 Kích hoạt: \`/setproxy auto\` hoặc \`/setproxy free\`
👉 Quét IP mới ngay: \`/scanproxy\`

━━━━━━━━━━━━━━━━━━━━
**2️⃣ PHƯƠNG ÁN 2: DÙNG PROXY RIÊNG (PROXY302 / CUSTOM PROXY)**
🔸 Nếu bạn có Proxy riêng dạng \`IP:PORT:USER:PASS\` hoặc \`IP:PORT\`:
👉 Gửi vào Bot: \`/setproxy 103.153.64.21:8080:user123:pass456\`

━━━━━━━━━━━━━━━━━━━━
**3️⃣ CÁC LỆNH TIỆN ÍCH:**
🔹 \`/proxy\` : Xem bảng điều khiển trạng thái Proxy.
🔹 \`/newip\` : Ép chuyển sang Proxy Trung Quốc tiếp theo.
🔹 \`/scanproxy\` : Quét và lọc danh sách Proxy sống mới nhất.
🔹 \`/setproxy off\` : Chuyển về dùng IP gốc (không qua Proxy).
`;
            bot.sendMessage(chatId, proxyGuide, {parse_mode: 'Markdown'});
            return;
        }

        if (text === '/hdcookie') {
            const cookieGuide = `
🍪 **HƯỚNG DẪN LẤY & CÀI ĐẶT COOKIE (CÁCH 4)**
_(Dùng khi phim yêu cầu VIP hoặc CDN chặn kiểm tra tài khoản)_

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

        if (text.startsWith('/setproxy')) {
            if (String(chatId) !== MASTER_ADMIN_ID && role !== 'admin') {
                bot.sendMessage(chatId, "⛔ Chỉ Admin mới được phép sử dụng lệnh này.");
                return;
            }
            const rawKey = text.replace('/setproxy', '').trim();
            
            if (!rawKey || rawKey === 'auto' || rawKey === 'free') {
                try {
                    await db.query("INSERT INTO system_config (key, value) VALUES ('global_kiotproxy_key', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", ['"auto"']);
                    bot.sendMessage(chatId, `✅ **Đã kích hoạt chế độ Tự Động Dùng Proxy Trung Quốc Free Share (Phương án 1)!**\nBot sẽ tự động thu thập, kiểm tra sống/chết và xoay tua các Proxy Trung Quốc tốc độ cao.`, { parse_mode: 'Markdown' });
                } catch (err) {
                    bot.sendMessage(chatId, "❌ Lỗi DB: " + err.message);
                }
                return;
            }

            if (rawKey === 'off' || rawKey === 'none') {
                try {
                    await db.query("INSERT INTO system_config (key, value) VALUES ('global_kiotproxy_key', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", ['"none"']);
                    bot.sendMessage(chatId, `ℹ️ **Đã tắt Proxy.** Bot sẽ kết nối trực tiếp bằng IP máy chủ.`);
                } catch (err) {
                    bot.sendMessage(chatId, "❌ Lỗi DB: " + err.message);
                }
                return;
            }

            const parts = rawKey.split(':');
            const isStaticProxy = parts.length === 4;
            try {
                await db.query("INSERT INTO system_config (key, value) VALUES ('global_kiotproxy_key', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(rawKey)]);
                if (isStaticProxy) {
                    bot.sendMessage(chatId, `✅ Đã lưu **Proxy Tĩnh (Proxy302/Custom)** thành công!\n🌐 Host: \`${parts[0]}:${parts[1]}\`\n👤 User: \`${parts[2]}\``, { parse_mode: 'Markdown' });
                } else if (rawKey.startsWith('K')) {
                    bot.sendMessage(chatId, `✅ Đã lưu **KiotProxy Key** thành công vào Database!`);
                } else {
                    bot.sendMessage(chatId, `✅ Đã lưu cấu hình Proxy thành công!`);
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

        // Lệnh Quét & Kiểm tra Proxy TQ mới
        if (text === '/scanproxy' || text === '/refreshpool') {
            const checkMsg = await bot.sendMessage(chatId, "🔍 **Đang quét và kiểm tra (Health Check) các nguồn Proxy Trung Quốc...**\n_Vui lòng đợi trong giây lát..._", { parse_mode: 'Markdown' });
            try {
                const pool = await refreshChinaProxyPool(true, 35);
                let report = `✅ **QUÉT PROXY TRUNG QUỐC HOÀN TẤT!**\n\n`;
                report += `📊 **Tổng số Proxy sống:** \`${pool.length}\` IP\n`;
                if (pool.length > 0) {
                    report += `\n🏆 **Top IP Trung Quốc phản hồi nhanh nhất:**\n`;
                    pool.slice(0, 5).forEach((p, idx) => {
                        report += `${idx + 1}. \`${p.ip}\` - ⚡ ${p.latencyMs}ms (${p.location})\n`;
                    });
                    report += `\n💡 Bot sẽ tự động xoay tua các IP trên khi bạn tải video.`;
                } else {
                    report += `⚠️ Chưa tìm thấy IP nào phản hồi nhanh. Bot sẽ thử lại ở lượt tải tiếp theo.`;
                }
                bot.editMessageText(report, {
                    chat_id: chatId,
                    message_id: checkMsg.message_id,
                    parse_mode: 'Markdown'
                });
            } catch (err) {
                bot.editMessageText(`❌ **Quét Proxy thất bại:** ${err.message}`, { chat_id: chatId, message_id: checkMsg.message_id });
            }
            return;
        }

        // Lệnh Đổi IP sang IP khác trong Pool
        if (text === '/newip') {
            const checkMsg = await bot.sendMessage(chatId, "⏳ Đang đổi sang Proxy Trung Quốc mới...");
            try {
                const newProxy = await forceNewKiotProxy(currentKiotKey);
                if (newProxy) {
                    bot.editMessageText(`✅ **Đã đổi sang Proxy mới thành công!**\n🌐 **IP Mới:** \`${newProxy.ip}\`\n📍 **Vị trí:** ${newProxy.location}`, {
                        chat_id: chatId,
                        message_id: checkMsg.message_id,
                        parse_mode: 'Markdown'
                    });
                } else {
                    bot.editMessageText(`⚠️ Không tìm thấy proxy khả dụng trong pool. Gõ \`/scanproxy\` để quét lại.`, { chat_id: chatId, message_id: checkMsg.message_id });
                }
            } catch (err) {
                bot.editMessageText(`❌ **Đổi IP thất bại:**\n_${err.message}_`, { chat_id: chatId, message_id: checkMsg.message_id, parse_mode: 'Markdown' });
            }
            return;
        }

        // Lệnh Kiểm tra trạng thái Proxy & IP hiện hành
        if (text === '/checkip' || text === '/proxy' || text === '/checkproxy') {
            const checkMsg = await bot.sendMessage(chatId, "⏳ Đang kiểm tra trạng thái mạng và đo Ping...");
            try {
                const poolStatus = getPoolStatus();
                const proxyInfo = await getBestChinaProxy(currentKiotKey);
                
                let msgText = `🌐 **BẢNG ĐIỀU KHIỂN PROXY TRUNG QUỐC**\n\n`;
                if (currentKiotKey === 'none' || currentKiotKey === 'off') {
                    msgText += `⚙️ **Chế độ:** Tắt Proxy (Dùng IP Gốc)\n`;
                } else if (proxyInfo && proxyInfo.isFreePool) {
                    msgText += `⚙️ **Chế độ:** 🇨🇳 **Auto Free China Proxy Pool (Phương án 1)**\n`;
                    msgText += `🏊 **Số Proxy TQ sống trong Pool:** \`${poolStatus.totalLive}\` IP\n`;
                    msgText += `🌐 **IP kết nối hiện tại:** \`${proxyInfo.ip}\`\n`;
                    msgText += `📍 **Vị trí:** ${proxyInfo.location}\n`;
                    msgText += `🕒 **Lần quét gần nhất:** ${poolStatus.lastRefresh}\n`;
                } else if (proxyInfo) {
                    msgText += `⚙️ **Chế độ:** 🌐 **Custom / Static Proxy**\n`;
                    msgText += `🌐 **IP:** \`${proxyInfo.ip}\`\n`;
                    msgText += `📍 **Vị trí:** ${proxyInfo.location}\n`;
                } else {
                    msgText += `⚠️ **Chưa tìm thấy Proxy khả dụng.** Bot đang dùng IP gốc.\n👉 Gõ \`/scanproxy\` để tìm Proxy mới.`;
                }

                msgText += `\n━━━━━━━━━━━━━━━━━━━━\n`;
                msgText += `👉 \`/newip\` : Đổi sang IP khác\n`;
                msgText += `👉 \`/scanproxy\` : Quét tìm thêm IP mới\n`;
                msgText += `👉 \`/setproxy auto\` : Bật lại chế độ Tự Động`;

                bot.editMessageText(msgText, {
                    chat_id: chatId,
                    message_id: checkMsg.message_id,
                    parse_mode: 'Markdown'
                });
            } catch (err) {
                bot.editMessageText(`❌ **Không thể kiểm tra Proxy:**\n_${err.message}_`, { chat_id: chatId, message_id: checkMsg.message_id, parse_mode: 'Markdown' });
            }
            return;
        }

        const urlMatch = text.match(/(https?:\/\/[^\s]+)/);
        if (urlMatch) {
            const url = urlMatch[0];
            
            try {
                const processingMsg = await bot.sendMessage(chatId, "⏳ Bắt đầu xử lý...");
                
                // Lấy Proxy Trung Quốc tốt nhất
                let currentProxy = null;
                if (currentKiotKey !== 'none' && currentKiotKey !== 'off') {
                    currentProxy = await getBestChinaProxy(currentKiotKey);
                }

                if (currentProxy) {
                    await bot.editMessageText(`⏳ Đang kết nối qua Proxy Trung Quốc: \`${currentProxy.ip}\` (${currentProxy.location})...`, { 
                        chat_id: chatId, 
                        message_id: processingMsg.message_id, 
                        parse_mode: 'Markdown' 
                    });
                } else {
                    await bot.editMessageText("⏳ Đang phân tích link bằng IP gốc...", { chat_id: chatId, message_id: processingMsg.message_id });
                }
                
                let proxyUrl = currentProxy ? currentProxy.proxyUrl : null;
                const currentCookie = await getGlobalCookie();

                let videoInfo = null;

                // Thử phân tích URL (có hỗ trợ failover nếu proxy lỗi)
                try {
                    videoInfo = await parseVideoUrl(url, proxyUrl, currentCookie);
                } catch (parseErr) {
                    if (currentProxy && (parseErr.message.includes('LỖI KẾT NỐI') || parseErr.message.includes('BỊ TỪ CHỐI') || parseErr.message.includes('timeout'))) {
                        console.log(`[FAILOVER] Proxy ${currentProxy.ip} bị lỗi parse, đánh dấu và thử proxy khác...`);
                        markProxyFailed(currentProxy.proxyUrl);
                        currentProxy = await getBestChinaProxy(currentKiotKey);
                        proxyUrl = currentProxy ? currentProxy.proxyUrl : null;
                        if (currentProxy) {
                            await bot.editMessageText(`🔄 Tự động chuyển sang Proxy dự phòng: \`${currentProxy.ip}\`...`, { chat_id: chatId, message_id: processingMsg.message_id, parse_mode: 'Markdown' });
                            videoInfo = await parseVideoUrl(url, proxyUrl, currentCookie);
                        } else {
                            throw parseErr;
                        }
                    } else {
                        throw parseErr;
                    }
                }

                if (videoInfo && videoInfo.url) {
                    await bot.editMessageText(`⏳ Đang tải video: ${videoInfo.title}...`, { chat_id: chatId, message_id: processingMsg.message_id });

                    const safeTitle = videoInfo.title.replace(/[\\/:*?"<>|]/g, '');
                    
                    let videoPath = null;
                    try {
                        videoPath = await downloadVideo(videoInfo.url, safeTitle, proxyUrl);
                    } catch (dlErr) {
                        // Failover cho phần download
                        if (currentProxy && (dlErr.message.includes('502') || dlErr.message.includes('LỖI MẠNG') || dlErr.message.includes('CHẶN'))) {
                            console.log(`[FAILOVER] Download thất bại với ${currentProxy.ip}, thử lại qua proxy khác...`);
                            markProxyFailed(currentProxy.proxyUrl);
                            currentProxy = await getBestChinaProxy(currentKiotKey);
                            proxyUrl = currentProxy ? currentProxy.proxyUrl : null;
                            if (currentProxy) {
                                await bot.editMessageText(`🔄 Đang thử tải lại qua Proxy TQ mới: \`${currentProxy.ip}\`...`, { chat_id: chatId, message_id: processingMsg.message_id, parse_mode: 'Markdown' });
                                videoPath = await downloadVideo(videoInfo.url, safeTitle, proxyUrl);
                            } else {
                                throw dlErr;
                            }
                        } else {
                            throw dlErr;
                        }
                    }
                    
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
                        finalCaption += currentProxy ? `🇨🇳 *Proxy Trung Quốc:* \`${currentProxy.ip}\` (${currentProxy.location})` : `⚠️ *Tải bằng IP gốc*`;

                        if (fileSizeMB > 49.5) {
                            await bot.editMessageText(`⏳ Dung lượng video lớn (${fileSizeMB.toFixed(1)}MB). Đang upload lên web để lấy link tải...`, { chat_id: chatId, message_id: processingMsg.message_id });
                            const uploadLink = await uploadToThirdParty(videoPath);
                            
                            let webCaption = `🎬 **${videoInfo.title}**\n\n`;
                            webCaption += methodNote;
                            webCaption += `⚠️ *Video quá lớn để gửi trực tiếp \(>50MB\)\.*\n`;
                            webCaption += `👉 [BẤM VÀO ĐÂY ĐỂ TẢI VIDEO VỀ](${uploadLink})\n`;
                            webCaption += `_\(Link tải tự động xóa sau 12 giờ\)_\n\n`;
                            webCaption += currentProxy ? `🇨🇳 *Proxy Trung Quốc:* \`${currentProxy.ip}\` (${currentProxy.location})` : `⚠️ *Tải bằng IP gốc*`;
                            
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
                    errHelp += `\n\n💡 *Gợi ý khắc phục:* Nếu link bị chặn hoặc chỉ có bản 30s, bạn hãy gõ lệnh \`/scanproxy\` để lấy IP Trung Quốc mới hoặc gõ \`/hdcookie\` để nạp Cookie tài khoản thật vượt chặn 100%.`;
                }
                bot.sendMessage(chatId, errHelp, { parse_mode: 'Markdown' });
            }
        }
    });
} else {
    console.log("[INFO] Chưa cấu hình Telegram Bot Token (bỏ trống trong config.json và env). Bỏ qua khởi động Bot.");
}

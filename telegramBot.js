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
        {command: 'hd', description: 'Xem hướng dẫn chi tiết'},
        {command: 'checkip', description: 'Kiểm tra IP Proxy đang kết nối'},
        {command: 'newip', description: 'Đổi sang Proxy mới ngay lập tức'},
        {command: 'setproxy', description: 'Thiết lập Key KiotProxy'},
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
            bot.sendMessage(chatId, "Xin chào! Hãy gửi cho tôi link video, tôi sẽ tải và gửi lại cho bạn.\nNếu bạn bị chặn IP, hãy gửi lệnh `/setproxy [KEY]` để thiết lập KiotProxy.\nGõ `/hd` để xem hướng dẫn chi tiết.", {parse_mode: 'Markdown'});
            return;
        }

        if (text === '/hd') {
            const helpText = `
📖 **HƯỚNG DẪN SỬ DỤNG BOT TẢI VIDEO**

**1. CÁCH TẢI VIDEO:**
🔸 Copy link video và dán thẳng vào đây.
🔸 Bot sẽ tự động bắt link, tải video và gửi lại cho bạn.
*(Lưu ý: Giới hạn file video Telegram là 50MB)*

**2. CÁCH DÙNG PROXY (KIOTPROXY):**
🔸 Lệnh đổi Key: \`/setproxy MÃ_KEY_CỦA_BẠN\`
🔸 Lệnh kiểm tra IP: \`/checkip\` - Xem Bot đang dùng IP nào để tải.

**3. DANH SÁCH TỔNG HỢP LỆNH:**
🔹 \`/start\` - Khởi động lại Bot
🔹 \`/hd\` - Mở bảng hướng dẫn
🔹 \`/checkip\` - Kiểm tra mạng/IP hiện tại
🔹 \`/newip\` - Ép hệ thống đổi sang IP mới
🔹 \`/setproxy [KEY]\` - Nhập Key KiotProxy

**4. QUẢN LÝ NGƯỜI DÙNG (CHỈ ADMIN):**
🔹 \`/adduser [ID]\` - Cấp quyền cho người khác.
🔹 \`/deluser [ID]\` - Thu hồi quyền của một người.
🔹 \`/listuser\` - Xem danh sách người dùng được phép.
`;
            bot.sendMessage(chatId, helpText, {parse_mode: 'Markdown'});
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
            try {
                await db.query("INSERT INTO system_config (key, value) VALUES ('global_kiotproxy_key', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(newKey)]);
                bot.sendMessage(chatId, `✅ Đã lưu KiotProxy Key thành công vào Database!`);
            } catch (err) {
                bot.sendMessage(chatId, "❌ Lỗi DB: " + err.message);
            }
            return;
        }

        const currentKiotKey = await getGlobalKiotProxyKey();

        if (text === '/newip') {
            if (!currentKiotKey) {
                bot.sendMessage(chatId, "⚠️ Bạn chưa thiết lập Key KiotProxy.", {parse_mode: 'Markdown'});
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
                bot.sendMessage(chatId, "⚠️ Bạn chưa thiết lập Key KiotProxy.", {parse_mode: 'Markdown'});
                return;
            }
            const checkMsg = await bot.sendMessage(chatId, "⏳ Đang kiểm tra trạng thái mạng...");
            try {
                const currentProxy = await getKiotProxy(currentKiotKey, 'random');
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
                    await bot.editMessageText(`⏳ Đang kết nối KiotProxy...`, { chat_id: chatId, message_id: processingMsg.message_id });
                    try {
                        currentProxy = await getKiotProxy(currentKiotKey, 'random');
                    } catch (err) {
                        bot.sendMessage(chatId, `⚠️ Lỗi lấy Proxy: ${err.message}. Thử tải bằng IP gốc.`);
                    }
                }

                if (currentProxy) {
                    await bot.editMessageText(`⏳ Đang phân tích link qua Proxy IP: ${currentProxy.ip}...`, { chat_id: chatId, message_id: processingMsg.message_id });
                } else {
                    await bot.editMessageText("⏳ Đang phân tích link bằng IP gốc...", { chat_id: chatId, message_id: processingMsg.message_id });
                }
                
                const proxyUrl = currentProxy ? currentProxy.proxyUrl : null;
                const videoInfo = await parseVideoUrl(url, proxyUrl);

                if (videoInfo && videoInfo.url) {
                    await bot.editMessageText(`⏳ Đang tải video: ${videoInfo.title}...`, { chat_id: chatId, message_id: processingMsg.message_id });

                    const safeTitle = videoInfo.title.replace(/[\\/:*?"<>|]/g, '');
                    const videoPath = await downloadVideo(videoInfo.url, safeTitle, proxyUrl);
                    
                    const stats = fs.statSync(videoPath);
                    const fileSizeMB = stats.size / (1024 * 1024);
                    console.log(`[INFO] Dung lượng file đã tải: ${fileSizeMB.toFixed(1)}MB`);

                    try {
                        let finalCaption = `🎬 **${videoInfo.title}**\n\n`;
                        finalCaption += currentProxy ? `🛡 *Đã tải ẩn danh*\n🌐 **IP Kết Nối:** \`${currentProxy.ip}\`` : `⚠️ *Tải bằng IP gốc*`;

                        if (fileSizeMB > 49.5) {
                            await bot.editMessageText(`⏳ Dung lượng video lớn (${fileSizeMB.toFixed(1)}MB). Đang upload lên web để lấy link tải...`, { chat_id: chatId, message_id: processingMsg.message_id });
                            const uploadLink = await uploadToThirdParty(videoPath);
                            
                            let webCaption = `🎬 **${videoInfo.title}**\n\n`;
                            webCaption += `⚠️ *Video quá lớn để gửi trực tiếp \(>50MB\)\.*\n`;
                            webCaption += `👉 [BẤM VÀO ĐÂY ĐỂ TẢI VIDEO VỀ](${uploadLink})\n`;
                            webCaption += `_\(Link tải tự động xóa sau 12 giờ\)_\n\n`;
                            webCaption += currentProxy ? `🛡 *Đã tải ẩn danh*\n🌐 **IP Kết Nối:** \`${currentProxy.ip}\`` : `⚠️ *Tải bằng IP gốc*`;
                            
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
                bot.sendMessage(chatId, `❌ Lỗi: ${error.message}`);
            }
        }
    });
} else {
    console.log("[INFO] Chưa cấu hình Telegram Bot Token (bỏ trống trong config.json và env). Bỏ qua khởi động Bot.");
}

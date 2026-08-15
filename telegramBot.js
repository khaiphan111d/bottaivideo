let TelegramBot = require('node-telegram-bot-api');
if (typeof TelegramBot !== 'function') {
    TelegramBot = TelegramBot.default || TelegramBot.TelegramBot;
}
const fs = require('fs');
const path = require('path');
const { parseVideoUrl } = require('./parser');
const { downloadVideo } = require('./downloader');
const { getKiotProxy, forceNewKiotProxy } = require('./proxyHelper');

const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

if (config.telegramBotToken) {
    const bot = new TelegramBot(config.telegramBotToken, { polling: true });

    // Thiết lập danh sách gợi ý lệnh cho người dùng
    bot.setMyCommands([
        {command: 'start', description: 'Bắt đầu sử dụng bot'},
        {command: 'hd', description: 'Xem hướng dẫn chi tiết'},
        {command: 'checkip', description: 'Kiểm tra IP Proxy đang kết nối'},
        {command: 'newip', description: 'Đổi sang Proxy mới ngay lập tức'},
        {command: 'setproxy', description: 'Thiết lập Key KiotProxy (Cú pháp: /setproxy KEY)'},
        {command: 'adduser', description: 'Thêm ID được dùng Bot (Chỉ dành cho Chủ Bot)'},
        {command: 'deluser', description: 'Xóa ID khỏi danh sách dùng Bot (Chỉ Chủ Bot)'},
        {command: 'listuser', description: 'Xem danh sách người dùng Bot (Chỉ Chủ Bot)'}
    ]).catch(err => console.error("Lỗi setMyCommands:", err));

    console.log("[INFO] Telegram Bot đã khởi động và đang chờ tin nhắn...");

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;

        if (!text) return;

        // Cập nhật để hỗ trợ nhiều tài khoản (mảng telegramAdminIds)
        const MASTER_ADMIN_ID = "5964340237";
        const adminIds = config.telegramAdminIds || [];
        if (config.telegramAdminId && !adminIds.includes(config.telegramAdminId)) {
            adminIds.push(config.telegramAdminId);
        }

        if (adminIds.length > 0) {
            const isAuthorized = adminIds.some(id => String(id) === String(chatId));
            if (!isAuthorized) {
                bot.sendMessage(chatId, "⛔ Bạn không có quyền sử dụng Bot này.");
                return;
            }
        }

        if (text === '/start') {
            bot.sendMessage(chatId, "Xin chào! Hãy gửi cho tôi link video (Douyin, Kuaishou, Hongguo...), tôi sẽ tải và gửi lại cho bạn.\nNếu bạn bị chặn IP, hãy gửi lệnh `/setproxy [KEY]` để thiết lập KiotProxy.\nGõ `/hd` để xem hướng dẫn chi tiết.", {parse_mode: 'Markdown'});
            return;
        }

        if (text === '/hd') {
            const helpText = `
📖 **HƯỚNG DẪN SỬ DỤNG BOT TẢI VIDEO**

**1. CÁCH TẢI VIDEO:**
🔸 Copy link video từ Douyin, Kuaishou, Hồng Quả... và dán thẳng vào đây.
🔸 Bot sẽ tự động bắt link, tải video và gửi lại cho bạn.
*(Lưu ý: Giới hạn file video Telegram là 50MB)*

**2. CÁCH DÙNG PROXY (KIOTPROXY):**
🔸 Lệnh đổi Key: \`/setproxy MÃ_KEY_CỦA_BẠN\`
*(Ví dụ: \`/setproxy K98ce71612345bbc89\`)*
🔸 Lệnh kiểm tra IP: \`/checkip\` - Xem Bot đang dùng IP nào để tải.

**3. DANH SÁCH TỔNG HỢP LỆNH:**
🔹 \`/start\` - Khởi động lại Bot
🔹 \`/hd\` - Mở bảng hướng dẫn này
🔹 \`/checkip\` - Kiểm tra mạng/IP hiện tại
🔹 \`/newip\` - Ép hệ thống đổi sang IP mới
🔹 \`/setproxy [KEY]\` - Nhập Key KiotProxy để chống chặn

**4. CÁC LỖI THƯỜNG GẶP:**
❌ *IP BỊ CHẶN / YÊU CẦU CAPTCHA:* Web đã chặn IP, hãy dùng \`/newip\` hoặc \`/setproxy\`.
❌ *Video quá lớn:* Vượt 50MB, bạn cần tải trên web thay vì dùng Bot.

**5. QUẢN LÝ NGƯỜI DÙNG (CHỈ CHỦ BOT):**
🔹 \`/adduser [ID]\` - Cấp quyền cho người khác.
🔹 \`/deluser [ID]\` - Thu hồi quyền của một người.
🔹 \`/listuser\` - Xem danh sách người dùng được phép.

💡 *Chỉ những ID được cấp quyền mới có thể nhắn tin cho Bot này!*
`;
            bot.sendMessage(chatId, helpText, {parse_mode: 'Markdown'});
            return;
        }

        if (text.startsWith('/adduser ')) {
            if (String(chatId) !== MASTER_ADMIN_ID) {
                bot.sendMessage(chatId, "⛔ Chỉ Chủ Bot mới được phép sử dụng lệnh này.");
                return;
            }
            
            const newIdStr = text.replace('/adduser ', '').trim();
            if (!/^[-]?\d+$/.test(newIdStr)) {
                bot.sendMessage(chatId, "⚠️ ID không hợp lệ. Vui lòng nhập đúng chuỗi số ID Telegram.");
                return;
            }

            const newId = Number(newIdStr);
            if (!config.telegramAdminIds) config.telegramAdminIds = [];
            
            if (!config.telegramAdminIds.includes(newId)) {
                config.telegramAdminIds.push(newId);
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
                bot.sendMessage(chatId, `✅ Đã cấp quyền sử dụng Bot thành công cho ID: **${newId}**`, {parse_mode: 'Markdown'});
            } else {
                bot.sendMessage(chatId, `⚠️ ID **${newId}** đã có sẵn quyền sử dụng Bot từ trước.`, {parse_mode: 'Markdown'});
            }
            return;
        }

        if (text.startsWith('/deluser ')) {
            if (String(chatId) !== MASTER_ADMIN_ID) {
                bot.sendMessage(chatId, "⛔ Chỉ Chủ Bot mới được phép sử dụng lệnh này.");
                return;
            }
            
            const delIdStr = text.replace('/deluser ', '').trim();
            const delId = Number(delIdStr);
            
            if (String(delId) === MASTER_ADMIN_ID) {
                bot.sendMessage(chatId, "⚠️ Bạn không thể tự thu hồi quyền của chính mình (Chủ Bot)!");
                return;
            }

            if (!config.telegramAdminIds) return;
            
            const index = config.telegramAdminIds.indexOf(delId);
            if (index !== -1) {
                config.telegramAdminIds.splice(index, 1);
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
                bot.sendMessage(chatId, `✅ Đã thu hồi quyền sử dụng Bot của ID: **${delId}**`, {parse_mode: 'Markdown'});
            } else {
                bot.sendMessage(chatId, `⚠️ ID **${delId}** không nằm trong danh sách được cấp quyền.`, {parse_mode: 'Markdown'});
            }
            return;
        }

        if (text === '/listuser') {
            if (String(chatId) !== MASTER_ADMIN_ID) {
                bot.sendMessage(chatId, "⛔ Chỉ Chủ Bot mới được phép sử dụng lệnh này.");
                return;
            }
            
            const ids = config.telegramAdminIds || [];
            
            let listMsg = "👥 **DANH SÁCH TÀI KHOẢN ĐƯỢC PHÉP:**\n\n";
            ids.forEach((id, index) => {
                const role = String(id) === MASTER_ADMIN_ID ? "👑 Chủ Bot" : "👤 Người dùng";
                listMsg += `${index + 1}. \`${id}\` - ${role}\n`;
            });
            
            bot.sendMessage(chatId, listMsg, {parse_mode: 'Markdown'});
            return;
        }

        if (text.startsWith('/setproxy ')) {
            const newKey = text.replace('/setproxy ', '').trim();
            config.kiotproxyKey = newKey;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
            bot.sendMessage(chatId, `✅ Đã lưu KiotProxy Key thành công!\nTừ giờ hệ thống sẽ tự động dùng proxy để tải video.`);
            return;
        }

        if (text === '/newip') {
            if (!config.kiotproxyKey) {
                bot.sendMessage(chatId, "⚠️ Bạn chưa thiết lập Key KiotProxy.\nVui lòng dùng lệnh `/setproxy KEY` trước.", {parse_mode: 'Markdown'});
                return;
            }

            const checkMsg = await bot.sendMessage(chatId, "⏳ Đang gửi yêu cầu đổi IP mới lên hệ thống...");
            try {
                const currentProxy = await forceNewKiotProxy(config.kiotproxyKey, 'random');
                if (currentProxy) {
                    bot.editMessageText(`✅ **Đã đổi IP thành công!**\n🌐 **IP Mới Của Bạn:** \`${currentProxy.ip}\`\n📍 **Vị trí:** ${currentProxy.location}`, {
                        chat_id: chatId,
                        message_id: checkMsg.message_id,
                        parse_mode: 'Markdown'
                    });
                }
            } catch (err) {
                bot.editMessageText(`❌ **Đổi IP thất bại:**\n_${err.message}_\n\n⚠️ *(Có thể do chưa hết thời gian chờ của KiotProxy)*`, {
                    chat_id: chatId,
                    message_id: checkMsg.message_id,
                    parse_mode: 'Markdown'
                });
            }
            return;
        }

        if (text === '/checkip') {
            if (!config.kiotproxyKey) {
                bot.sendMessage(chatId, "⚠️ Bạn chưa thiết lập Key KiotProxy.\nHệ thống hiện tại sẽ dùng **IP mạng gốc** để tải video.", {parse_mode: 'Markdown'});
                return;
            }

            const checkMsg = await bot.sendMessage(chatId, "⏳ Đang kiểm tra trạng thái mạng...");
            try {
                const currentProxy = await getKiotProxy(config.kiotproxyKey, 'random');
                if (currentProxy) {
                    bot.editMessageText(`✅ **Hệ thống đang kết nối Proxy an toàn**\n🌐 **Địa chỉ IP:** \`${currentProxy.ip}\`\n📍 **Vị trí:** ${currentProxy.location}`, {
                        chat_id: chatId,
                        message_id: checkMsg.message_id,
                        parse_mode: 'Markdown'
                    });
                }
            } catch (err) {
                bot.editMessageText(`❌ **Không thể lấy Proxy:**\n_${err.message}_\n\n⚠️ Hệ thống tạm thời sẽ sử dụng IP mạng gốc.`, {
                    chat_id: chatId,
                    message_id: checkMsg.message_id,
                    parse_mode: 'Markdown'
                });
            }
            return;
        }

        const urlMatch = text.match(/(https?:\/\/[^\s]+)/);
        if (urlMatch) {
            const url = urlMatch[0];
            
            try {
                const processingMsg = await bot.sendMessage(chatId, "⏳ Bắt đầu xử lý...");
                
                let currentProxy = null;
                if (config.kiotproxyKey) {
                    await bot.editMessageText(`⏳ Đang kết nối KiotProxy...`, { chat_id: chatId, message_id: processingMsg.message_id });
                    try {
                        currentProxy = await getKiotProxy(config.kiotproxyKey, 'random');
                    } catch (err) {
                        bot.sendMessage(chatId, `⚠️ Lỗi lấy Proxy: ${err.message}. Sẽ thử tải bằng IP gốc.`);
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
                    await bot.editMessageText(`⏳ Đang tải video: ${videoInfo.title}${currentProxy ? ` (Qua IP: ${currentProxy.ip})` : ''}...`, {
                        chat_id: chatId,
                        message_id: processingMsg.message_id
                    });

                    const safeTitle = videoInfo.title.replace(/[\\/:*?"<>|]/g, '');
                    const videoPath = await downloadVideo(videoInfo.url, safeTitle, proxyUrl);
                    
                    await bot.editMessageText("📤 Đang gửi video cho bạn (có thể mất chút thời gian nếu file lớn)...", {
                        chat_id: chatId,
                        message_id: processingMsg.message_id
                    });
                    
                    try {
                        let finalCaption = `🎬 **${videoInfo.title}**`;
                        if (currentProxy) {
                            finalCaption += `\n\n🛡 *Đã tải ẩn danh qua KiotProxy*\n🌐 **IP Kết Nối:** \`${currentProxy.ip}\``;
                        } else {
                            finalCaption += `\n\n⚠️ *Tải bằng IP mạng gốc (Không dùng Proxy)*`;
                        }

                        await bot.sendVideo(chatId, videoPath, {
                            caption: finalCaption,
                            parse_mode: 'Markdown'
                        });
                        
                        bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
                    } catch (sendError) {
                        console.error("[ERROR] Lỗi khi gửi video qua Telegram:", sendError.message);
                        if (sendError.message.includes('413')) {
                            bot.sendMessage(chatId, "❌ Video quá lớn, Telegram Bot chỉ hỗ trợ gửi file tối đa 50MB.");
                        } else {
                            bot.sendMessage(chatId, `❌ Lỗi khi gửi video: ${sendError.message}`);
                        }
                    }

                    // Tùy chọn: Xóa file sau khi xử lý xong (dù thành công hay thất bại) để đỡ tốn dung lượng
                    fs.unlink(videoPath, (err) => {
                        if (err) console.error("Lỗi xóa file sau khi gửi Telegram:", err);
                    });

                } else {
                    bot.sendMessage(chatId, "❌ Không tìm thấy link video gốc.");
                }
            } catch (error) {
                console.error("[ERROR]", error);
                bot.sendMessage(chatId, `❌ Lỗi: ${error.message}`);
            }
        }
    });
} else {
    console.log("[INFO] Chưa cấu hình Telegram Bot Token (bỏ trống trong config.json). Bỏ qua khởi động Bot.");
}

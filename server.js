const express = require('express');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const { downloadVideo } = require('./downloader');
const { parseVideoUrl } = require('./parser');
const open = require('open');

// Khởi động Telegram Bot (nếu có cấu hình)
require('./telegramBot');

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình API
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));



// API Endpoint cho giao diện gọi tới
app.post('/api/download', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ success: false, message: 'Vui lòng cung cấp link.' });
    }

    try {
        const videoInfo = await parseVideoUrl(url);
        
        if (videoInfo && videoInfo.url) {
            const safeTitle = videoInfo.title.replace(/[\\/:*?"<>|]/g, '');
            await downloadVideo(videoInfo.url, safeTitle);
            
            res.json({ 
                success: true, 
                message: `Tải thành công: ${videoInfo.title}`,
                title: videoInfo.title
            });
        } else {
            res.status(500).json({ success: false, message: 'Không tìm thấy link video gốc.' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: `Lỗi: ${error.message}` });
    }
});

app.listen(PORT, async () => {
    console.log(`[INFO] Server đang chạy tại port: ${PORT}`);
    // Tự động mở trình duyệt (chỉ hoạt động trên máy tính cá nhân, sẽ bỏ qua trên server)
    try {
        await open(`http://localhost:${PORT}`);
    } catch (e) {}
});

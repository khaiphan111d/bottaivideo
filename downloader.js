const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { HttpsProxyAgent } = require('https-proxy-agent');

/**
 * Tải video MP4 hoặc M3U8 từ URL
 * @param {string} videoUrl URL của video (.mp4 hoặc .m3u8)
 * @param {string} outputFilename Tên file đầu ra
 * @param {string} [proxyUrl] URL proxy (tùy chọn)
 * @returns {Promise<void>}
 */
async function downloadVideo(videoUrl, outputFilename, proxyUrl = null) {
    // Lưu video trực tiếp tại thư mục hiện tại
    const downloadsDir = __dirname;

    const outputPath = path.join(downloadsDir, `${outputFilename}.mp4`);

    if (videoUrl.includes('.m3u8')) {
        console.log(`[INFO] Phát hiện định dạng M3U8. Đang tải và gộp file...`);
        return new Promise((resolve, reject) => {
            let command = ffmpeg(videoUrl);

            // Thêm proxy cho FFmpeg nếu có
            if (proxyUrl) {
                command = command.addInputOption(`-http_proxy ${proxyUrl}`);
            }

            command
                .outputOptions('-c copy')
                .outputOptions('-bsf:a aac_adtstoasc')
                .output(outputPath)
                .on('end', () => {
                    console.log(`[SUCCESS] Đã lưu video thành công tại: ${outputPath}`);
                    resolve(outputPath);
                })
                .on('error', (err) => {
                    console.error(`[ERROR] Lỗi khi tải M3U8:`, err.message);
                    reject(err);
                })
                .run();
        });
    } else {
        console.log(`[INFO] Phát hiện định dạng MP4. Đang tải file...`);
        try {
            let axiosConfig = {
                method: 'GET',
                url: videoUrl,
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            };

            if (proxyUrl) {
                axiosConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
            }

            const response = await axios(axiosConfig);

            const writer = fs.createWriteStream(outputPath);
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    console.log(`[SUCCESS] Đã lưu video thành công tại: ${outputPath}`);
                    resolve(outputPath);
                });
                writer.on('error', (err) => {
                    console.error(`[ERROR] Lỗi khi lưu file:`, err.message);
                    reject(err);
                });
            });
        } catch (error) {
            let errorMsg = error.message;
            if (error.response) {
                const status = error.response.status;
                if ([403, 429, 401].includes(status)) {
                    errorMsg = `🛑 LỖI TẢI VIDEO (Mã ${status}): Máy chủ video đã từ chối kết nối. Có thể IP của bạn đã bị chặn. Vui lòng đổi IP hoặc thử lại sau.`;
                }
            } else if (error.message && (error.message.toLowerCase().includes('timeout') || error.message.toLowerCase().includes('econnreset'))) {
                errorMsg = `🛑 LỖI MẠNG: Kết nối bị ngắt, có thể IP bị chặn hoặc mạng quá yếu.`;
            }

            console.error(`[ERROR] Lỗi khi tải luồng MP4:`, errorMsg);
            throw new Error(errorMsg);
        }
    }
}

module.exports = {
    downloadVideo
};

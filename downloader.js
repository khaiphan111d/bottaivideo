const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { HttpsProxyAgent } = require('https-proxy-agent');
const FormData = require('form-data');

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
            const isHongguoCDN = videoUrl.includes('qznovel.com');
            let axiosConfig = {
                method: 'GET',
                url: videoUrl,
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    ...(isHongguoCDN && {
                        'Referer': 'https://novelquickapp.com/',
                        'Origin': 'https://novelquickapp.com',
                        'Accept': 'video/webm,video/mp4,video/*;q=0.9,*/*;q=0.8'
                    })
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

/**
 * Upload video lên Litterbox (hỗ trợ file tới 1GB, xoá sau 12h)
 * @param {string} filePath Đường dẫn tới file cần upload
 * @returns {Promise<string>} URL tải file trả về
 */
async function uploadToThirdParty(filePath) {
    const fileSizeMB = (fs.statSync(filePath).size / (1024 * 1024)).toFixed(1);
    console.log(`[INFO] Đang upload file lớn (${fileSizeMB}MB) lên Litterbox...`);

    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('time', '12h'); // File sống 12h
    form.append('fileToUpload', fs.createReadStream(filePath));

    const response = await axios.post('https://litterbox.catbox.moe/api.php', form, {
        headers: {
            ...form.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 0 // Không giới hạn timeout - file lớn cần thời gian upload dài
    });

    const responseText = typeof response.data === 'string' ? response.data.trim() : '';

    if (responseText.startsWith('https://')) {
        console.log(`[SUCCESS] Đã upload thành công lên Litterbox: ${responseText}`);
        return responseText;
    } else {
        throw new Error(`Litterbox từ chối upload (${fileSizeMB}MB): ` + responseText);
    }
}

module.exports = {
    downloadVideo,
    uploadToThirdParty
};

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { createProxyAgent } = require('./proxyHelper');
const FormData = require('form-data');

const { getActiveCookie } = require('./parser');

/**
 * Tải video MP4 hoặc M3U8 từ URL
 * @param {string} videoUrl URL của video (.mp4 hoặc .m3u8)
 * @param {string} outputFilename Tên file đầu ra
 * @param {string} [proxyUrl] URL proxy (tùy chọn)
 * @returns {Promise<void>}
 */
async function downloadVideo(videoUrl, outputFilename, proxyUrl = null) {
    const downloadsDir = __dirname;
    const outputPath = path.join(downloadsDir, `${outputFilename}.mp4`);

    if (videoUrl.includes('.m3u8')) {
        console.log(`[INFO] Phát hiện định dạng M3U8. Đang tải và gộp file...`);
        return new Promise((resolve, reject) => {
            let command = ffmpeg(videoUrl);

            if (proxyUrl && proxyUrl.startsWith('http')) {
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
        console.log(`[INFO] Phát hiện định dạng MP4. Đang kết nối luồng tải...`);
        
        const cookie = getActiveCookie();
        const isHongguoCDN = videoUrl.includes('qznovel.com') || videoUrl.includes('bytevd.com') || videoUrl.includes('douyinvod.com');

        // Các cấu hình thử nghiệm: Thử qua Proxy trước (nếu có), nếu proxy 502/lỗi thì tự thử lại bằng IP gốc
        const attempts = [];
        if (proxyUrl) {
            attempts.push({ useProxy: true, desc: 'Qua Proxy' });
            attempts.push({ useProxy: false, desc: 'Qua IP gốc' });
        } else {
            attempts.push({ useProxy: false, desc: 'Qua IP gốc' });
        }

        let lastError = null;

        for (const attempt of attempts) {
            try {
                let axiosConfig = {
                    method: 'GET',
                    url: videoUrl,
                    responseType: 'stream',
                    timeout: 25000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Range': 'bytes=0-', // 🔑 Bắt buộc đối với CDN ByteDance/Hồng Quả để tránh bị bóp/ngắt luồng
                        'Accept': 'video/webm,video/mp4,video/*;q=0.9,*/*;q=0.8',
                        'Accept-Encoding': 'identity;q=1, *;q=0',
                        'Sec-Fetch-Dest': 'video',
                        'Sec-Fetch-Mode': 'no-cors',
                        'Sec-Fetch-Site': 'cross-site',
                        ...(isHongguoCDN && {
                            'Referer': 'https://novelquickapp.com/',
                            'Origin': 'https://novelquickapp.com'
                        }),
                        ...(cookie ? { 'Cookie': cookie } : {})
                    }
                };

                if (attempt.useProxy && proxyUrl) {
                    const agent = createProxyAgent(proxyUrl);
                    if (agent) {
                        axiosConfig.httpAgent = agent;
                        axiosConfig.httpsAgent = agent;
                    }
                }

                const response = await axios(axiosConfig);

                const writer = fs.createWriteStream(outputPath);
                response.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                console.log(`[SUCCESS] Đã tải và lưu video thành công (${attempt.desc}) tại: ${outputPath}`);
                return outputPath;
            } catch (error) {
                lastError = error;
                console.log(`[WARN] Tải video thất bại (${attempt.desc}): ${error.message}`);
            }
        }

        // Phân tích chi tiết nguyên nhân lỗi trả về
        let errorMsg = lastError ? lastError.message : "Không thể tải video từ máy chủ";
        if (lastError && lastError.response) {
            const status = lastError.response.status;
            if (status === 502) {
                errorMsg = `🛑 LỖI PROXY (Mã 502 Bad Gateway): Máy chủ Proxy hiện tại bị nghẽn mạng hoặc mất kết nối tới máy chủ video. Hãy gõ lệnh \`/newip\` để đổi IP mới.`;
            } else if ([403, 429, 401].includes(status)) {
                errorMsg = `🛑 LỖI BỊ CHẶN IP/WAF (Mã ${status}): Máy chủ video từ chối IP hiện tại. Hãy gõ lệnh \`/newip\` để đổi IP khác hoặc gõ \`/hdcookie\` để nạp Cookie.`;
            } else if (status === 504) {
                errorMsg = `🛑 LỖI TIMEOUT (Mã 504): Proxy phản hồi quá chậm, hãy gõ \`/newip\` để đổi Proxy nhanh hơn.`;
            }
        } else if (lastError && (lastError.message.toLowerCase().includes('timeout') || lastError.message.toLowerCase().includes('econnreset'))) {
            errorMsg = `🛑 LỖI MẠNG: Kết nối tới máy chủ bị ngắt quãng hoặc Proxy bị ngưng. Hãy gõ \`/newip\` để thử lại.`;
        }

        console.error(`[ERROR] Thất bại khi tải luồng MP4:`, errorMsg);
        throw new Error(errorMsg);
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

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { HttpsProxyAgent } = require('https-proxy-agent');
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
        console.log(`[INFO] Phát hiện định dạng MP4. Đang kết nối luồng tải...`);
        
        const cookie = getActiveCookie();
        const isHongguoCDN = videoUrl.includes('qznovel.com') || videoUrl.includes('bytevd.com') || videoUrl.includes('douyinvod.com');

        // Danh sách URL thử nghiệm (Bao gồm CDN dự phòng nếu domain chính bị 403)
        const tryUrls = [videoUrl];
        if (videoUrl.includes('qznovel.com')) {
            // Thử đổi sang CDN mirror ByteDance Douyin
            tryUrls.push(videoUrl.replace('v3-share.qznovel.com', 'v3-novel.douyinvod.com'));
            tryUrls.push(videoUrl.replace('v3-share.qznovel.com', 'v26-novel.douyinvod.com'));
        }

        let lastError = null;

        for (let i = 0; i < tryUrls.length; i++) {
            const currentUrl = tryUrls[i];
            try {
                let axiosConfig = {
                    method: 'GET',
                    url: currentUrl,
                    responseType: 'stream',
                    timeout: 20000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Range': 'bytes=0-', // 🔑 Bắt buộc đối với CDN ByteDance/Hồng Quả để tránh bị bóp/ngắt luồng 403
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

                if (proxyUrl) {
                    axiosConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
                }

                const response = await axios(axiosConfig);

                const writer = fs.createWriteStream(outputPath);
                response.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                console.log(`[SUCCESS] Đã tải và lưu video thành công tại: ${outputPath}`);
                return outputPath;
            } catch (error) {
                lastError = error;
                console.log(`[WARN] Tải CDN lượt ${i + 1} không thành công (${error.message}), đang thử phương án tiếp...`);
            }
        }

        // Nếu tất cả các URL CDN đều lỗi
        let errorMsg = lastError ? lastError.message : "Không thể tải video từ máy chủ";
        if (lastError && lastError.response) {
            const status = lastError.response.status;
            if ([403, 429, 401].includes(status)) {
                errorMsg = `🛑 LỖI TẢI VIDEO (Mã ${status}): Máy chủ CDN từ chối kết nối. Hãy thử gán Cookie (/setcookie) hoặc đổi Proxy.`;
            }
        } else if (lastError && (lastError.message.toLowerCase().includes('timeout') || lastError.message.toLowerCase().includes('econnreset'))) {
            errorMsg = `🛑 LỖI MẠNG: Kết nối tới CDN bị ngắt quãng, vui lòng thử lại.`;
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

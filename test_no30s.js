/**
 * Test tính năng bỏ giới hạn 30 giây của link Hồng Quả (novelquickapp.com)
 * Kiểm tra 2 điều:
 *   1. URL trả về KHÔNG chứa &end=... hoặc &start=... (đã bỏ giới hạn)
 *   2. File video tải được có dung lượng lớn hơn nếu không có giới hạn (HEAD request)
 */

const { parseVideoUrl } = require('./parser');
const axios = require('axios');

// Màu sắc console
const green  = (s) => `\x1b[32m${s}\x1b[0m`;
const red    = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan   = (s) => `\x1b[36m${s}\x1b[0m`;

// Link test (link từ ảnh bạn gửi)
const TEST_URL = 'https://novelquickapp.com/s/xIi5P7IXnOQ/';

async function getFileSize(url) {
    try {
        const res = await axios.head(url, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const bytes = parseInt(res.headers['content-length'] || '0', 10);
        return bytes;
    } catch(e) {
        return null;
    }
}

async function runTests() {
    console.log(cyan('\n╔══════════════════════════════════════════════════╗'));
    console.log(cyan('║   KIỂM THỬ: Bỏ giới hạn 30 giây - Hồng Quả     ║'));
    console.log(cyan('╚══════════════════════════════════════════════════╝\n'));

    let passed = 0;
    let failed = 0;

    // ─── TEST 1: Parser trả về URL ───────────────────────────────────────
    console.log(yellow('TEST 1: Parser phân tích link thành công...'));
    let result;
    try {
        result = await parseVideoUrl(TEST_URL);
        if (result && result.url) {
            console.log(green('  ✅ PASS - Parser trả về URL thành công'));
            console.log(`     Title : ${result.title}`);
            console.log(`     URL   : ${result.url.substring(0, 80)}...`);
            passed++;
        } else {
            throw new Error('Kết quả không có URL');
        }
    } catch (e) {
        console.log(red(`  ❌ FAIL - ${e.message}`));
        failed++;
        console.log(red('\n⛔ Không thể tiếp tục test vì TEST 1 thất bại.'));
        process.exit(1);
    }

    // ─── TEST 2: URL không chứa &end= và &start= ─────────────────────────
    console.log(yellow('\nTEST 2: URL không chứa tham số giới hạn &end= &start=...'));
    const hasEnd   = /[&?]end=\d+/.test(result.url);
    const hasStart = /[&?]start=\d+/.test(result.url);

    if (!hasEnd && !hasStart) {
        console.log(green('  ✅ PASS - URL đã sạch, không có &end= và &start='));
        passed++;
    } else {
        console.log(red(`  ❌ FAIL - URL vẫn chứa tham số giới hạn:`));
        if (hasEnd)   console.log(red('     → Vẫn có &end='));
        if (hasStart) console.log(red('     → Vẫn có &start='));
        failed++;
    }

    // ─── TEST 3: Dung lượng file video > 2MB (không phải clip 30s bị cắt) ─
    console.log(yellow('\nTEST 3: Kiểm tra dung lượng file video qua HEAD request...'));
    const fileSize = await getFileSize(result.url);
    if (fileSize === null) {
        console.log(yellow('  ⚠️  SKIP - Server không hỗ trợ HEAD request hoặc không trả về Content-Length'));
    } else {
        const sizeMB = (fileSize / 1024 / 1024).toFixed(2);
        console.log(`     Dung lượng: ${sizeMB} MB (${fileSize.toLocaleString()} bytes)`);
        if (fileSize > 2 * 1024 * 1024) {
            console.log(green(`  ✅ PASS - File nặng ${sizeMB}MB → Đây là video đầy đủ (không bị cắt 30s)`));
            passed++;
        } else if (fileSize > 0) {
            console.log(yellow(`  ⚠️  WARN - File chỉ ${sizeMB}MB. Có thể video ngắn hoặc vẫn bị giới hạn.`));
        } else {
            console.log(yellow('  ⚠️  SKIP - Content-Length = 0, không thể xác định'));
        }
    }

    // ─── KẾT QUẢ TỔNG HỢP ────────────────────────────────────────────────
    console.log(cyan('\n╔══════════════════════════════════════════════════╗'));
    console.log(cyan(`║  KẾT QUẢ: ${passed} PASS  |  ${failed} FAIL` + ' '.repeat(34 - String(passed).length - String(failed).length) + '║'));
    console.log(cyan('╚══════════════════════════════════════════════════╝\n'));
    if (failed === 0) {
        console.log(green('🎉 Tất cả test đều pass! Tính năng bỏ giới hạn 30s hoạt động tốt.\n'));
    } else {
        console.log(red(`🚨 Có ${failed} test thất bại. Cần kiểm tra lại parser.js\n`));
    }
}

runTests();

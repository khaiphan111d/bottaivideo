// Test end-to-end Hongguo parsing
const { parseVideoUrl } = require('./parser');

async function test() {
    console.log('=== Test Hồng Quả / Novelquickapp ===');
    try {
        const result = await parseVideoUrl('https://novelquickapp.com/s/YIxzEfHfB08/');
        console.log('✅ Thành công!');
        console.log('Title:', result.title);
        console.log('URL:', result.url.substring(0, 100) + '...');
    } catch(e) {
        console.error('❌ Lỗi:', e.message);
    }
}

test();

const { Pool } = require('pg');

// Mật khẩu có chứa ký tự đặc biệt được encode (YgTefY+4aiQVp%L -> YgTefY%2B4aiQVp%25L)
const defaultDbUrl = 'postgresql://postgres.tchzupewoyxazxtbxtpj:YgTefY%2B4aiQVp%25L@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || defaultDbUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('error', (err, client) => {
  console.error('Lỗi kết nối CSDL:', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};

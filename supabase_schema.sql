-- Bảng lưu trữ thông tin người dùng Telegram và quyền hạn
CREATE TABLE users (
    telegram_id BIGINT PRIMARY KEY,
    role TEXT DEFAULT 'user', -- 'admin' hoặc 'user'
    kiotproxy_key TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bảng lưu trữ lịch sử tải video
CREATE TABLE downloads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id BIGINT REFERENCES users(telegram_id) ON DELETE SET NULL,
    original_url TEXT NOT NULL,
    video_title TEXT,
    proxy_ip TEXT, -- IP proxy đã dùng để tải
    downloaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bảng cấu hình hệ thống (Thay thế cho config.json nếu muốn)
CREATE TABLE system_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chèn cấu hình mặc định
INSERT INTO system_config (key, value) VALUES 
('master_admin_id', '"5964340237"'),
('global_kiotproxy_key', '""');

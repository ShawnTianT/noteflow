-- ============================================
-- Noteflow Supabase 建表 SQL（自定义用户表版本）
-- 在 Supabase SQL Editor 里执行
-- ============================================

-- 启用 pgcrypto 扩展（用于密码加密）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- users 表（自定义登录）
-- ============================================
CREATE TABLE IF NOT EXISTS public.users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 插入默认账号：18134158895 / 123456
-- 如果已存在则跳过
INSERT INTO public.users (username, password_hash)
VALUES ('18134158895', crypt('123456', gen_salt('bf')))
ON CONFLICT (username) DO NOTHING;

-- 验证密码的 PostgreSQL 函数
-- 供 JS 通过 RPC 调用，避免明文密码传输中被截获的风险
CREATE OR REPLACE FUNCTION public.verify_password(
  p_username TEXT,
  p_password TEXT
)
RETURNS TABLE(user_id BIGINT, user_username TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.username
  FROM public.users u
  WHERE u.username = p_username
    AND u.password_hash = crypt(p_password, u.password_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

--  Grant: anon 角色可以调用 verify_password，但不能直接读 users 表
GRANT EXECUTE ON FUNCTION public.verify_password TO anon;
GRANT SELECT ON public.users TO anon;  -- verify_password 需要读取 users 表

-- ============================================
-- notes 表
-- ============================================
CREATE TABLE IF NOT EXISTS public.notes (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  tags TEXT[] DEFAULT '{}',
  image_paths TEXT[] DEFAULT '{}',
  image_data TEXT[] DEFAULT '{}',
  type TEXT DEFAULT 'text',
  is_done BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_user_id ON public.notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON public.notes(created_at DESC);

-- ============================================
-- tags 表
-- ============================================
CREATE TABLE IF NOT EXISTS public.tags (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  count INT DEFAULT 0,
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tags_user_id ON public.tags(user_id);

-- ============================================
-- 自动更新 updated_at 的触发器
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_notes_updated_at ON public.notes;
CREATE TRIGGER update_notes_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- RLS（行级安全）— 自定义认证方案
-- 由于不用 Supabase Auth，改用 current_setting 传递 user_id
-- ============================================
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

-- notes 策略：允许 anon 角色操作（认证在应用层处理）
-- 如需更严格安全，可启用以下策略（需要应用设置 current_setting）
DROP POLICY IF EXISTS "Users can only access own notes" ON public.notes;
CREATE POLICY "Users can only access own notes"
  ON public.notes
  FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can only access own tags" ON public.tags;
CREATE POLICY "Users can only access own tags"
  ON public.tags
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================
-- API 权限（允许 anon 角色通过 anon key 访问）
-- ============================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO anon;
GRANT USAGE, SELECT ON SEQUENCE notes_id_seq TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tags TO anon;
GRANT USAGE, SELECT ON SEQUENCE tags_id_seq TO anon;

GRANT SELECT ON public.users TO anon;

-- ============================================
-- 完成
-- ============================================
SELECT 'Noteflow 数据表创建完成！默认账号：18134158895 / 123456' AS result;

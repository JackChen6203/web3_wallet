-- 🌐 Supabase 協調式錢包生成 - 數據庫表結構
-- 用於多機器協調，避免重複計算

-- 1. 範圍分配表 (核心表)
CREATE TABLE IF NOT EXISTS wallet_ranges (
  id SERIAL PRIMARY KEY,
  machine_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  range_start BIGINT NOT NULL,
  range_end BIGINT NOT NULL,
  status TEXT DEFAULT 'assigned' CHECK (status IN ('assigned', 'processing', 'completed', 'failed')),
  assigned_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  wallets_generated INTEGER DEFAULT 0,
  wallets_with_balance INTEGER DEFAULT 0,
  error_message TEXT,
  
  -- 約束
  UNIQUE(range_start, range_end)
);

-- 2. 機器狀態表 (監控表)
CREATE TABLE IF NOT EXISTS machine_status (
  machine_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'stopped', 'error')),
  last_heartbeat TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP DEFAULT NOW(),
  
  -- 統計信息
  total_generated INTEGER DEFAULT 0,
  total_with_balance INTEGER DEFAULT 0,
  current_range_start BIGINT,
  current_range_end BIGINT,
  current_index BIGINT,
  
  -- 系統信息
  hostname TEXT,
  platform TEXT,
  cpu_count INTEGER,
  memory_gb DECIMAL(8,2),
  system_info JSONB,
  
  -- 性能指標
  average_speed DECIMAL(10,2), -- 錢包/秒
  peak_speed DECIMAL(10,2)
  
  -- 無額外約束
);

-- 3. 寶藏錢包表 (重要發現)
CREATE TABLE IF NOT EXISTS treasure_wallets (
  id SERIAL PRIMARY KEY,
  machine_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  wallet_index BIGINT NOT NULL,
  address TEXT NOT NULL UNIQUE,
  private_key TEXT NOT NULL,
  public_key TEXT,
  
  -- 餘額信息
  balance_btc DECIMAL(16,8) NOT NULL,
  balance_satoshis BIGINT NOT NULL,
  confirmed_balance BIGINT DEFAULT 0,
  unconfirmed_balance BIGINT DEFAULT 0,
  
  -- 發現信息
  discovered_at TIMESTAMP DEFAULT NOW(),
  range_id INTEGER REFERENCES wallet_ranges(id),
  
  -- 驗證狀態
  verified BOOLEAN DEFAULT FALSE,
  last_verified TIMESTAMP
  
  -- 無額外約束
);

-- 4. 協調日誌表 (調試和審計)
CREATE TABLE IF NOT EXISTS coordination_logs (
  id SERIAL PRIMARY KEY,
  machine_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('range_assigned', 'range_started', 'range_completed', 'treasure_found', 'error', 'heartbeat')),
  event_data JSONB,
  timestamp TIMESTAMP DEFAULT NOW()
  
  -- 無額外約束
);

-- 5. 全局統計表 (總覽)
CREATE TABLE IF NOT EXISTS global_statistics (
  id SERIAL PRIMARY KEY,
  session_group TEXT DEFAULT 'default',
  total_machines INTEGER DEFAULT 0,
  active_machines INTEGER DEFAULT 0,
  total_ranges_assigned INTEGER DEFAULT 0,
  total_ranges_completed INTEGER DEFAULT 0,
  total_wallets_generated BIGINT DEFAULT 0,
  total_treasures_found INTEGER DEFAULT 0,
  total_btc_found DECIMAL(16,8) DEFAULT 0,
  highest_balance_found DECIMAL(16,8) DEFAULT 0,
  highest_balance_address TEXT,
  last_updated TIMESTAMP DEFAULT NOW(),
  
  -- 性能統計
  average_speed_all_machines DECIMAL(10,2),
  total_runtime_hours DECIMAL(10,2),
  
  UNIQUE(session_group)
);

-- 6. RPC 函數：獲取下一個可用範圍
CREATE OR REPLACE FUNCTION get_next_wallet_range(
  p_machine_id TEXT,
  p_session_id TEXT,
  p_range_size INTEGER DEFAULT 1000000
)
RETURNS TABLE (
  range_id INTEGER,
  range_start BIGINT,
  range_end BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_next_start BIGINT;
  v_next_end BIGINT;
  v_range_id INTEGER;
BEGIN
  -- 獲取最大的 range_end
  SELECT COALESCE(MAX(range_end), -1) + 1 INTO v_next_start
  FROM wallet_ranges;
  
  v_next_end := v_next_start + p_range_size - 1;
  
  -- 插入新範圍
  INSERT INTO wallet_ranges (machine_id, session_id, range_start, range_end, status)
  VALUES (p_machine_id, p_session_id, v_next_start, v_next_end, 'assigned')
  RETURNING id INTO v_range_id;
  
  -- 記錄日誌
  INSERT INTO coordination_logs (machine_id, session_id, event_type, event_data)
  VALUES (p_machine_id, p_session_id, 'range_assigned', 
          json_build_object('range_id', v_range_id, 'start', v_next_start, 'end', v_next_end));
  
  -- 返回結果
  RETURN QUERY SELECT v_range_id, v_next_start, v_next_end;
END;
$$;

-- 7. RPC 函數：更新全局統計
CREATE OR REPLACE FUNCTION update_global_statistics()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO global_statistics (
    session_group,
    total_machines,
    active_machines,
    total_ranges_assigned,
    total_ranges_completed,
    total_wallets_generated,
    total_treasures_found,
    total_btc_found,
    highest_balance_found,
    highest_balance_address,
    last_updated
  )
  SELECT 
    'default',
    COUNT(DISTINCT m.machine_id),
    COUNT(DISTINCT CASE WHEN m.last_heartbeat > NOW() - INTERVAL '5 minutes' THEN m.machine_id END),
    COUNT(r.id),
    COUNT(CASE WHEN r.status = 'completed' THEN r.id END),
    COALESCE(SUM(r.wallets_generated), 0),
    COUNT(t.id),
    COALESCE(SUM(t.balance_btc), 0),
    COALESCE(MAX(t.balance_btc), 0),
    (SELECT address FROM treasure_wallets ORDER BY balance_btc DESC LIMIT 1),
    NOW()
  FROM machine_status m
  LEFT JOIN wallet_ranges r ON m.machine_id = r.machine_id
  LEFT JOIN treasure_wallets t ON m.machine_id = t.machine_id
  
  ON CONFLICT (session_group)
  DO UPDATE SET
    total_machines = EXCLUDED.total_machines,
    active_machines = EXCLUDED.active_machines,
    total_ranges_assigned = EXCLUDED.total_ranges_assigned,
    total_ranges_completed = EXCLUDED.total_ranges_completed,
    total_wallets_generated = EXCLUDED.total_wallets_generated,
    total_treasures_found = EXCLUDED.total_treasures_found,
    total_btc_found = EXCLUDED.total_btc_found,
    highest_balance_found = EXCLUDED.highest_balance_found,
    highest_balance_address = EXCLUDED.highest_balance_address,
    last_updated = EXCLUDED.last_updated;
END;
$$;

-- 8. 定期更新統計的觸發器
CREATE OR REPLACE FUNCTION trigger_update_statistics()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM update_global_statistics();
  RETURN NULL;
END;
$$;

-- 在重要表上設置觸發器
DROP TRIGGER IF EXISTS update_stats_on_range_change ON wallet_ranges;
CREATE TRIGGER update_stats_on_range_change
  AFTER INSERT OR UPDATE ON wallet_ranges
  FOR EACH ROW EXECUTE FUNCTION trigger_update_statistics();

DROP TRIGGER IF EXISTS update_stats_on_treasure_found ON treasure_wallets;
CREATE TRIGGER update_stats_on_treasure_found
  AFTER INSERT ON treasure_wallets
  FOR EACH ROW EXECUTE FUNCTION trigger_update_statistics();

-- 9. 查詢視圖：機器狀態總覽
CREATE OR REPLACE VIEW machine_overview AS
SELECT 
  m.machine_id,
  m.hostname,
  m.status,
  m.last_heartbeat,
  m.total_generated,
  m.total_with_balance,
  m.average_speed,
  CASE 
    WHEN m.last_heartbeat > NOW() - INTERVAL '2 minutes' THEN 'ONLINE'
    WHEN m.last_heartbeat > NOW() - INTERVAL '10 minutes' THEN 'IDLE'
    ELSE 'OFFLINE'
  END as connection_status,
  COUNT(r.id) as assigned_ranges,
  COUNT(CASE WHEN r.status = 'completed' THEN r.id END) as completed_ranges,
  COUNT(t.id) as treasures_found,
  COALESCE(SUM(t.balance_btc), 0) as total_btc_found
FROM machine_status m
LEFT JOIN wallet_ranges r ON m.machine_id = r.machine_id
LEFT JOIN treasure_wallets t ON m.machine_id = t.machine_id
GROUP BY m.machine_id, m.hostname, m.status, m.last_heartbeat, 
         m.total_generated, m.total_with_balance, m.average_speed
ORDER BY m.last_heartbeat DESC;

-- 10. 查詢視圖：範圍進度總覽
CREATE OR REPLACE VIEW range_progress AS
SELECT 
  r.id,
  r.machine_id,
  r.range_start,
  r.range_end,
  r.status,
  r.wallets_generated,
  r.wallets_with_balance,
  ROUND((r.wallets_generated::DECIMAL / (r.range_end - r.range_start + 1)) * 100, 2) as progress_percentage,
  r.started_at,
  r.completed_at,
  CASE 
    WHEN r.completed_at IS NOT NULL THEN 
      EXTRACT(EPOCH FROM (r.completed_at - r.started_at))::INTEGER
    WHEN r.started_at IS NOT NULL THEN 
      EXTRACT(EPOCH FROM (NOW() - r.started_at))::INTEGER
    ELSE NULL
  END as duration_seconds
FROM wallet_ranges r
ORDER BY r.id DESC;

-- 授權給公共使用者 (根據需要調整)
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO anon;
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- 插入初始統計記錄
INSERT INTO global_statistics (session_group) VALUES ('default')
ON CONFLICT (session_group) DO NOTHING;

-- 創建索引 (提高查詢性能)
CREATE INDEX IF NOT EXISTS idx_wallet_ranges_status ON wallet_ranges(status);
CREATE INDEX IF NOT EXISTS idx_wallet_ranges_machine ON wallet_ranges(machine_id);
CREATE INDEX IF NOT EXISTS idx_wallet_ranges_session ON wallet_ranges(session_id);

CREATE INDEX IF NOT EXISTS idx_machine_status_session ON machine_status(session_id);
CREATE INDEX IF NOT EXISTS idx_machine_status_heartbeat ON machine_status(last_heartbeat);

CREATE INDEX IF NOT EXISTS idx_treasure_address ON treasure_wallets(address);
CREATE INDEX IF NOT EXISTS idx_treasure_machine ON treasure_wallets(machine_id);
CREATE INDEX IF NOT EXISTS idx_treasure_session ON treasure_wallets(session_id);
CREATE INDEX IF NOT EXISTS idx_treasure_balance ON treasure_wallets(balance_btc DESC);
CREATE INDEX IF NOT EXISTS idx_treasure_discovered ON treasure_wallets(discovered_at DESC);

CREATE INDEX IF NOT EXISTS idx_coordination_logs_machine ON coordination_logs(machine_id);
CREATE INDEX IF NOT EXISTS idx_coordination_logs_type ON coordination_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_coordination_logs_timestamp ON coordination_logs(timestamp DESC);
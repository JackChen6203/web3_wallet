-- 工作範圍協調表
-- 用於多主機並行作業時的範圍分配和協調

CREATE TABLE IF NOT EXISTS work_ranges (
  id SERIAL PRIMARY KEY,
  start_index BIGINT NOT NULL,
  end_index BIGINT NOT NULL,
  status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'assigned', 'completed')),
  assigned_to VARCHAR(255),
  assigned_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 索引優化
CREATE INDEX IF NOT EXISTS idx_work_ranges_status ON work_ranges(status);
CREATE INDEX IF NOT EXISTS idx_work_ranges_range ON work_ranges(start_index, end_index);
CREATE INDEX IF NOT EXISTS idx_work_ranges_assigned ON work_ranges(assigned_to);

-- 添加觸發器自動更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_work_ranges_updated_at 
BEFORE UPDATE ON work_ranges 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 插入一些初始範圍（可選）
INSERT INTO work_ranges (start_index, end_index, status) VALUES
(1, 1000000, 'available'),
(1000001, 2000000, 'available'),
(2000001, 3000000, 'available'),
(3000001, 4000000, 'available'),
(4000001, 5000000, 'available')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE work_ranges IS '工作範圍協調表 - 用於多主機並行處理的範圍分配';
COMMENT ON COLUMN work_ranges.start_index IS '範圍起始索引';
COMMENT ON COLUMN work_ranges.end_index IS '範圍結束索引';
COMMENT ON COLUMN work_ranges.status IS '範圍狀態: available, assigned, completed';
COMMENT ON COLUMN work_ranges.assigned_to IS '分配給的會話ID';
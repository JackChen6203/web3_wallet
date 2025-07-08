# 🚀 Bitcoin Calculator - 無限獵人版

## ✨ 功能特色

- 🚀 **無限制 Bitcoin 地址生成器** - 包含私鑰和餘額檢查
- 🌐 **12個 API 來源負載平衡** - 最大化可用性和速度
- ⚡ **智能重試和自動恢復** - 容錯能力強
- 💾 **進度保存和斷點續傳** - 永不丟失進度
- 🎯 **實時寶藏檢測** - 立即通知和保存
- 📊 **詳細性能監控** - 實時統計和分析

## 🎯 快速開始

### 安裝依賴
```bash
npm install
```

### 配置環境變數（可選）
```bash
cp .env.example .env
# 編輯 .env 文件添加 API 密鑰以提升性能
```

### 🚀 啟動無限 Bitcoin 獵人
```bash
npm run hunt:infinite
```

## 📊 主要命令

```bash
# 🚀 無限 Bitcoin 獵人（主程序）
npm run hunt:infinite

# ⚡ 高級餘額檢查測試
npm run test:balance:advanced

# 🔥 大規模性能測試
npm run test:balance:large

# 🚀 TURBO 模式生成器
npm run test:turbo
```

## 🌐 支援的 API 來源

1. **Blockstream.info** - 高穩定性
2. **BlockCypher** - 高速率限制
3. **Blockchain.info** - 經典可靠
4. **Blockchair** - 功能豐富
5. **BitGo** - 企業級
6. **Insight** - 開源穩定
7. **SoChain** - 高頻率限制
8. **Mempool.space** - 現代界面
9. **BTCExplorer** - 傳統穩定
10. **CryptoID** - 多幣種支援
11. **SmartBit** - 澳洲源
12. **BitCore** - 高性能

## 📈 預期性能

- **生成速度：** ~1000 錢包/秒
- **檢查速度：** ~50 地址/秒
- **API 成功率：** >95%（多源容錯）
- **記憶體使用：** <512MB

## 🎉 輸出內容

每個檢查的地址包含：
- ✅ Bitcoin 地址
- ✅ 私鑰 (WIF格式)
- ✅ 公鑰
- ✅ 餘額信息
- ✅ API 來源
- ✅ 時間戳

## ⚠️ 重要提醒

1. **合法使用** - 僅用於學習和合法目的
2. **API 限制** - 遵守各API提供商的使用條款  
3. **資源管理** - 監控CPU和記憶體使用
4. **備份重要** - 定期備份發現的寶藏錢包

## 📁 項目結構

```
├── test/
│   ├── infinite-bitcoin-hunter.js      # 🚀 主程序
│   ├── advanced-balance-test.js        # ⚡ 測試套件
│   └── turbo-wallet-generator.js       # 🚀 TURBO 生成器
├── src/
│   ├── services/
│   │   ├── ultimateBalanceChecker.js   # 🌐 12個API負載平衡
│   │   ├── advancedBalanceChecker.js   # ⚡ 高級檢查器
│   │   └── supabaseClient.js           # 💾 資料庫客戶端
│   └── utils/
│       └── walletGenerator.js          # 🔧 錢包生成工具
├── database/
│   └── supabase_coordination_tables.sql # 📊 資料庫架構
├── package.json                        # 📦 依賴配置
└── .env.example                        # ⚙️ 環境變數範例
```

---

🚀 **立即開始您的 Bitcoin 寶藏獵人之旅！**
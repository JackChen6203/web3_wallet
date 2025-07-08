const UltimateBalanceChecker = require('../src/services/ultimateBalanceChecker');
const SupabaseClient = require('../src/services/supabaseClient');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');

class InfiniteBitcoinHunter {
  constructor() {
    this.startTime = Date.now();
    this.machineId = this.generateMachineId();
    this.sessionId = `INFINITE_${this.machineId}_${Date.now()}`;
    this.isRunning = true;
    
    // 統計數據
    this.totalGenerated = 0;
    this.totalChecked = 0;
    this.totalWithBalance = 0;
    this.treasures = [];
    this.currentIndex = this.getStartingIndex();
    
    // 🚀 終極餘額檢查器（12個API來源）
    this.balanceChecker = new UltimateBalanceChecker();
    
    // 配置
    this.batchSize = 200; // 大批次處理
    this.saveInterval = 1000; // 每1000個錢包保存一次
    this.statsInterval = 3000; // 3秒更新統計
    
    // Supabase 整合
    this.supabase = null;
    this.useSupabase = false;
    
    // 文件系統
    this.outputDir = 'infinite_hunt';
    this.walletFile = `${this.outputDir}/wallets_${this.sessionId}.jsonl`;
    this.treasureFile = `${this.outputDir}/treasures_${this.sessionId}.json`;
    this.progressFile = `${this.outputDir}/progress_${this.sessionId}.json`;
    this.logFile = `${this.outputDir}/hunt_log_${this.sessionId}.log`;
    
    // 性能監控
    this.performanceMetrics = {
      generationSpeed: 0,
      checkingSpeed: 0,
      apiSuccessRate: 0,
      cacheHitRate: 0,
      memoryUsage: 0
    };
    
    this.ensureDirectories();
    this.setupGracefulShutdown();
    this.loadProgress();
  }

  // 生成機器ID
  generateMachineId() {
    const hostname = os.hostname();
    const platform = os.platform();
    const arch = os.arch();
    const cpus = os.cpus().length;
    const memory = os.totalmem();
    
    const uniqueString = `${hostname}_${platform}_${arch}_${cpus}_${memory}`;
    const hash = crypto.createHash('sha256').update(uniqueString).digest('hex');
    return `INF${hash.substring(0, 9).toUpperCase()}`;
  }

  // 獲取起始索引（避免重複）
  getStartingIndex() {
    // 基於機器ID和時間的確定性起始點
    const seed = crypto.createHash('sha256')
      .update(this.machineId + Date.now().toString())
      .digest('hex');
    const startIndex = parseInt(seed.substring(0, 12), 16) % 1000000000; // 10億範圍內
    return Math.max(startIndex, 1000000); // 至少從100萬開始
  }

  // 初始化 Supabase
  async initializeSupabase() {
    try {
      this.supabase = new SupabaseClient();
      this.useSupabase = true;
      this.log(`✅ Supabase 連接成功`);
    } catch (error) {
      this.log(`⚠️ Supabase 連接失敗: ${error.message}`);
      this.useSupabase = false;
    }
  }

  // 確定性錢包生成
  generateWalletAtIndex(index) {
    // 使用多層熵源
    const seedBuffer = Buffer.alloc(64);
    
    // 主要索引
    seedBuffer.writeUInt32BE(Math.floor(index / 0x100000000), 0);
    seedBuffer.writeUInt32BE(index & 0xffffffff, 4);
    
    // 機器特定性
    const machineHash = crypto.createHash('sha256').update(this.machineId).digest();
    machineHash.copy(seedBuffer, 8);
    
    // 時間變化（每小時變化）
    const hourSeed = Math.floor(Date.now() / 3600000);
    seedBuffer.writeUInt32BE(hourSeed, 40);
    
    // 最終哈希
    const finalHash = crypto.createHash('sha256').update(seedBuffer).digest();
    
    try {
      const bitcoin = require('bitcoinjs-lib');
      const keyPair = bitcoin.ECPair.fromPrivateKey(finalHash);
      const { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey });
      
      return {
        index: index,
        address: address,
        privateKey: keyPair.toWIF(),
        publicKey: keyPair.publicKey.toString('hex'),
        machineId: this.machineId,
        timestamp: Date.now()
      };
    } catch (error) {
      // 如果私鑰無效，使用下一個索引
      return this.generateWalletAtIndex(index + 1);
    }
  }

  // 批量生成和檢查
  async generateAndCheckBatch(startIndex, batchSize) {
    const generationStart = Date.now();
    const wallets = [];
    const addresses = [];
    
    // 🚀 高速生成錢包
    for (let i = 0; i < batchSize; i++) {
      const wallet = this.generateWalletAtIndex(startIndex + i);
      wallets.push(wallet);
      addresses.push(wallet.address);
    }
    
    const generationTime = Date.now() - generationStart;
    
    // 💰 並行餘額檢查
    const checkingStart = Date.now();
    const balanceResults = await this.balanceChecker.checkMultipleBalances(addresses);
    const checkingTime = Date.now() - checkingStart;
    
    // 🎉 分析結果
    const walletsWithBalance = [];
    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];
      const balanceResult = balanceResults[i];
      
      if (balanceResult && balanceResult.hasBalance && !balanceResult.error) {
        const treasureWallet = {
          ...wallet,
          balance: balanceResult,
          discoveredAt: new Date().toISOString(),
          source: balanceResult.source
        };
        
        walletsWithBalance.push(treasureWallet);
        this.treasures.push(treasureWallet);
        this.totalWithBalance++;
        
        // 🎉 立即通知和保存
        this.log(`🎉💰 寶藏發現! ${wallet.address} = ${balanceResult.balanceInBTC} BTC (來源: ${balanceResult.source})`);
        await this.saveTreasureImmediately(treasureWallet);
      }
    }
    
    // 更新性能指標
    this.performanceMetrics.generationSpeed = batchSize / (generationTime / 1000);
    this.performanceMetrics.checkingSpeed = batchSize / (checkingTime / 1000);
    
    return {
      wallets,
      walletsWithBalance,
      generationTime,
      checkingTime
    };
  }

  // 立即保存寶藏
  async saveTreasureImmediately(treasure) {
    try {
      // 保存到文件
      const treasureData = {
        ...treasure,
        savedAt: new Date().toISOString()
      };
      
      fs.appendFileSync(this.treasureFile, JSON.stringify(treasureData) + '\n');
      
      // 保存到 Supabase
      if (this.useSupabase) {
        await this.supabase.saveWalletData({
          address: treasure.address,
          privateKey: treasure.privateKey,
          publicKey: treasure.publicKey,
          type: 'bitcoin',
          balance: treasure.balance
        });
      }
      
      // 發送通知（可以擴展為 Discord/Telegram 通知）
      this.sendTreasureNotification(treasure);
      
    } catch (error) {
      this.log(`❌ 保存寶藏失敗: ${error.message}`);
    }
  }

  // 發送寶藏通知
  sendTreasureNotification(treasure) {
    const notification = {
      type: 'TREASURE_FOUND',
      address: treasure.address,
      balance: treasure.balance.balanceInBTC,
      source: treasure.source,
      timestamp: treasure.discoveredAt,
      machine: this.machineId
    };
    
    // 可以在這裡添加 Discord webhook 或其他通知方式
    console.log(`\n🚨 寶藏警報! 🚨`);
    console.log(`💰 地址: ${treasure.address}`);
    console.log(`💎 餘額: ${treasure.balance.balanceInBTC} BTC`);
    console.log(`🔍 來源: ${treasure.source}`);
    console.log(`🕐 時間: ${treasure.discoveredAt}`);
    console.log(`${'='.repeat(80)}`);
  }

  // 顯示實時統計
  displayHuntingStats() {
    const runTime = (Date.now() - this.startTime) / 1000;
    const memUsage = process.memoryUsage();
    const balanceStats = this.balanceChecker.getDetailedStats();
    
    console.clear();
    console.log(`🚀 無限 Bitcoin 獵人 - 機器: ${this.machineId}`);
    console.log(`${'='.repeat(100)}`);
    console.log(`🆔 會話: ${this.sessionId}`);
    console.log(`📍 當前索引: ${this.currentIndex.toLocaleString()}`);
    console.log(`⏱️ 運行時間: ${Math.floor(runTime / 3600)}h ${Math.floor((runTime % 3600) / 60)}m ${Math.floor(runTime % 60)}s`);
    
    console.log(`\n📊 生成統計:`);
    console.log(`   已生成: ${this.totalGenerated.toLocaleString()} 個錢包`);
    console.log(`   已檢查: ${this.totalChecked.toLocaleString()} 個地址`);
    console.log(`   有餘額: ${this.totalWithBalance} 個地址`);
    console.log(`   命中率: ${this.totalChecked > 0 ? (this.totalWithBalance / this.totalChecked * 100).toFixed(8) : 0}%`);
    
    console.log(`\n⚡ 性能指標:`);
    console.log(`   生成速度: ${this.performanceMetrics.generationSpeed.toFixed(1)} 錢包/秒`);
    console.log(`   檢查速度: ${this.performanceMetrics.checkingSpeed.toFixed(1)} 地址/秒`);
    console.log(`   記憶體使用: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB`);
    
    console.log(`\n🌐 API 狀態:`);
    console.log(`   活躍 API: ${balanceStats.overall.activeAPIs}/${balanceStats.overall.totalAPIs}`);
    console.log(`   平均健康: ${balanceStats.overall.averageHealth}%`);
    console.log(`   隊列大小: ${balanceStats.overall.queueSize}`);
    console.log(`   處理中: ${balanceStats.overall.activeRequests}`);
    console.log(`   緩存大小: ${balanceStats.overall.cacheSize}`);
    
    // 顯示 API 詳情
    let apiCount = 0;
    for (const [apiName, stats] of Object.entries(balanceStats.apis)) {
      if (stats.totalRequests > 0 && apiCount < 6) { // 只顯示前6個活躍的API
        console.log(`   ${apiName}: ${stats.successRate} 成功率, ${stats.healthScore.toFixed(0)}% 健康, ${stats.totalRequests} 請求`);
        apiCount++;
      }
    }
    
    if (this.treasures.length > 0) {
      console.log(`\n🎉 發現的寶藏 (最近5個):`);
      this.treasures.slice(-5).forEach((treasure, index) => {
        console.log(`   ${index + 1}. ${treasure.address}: ${treasure.balance.balanceInBTC} BTC (${treasure.source})`);
      });
      if (this.treasures.length > 5) {
        console.log(`   ... 總共 ${this.treasures.length} 個寶藏!`);
      }
    }
    
    console.log(`\n📁 輸出文件:`);
    console.log(`   寶藏: ${this.treasureFile}`);
    console.log(`   進度: ${this.progressFile}`);
    console.log(`   日誌: ${this.logFile}`);
    
    console.log(`\n🛑 按 Ctrl+C 安全停止獵人`);
  }

  // 保存進度
  saveProgress() {
    const progress = {
      machineId: this.machineId,
      sessionId: this.sessionId,
      currentIndex: this.currentIndex,
      totalGenerated: this.totalGenerated,
      totalChecked: this.totalChecked,
      totalWithBalance: this.totalWithBalance,
      treasuresFound: this.treasures.length,
      lastSaved: new Date().toISOString(),
      performanceMetrics: this.performanceMetrics
    };
    
    fs.writeFileSync(this.progressFile, JSON.stringify(progress, null, 2));
  }

  // 載入進度
  loadProgress() {
    try {
      if (fs.existsSync(this.progressFile)) {
        const progress = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
        if (progress.machineId === this.machineId) {
          this.currentIndex = progress.currentIndex;
          this.totalGenerated = progress.totalGenerated || 0;
          this.totalChecked = progress.totalChecked || 0;
          this.totalWithBalance = progress.totalWithBalance || 0;
          this.log(`🔄 已載入進度: 從索引 ${this.currentIndex.toLocaleString()} 繼續`);
        }
      }
    } catch (error) {
      this.log(`⚠️ 載入進度失敗: ${error.message}`);
    }
  }

  // 記錄日誌
  log(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} - ${message}\n`;
    
    console.log(message);
    fs.appendFileSync(this.logFile, logEntry);
  }

  // 啟動無限獵人模式
  async startInfiniteHunt(options = {}) {
    this.log(`🚀 啟動無限 Bitcoin 獵人`);
    this.log(`🆔 機器ID: ${this.machineId}`);
    this.log(`📍 起始索引: ${this.currentIndex.toLocaleString()}`);
    this.log(`🔧 批次大小: ${this.batchSize}`);
    this.log(`🌐 API 來源: 12個 Bitcoin API 提供商`);
    
    await this.initializeSupabase();
    
    // 設置定時器
    const statsInterval = setInterval(() => {
      if (this.isRunning) {
        this.displayHuntingStats();
      } else {
        clearInterval(statsInterval);
      }
    }, this.statsInterval);
    
    const saveInterval = setInterval(() => {
      if (this.isRunning) {
        this.saveProgress();
      } else {
        clearInterval(saveInterval);
      }
    }, 30000); // 每30秒保存進度
    
    try {
      while (this.isRunning) {
        // 批量生成和檢查
        const result = await this.generateAndCheckBatch(this.currentIndex, this.batchSize);
        
        this.totalGenerated += result.wallets.length;
        this.totalChecked += result.wallets.length;
        this.currentIndex += this.batchSize;
        
        // 定期保存進度
        if (this.totalGenerated % this.saveInterval === 0) {
          this.saveProgress();
        }
        
        // 記憶體管理
        if (process.memoryUsage().heapUsed > 512 * 1024 * 1024) { // 512MB
          global.gc && global.gc();
        }
        
        // 微小延遲避免過度負載
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      
    } catch (error) {
      this.log(`❌ 獵人運行錯誤: ${error.message}`);
    } finally {
      clearInterval(statsInterval);
      clearInterval(saveInterval);
    }
  }

  // 確保目錄
  ensureDirectories() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  // 優雅停止
  setupGracefulShutdown() {
    let isShuttingDown = false;
    
    const shutdown = async (signal) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      this.isRunning = false;
      
      this.log(`🛑 收到 ${signal} 信號，正在停止獵人...`);
      
      this.saveProgress();
      this.balanceChecker.stop();
      await this.generateFinalReport();
      
      this.log(`✅ 無限獵人已安全停止`);
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT (Ctrl+C)'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  // 生成最終報告
  async generateFinalReport() {
    const runTime = (Date.now() - this.startTime) / 1000;
    const balanceStats = this.balanceChecker.getDetailedStats();
    
    const report = {
      summary: {
        machineId: this.machineId,
        sessionId: this.sessionId,
        huntingMode: 'INFINITE',
        totalRunTime: runTime,
        totalGenerated: this.totalGenerated,
        totalChecked: this.totalChecked,
        totalWithBalance: this.totalWithBalance,
        treasuresFound: this.treasures.length,
        finalIndex: this.currentIndex,
        generationSpeed: this.totalGenerated / runTime,
        checkingSpeed: this.totalChecked / runTime,
        treasureRate: this.totalChecked > 0 ? this.totalWithBalance / this.totalChecked : 0
      },
      treasures: this.treasures,
      apiStats: balanceStats,
      performanceMetrics: this.performanceMetrics,
      endTime: new Date().toISOString()
    };
    
    const reportFile = `${this.outputDir}/final_report_${this.sessionId}.json`;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    
    this.log(`📊 最終報告: ${reportFile}`);
    this.log(`⚡ 平均生成速度: ${report.summary.generationSpeed.toFixed(1)} 錢包/秒`);
    this.log(`🔍 平均檢查速度: ${report.summary.checkingSpeed.toFixed(1)} 地址/秒`);
    
    if (this.treasures.length > 0) {
      const totalBTC = this.treasures.reduce((sum, t) => sum + t.balance.balanceInBTC, 0);
      this.log(`🎉 總共發現 ${this.treasures.length} 個寶藏錢包!`);
      this.log(`💰 總價值: ${totalBTC} BTC`);
    }
  }
}

// CLI 執行
async function main() {
  const args = process.argv.slice(2);
  
  console.log('🚀 無限 Bitcoin 獵人');
  console.log('===================');
  console.log('💰 包含私鑰 + 餘額檢查');
  console.log('🌐 12個 API 來源負載平衡');
  console.log('⚡ 智能重試 + 自動恢復');
  console.log('💾 進度保存 + 寶藏追蹤');
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log('\n使用方法:');
    console.log('node test/infinite-bitcoin-hunter.js [選項]');
    console.log('\n特色:');
    console.log('  🚀 無限生成 - 永不停止的錢包生成');
    console.log('  💰 完整信息 - 地址 + 私鑰 + 餘額');
    console.log('  🌐 12個 API 來源 - 最大化可用性');
    console.log('  ⚡ 智能負載平衡 - 自動選擇最佳API');
    console.log('  🎯 實時寶藏檢測 - 立即通知和保存');
    console.log('  💾 進度保存 - 支持斷點續傳');
    console.log('  📊 詳細統計 - 實時性能監控');
    console.log('\nAPI 來源包括:');
    console.log('  1. Blockstream.info     2. BlockCypher');
    console.log('  3. Blockchain.info      4. Blockchair');
    console.log('  5. BitGo               6. Insight');
    console.log('  7. SoChain             8. Mempool.space');
    console.log('  9. BTCExplorer         10. CryptoID');
    console.log('  11. SmartBit           12. BitCore');
    return;
  }

  try {
    const hunter = new InfiniteBitcoinHunter();
    await hunter.startInfiniteHunt();
    
  } catch (error) {
    console.error(`\n❌ 無限獵人失敗: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = InfiniteBitcoinHunter;
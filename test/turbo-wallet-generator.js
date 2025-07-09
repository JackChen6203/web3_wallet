require('dotenv').config();
const AdvancedBalanceChecker = require('../src/services/advancedBalanceChecker');
const SupabaseService = require('../src/services/supabaseClient');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');

class TurboWalletGenerator {
  constructor() {
    this.startTime = Date.now();
    this.machineId = this.generateMachineId();
    this.sessionId = `TURBO_${this.machineId}_${Date.now()}`;
    this.isRunning = true;
    this.totalGenerated = 0;
    this.totalWithBalance = 0;
    this.treasures = [];
    
    // 高級餘額檢查器
    this.balanceChecker = new AdvancedBalanceChecker();
    
    // 範圍配置 - 針對雲端環境優化
    this.rangeSize = 1000000;
    this.currentRange = null;
    this.currentIndex = 0;
    this.batchSize = this.getOptimalBatchSize(); // 根據環境自動調整批次大小
    
    // 進度文件路徑
    this.progressFile = `turbo/progress_${this.machineId}.json`;
    this.resumeFromProgress = false;
    
    // Supabase
    this.supabase = null;
    this.useSupabase = false;
    
    // 性能統計
    this.stats = {
      machineId: this.machineId,
      sessionId: this.sessionId,
      generationSpeed: 0,
      balanceCheckSpeed: 0,
      totalAPIRequests: 0,
      successfulAPIRequests: 0,
      cacheHitRate: 0
    };
    
    this.ensureDirectories();
    this.setupGracefulShutdown();
  }

  // 獲取最佳批次大小
  getOptimalBatchSize() {
    const cpuCores = require('os').cpus().length;
    
    // 根據 CPU 核心數調整批次大小
    if (cpuCores <= 2) {
      return 50; // 低配置環境，減少批次大小
    } else if (cpuCores <= 4) {
      return 100; // 中配置環境
    } else if (cpuCores <= 8) {
      return 150; // 高配置環境
    } else {
      return 200; // 超高配置環境
    }
  }

  // 生成機器ID
  generateMachineId() {
    const hostname = os.hostname();
    const cpus = os.cpus()[0].model;
    const uniqueString = `${hostname}_${cpus}_TURBO`;
    const hash = crypto.createHash('sha256').update(uniqueString).digest('hex');
    return `T${hash.substring(0, 11).toUpperCase()}`;
  }

  // 初始化 Supabase
  async initializeSupabase() {
    try {
      this.supabase = new SupabaseService();
      this.useSupabase = true;
      console.log(`✅ Supabase 連接成功`);
    } catch (error) {
      console.log(`⚠️ Supabase 連接失敗，使用本地模式: ${error.message}`);
      this.useSupabase = false;
    }
  }

  // 獲取下一個範圍 - 確保每台主機獲得不同範圍
  async getNextRange() {
    // 使用主機名、CPU、時間戳創建唯一標識
    const hostname = require('os').hostname();
    const cpuInfo = require('os').cpus()[0].model;
    const uniqueString = `${hostname}_${cpuInfo}_${this.machineId}_${Date.now()}`;
    const hash = crypto.createHash('sha256').update(uniqueString).digest('hex');
    
    // 使用 hash 的不同部分來創建大範圍分散
    const segment1 = parseInt(hash.substring(0, 8), 16);
    const segment2 = parseInt(hash.substring(8, 16), 16);
    const segment3 = parseInt(hash.substring(16, 24), 16);
    
    // 創建一個很大的基礎偏移，確保不同主機在完全不同的數字空間
    // 使用更大的偏移量來避免衝突
    const hostHash = parseInt(hash.substring(0, 6), 16) % 10000; // 0-9999
    const timeHash = parseInt(hash.substring(6, 12), 16) % 1000; // 0-999
    const machineHash = parseInt(hash.substring(12, 18), 16) % 100; // 0-99
    
    const baseOffset = hostHash * 1000000 + timeHash * 1000 + machineHash * 10 + 1;
    
    // 如果使用 Supabase，嘗試協調分配
    if (this.useSupabase) {
      try {
        const coordinatedRange = await this.supabase.getNextWorkRange(this.sessionId, this.rangeSize);
        if (coordinatedRange) {
          console.log(`📋 從 Supabase 獲得協調範圍: ${coordinatedRange.start.toLocaleString()} - ${coordinatedRange.end.toLocaleString()}`);
          return coordinatedRange;
        }
      } catch (error) {
        console.log(`⚠️ Supabase 範圍協調失敗，使用本地分配: ${error.message}`);
      }
    }
    
    // 本地分配確保唯一性
    const rangeStart = baseOffset;
    
    console.log(`📋 分配新範圍: ${rangeStart.toLocaleString()} - ${(rangeStart + this.rangeSize - 1).toLocaleString()}`);
    console.log(`🆔 主機標識: ${hostname} (${this.machineId})`);
    
    return {
      start: rangeStart,
      end: rangeStart + this.rangeSize - 1,
      id: `turbo_${this.machineId}_${Date.now()}`
    };
  }

  // 確定性生成錢包
  generateWalletAtIndex(index) {
    const seedBuffer = Buffer.alloc(32);
    seedBuffer.writeUInt32BE(Math.floor(index / 0x100000000), 0);
    seedBuffer.writeUInt32BE(index & 0xffffffff, 4);
    
    const hash = crypto.createHash('sha256').update(seedBuffer).digest();
    
    const bitcoin = require('bitcoinjs-lib');
    const keyPair = bitcoin.ECPair.fromPrivateKey(hash);
    const { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey });
    
    return {
      index: index,
      address: address,
      privateKey: keyPair.toWIF(),
      publicKey: keyPair.publicKey.toString('hex'),
      machineId: this.machineId,
      timestamp: Date.now()
    };
  }

  // 批量生成和檢查
  async generateAndCheckBatch(startIndex, batchSize) {
    const wallets = [];
    const addresses = [];
    
    // 快速生成錢包批次
    for (let i = 0; i < batchSize; i++) {
      const wallet = this.generateWalletAtIndex(startIndex + i);
      wallets.push(wallet);
      addresses.push(wallet.address);
    }
    
    // 並行餘額檢查 - 使用批量優化模式，根據環境調整子批次大小
    const subBatchSize = require('os').cpus().length <= 2 ? 20 : 50;
    const balanceResults = await this.balanceChecker.batchCheckBalances(addresses, 'bitcoin', subBatchSize);
    
    // 合併結果
    const walletsWithBalance = [];
    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];
      const balanceResult = balanceResults.results[i];
      
      if (balanceResult && balanceResult.hasBalance) {
        const treasureWallet = {
          ...wallet,
          balance: balanceResult
        };
        walletsWithBalance.push(treasureWallet);
        this.treasures.push(treasureWallet);
        this.totalWithBalance++;
        
        console.log(`\n🎉💰 發現寶藏! ${wallet.address} - ${balanceResult.balanceInBTC} BTC`);
        
        // 保存到 Supabase
        if (this.useSupabase) {
          await this.recordTreasure(treasureWallet);
        }
      }
    }
    
    return { wallets, walletsWithBalance };
  }

  // 記錄寶藏到 Supabase
  async recordTreasure(treasureWallet) {
    if (!this.useSupabase) return;
    
    try {
      await this.supabase.saveWalletData({
        address: treasureWallet.address,
        privateKey: treasureWallet.privateKey,
        publicKey: treasureWallet.publicKey,
        type: 'bitcoin',
        balance: treasureWallet.balance
      });
    } catch (error) {
      console.error(`❌ 記錄寶藏失敗: ${error.message}`);
    }
  }

  // 顯示實時統計
  displayStats() {
    const runTime = (Date.now() - this.startTime) / 1000;
    const generationSpeed = this.totalGenerated / runTime;
    const balanceStats = this.balanceChecker.getStats();
    
    console.clear();
    console.log(`🚀 TURBO 錢包生成器 - 機器: ${this.machineId}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`🆔 會話ID: ${this.sessionId}`);
    console.log(`📋 當前範圍: ${this.currentRange?.start?.toLocaleString()} - ${this.currentRange?.end?.toLocaleString()}`);
    console.log(`📍 當前索引: ${(this.currentRange?.start + this.currentIndex)?.toLocaleString()}`);
    console.log(`⏱️ 運行時間: ${Math.floor(runTime / 3600)}h ${Math.floor((runTime % 3600) / 60)}m ${Math.floor(runTime % 60)}s`);
    console.log(`📊 已生成: ${this.totalGenerated.toLocaleString()} 個錢包`);
    console.log(`💰 有餘額: ${this.totalWithBalance} 個錢包`);
    console.log(`⚡ 生成速度: ${generationSpeed.toFixed(1)} 錢包/秒`);
    
    // API 統計
    console.log(`\n📡 API 統計:`);
    let totalAPIRequests = 0;
    let successfulAPIRequests = 0;
    
    for (const [apiName, apiStats] of Object.entries(balanceStats.apis)) {
      if (apiStats.totalRequests > 0) {
        totalAPIRequests += apiStats.totalRequests;
        successfulAPIRequests += apiStats.successfulRequests;
        console.log(`   ${apiName}: ${apiStats.successRate} 成功率, ${apiStats.totalRequests} 請求`);
      }
    }
    
    if (totalAPIRequests > 0) {
      console.log(`   總體成功率: ${(successfulAPIRequests / totalAPIRequests * 100).toFixed(1)}%`);
    }
    
    console.log(`\n📋 處理隊列:`);
    console.log(`   等待: ${balanceStats.queue.pending}, 處理中: ${balanceStats.queue.processing}`);
    console.log(`   緩存: ${balanceStats.cache.size} 項目`);
    
    if (this.totalWithBalance > 0) {
      console.log(`\n🎉 發現的寶藏錢包:`);
      this.treasures.slice(-5).forEach(treasure => {
        console.log(`   💎 ${treasure.address}: ${treasure.balance.balanceInBTC} BTC`);
      });
      if (this.treasures.length > 5) {
        console.log(`   ... 還有 ${this.treasures.length - 5} 個寶藏`);
      }
    }
    
    console.log(`\n🛑 按 Ctrl+C 安全停止`);
  }

  // 啟動 TURBO 模式
  async startTurboGeneration(options = {}) {
    console.log(`🚀 啟動 TURBO 錢包生成器`);
    console.log(`🆔 機器ID: ${this.machineId}`);
    console.log(`💻 系統配置: ${require('os').cpus().length} CPU 核心`);
    console.log(`📦 批次大小: ${this.batchSize} 錢包/批次`);
    console.log(`⚡ 特色: 高速生成 + 智能餘額檢查 + 多API負載平衡`);
    
    // 加載進度
    await this.loadProgress();
    
    await this.initializeSupabase();
    
    const checkBalance = options.checkBalance !== false; // 默認啟用
    
    if (checkBalance) {
      console.log(`💰 高級餘額檢查已啟用`);
      console.log(`🔧 支援多個 API 提供商和智能負載平衡`);
    }
    
    // 統計顯示間隔
    const statsInterval = setInterval(() => {
      if (this.isRunning) {
        this.displayStats();
      } else {
        clearInterval(statsInterval);
      }
    }, 2000);
    
    try {
      while (this.isRunning) {
        // 獲取新範圍
        if (!this.currentRange || this.currentIndex >= this.rangeSize) {
          this.currentRange = await this.getNextRange();
          this.currentIndex = 0;
          console.log(`\n📋 分配新範圍: ${this.currentRange.start.toLocaleString()} - ${this.currentRange.end.toLocaleString()}`);
        }
        
        // 批量生成和檢查
        const currentBatchSize = Math.min(this.batchSize, this.rangeSize - this.currentIndex);
        const startIndex = this.currentRange.start + this.currentIndex;
        
        if (checkBalance) {
          const result = await this.generateAndCheckBatch(startIndex, currentBatchSize);
          this.totalGenerated += result.wallets.length;
        } else {
          // 純生成模式（更快）
          for (let i = 0; i < currentBatchSize; i++) {
            this.generateWalletAtIndex(startIndex + i);
            this.totalGenerated++;
          }
        }
        
        this.currentIndex += currentBatchSize;
        
        // 定期保存進度（每1000個錢包保存一次）
        if (this.totalGenerated % 1000 === 0) {
          await this.saveProgress();
        }
        
        // 避免過度 CPU 使用
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      
    } catch (error) {
      console.error(`❌ TURBO 生成過程錯誤: ${error.message}`);
    } finally {
      clearInterval(statsInterval);
    }
  }

  // 確保目錄存在
  ensureDirectories() {
    const dirs = ['wallets', 'treasures', 'results', 'turbo'];
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  // 加載進度
  async loadProgress() {
    try {
      if (fs.existsSync(this.progressFile)) {
        const progressData = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
        
        // 檢查進度是否有效（24小時內）
        const progressAge = Date.now() - progressData.lastUpdate;
        if (progressAge < 24 * 60 * 60 * 1000) {
          this.currentRange = progressData.currentRange;
          this.currentIndex = progressData.currentIndex;
          this.totalGenerated = progressData.totalGenerated || 0;
          this.totalWithBalance = progressData.totalWithBalance || 0;
          this.treasures = progressData.treasures || [];
          this.resumeFromProgress = true;
          
          console.log(`📂 加載進度: 從索引 ${this.currentIndex.toLocaleString()} 恢復`);
          console.log(`📊 歷史統計: 已生成 ${this.totalGenerated.toLocaleString()} 個，發現 ${this.totalWithBalance} 個有餘額`);
          console.log(`📋 恢復範圍: ${this.currentRange.start.toLocaleString()} - ${this.currentRange.end.toLocaleString()}`);
          return true;
        } else {
          console.log(`⏰ 進度文件過期（${Math.floor(progressAge / 3600000)}小時前），開始新任務`);
          fs.unlinkSync(this.progressFile);
        }
      }
    } catch (error) {
      console.warn(`⚠️ 加載進度失敗: ${error.message}`);
    }
    return false;
  }

  // 保存進度
  async saveProgress() {
    try {
      const progressData = {
        machineId: this.machineId,
        sessionId: this.sessionId,
        currentRange: this.currentRange,
        currentIndex: this.currentIndex,
        totalGenerated: this.totalGenerated,
        totalWithBalance: this.totalWithBalance,
        treasures: this.treasures,
        lastUpdate: Date.now(),
        timestamp: new Date().toISOString()
      };
      
      // 確保目錄存在
      const progressDir = require('path').dirname(this.progressFile);
      if (!fs.existsSync(progressDir)) {
        fs.mkdirSync(progressDir, { recursive: true });
      }
      
      fs.writeFileSync(this.progressFile, JSON.stringify(progressData, null, 2));
    } catch (error) {
      console.warn(`⚠️ 保存進度失敗: ${error.message}`);
    }
  }

  // 優雅停止
  setupGracefulShutdown() {
    let isShuttingDown = false;
    
    const shutdown = async (signal) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      this.isRunning = false;
      
      console.log(`\n🛑 收到 ${signal} 信號，正在停止...`);
      
      // 保存當前進度
      await this.saveProgress();
      console.log(`💾 進度已保存至 ${this.progressFile}`);
      
      await this.saveFinalReport();
      this.balanceChecker.stop();
      
      console.log(`✅ TURBO 生成器已安全停止`);
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT (Ctrl+C)'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  // 保存最終報告
  async saveFinalReport() {
    const runTime = (Date.now() - this.startTime) / 1000;
    const balanceStats = this.balanceChecker.getStats();
    
    const report = {
      machineId: this.machineId,
      sessionId: this.sessionId,
      mode: 'TURBO',
      totalRunTime: runTime,
      totalGenerated: this.totalGenerated,
      totalWithBalance: this.totalWithBalance,
      treasures: this.treasures,
      generationSpeed: this.totalGenerated / runTime,
      apiStats: balanceStats,
      endTime: new Date().toISOString()
    };
    
    const reportFile = `turbo/turbo_report_${this.sessionId}.json`;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    
    console.log(`\n📊 TURBO 報告: ${reportFile}`);
    console.log(`⚡ 平均生成速度: ${report.generationSpeed.toFixed(1)} 錢包/秒`);
    if (this.totalWithBalance > 0) {
      console.log(`🎉 發現 ${this.totalWithBalance} 個有餘額的錢包！`);
    }
  }
}

// CLI 執行
async function main() {
  const args = process.argv.slice(2);
  
  console.log('🚀 TURBO 錢包生成器');
  console.log('==================');
  console.log('⚡ 高速生成 + 智能餘額檢查');
  console.log('🔧 多 API 負載平衡 + 自動重試');
  console.log('📊 實時統計 + Supabase 整合');
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log('\n使用方法:');
    console.log('node test/turbo-wallet-generator.js [選項]');
    console.log('\n選項:');
    console.log('  --no-balance            禁用餘額檢查（僅生成）');
    console.log('\n特色:');
    console.log('  🚀 智能批量處理 - 優化的生成和檢查流程');
    console.log('  ⚡ 多 API 負載平衡 - 自動選擇最佳 API');
    console.log('  📊 實時統計監控 - 詳細的性能指標');
    console.log('  💾 智能緩存系統 - 避免重複查詢');
    console.log('  🔄 自動錯誤恢復 - 智能重試機制');
    console.log('  💰 寶藏自動記錄 - 有餘額錢包自動保存');
    return;
  }
  
  const options = {
    checkBalance: !args.includes('--no-balance')
  };

  try {
    const generator = new TurboWalletGenerator();
    await generator.startTurboGeneration(options);
    
  } catch (error) {
    console.error(`\n❌ TURBO 生成器失敗: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = TurboWalletGenerator;
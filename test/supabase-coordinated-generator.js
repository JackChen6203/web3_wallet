const SupabaseClient = require('../src/services/supabaseClient');
const UltimateBalanceChecker = require('../src/services/ultimateBalanceChecker');
const WalletGenerator = require('../src/utils/walletGenerator');
const crypto = require('crypto');
const os = require('os');

class SupabaseCoordinatedGenerator {
  constructor(options = {}) {
    this.checkBalance = options.checkBalance || false;
    this.batchSize = options.batchSize || 100;
    this.concurrent = options.concurrent || 4;
    this.reportInterval = options.reportInterval || 5000;
    
    this.machineId = this.generateMachineId();
    this.sessionId = `SUPABASE_${this.machineId}_${Date.now()}`;
    this.isRunning = true;
    
    // 統計數據
    this.totalGenerated = 0;
    this.totalChecked = 0;
    this.totalWithBalance = 0;
    this.treasures = [];
    this.startTime = Date.now();
    
    // 初始化服務
    this.supabase = new SupabaseClient();
    this.balanceChecker = new UltimateBalanceChecker();
    this.walletGenerator = new WalletGenerator();
    
    console.log('🚀 Supabase 協調式 Bitcoin 錢包生成器');
    console.log('===========================================');
    console.log(`💾 資料庫協調: 是`);
    console.log(`💰 餘額檢查: ${this.checkBalance ? '是' : '否'}`);
    console.log(`📦 批次大小: ${this.batchSize}`);
    console.log(`⚡ 並發數: ${this.concurrent}`);
    console.log(`🆔 會話ID: ${this.sessionId}`);
    console.log('===========================================\n');
  }

  generateMachineId() {
    const hostname = os.hostname();
    const platform = os.platform();
    const arch = os.arch();
    const hash = crypto.createHash('md5')
      .update(`${hostname}-${platform}-${arch}`)
      .digest('hex')
      .substring(0, 8);
    return `${hostname.substring(0, 8)}_${hash}`;
  }

  async initializeDatabase() {
    try {
      console.log('📊 初始化資料庫連接...');
      await this.supabase.ensureTablesExist();
      
      // 註冊會話
      await this.supabase.registerSession({
        sessionId: this.sessionId,
        machineId: this.machineId,
        status: 'active',
        config: {
          checkBalance: this.checkBalance,
          batchSize: this.batchSize,
          concurrent: this.concurrent
        }
      });
      
      console.log('✅ 資料庫初始化完成');
    } catch (error) {
      console.error('❌ 資料庫初始化失敗:', error.message);
      throw error;
    }
  }

  async getNextWorkRange() {
    try {
      const range = await this.supabase.getNextWorkRange(this.sessionId, this.batchSize);
      return range;
    } catch (error) {
      console.error('❌ 獲取工作範圍失敗:', error.message);
      // 回退到本地範圍分配
      const start = Math.floor(Math.random() * 1000000000);
      return { start, end: start + this.batchSize };
    }
  }

  async processWalletBatch(startIndex) {
    const batch = [];
    const promises = [];
    
    for (let i = 0; i < this.batchSize; i++) {
      const index = startIndex + i;
      const wallet = this.walletGenerator.generateFromIndex(index);
      batch.push(wallet);
      
      if (this.checkBalance) {
        const promise = this.checkWalletBalance(wallet)
          .then(result => {
            if (result.hasBalance) {
              this.treasures.push(result);
              this.totalWithBalance++;
              this.notifyTreasureFound(result);
            }
          })
          .catch(error => {
            console.error(`❌ 餘額檢查失敗 ${wallet.address}:`, error.message);
          });
        promises.push(promise);
      }
    }
    
    this.totalGenerated += batch.length;
    
    if (this.checkBalance) {
      await Promise.allSettled(promises);
      this.totalChecked += batch.length;
    }
    
    // 保存到資料庫
    try {
      await this.supabase.saveWalletBatch(batch, this.sessionId);
    } catch (error) {
      console.error('❌ 保存批次失敗:', error.message);
    }
    
    return batch;
  }

  async checkWalletBalance(wallet) {
    try {
      const result = await this.balanceChecker.checkBalance(wallet.address);
      return {
        ...wallet,
        balance: result.balance,
        hasBalance: result.balance > 0,
        apiSource: result.source,
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`餘額檢查失敗: ${error.message}`);
    }
  }

  notifyTreasureFound(treasure) {
    console.log('\n🎉 ========== 發現寶藏! ==========');
    console.log(`💰 地址: ${treasure.address}`);
    console.log(`💎 餘額: ${treasure.balance} BTC`);
    console.log(`🔑 私鑰: ${treasure.privateKey}`);
    console.log(`🌐 來源: ${treasure.apiSource}`);
    console.log(`⏰ 時間: ${treasure.checkedAt}`);
    console.log('================================\n');
  }

  printProgress() {
    const elapsed = Date.now() - this.startTime;
    const elapsedMinutes = elapsed / 60000;
    const genRate = this.totalGenerated / elapsedMinutes;
    const checkRate = this.totalChecked / elapsedMinutes;
    
    console.log('\n📊 ========== 進度報告 ==========');
    console.log(`⏱️  運行時間: ${Math.floor(elapsedMinutes)}分鐘`);
    console.log(`🔢 已生成: ${this.totalGenerated.toLocaleString()} 個錢包`);
    console.log(`🔍 已檢查: ${this.totalChecked.toLocaleString()} 個地址`);
    console.log(`💰 有餘額: ${this.totalWithBalance} 個`);
    console.log(`🚀 生成速度: ${Math.round(genRate)} 錢包/分鐘`);
    if (this.checkBalance) {
      console.log(`⚡ 檢查速度: ${Math.round(checkRate)} 地址/分鐘`);
    }
    console.log(`🆔 會話: ${this.sessionId}`);
    console.log('================================\n');
  }

  async updateSessionStatus() {
    try {
      await this.supabase.updateSessionStats(this.sessionId, {
        totalGenerated: this.totalGenerated,
        totalChecked: this.totalChecked,
        totalWithBalance: this.totalWithBalance,
        lastUpdate: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ 更新會話狀態失敗:', error.message);
    }
  }

  async run() {
    try {
      await this.initializeDatabase();
      
      const progressTimer = setInterval(() => {
        this.printProgress();
        this.updateSessionStatus();
      }, this.reportInterval);
      
      process.on('SIGINT', async () => {
        console.log('\n\n🛑 收到停止信號，正在清理...');
        this.isRunning = false;
        clearInterval(progressTimer);
        
        try {
          await this.supabase.updateSessionStatus(this.sessionId, 'stopped');
          console.log('✅ 會話狀態已更新');
        } catch (error) {
          console.error('❌ 更新會話狀態失敗:', error.message);
        }
        
        this.printProgress();
        console.log('👋 程式已停止');
        process.exit(0);
      });
      
      console.log('🚀 開始生成錢包...\n');
      
      while (this.isRunning) {
        try {
          const workRange = await this.getNextWorkRange();
          await this.processWalletBatch(workRange.start);
          
          // 短暫延遲避免資源耗盡
          await new Promise(resolve => setTimeout(resolve, 10));
          
        } catch (error) {
          console.error('❌ 處理批次時發生錯誤:', error.message);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
    } catch (error) {
      console.error('❌ 程式運行失敗:', error.message);
      process.exit(1);
    }
  }
}

// 命令行參數處理
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    checkBalance: false,
    batchSize: 100,
    concurrent: 4,
    reportInterval: 5000
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--check-balance':
        options.checkBalance = true;
        break;
      case '--batch-size':
        options.batchSize = parseInt(args[++i]) || 100;
        break;
      case '--concurrent':
        options.concurrent = parseInt(args[++i]) || 4;
        break;
      case '--report-interval':
        options.reportInterval = parseInt(args[++i]) || 5000;
        break;
      case '--help':
        console.log(`
🚀 Supabase 協調式 Bitcoin 錢包生成器
========================================

使用方法:
  node test/supabase-coordinated-generator.js [選項]

選項:
  --check-balance     檢查錢包餘額
  --batch-size NUM    批次大小 (預設: 100)
  --concurrent NUM    並發數 (預設: 4)
  --report-interval   報告間隔毫秒 (預設: 5000)
  --help             顯示此幫助

範例:
  npm run test:supabase
  npm run test:supabase:balance
  node test/supabase-coordinated-generator.js --check-balance --batch-size 50
        `);
        process.exit(0);
    }
  }
  
  return options;
}

// 如果直接運行此文件
if (require.main === module) {
  const options = parseArgs();
  const generator = new SupabaseCoordinatedGenerator(options);
  generator.run().catch(console.error);
}

module.exports = SupabaseCoordinatedGenerator;
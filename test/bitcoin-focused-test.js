const WalletGenerator = require('../src/utils/walletGenerator');
const UltimateBalanceChecker = require('../src/services/ultimateBalanceChecker');
const fs = require('fs').promises;
const path = require('path');

class BitcoinFocusedTest {
  constructor(options = {}) {
    this.count = options.count || 5;
    this.checkBalance = options.checkBalance || false;
    this.save = options.save || false;
    this.performance = options.performance || false;
    
    this.walletGenerator = new WalletGenerator();
    this.balanceChecker = new UltimateBalanceChecker();
    
    this.wallets = [];
    this.treasures = [];
    this.startTime = Date.now();
    
    console.log('🚀 Bitcoin 專注測試');
    console.log('===================');
    console.log(`🔢 生成數量: ${this.count}`);
    console.log(`💰 檢查餘額: ${this.checkBalance ? '是' : '否'}`);
    console.log(`💾 保存結果: ${this.save ? '是' : '否'}`);
    console.log(`⚡ 性能測試: ${this.performance ? '是' : '否'}`);
    console.log('===================\n');
  }

  async generateWallets() {
    console.log('🔑 生成 Bitcoin 錢包...');
    
    const startTime = Date.now();
    
    for (let i = 0; i < this.count; i++) {
      const wallet = this.walletGenerator.generateRandom();
      this.wallets.push(wallet);
      
      if (!this.performance) {
        console.log(`\n錢包 ${i + 1}:`);
        console.log(`  地址: ${wallet.address}`);
        console.log(`  私鑰: ${wallet.privateKey}`);
        console.log(`  公鑰: ${wallet.publicKey}`);
      }
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`\n✅ 生成完成! 用時: ${elapsed}ms`);
    console.log(`📊 平均速度: ${Math.round(this.count / (elapsed / 1000))} 錢包/秒\n`);
  }

  async checkBalances() {
    if (!this.checkBalance) return;
    
    console.log('💰 檢查錢包餘額...\n');
    
    const startTime = Date.now();
    let checkedCount = 0;
    
    for (const wallet of this.wallets) {
      try {
        console.log(`🔍 檢查 ${wallet.address}...`);
        const result = await this.balanceChecker.checkBalance(wallet.address);
        
        wallet.balance = result.balance;
        wallet.apiSource = result.source;
        wallet.checkedAt = new Date().toISOString();
        
        if (result.balance > 0) {
          this.treasures.push(wallet);
          console.log(`🎉 發現有餘額的錢包! 餘額: ${result.balance} BTC`);
        } else {
          console.log(`   餘額: 0 BTC (來源: ${result.source})`);
        }
        
        checkedCount++;
        
      } catch (error) {
        console.log(`❌ 檢查失敗: ${error.message}`);
        wallet.error = error.message;
      }
      
      // 短暫延遲避免API限制
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`\n✅ 餘額檢查完成! 用時: ${elapsed}ms`);
    console.log(`📊 檢查了 ${checkedCount} 個地址`);
    console.log(`💰 發現 ${this.treasures.length} 個有餘額的錢包\n`);
  }

  async saveResults() {
    if (!this.save) return;
    
    console.log('💾 保存結果...');
    
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `bitcoin-test-${timestamp}.json`;
      const filepath = path.join('wallets', filename);
      
      // 確保wallets目錄存在
      await fs.mkdir('wallets', { recursive: true });
      
      const data = {
        timestamp: new Date().toISOString(),
        config: {
          count: this.count,
          checkBalance: this.checkBalance,
          performance: this.performance
        },
        summary: {
          totalGenerated: this.wallets.length,
          totalWithBalance: this.treasures.length,
          executionTime: Date.now() - this.startTime
        },
        wallets: this.wallets,
        treasures: this.treasures
      };
      
      await fs.writeFile(filepath, JSON.stringify(data, null, 2));
      console.log(`✅ 結果已保存到: ${filepath}\n`);
      
    } catch (error) {
      console.error(`❌ 保存失敗: ${error.message}\n`);
    }
  }

  async runPerformanceTest() {
    if (!this.performance) return;
    
    console.log('⚡ 運行性能測試...\n');
    
    const tests = [
      { count: 10, name: '小量測試' },
      { count: 50, name: '中量測試' },
      { count: 100, name: '大量測試' }
    ];
    
    for (const test of tests) {
      console.log(`🏃 ${test.name} (${test.count} 個錢包):`);
      
      const startTime = Date.now();
      const testWallets = [];
      
      for (let i = 0; i < test.count; i++) {
        const wallet = this.walletGenerator.generateRandom();
        testWallets.push(wallet);
      }
      
      const elapsed = Date.now() - startTime;
      const rate = Math.round(test.count / (elapsed / 1000));
      
      console.log(`  ✅ 用時: ${elapsed}ms`);
      console.log(`  📊 速度: ${rate} 錢包/秒\n`);
    }
  }

  printSummary() {
    const totalTime = Date.now() - this.startTime;
    
    console.log('📊 ========== 測試總結 ==========');
    console.log(`⏱️  總用時: ${totalTime}ms`);
    console.log(`🔢 生成錢包: ${this.wallets.length} 個`);
    
    if (this.checkBalance) {
      console.log(`💰 有餘額錢包: ${this.treasures.length} 個`);
      console.log(`📊 成功率: ${((this.treasures.length / this.wallets.length) * 100).toFixed(4)}%`);
    }
    
    if (this.treasures.length > 0) {
      console.log('\n🎉 發現的寶藏:');
      this.treasures.forEach((treasure, index) => {
        console.log(`  ${index + 1}. ${treasure.address} (${treasure.balance} BTC)`);
      });
    }
    
    console.log('================================\n');
  }

  async run() {
    try {
      await this.generateWallets();
      await this.runPerformanceTest();
      await this.checkBalances();
      await this.saveResults();
      this.printSummary();
      
    } catch (error) {
      console.error('❌ 測試失敗:', error.message);
      process.exit(1);
    }
  }
}

// 命令行參數處理
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    count: 5,
    checkBalance: false,
    save: false,
    performance: false
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--generate':
        const nextArg = args[i + 1];
        if (nextArg && !nextArg.startsWith('--')) {
          options.count = parseInt(nextArg);
          i++;
        }
        break;
      case '--balance':
        options.checkBalance = true;
        break;
      case '--save':
        options.save = true;
        break;
      case '--performance':
        options.performance = true;
        break;
      case '--help':
        console.log(`
🚀 Bitcoin 專注測試
===================

使用方法:
  node test/bitcoin-focused-test.js [選項]

選項:
  --generate [數量]   生成指定數量的錢包 (預設: 5)
  --balance          檢查餘額
  --save             保存結果到檔案
  --performance      運行性能測試
  --help             顯示此幫助

範例:
  npm run test:bitcoin
  npm run test:bitcoin:balance
  npm run test:bitcoin:full
  node test/bitcoin-focused-test.js --generate 10 --balance --save
        `);
        process.exit(0);
    }
  }
  
  return options;
}

// 如果直接運行此文件
if (require.main === module) {
  const options = parseArgs();
  const test = new BitcoinFocusedTest(options);
  test.run().catch(console.error);
}

module.exports = BitcoinFocusedTest;
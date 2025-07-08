const AdvancedBalanceChecker = require('../src/services/advancedBalanceChecker');
const WalletGenerator = require('../src/utils/walletGenerator');

class AdvancedBalanceTest {
  constructor() {
    this.balanceChecker = new AdvancedBalanceChecker();
    this.testResults = {
      totalTested: 0,
      withBalance: 0,
      averageSpeed: 0,
      apiStats: {}
    };
  }

  // 基礎性能測試
  async basicPerformanceTest(count = 100) {
    console.log(`⚡ 高級餘額檢查性能測試`);
    console.log(`🎯 測試數量: ${count} 個地址`);
    console.log('='.repeat(60));

    // 生成測試地址
    const testAddresses = [];
    for (let i = 0; i < count; i++) {
      const wallet = WalletGenerator.generateBitcoinWallet();
      testAddresses.push(wallet.address);
    }

    console.log('📊 開始並行餘額檢查...');
    const startTime = Date.now();

    try {
      const results = await this.balanceChecker.fastScanMode(testAddresses, 'bitcoin');
      
      const duration = (Date.now() - startTime) / 1000;
      const speed = count / duration;
      
      console.log('\n✅ 測試完成！');
      console.log('='.repeat(60));
      console.log(`📊 總計檢查: ${count} 個地址`);
      console.log(`⏱️ 用時: ${duration.toFixed(2)}s`);
      console.log(`⚡ 速度: ${speed.toFixed(1)} 地址/秒`);
      console.log(`💰 有餘額: ${results.withBalance.length} 個地址`);
      
      // 顯示 API 統計
      this.displayAPIStats();
      
      return results;
      
    } catch (error) {
      console.error(`❌ 測試失敗: ${error.message}`);
      throw error;
    }
  }

  // 大規模並發測試
  async largeConcurrencyTest(count = 1000) {
    console.log(`\n🚀 大規模並發餘額檢查測試`);
    console.log(`🎯 測試數量: ${count} 個地址`);
    console.log(`⚡ 最大並發: ${this.balanceChecker.maxConcurrent}`);
    console.log('='.repeat(60));

    // 生成大量測試地址
    console.log('📝 生成測試地址...');
    const testWallets = [];
    for (let i = 0; i < count; i++) {
      const wallet = WalletGenerator.generateBitcoinWallet();
      testWallets.push({
        address: wallet.address,
        type: 'bitcoin'
      });
    }

    console.log('🔄 開始批量並發檢查...');
    const startTime = Date.now();
    let completedCount = 0;
    let withBalanceCount = 0;

    // 實時統計顯示
    const statsInterval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const currentSpeed = completedCount / elapsed;
      const progress = (completedCount / count) * 100;
      
      console.clear();
      console.log('🚀 大規模並發餘額檢查');
      console.log('='.repeat(60));
      console.log(`🎯 進度: ${completedCount}/${count} (${progress.toFixed(1)}%)`);
      console.log(`⏱️ 已運行: ${elapsed.toFixed(1)}s`);
      console.log(`⚡ 當前速度: ${currentSpeed.toFixed(1)} 地址/秒`);
      console.log(`💰 已發現: ${withBalanceCount} 個有餘額地址`);
      
      const queueStats = this.balanceChecker.getStats().queue;
      console.log(`📋 隊列: ${queueStats.pending} 等待, ${queueStats.processing} 處理中`);
      console.log('\n🛑 按 Ctrl+C 停止');
    }, 1000);

    try {
      // 批量提交到隊列
      const promises = testWallets.map(async (wallet) => {
        try {
          const result = await this.balanceChecker.checkBalance(wallet.address, wallet.type);
          completedCount++;
          if (result.hasBalance) {
            withBalanceCount++;
            console.log(`\n🎉💰 發現寶藏! ${result.address} - ${result.balanceInBTC} BTC`);
          }
          return result;
        } catch (error) {
          completedCount++;
          return { address: wallet.address, error: error.message, hasBalance: false };
        }
      });

      const results = await Promise.all(promises);
      clearInterval(statsInterval);

      const totalTime = (Date.now() - startTime) / 1000;
      const finalSpeed = count / totalTime;
      const successfulResults = results.filter(r => !r.error);
      const failedResults = results.filter(r => r.error);

      console.log('\n🏁 大規模測試完成！');
      console.log('='.repeat(60));
      console.log(`📊 總計檢查: ${count} 個地址`);
      console.log(`✅ 成功: ${successfulResults.length} 個`);
      console.log(`❌ 失敗: ${failedResults.length} 個`);
      console.log(`⏱️ 總用時: ${totalTime.toFixed(2)}s`);
      console.log(`⚡ 平均速度: ${finalSpeed.toFixed(1)} 地址/秒`);
      console.log(`💰 有餘額: ${withBalanceCount} 個地址`);
      console.log(`📈 成功率: ${(successfulResults.length/count*100).toFixed(1)}%`);

      // 顯示詳細統計
      this.displayDetailedStats();

      return {
        results,
        stats: {
          total: count,
          successful: successfulResults.length,
          failed: failedResults.length,
          withBalance: withBalanceCount,
          duration: totalTime,
          speed: finalSpeed,
          successRate: successfulResults.length / count
        }
      };

    } catch (error) {
      clearInterval(statsInterval);
      console.error(`❌ 大規模測試失敗: ${error.message}`);
      throw error;
    }
  }

  // 混合幣種測試
  async mixedCurrencyTest(btcCount = 50, ethCount = 50) {
    console.log(`\n🌐 混合幣種餘額檢查測試`);
    console.log(`₿ Bitcoin: ${btcCount} 個地址`);
    console.log(`Ξ Ethereum: ${ethCount} 個地址`);
    console.log('='.repeat(60));

    const testWallets = [];

    // 生成 Bitcoin 測試地址
    for (let i = 0; i < btcCount; i++) {
      const wallet = WalletGenerator.generateBitcoinWallet();
      testWallets.push({
        address: wallet.address,
        type: 'bitcoin'
      });
    }

    // 生成 Ethereum 測試地址
    for (let i = 0; i < ethCount; i++) {
      const wallet = WalletGenerator.generateEthereumWallet();
      testWallets.push({
        address: wallet.address,
        type: 'ethereum'
      });
    }

    console.log('🔄 開始混合幣種檢查...');
    const startTime = Date.now();

    try {
      const promises = testWallets.map(wallet => 
        this.balanceChecker.checkBalance(wallet.address, wallet.type)
          .catch(error => ({
            address: wallet.address,
            type: wallet.type,
            error: error.message,
            hasBalance: false
          }))
      );

      const results = await Promise.all(promises);
      const duration = (Date.now() - startTime) / 1000;

      // 分析結果
      const btcResults = results.filter(r => r.type === 'bitcoin');
      const ethResults = results.filter(r => r.type === 'ethereum');
      const btcWithBalance = btcResults.filter(r => r.hasBalance);
      const ethWithBalance = ethResults.filter(r => r.hasBalance);

      console.log('\n✅ 混合測試完成！');
      console.log('='.repeat(60));
      console.log(`⏱️ 總用時: ${duration.toFixed(2)}s`);
      console.log(`⚡ 總速度: ${(btcCount + ethCount) / duration} 地址/秒`);
      console.log(`\n₿ Bitcoin 結果:`);
      console.log(`   檢查: ${btcCount} 個，有餘額: ${btcWithBalance.length} 個`);
      console.log(`Ξ Ethereum 結果:`);
      console.log(`   檢查: ${ethCount} 個，有餘額: ${ethWithBalance.length} 個`);

      return { results, btcResults, ethResults, btcWithBalance, ethWithBalance };

    } catch (error) {
      console.error(`❌ 混合測試失敗: ${error.message}`);
      throw error;
    }
  }

  // 壓力測試
  async stressTest(duration = 60) {
    console.log(`\n🔥 API 壓力測試`);
    console.log(`⏱️ 測試時長: ${duration} 秒`);
    console.log('='.repeat(60));

    const startTime = Date.now();
    const endTime = startTime + (duration * 1000);
    let totalRequests = 0;
    let successfulRequests = 0;
    let requestsWithBalance = 0;

    const statsInterval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const requestsPerSecond = totalRequests / elapsed;
      const successRate = totalRequests > 0 ? (successfulRequests / totalRequests * 100) : 0;
      
      console.clear();
      console.log('🔥 API 壓力測試');
      console.log('='.repeat(60));
      console.log(`⏱️ 已運行: ${elapsed.toFixed(1)}/${duration}s`);
      console.log(`📊 總請求: ${totalRequests}`);
      console.log(`✅ 成功: ${successfulRequests} (${successRate.toFixed(1)}%)`);
      console.log(`💰 有餘額: ${requestsWithBalance}`);
      console.log(`⚡ 速度: ${requestsPerSecond.toFixed(1)} 請求/秒`);
      
      this.displayAPIStats();
    }, 1000);

    const promises = [];

    // 持續生成請求直到時間結束
    while (Date.now() < endTime) {
      const wallet = WalletGenerator.generateBitcoinWallet();
      totalRequests++;

      const promise = this.balanceChecker.checkBalance(wallet.address, 'bitcoin')
        .then(result => {
          successfulRequests++;
          if (result.hasBalance) {
            requestsWithBalance++;
            console.log(`\n🎉 壓力測試中發現寶藏! ${result.address}`);
          }
          return result;
        })
        .catch(error => {
          // 壓力測試中忽略錯誤
          return { error: error.message };
        });

      promises.push(promise);

      // 短暫延遲避免過度負載
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    console.log('\n⏳ 等待所有請求完成...');
    await Promise.all(promises);
    clearInterval(statsInterval);

    const actualDuration = (Date.now() - startTime) / 1000;
    const finalSpeed = totalRequests / actualDuration;
    const finalSuccessRate = totalRequests > 0 ? (successfulRequests / totalRequests * 100) : 0;

    console.log('\n🏁 壓力測試完成！');
    console.log('='.repeat(60));
    console.log(`⏱️ 實際用時: ${actualDuration.toFixed(2)}s`);
    console.log(`📊 總請求: ${totalRequests}`);
    console.log(`✅ 成功: ${successfulRequests} (${finalSuccessRate.toFixed(1)}%)`);
    console.log(`💰 有餘額: ${requestsWithBalance}`);
    console.log(`⚡ 平均速度: ${finalSpeed.toFixed(1)} 請求/秒`);

    this.displayDetailedStats();

    return {
      duration: actualDuration,
      totalRequests,
      successfulRequests,
      requestsWithBalance,
      speed: finalSpeed,
      successRate: finalSuccessRate
    };
  }

  // 顯示 API 統計
  displayAPIStats() {
    const stats = this.balanceChecker.getStats();
    
    console.log('\n📊 API 統計:');
    for (const [apiName, apiStats] of Object.entries(stats.apis)) {
      if (apiStats.totalRequests > 0) {
        console.log(`   ${apiName}: ${apiStats.totalRequests} 請求, ${apiStats.successRate} 成功率`);
      }
    }
  }

  // 顯示詳細統計
  displayDetailedStats() {
    const stats = this.balanceChecker.getStats();
    
    console.log('\n📈 詳細統計:');
    console.log('='.repeat(60));
    
    for (const [apiName, apiStats] of Object.entries(stats.apis)) {
      if (apiStats.totalRequests > 0) {
        console.log(`\n🔧 ${apiName}:`);
        console.log(`   總請求: ${apiStats.totalRequests}`);
        console.log(`   成功: ${apiStats.successfulRequests}`);
        console.log(`   失敗: ${apiStats.failedRequests}`);
        console.log(`   成功率: ${apiStats.successRate}`);
        console.log(`   平均響應時間: ${apiStats.averageResponseTime.toFixed(0)}ms`);
        console.log(`   狀態: ${apiStats.isActive ? '✅ 活躍' : '❌ 停用'}`);
        if (apiStats.lastError) {
          console.log(`   最後錯誤: ${apiStats.lastError}`);
        }
      }
    }

    console.log(`\n📋 隊列狀態:`);
    console.log(`   等待中: ${stats.queue.pending}`);
    console.log(`   處理中: ${stats.queue.processing}`);
    console.log(`   最大並發: ${stats.queue.maxConcurrent}`);

    console.log(`\n💾 緩存狀態:`);
    console.log(`   緩存大小: ${stats.cache.size}`);
    console.log(`   過期時間: ${stats.cache.expiryTime}`);
  }

  // 清理資源
  cleanup() {
    this.balanceChecker.stop();
  }
}

// CLI 執行
async function main() {
  const args = process.argv.slice(2);
  
  console.log('⚡ 高級餘額檢查器測試');
  console.log('='.repeat(30));
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log('\n使用方法:');
    console.log('node test/advanced-balance-test.js [選項]');
    console.log('\n選項:');
    console.log('  --basic [數量]          基礎性能測試 (默認: 100)');
    console.log('  --large [數量]          大規模並發測試 (默認: 1000)');
    console.log('  --mixed [btc] [eth]     混合幣種測試 (默認: 50 50)');
    console.log('  --stress [秒數]         壓力測試 (默認: 60)');
    console.log('\n示例:');
    console.log('  node test/advanced-balance-test.js --basic 200');
    console.log('  node test/advanced-balance-test.js --large 2000');
    console.log('  node test/advanced-balance-test.js --mixed 100 100');
    console.log('  node test/advanced-balance-test.js --stress 120');
    return;
  }

  const tester = new AdvancedBalanceTest();
  
  try {
    if (args.includes('--basic')) {
      const countIndex = args.indexOf('--basic') + 1;
      const count = countIndex < args.length ? parseInt(args[countIndex]) || 100 : 100;
      await tester.basicPerformanceTest(count);
      
    } else if (args.includes('--large')) {
      const countIndex = args.indexOf('--large') + 1;
      const count = countIndex < args.length ? parseInt(args[countIndex]) || 1000 : 1000;
      await tester.largeConcurrencyTest(count);
      
    } else if (args.includes('--mixed')) {
      const btcIndex = args.indexOf('--mixed') + 1;
      const ethIndex = btcIndex + 1;
      const btcCount = btcIndex < args.length ? parseInt(args[btcIndex]) || 50 : 50;
      const ethCount = ethIndex < args.length ? parseInt(args[ethIndex]) || 50 : 50;
      await tester.mixedCurrencyTest(btcCount, ethCount);
      
    } else if (args.includes('--stress')) {
      const durationIndex = args.indexOf('--stress') + 1;
      const duration = durationIndex < args.length ? parseInt(args[durationIndex]) || 60 : 60;
      await tester.stressTest(duration);
      
    } else {
      // 默認運行基礎測試
      await tester.basicPerformanceTest(100);
    }
    
  } catch (error) {
    console.error(`\n❌ 測試失敗: ${error.message}`);
  } finally {
    tester.cleanup();
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}

module.exports = AdvancedBalanceTest;
const axios = require('axios');
const { ethers } = require('ethers');

class AdvancedBalanceChecker {
  constructor() {
    // 多個 Bitcoin API 提供商
    this.bitcoinAPIs = [
      {
        name: 'Blockstream',
        url: 'https://blockstream.info/api',
        rateLimit: 50, // 每秒請求數
        priority: 1
      },
      {
        name: 'BlockCypher',
        url: 'https://api.blockcypher.com/v1/btc/main',
        rateLimit: 200, // 每小時請求數（免費版）
        priority: 2
      },
      {
        name: 'Blockchain.info',
        url: 'https://blockchain.info',
        rateLimit: 10,
        priority: 3
      },
      {
        name: 'Mempool.space',
        url: 'https://mempool.space/api',
        rateLimit: 60,
        priority: 4
      },
      {
        name: 'Blockchair',
        url: 'https://api.blockchair.com/bitcoin',
        rateLimit: 30,
        priority: 5
      },
      {
        name: 'SoChain',
        url: 'https://sochain.com/api/v2',
        rateLimit: 300,
        priority: 6
      },
      {
        name: 'SmartBit',
        url: 'https://api.smartbit.com.au/v1/blockchain',
        rateLimit: 50,
        priority: 7
      }
    ];

    // 多個 Ethereum API 提供商
    this.ethereumAPIs = [
      {
        name: 'Etherscan',
        url: 'https://api.etherscan.io/api',
        apiKey: process.env.ETHERSCAN_API_KEY,
        rateLimit: 5,
        priority: 1
      },
      {
        name: 'Alchemy',
        url: process.env.ALCHEMY_URL,
        apiKey: process.env.ALCHEMY_API_KEY,
        rateLimit: 100,
        priority: 2
      },
      {
        name: 'Infura',
        url: process.env.INFURA_URL,
        apiKey: process.env.INFURA_API_KEY,
        rateLimit: 100,
        priority: 3
      }
    ];

    // 智能隊列配置 - 針對雲端環境優化
    this.queue = [];
    this.processing = false;
    this.maxConcurrent = this.detectOptimalConcurrency(); // 自動檢測最佳並發數
    this.activeRequests = 0;
    this.retryAttempts = 2; // 減少重試次數
    this.baseDelay = 100; // 增加延遲以減少負載
    
    // 動態調整配置
    this.dynamicScaling = true;
    this.lastQueueSize = 0;
    this.queueGrowthRate = 0;
    this.performanceHistory = [];
    this.lastAdjustTime = Date.now();
    this.cpuCores = require('os').cpus().length;

    // API 狀態追踪
    this.apiStats = new Map();
    this.initializeAPIStats();

    // 緩存系統
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5分鐘緩存

    // 開始處理隊列
    this.startQueueProcessor();
    
    // 啟動隊列監控
    this.startQueueMonitoring();
  }

  // 檢測最佳並發數
  detectOptimalConcurrency() {
    const cpuCores = require('os').cpus().length;
    
    // 根據 CPU 核心數動態調整
    if (cpuCores <= 2) {
      return 8; // 低配置環境
    } else if (cpuCores <= 4) {
      return 16; // 中配置環境
    } else if (cpuCores <= 8) {
      return 32; // 高配置環境
    } else {
      return 50; // 超高配置環境
    }
  }

  // 初始化 API 統計
  initializeAPIStats() {
    [...this.bitcoinAPIs, ...this.ethereumAPIs].forEach(api => {
      this.apiStats.set(api.name, {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        lastRequestTime: 0,
        isActive: true,
        errorCount: 0,
        lastError: null
      });
    });
  }

  // 智能 API 選擇
  selectBestAPI(apis, type) {
    const availableAPIs = apis.filter(api => {
      const stats = this.apiStats.get(api.name);
      const timeSinceLastRequest = Date.now() - stats.lastRequestTime;
      const canMakeRequest = timeSinceLastRequest >= (1000 / api.rateLimit);
      
      return stats.isActive && canMakeRequest && stats.errorCount < 5;
    });

    if (availableAPIs.length === 0) {
      // 如果沒有可用 API，選擇錯誤最少的
      return apis.reduce((best, current) => {
        const currentStats = this.apiStats.get(current.name);
        const bestStats = this.apiStats.get(best.name);
        return currentStats.errorCount < bestStats.errorCount ? current : best;
      });
    }

    // 根據優先級和成功率選擇
    return availableAPIs.sort((a, b) => {
      const aStats = this.apiStats.get(a.name);
      const bStats = this.apiStats.get(b.name);
      
      const aScore = (aStats.successfulRequests / Math.max(aStats.totalRequests, 1)) * (1 / a.priority);
      const bScore = (bStats.successfulRequests / Math.max(bStats.totalRequests, 1)) * (1 / b.priority);
      
      return bScore - aScore;
    })[0];
  }

  // 更新 API 統計
  updateAPIStats(apiName, success, responseTime, error = null) {
    const stats = this.apiStats.get(apiName);
    stats.totalRequests++;
    stats.lastRequestTime = Date.now();

    if (success) {
      stats.successfulRequests++;
      stats.errorCount = Math.max(0, stats.errorCount - 1); // 成功時減少錯誤計數
      stats.averageResponseTime = (stats.averageResponseTime + responseTime) / 2;
    } else {
      stats.failedRequests++;
      stats.errorCount++;
      stats.lastError = error;
      
      // 如果錯誤過多，暫時禁用 API
      if (stats.errorCount >= 10) {
        stats.isActive = false;
        setTimeout(() => {
          stats.isActive = true;
          stats.errorCount = 0;
        }, 60000); // 1分鐘後重新啟用
      }
    }
  }

  // 添加到隊列
  addToQueue(request) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        ...request,
        resolve,
        reject,
        timestamp: Date.now(),
        retries: 0
      });
    });
  }

  // 隊列處理器
  async startQueueProcessor() {
    this.processing = true;
    
    while (this.processing) {
      // 動態調整並發數
      if (this.dynamicScaling) {
        this.adjustConcurrency();
      }
      
      if (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
        const request = this.queue.shift();
        this.activeRequests++;
        
        // 異步處理請求
        this.processRequest(request)
          .finally(() => {
            this.activeRequests--;
          });
      }
      
      // 批量處理模式：當隊列過大時，減少延遲
      const delay = this.queue.length > 100 ? 1 : (this.queue.length > 50 ? 5 : 10);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // 動態調整並發數
  adjustConcurrency() {
    const now = Date.now();
    const queueSize = this.queue.length;
    
    // 每 10 秒調整一次（減少調整頻率）
    if (now - this.lastAdjustTime < 10000) return;
    
    this.queueGrowthRate = queueSize - this.lastQueueSize;
    this.lastQueueSize = queueSize;
    this.lastAdjustTime = now;
    
    // 根據 CPU 核心數設定上限
    const maxAllowed = this.cpuCores <= 2 ? 12 : (this.cpuCores <= 4 ? 24 : 50);
    const minConcurrency = this.cpuCores <= 2 ? 4 : (this.cpuCores <= 4 ? 8 : 16);
    
    // 隊列積壓嚴重時適度增加並發
    if (queueSize > 100 && this.queueGrowthRate > 0) {
      const increment = this.cpuCores <= 2 ? 2 : 4;
      this.maxConcurrent = Math.min(maxAllowed, this.maxConcurrent + increment);
      console.log(`📈 隊列積壓，增加並發至 ${this.maxConcurrent} (CPU: ${this.cpuCores} 核心)`);
    }
    // 隊列穩定時適當減少並發
    else if (queueSize < 10 && this.queueGrowthRate <= 0 && this.maxConcurrent > minConcurrency) {
      const decrement = this.cpuCores <= 2 ? 1 : 2;
      this.maxConcurrent = Math.max(minConcurrency, this.maxConcurrent - decrement);
      console.log(`📉 隊列穩定，降低並發至 ${this.maxConcurrent} (CPU: ${this.cpuCores} 核心)`);
    }
    
    // 記錄性能歷史
    this.performanceHistory.push({
      timestamp: now,
      queueSize,
      activeRequests: this.activeRequests,
      maxConcurrent: this.maxConcurrent,
      queueGrowthRate: this.queueGrowthRate,
      cpuCores: this.cpuCores
    });
    
    // 只保留最近 50 個記錄（減少內存使用）
    if (this.performanceHistory.length > 50) {
      this.performanceHistory.shift();
    }
  }

  // 處理單個請求
  async processRequest(request) {
    try {
      const result = await this.executeBalanceCheck(request);
      request.resolve(result);
    } catch (error) {
      if (request.retries < this.retryAttempts) {
        request.retries++;
        // 指數退避重試
        const delay = this.baseDelay * Math.pow(2, request.retries);
        setTimeout(() => {
          this.queue.unshift(request); // 重新加入隊列前端
        }, delay);
      } else {
        request.reject(error);
      }
    }
  }

  // 執行餘額檢查
  async executeBalanceCheck(request) {
    const { address, type } = request;
    
    // 檢查緩存
    const cacheKey = `${type}:${address}`;
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.cacheExpiry) {
      return cached.data;
    }

    let result;
    if (type === 'bitcoin') {
      result = await this.checkBitcoinBalanceAdvanced(address);
    } else if (type === 'ethereum') {
      result = await this.checkEthereumBalanceAdvanced(address);
    } else {
      throw new Error(`Unsupported type: ${type}`);
    }

    // 緩存結果
    this.cache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });

    return result;
  }

  // 高級 Bitcoin 餘額檢查
  async checkBitcoinBalanceAdvanced(address) {
    const api = this.selectBestAPI(this.bitcoinAPIs, 'bitcoin');
    const startTime = Date.now();

    try {
      let response;
      
      switch (api.name) {
        case 'Blockstream':
          response = await axios.get(`${api.url}/address/${address}`, {
            timeout: 5000
          });
          break;
          
        case 'BlockCypher':
          response = await axios.get(`${api.url}/addrs/${address}/balance`, {
            timeout: 5000
          });
          break;
          
        case 'Blockchain.info':
          response = await axios.get(`${api.url}/q/addressbalance/${address}`, {
            timeout: 5000
          });
          break;
          
        case 'Mempool.space':
          response = await axios.get(`${api.url}/address/${address}`, {
            timeout: 5000
          });
          break;
          
        case 'Blockchair':
          response = await axios.get(`${api.url}/dashboards/address/${address}`, {
            timeout: 5000
          });
          break;
          
        case 'SoChain':
          response = await axios.get(`${api.url}/get_address_balance/BTC/${address}`, {
            timeout: 5000
          });
          break;
          
        case 'SmartBit':
          response = await axios.get(`${api.url}/address/${address}`, {
            timeout: 5000
          });
          break;
          
        default:
          throw new Error(`Unsupported Bitcoin API: ${api.name}`);
      }

      const responseTime = Date.now() - startTime;
      this.updateAPIStats(api.name, true, responseTime);

      // 解析不同 API 的響應格式
      return this.parseBitcoinResponse(response.data, api.name, address);

    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.updateAPIStats(api.name, false, responseTime, error.message);
      throw error;
    }
  }

  // 解析 Bitcoin API 響應
  parseBitcoinResponse(data, apiName, address) {
    let balance = { confirmed: 0, unconfirmed: 0, total: 0 };

    try {
      switch (apiName) {
        case 'Blockstream':
          balance = {
            confirmed: data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum,
            unconfirmed: data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum,
            total: (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) + 
                   (data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum)
          };
          break;
          
        case 'BlockCypher':
          balance = {
            confirmed: data.balance || 0,
            unconfirmed: data.unconfirmed_balance || 0,
            total: (data.balance || 0) + (data.unconfirmed_balance || 0)
          };
          break;
          
        case 'Blockchain.info':
          const totalSatoshis = parseInt(data) || 0;
          balance = {
            confirmed: totalSatoshis,
            unconfirmed: 0,
            total: totalSatoshis
          };
          break;
          
        case 'Mempool.space':
          balance = {
            confirmed: data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum,
            unconfirmed: data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum,
            total: (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) + 
                   (data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum)
          };
          break;
          
        case 'Blockchair':
          const addrData = data.data[address];
          if (addrData) {
            balance = {
              confirmed: addrData.address.balance || 0,
              unconfirmed: addrData.address.unconfirmed_balance || 0,
              total: (addrData.address.balance || 0) + (addrData.address.unconfirmed_balance || 0)
            };
          }
          break;
          
        case 'SoChain':
          if (data.status === 'success') {
            const balanceStr = data.data.confirmed_balance;
            const satoshis = Math.round(parseFloat(balanceStr) * 100000000);
            balance = { confirmed: satoshis, unconfirmed: 0, total: satoshis };
          }
          break;
          
        case 'SmartBit':
          if (data.success && data.address) {
            balance = {
              confirmed: data.address.confirmed.balance_int || 0,
              unconfirmed: data.address.unconfirmed.balance_int || 0,
              total: (data.address.confirmed.balance_int || 0) + (data.address.unconfirmed.balance_int || 0)
            };
          }
          break;
      }
    } catch (parseError) {
      console.warn(`解析 ${apiName} 響應失敗:`, parseError.message);
    }

    return {
      address,
      ...balance,
      balanceInBTC: balance.total / 100000000,
      hasBalance: balance.total > 0,
      type: 'bitcoin',
      source: apiName
    };
  }

  // 高級 Ethereum 餘額檢查
  async checkEthereumBalanceAdvanced(address) {
    const api = this.selectBestAPI(this.ethereumAPIs.filter(api => api.apiKey), 'ethereum');
    const startTime = Date.now();

    try {
      let balance;
      
      if (api.name === 'Etherscan') {
        const response = await axios.get(api.url, {
          params: {
            module: 'account',
            action: 'balance',
            address: address,
            tag: 'latest',
            apikey: api.apiKey
          },
          timeout: 5000
        });
        
        if (response.data.status === '1') {
          balance = response.data.result;
        } else {
          throw new Error(response.data.message || 'Etherscan API error');
        }
      } else {
        // 使用 RPC 提供商 (Alchemy, Infura)
        const provider = new ethers.JsonRpcProvider(api.url);
        balance = await provider.getBalance(address);
        balance = balance.toString();
      }

      const responseTime = Date.now() - startTime;
      this.updateAPIStats(api.name, true, responseTime);

      const balanceInETH = ethers.formatEther(balance);
      
      return {
        address,
        balance: balance,
        balanceInETH: parseFloat(balanceInETH),
        hasBalance: parseFloat(balanceInETH) > 0,
        type: 'ethereum',
        source: api.name
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.updateAPIStats(api.name, false, responseTime, error.message);
      throw error;
    }
  }

  // 公共介面：檢查單個餘額
  async checkBalance(address, type) {
    return await this.addToQueue({ address, type });
  }

  // 公共介面：批量檢查餘額
  async checkMultipleBalances(wallets) {
    const promises = wallets.map(wallet => 
      this.checkBalance(wallet.address, wallet.type || 'bitcoin')
    );
    
    return await Promise.allSettled(promises);
  }

  // 高速掃描模式
  async fastScanMode(addresses, type = 'bitcoin') {
    console.log(`🚀 啟動高速掃描模式: ${addresses.length} 個地址`);
    
    const startTime = Date.now();
    const promises = addresses.map(address => 
      this.checkBalance(address, type).catch(error => ({
        address,
        error: error.message,
        hasBalance: false
      }))
    );
    
    const results = await Promise.all(promises);
    const withBalance = results.filter(result => result.hasBalance);
    
    const duration = (Date.now() - startTime) / 1000;
    const speed = addresses.length / duration;
    
    console.log(`✅ 掃描完成: ${addresses.length} 個地址，${duration.toFixed(2)}s，${speed.toFixed(1)} 地址/秒`);
    console.log(`💰 發現 ${withBalance.length} 個有餘額的地址`);
    
    return { results, withBalance, stats: { duration, speed } };
  }

  // 獲取統計信息
  getStats() {
    const stats = {};
    let totalRequests = 0;
    let totalSuccessful = 0;
    
    for (const [apiName, apiStats] of this.apiStats) {
      totalRequests += apiStats.totalRequests;
      totalSuccessful += apiStats.successfulRequests;
      
      stats[apiName] = {
        ...apiStats,
        successRate: apiStats.totalRequests > 0 ? 
          (apiStats.successfulRequests / apiStats.totalRequests * 100).toFixed(2) + '%' : '0%'
      };
    }
    
    const overallSuccessRate = totalRequests > 0 ? 
      (totalSuccessful / totalRequests * 100).toFixed(1) + '%' : '0%';
    
    return {
      apis: stats,
      overall: {
        totalRequests,
        successfulRequests: totalSuccessful,
        successRate: overallSuccessRate
      },
      queue: {
        pending: this.queue.length,
        processing: this.activeRequests,
        maxConcurrent: this.maxConcurrent,
        dynamicScaling: this.dynamicScaling
      },
      cache: {
        size: this.cache.size,
        expiryTime: this.cacheExpiry / 1000 + 's'
      },
      performance: {
        queueGrowthRate: this.queueGrowthRate,
        lastQueueSize: this.lastQueueSize,
        recentPerformance: this.performanceHistory.slice(-5)
      }
    };
  }

  // 批量地址檢查優化
  async batchCheckBalances(addresses, type = 'bitcoin', batchSize = 100) {
    console.log(`🚀 批量檢查模式: ${addresses.length} 個地址，批次大小: ${batchSize}`);
    
    const results = [];
    const startTime = Date.now();
    
    // 分批處理
    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      const batchPromises = batch.map(address => 
        this.checkBalance(address, type).catch(error => ({
          address,
          error: error.message,
          hasBalance: false,
          type
        }))
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // 批次間短暫延遲，避免過度負載
      if (i + batchSize < addresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // 顯示進度
      const progress = Math.min(i + batchSize, addresses.length);
      const percentage = (progress / addresses.length * 100).toFixed(1);
      console.log(`📊 批量檢查進度: ${progress}/${addresses.length} (${percentage}%)`);
    }
    
    const duration = (Date.now() - startTime) / 1000;
    const speed = addresses.length / duration;
    const withBalance = results.filter(result => result.hasBalance);
    
    console.log(`✅ 批量檢查完成: ${addresses.length} 個地址，${duration.toFixed(2)}s，${speed.toFixed(1)} 地址/秒`);
    console.log(`💰 發現 ${withBalance.length} 個有餘額的地址`);
    
    return { results, withBalance, stats: { duration, speed } };
  }

  // 清理緩存
  clearExpiredCache() {
    const now = Date.now();
    for (const [key, value] of this.cache) {
      if (now - value.timestamp > this.cacheExpiry) {
        this.cache.delete(key);
      }
    }
  }

  // 停止處理
  stop() {
    this.processing = false;
    
    // 清理定時器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
    }
  }

  // 啟動隊列監控
  startQueueMonitoring() {
    this.monitorTimer = setInterval(() => {
      const queueSize = this.queue.length;
      const activeRequests = this.activeRequests;
      
      // 隊列積壓警告
      if (queueSize > 500) {
        console.warn(`⚠️ 隊列積壓嚴重: ${queueSize} 個待處理，${activeRequests} 個處理中`);
      }
      
      // 自動清理過期緩存
      if (this.cache.size > 1000) {
        this.clearExpiredCache();
      }
    }, 10000); // 每10秒檢查一次
  }
}

module.exports = AdvancedBalanceChecker;
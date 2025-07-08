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
        name: 'BTCExplorer',
        url: 'https://blockexplorer.com/api',
        rateLimit: 30,
        priority: 4
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

    // 智能隊列配置
    this.queue = [];
    this.processing = false;
    this.maxConcurrent = 20; // 最大並發數
    this.activeRequests = 0;
    this.retryAttempts = 3;
    this.baseDelay = 100; // 基礎延遲 ms

    // API 狀態追踪
    this.apiStats = new Map();
    this.initializeAPIStats();

    // 緩存系統
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5分鐘緩存

    // 開始處理隊列
    this.startQueueProcessor();
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
      if (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
        const request = this.queue.shift();
        this.activeRequests++;
        
        // 異步處理請求
        this.processRequest(request)
          .finally(() => {
            this.activeRequests--;
          });
      }
      
      // 短暫延遲避免 CPU 過載
      await new Promise(resolve => setTimeout(resolve, 10));
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
    for (const [apiName, apiStats] of this.apiStats) {
      stats[apiName] = {
        ...apiStats,
        successRate: apiStats.totalRequests > 0 ? 
          (apiStats.successfulRequests / apiStats.totalRequests * 100).toFixed(2) + '%' : '0%'
      };
    }
    
    return {
      apis: stats,
      queue: {
        pending: this.queue.length,
        processing: this.activeRequests,
        maxConcurrent: this.maxConcurrent
      },
      cache: {
        size: this.cache.size,
        expiryTime: this.cacheExpiry / 1000 + 's'
      }
    };
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
  }
}

module.exports = AdvancedBalanceChecker;
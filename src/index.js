const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const WalletGenerator = require('./utils/walletGenerator');
const UltimateBalanceChecker = require('./services/ultimateBalanceChecker');
const AdvancedBalanceChecker = require('./services/advancedBalanceChecker');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中間件
app.use(helmet());
app.use(cors());
app.use(express.json());

// 初始化服務
const walletGenerator = new WalletGenerator();
const ultimateBalanceChecker = new UltimateBalanceChecker();
const advancedBalanceChecker = new AdvancedBalanceChecker();

// 根路由
app.get('/', (req, res) => {
  res.json({
    message: '🚀 Bitcoin Calculator - Web3 Cold Wallet API',
    version: '1.0.0',
    endpoints: {
      '/api/wallet/generate': 'POST - 生成新錢包',
      '/api/wallet/balance/:address': 'GET - 查詢餘額',
      '/api/wallet/verify': 'POST - 驗證錢包可用性',
      '/api/health': 'GET - 健康檢查'
    }
  });
});

// 健康檢查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '1.0.0'
  });
});

// 生成新錢包
app.post('/api/wallet/generate', async (req, res) => {
  try {
    const { count = 1, checkBalance = false } = req.body;
    
    if (count > 100) {
      return res.status(400).json({
        error: '一次最多只能生成100個錢包'
      });
    }
    
    const wallets = [];
    
    for (let i = 0; i < count; i++) {
      const wallet = walletGenerator.generateRandom();
      
      if (checkBalance) {
        try {
          const balanceResult = await ultimateBalanceChecker.checkBalance(wallet.address);
          wallet.balance = balanceResult.balance;
          wallet.hasBalance = balanceResult.balance > 0;
          wallet.apiSource = balanceResult.source;
        } catch (error) {
          wallet.balanceError = error.message;
        }
      }
      
      wallets.push(wallet);
    }
    
    res.json({
      success: true,
      count: wallets.length,
      wallets,
      generated_at: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      error: '錢包生成失敗',
      message: error.message
    });
  }
});

// 查詢餘額
app.get('/api/wallet/balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!address) {
      return res.status(400).json({
        error: '請提供有效的比特幣地址'
      });
    }
    
    const result = await ultimateBalanceChecker.checkBalance(address);
    
    res.json({
      success: true,
      address,
      balance: result.balance,
      hasBalance: result.balance > 0,
      source: result.source,
      checked_at: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      error: '餘額查詢失敗',
      message: error.message
    });
  }
});

// 驗證錢包可用性 (確保地址沒有被使用)
app.post('/api/wallet/verify', async (req, res) => {
  try {
    const { addresses } = req.body;
    
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return res.status(400).json({
        error: '請提供地址數組'
      });
    }
    
    if (addresses.length > 50) {
      return res.status(400).json({
        error: '一次最多只能驗證50個地址'
      });
    }
    
    const results = [];
    
    for (const address of addresses) {
      try {
        const balanceResult = await ultimateBalanceChecker.checkBalance(address);
        
        results.push({
          address,
          balance: balanceResult.balance,
          hasBalance: balanceResult.balance > 0,
          available: balanceResult.balance === 0, // 沒有餘額才可用
          source: balanceResult.source,
          status: 'success'
        });
        
      } catch (error) {
        results.push({
          address,
          available: false,
          error: error.message,
          status: 'error'
        });
      }
    }
    
    const availableCount = results.filter(r => r.available).length;
    
    res.json({
      success: true,
      total: results.length,
      available: availableCount,
      unavailable: results.length - availableCount,
      results,
      checked_at: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      error: '驗證失敗',
      message: error.message
    });
  }
});

// 錯誤處理中間件
app.use((error, req, res, next) => {
  console.error('伺服器錯誤:', error);
  res.status(500).json({
    error: '內部伺服器錯誤',
    message: error.message
  });
});

// 404 處理
app.use((req, res) => {
  res.status(404).json({
    error: '路由不存在',
    path: req.path
  });
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log('🚀 Bitcoin Calculator API 伺服器啟動');
  console.log('====================================');
  console.log(`🌐 端口: ${PORT}`);
  console.log(`🔗 本地地址: http://localhost:${PORT}`);
  console.log(`📊 健康檢查: http://localhost:${PORT}/api/health`);
  console.log(`📖 API 文檔: http://localhost:${PORT}`);
  console.log('====================================\n');
  
  console.log('💡 可用 API 端點:');
  console.log('   POST /api/wallet/generate     - 生成新錢包');
  console.log('   GET  /api/wallet/balance/:addr - 查詢餘額');
  console.log('   POST /api/wallet/verify       - 驗證錢包可用性');
  console.log('   GET  /api/health              - 健康檢查\n');
});

module.exports = app;
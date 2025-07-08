const axios = require('axios');
const { ethers } = require('ethers');

class BalanceChecker {
  constructor() {
    this.btcApiUrl = 'https://blockstream.info/api';
    this.ethApiUrl = 'https://api.etherscan.io/api';
    this.ethApiKey = process.env.ETHERSCAN_API_KEY;
    this.provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL || 'https://eth-mainnet.alchemyapi.io/v2/YOUR-API-KEY');
  }

  async checkBitcoinBalance(address) {
    try {
      const response = await axios.get(`${this.btcApiUrl}/address/${address}`);
      const data = response.data;
      
      const balance = {
        address,
        confirmed: data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum,
        unconfirmed: data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum,
        total: (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) + 
               (data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum)
      };
      
      return {
        ...balance,
        balanceInBTC: balance.total / 100000000,
        hasBalance: balance.total > 0,
        type: 'bitcoin'
      };
    } catch (error) {
      console.error(`Bitcoin balance check failed for ${address}:`, error.message);
      return {
        address,
        confirmed: 0,
        unconfirmed: 0,
        total: 0,
        balanceInBTC: 0,
        hasBalance: false,
        type: 'bitcoin',
        error: error.message
      };
    }
  }

  async checkEthereumBalance(address) {
    try {
      let balance;
      
      if (this.ethApiKey) {
        const response = await axios.get(`${this.ethApiUrl}`, {
          params: {
            module: 'account',
            action: 'balance',
            address: address,
            tag: 'latest',
            apikey: this.ethApiKey
          }
        });
        
        if (response.data.status === '1') {
          balance = response.data.result;
        } else {
          throw new Error(response.data.message || 'Etherscan API error');
        }
      } else {
        balance = await this.provider.getBalance(address);
        balance = balance.toString();
      }
      
      const balanceInETH = ethers.formatEther(balance);
      
      return {
        address,
        balance: balance,
        balanceInETH: parseFloat(balanceInETH),
        hasBalance: parseFloat(balanceInETH) > 0,
        type: 'ethereum'
      };
    } catch (error) {
      console.error(`Ethereum balance check failed for ${address}:`, error.message);
      return {
        address,
        balance: '0',
        balanceInETH: 0,
        hasBalance: false,
        type: 'ethereum',
        error: error.message
      };
    }
  }

  async checkBalance(address, type) {
    switch (type) {
      case 'bitcoin':
        return await this.checkBitcoinBalance(address);
      case 'ethereum':
        return await this.checkEthereumBalance(address);
      default:
        throw new Error(`Unsupported wallet type: ${type}`);
    }
  }

  async checkMultipleBalances(wallets) {
    const results = [];
    
    for (const wallet of wallets) {
      const balance = await this.checkBalance(wallet.address, wallet.type);
      results.push({
        ...wallet,
        balance
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return results;
  }

  async findWalletsWithBalance(wallets, minBalance = 0) {
    const results = await this.checkMultipleBalances(wallets);
    
    return results.filter(wallet => {
      const balance = wallet.type === 'bitcoin' ? 
        wallet.balance.balanceInBTC : 
        wallet.balance.balanceInETH;
      
      return balance > minBalance;
    });
  }
}

module.exports = BalanceChecker;
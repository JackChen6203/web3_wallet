const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const os = require('os');

class WorkerWalletGenerator {
  constructor() {
    this.maxWorkers = os.cpus().length; // 使用所有 CPU 核心
    this.batchSize = 1000;
  }

  // 並行生成錢包 (CPU 多核加速)
  async generateWalletsBatch(count) {
    const startTime = Date.now();
    const workers = [];
    const chunkSize = Math.ceil(count / this.maxWorkers);
    
    console.log(`🚀 使用 ${this.maxWorkers} 個 Worker 線程並行生成 ${count} 個錢包`);
    
    for (let i = 0; i < this.maxWorkers; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, count);
      
      if (start < end) {
        const walletCount = end - start;
        workers.push(this.createWorker(walletCount));
      }
    }
    
    const results = await Promise.all(workers);
    const wallets = results.flat();
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    const speed = wallets.length / duration;
    
    console.log(`✅ 多核並行生成 ${wallets.length} 個錢包，用時 ${duration.toFixed(2)}s，速度 ${speed.toFixed(1)} 錢包/秒`);
    
    return wallets;
  }

  // 創建 Worker
  createWorker(count) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: { count }
      });
      
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker 異常退出: ${code}`));
        }
      });
    });
  }

  // 確定性生成錢包 (適合大規模掃描)
  generateWalletAtIndex(index) {
    const seedBuffer = Buffer.alloc(32);
    seedBuffer.writeUInt32BE(Math.floor(index / 0x100000000), 0);
    seedBuffer.writeUInt32BE(index & 0xffffffff, 4);
    
    // 使用機器特定的鹽值
    const machineId = os.hostname() + os.platform();
    const salt = crypto.createHash('sha256').update(machineId).digest();
    
    // 混合索引和機器鹽值
    const combined = Buffer.concat([seedBuffer, salt]);
    const privateKey = crypto.createHash('sha256').update(combined).digest();
    
    try {
      const keyPair = bitcoin.ECPair.fromPrivateKey(privateKey);
      const { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey });
      
      return {
        index: index,
        address: address,
        privateKey: keyPair.toWIF(),
        publicKey: keyPair.publicKey.toString('hex'),
        timestamp: Date.now()
      };
    } catch (error) {
      // 如果私鑰無效，遞歸生成下一個
      return this.generateWalletAtIndex(index + 1);
    }
  }

  // 批次確定性生成 (多核加速)
  async generateDeterministicBatch(startIndex, count) {
    const workers = [];
    const chunkSize = Math.ceil(count / this.maxWorkers);
    
    for (let i = 0; i < this.maxWorkers; i++) {
      const start = startIndex + (i * chunkSize);
      const walletCount = Math.min(chunkSize, count - (i * chunkSize));
      
      if (walletCount > 0) {
        workers.push(this.createDeterministicWorker(start, walletCount));
      }
    }
    
    const results = await Promise.all(workers);
    return results.flat().sort((a, b) => a.index - b.index);
  }

  // 創建確定性 Worker
  createDeterministicWorker(startIndex, count) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: { startIndex, count, deterministic: true }
      });
      
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker 異常退出: ${code}`));
        }
      });
    });
  }
}

// Worker 線程處理邏輯
if (!isMainThread) {
  const { count, startIndex, deterministic } = workerData;
  const wallets = [];
  
  if (deterministic) {
    // 確定性生成
    const generator = new WorkerWalletGenerator();
    for (let i = 0; i < count; i++) {
      try {
        const wallet = generator.generateWalletAtIndex(startIndex + i);
        wallets.push(wallet);
      } catch (error) {
        continue;
      }
    }
  } else {
    // 隨機生成
    for (let i = 0; i < count; i++) {
      try {
        const keyPair = bitcoin.ECPair.makeRandom();
        const { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey });
        
        wallets.push({
          address: address,
          privateKey: keyPair.toWIF(),
          publicKey: keyPair.publicKey.toString('hex'),
          type: 'bitcoin'
        });
      } catch (error) {
        continue;
      }
    }
  }
  
  parentPort.postMessage(wallets);
}

module.exports = WorkerWalletGenerator;
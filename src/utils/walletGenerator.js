const bitcoin = require('bitcoinjs-lib');
const { ethers } = require('ethers');
const bip39 = require('bip39');
const hdkey = require('hdkey');
const crypto = require('crypto');

class WalletGenerator {
  constructor() {
    // Instance-based wallet generator for compatibility with test files
  }

  // Instance methods for test compatibility
  generateRandom() {
    return WalletGenerator.generateBitcoinWallet();
  }

  generateFromIndex(index) {
    // Generate deterministic wallet from index for distributed testing
    const seed = crypto.createHash('sha256').update(index.toString()).digest();
    const keyPair = bitcoin.ECPair.fromPrivateKey(seed);
    const privateKey = keyPair.toWIF();
    const publicKey = keyPair.publicKey.toString('hex');
    const { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey });
    
    return {
      index,
      privateKey,
      publicKey,
      address,
      type: 'bitcoin'
    };
  }

  static generateBitcoinWallet() {
    try {
      const keyPair = bitcoin.ECPair.makeRandom();
      const privateKey = keyPair.toWIF();
      const publicKey = keyPair.publicKey.toString('hex');
      
      const { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey });
      
      return {
        privateKey,
        publicKey,
        address,
        type: 'bitcoin'
      };
    } catch (error) {
      throw new Error(`Bitcoin wallet generation failed: ${error.message}`);
    }
  }

  static generateEthereumWallet() {
    try {
      const wallet = ethers.Wallet.createRandom();
      
      return {
        privateKey: wallet.privateKey,
        publicKey: wallet.publicKey,
        address: wallet.address,
        type: 'ethereum'
      };
    } catch (error) {
      throw new Error(`Ethereum wallet generation failed: ${error.message}`);
    }
  }

  static generateHDWallet() {
    try {
      const mnemonic = bip39.generateMnemonic();
      return this.generateHDWalletFromMnemonic(mnemonic);
    } catch (error) {
      throw new Error(`HD wallet generation failed: ${error.message}`);
    }
  }

  static generateHDWalletFromMnemonic(mnemonic) {
    try {
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const hdWallet = hdkey.fromMasterSeed(seed);
      
      const bitcoinPath = "m/44'/0'/0'/0/0";
      const ethereumPath = "m/44'/60'/0'/0/0";
      
      const bitcoinWallet = hdWallet.derive(bitcoinPath);
      const ethereumWallet = hdWallet.derive(ethereumPath);
      
      const bitcoinKeyPair = bitcoin.ECPair.fromPrivateKey(bitcoinWallet.privateKey);
      const { address: bitcoinAddress } = bitcoin.payments.p2pkh({ pubkey: bitcoinKeyPair.publicKey });
      
      const ethereumPrivateKey = '0x' + ethereumWallet.privateKey.toString('hex');
      const ethereumWalletObj = new ethers.Wallet(ethereumPrivateKey);
      
      return {
        mnemonic,
        bitcoin: {
          privateKey: bitcoinKeyPair.toWIF(),
          publicKey: bitcoinKeyPair.publicKey.toString('hex'),
          address: bitcoinAddress,
          type: 'bitcoin'
        },
        ethereum: {
          privateKey: ethereumPrivateKey,
          publicKey: ethereumWalletObj.publicKey,
          address: ethereumWalletObj.address,
          type: 'ethereum'
        }
      };
    } catch (error) {
      throw new Error(`HD wallet generation failed: ${error.message}`);
    }
  }

  static generateRandomWallets(count = 1) {
    const wallets = [];
    
    for (let i = 0; i < count; i++) {
      const coinType = Math.random() < 0.5 ? 'bitcoin' : 'ethereum';
      if (coinType === 'bitcoin') {
        wallets.push(this.generateBitcoinWallet());
      } else {
        wallets.push(this.generateEthereumWallet());
      }
    }
    
    return wallets;
  }
}

module.exports = WalletGenerator;
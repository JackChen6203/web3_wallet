const { createClient } = require('@supabase/supabase-js');

class SupabaseService {
  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL;
    this.supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    if (!this.supabaseUrl || !this.supabaseKey) {
      throw new Error('Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.');
    }
    
    this.supabase = createClient(this.supabaseUrl, this.supabaseKey);
  }

  async saveWalletData(walletData) {
    try {
      const { data, error } = await this.supabase
        .from('wallets')
        .insert([{
          address: walletData.address,
          private_key: walletData.privateKey,
          public_key: walletData.publicKey,
          wallet_type: walletData.type,
          balance: walletData.balance.hasBalance ? 
            (walletData.type === 'bitcoin' ? walletData.balance.balanceInBTC : walletData.balance.balanceInETH) : 0,
          balance_raw: walletData.balance.hasBalance ? 
            (walletData.type === 'bitcoin' ? walletData.balance.total : walletData.balance.balance) : '0',
          has_balance: walletData.balance.hasBalance,
          assigned_to_user: false,
          assigned_user_id: null,
          assigned_at: null,
          created_at: new Date().toISOString(),
          last_checked: new Date().toISOString()
        }]);

      if (error) {
        throw new Error(`Supabase insert error: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('Failed to save wallet data:', error);
      throw error;
    }
  }

  async checkWalletExists(address) {
    try {
      const { data, error } = await this.supabase
        .from('wallets')
        .select('address, has_balance')
        .eq('address', address)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw new Error(`Supabase query error: ${error.message}`);
      }

      return data ? true : false;
    } catch (error) {
      console.error('Failed to check wallet existence:', error);
      return false;
    }
  }

  async getWalletsWithBalance(limit = 100) {
    try {
      const { data, error } = await this.supabase
        .from('wallets')
        .select('*')
        .eq('has_balance', true)
        .eq('assigned_to_user', false)
        .limit(limit)
        .order('created_at', { ascending: true });

      if (error) {
        throw new Error(`Supabase query error: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('Failed to get wallets with balance:', error);
      throw error;
    }
  }

  async reserveWalletForUser(walletAddress, userId) {
    try {
      const { data, error } = await this.supabase
        .from('wallets')
        .update({
          assigned_to_user: true,
          assigned_user_id: userId,
          assigned_at: new Date().toISOString()
        })
        .eq('address', walletAddress)
        .eq('assigned_to_user', false)
        .select();

      if (error) {
        throw new Error(`Supabase wallet reservation error: ${error.message}`);
      }

      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error('Failed to reserve wallet for user:', error);
      throw error;
    }
  }

  async getAvailableWalletWithLock(walletType = null) {
    try {
      // Use RPC function for atomic wallet selection with row-level locking
      const { data, error } = await this.supabase
        .rpc('get_and_lock_wallet', {
          wallet_type_filter: walletType
        });

      if (error) {
        throw new Error(`Supabase RPC error: ${error.message}`);
      }

      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error('Failed to get available wallet with lock:', error);
      throw error;
    }
  }

  async createUserWithWalletTransaction(userData, walletAddress) {
    try {
      // Use RPC function for atomic user creation and wallet reservation
      const { data, error } = await this.supabase
        .rpc('create_user_with_wallet_transaction', {
          user_email: userData.email,
          user_password_hash: userData.passwordHash,
          wallet_address: walletAddress,
          wallet_type: userData.walletType
        });

      if (error) {
        throw new Error(`Transaction failed: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('Failed to create user with wallet transaction:', error);
      throw error;
    }
  }

  async updateWalletBalance(address, balanceData) {
    try {
      const { data, error } = await this.supabase
        .from('wallets')
        .update({
          balance: balanceData.hasBalance ? 
            (balanceData.type === 'bitcoin' ? balanceData.balanceInBTC : balanceData.balanceInETH) : 0,
          balance_raw: balanceData.hasBalance ? 
            (balanceData.type === 'bitcoin' ? balanceData.total : balanceData.balance) : '0',
          has_balance: balanceData.hasBalance,
          last_checked: new Date().toISOString()
        })
        .eq('address', address);

      if (error) {
        throw new Error(`Supabase update error: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('Failed to update wallet balance:', error);
      throw error;
    }
  }

  async saveUser(userData) {
    try {
      const { data, error } = await this.supabase
        .from('users')
        .insert([{
          email: userData.email,
          password_hash: userData.passwordHash,
          wallet_address: userData.walletAddress,
          wallet_type: userData.walletType,
          created_at: new Date().toISOString()
        }])
        .select();

      if (error) {
        throw new Error(`Supabase user insert error: ${error.message}`);
      }

      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error('Failed to save user:', error);
      throw error;
    }
  }

  async getUserByEmail(email) {
    try {
      const { data, error } = await this.supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw new Error(`Supabase query error: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('Failed to get user by email:', error);
      return null;
    }
  }

  async initializeTables() {
    try {
      const walletsTableSQL = `
        CREATE TABLE IF NOT EXISTS wallets (
          id SERIAL PRIMARY KEY,
          address VARCHAR(255) UNIQUE NOT NULL,
          private_key TEXT NOT NULL,
          public_key TEXT NOT NULL,
          wallet_type VARCHAR(50) NOT NULL,
          balance DECIMAL(20,8) DEFAULT 0,
          balance_raw TEXT DEFAULT '0',
          has_balance BOOLEAN DEFAULT FALSE,
          assigned_to_user BOOLEAN DEFAULT FALSE,
          assigned_user_id INTEGER DEFAULT NULL,
          assigned_at TIMESTAMP DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_has_balance_assigned (has_balance, assigned_to_user),
          INDEX idx_wallet_type (wallet_type),
          INDEX idx_assigned_user (assigned_user_id)
        );
      `;

      const usersTableSQL = `
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          wallet_address VARCHAR(255) NOT NULL,
          wallet_type VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (wallet_address) REFERENCES wallets(address)
        );
      `;

      console.log('Database tables initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize database tables:', error);
      throw error;
    }
  }
}

module.exports = SupabaseService;
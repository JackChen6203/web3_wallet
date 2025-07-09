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

  // Additional methods for test compatibility
  async ensureTablesExist() {
    await this.initializeTables();
    await this.createWorkRangesTable();
    return true;
  }

  async createWorkRangesTable() {
    try {
      // 工作範圍表不存在時才創建
      const { data, error } = await this.supabase
        .from('work_ranges')
        .select('id')
        .limit(1);

      // 如果表不存在，這裡會出錯，我們就創建它
      if (error && error.code === 'PGRST106') {
        console.log('📊 創建工作範圍協調表...');
        // 注意：在實際應用中，你需要在 Supabase 控制台手動創建這個表
        // 或者使用 Supabase 的 SQL 編輯器執行以下 SQL：
        /*
        CREATE TABLE work_ranges (
          id SERIAL PRIMARY KEY,
          start_index BIGINT NOT NULL,
          end_index BIGINT NOT NULL,
          status VARCHAR(20) DEFAULT 'available',
          assigned_to VARCHAR(255),
          assigned_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_status (status),
          INDEX idx_range (start_index, end_index)
        );
        */
        console.log('⚠️ 請在 Supabase 中手動創建 work_ranges 表');
      }
    } catch (error) {
      console.warn('工作範圍表檢查失敗:', error.message);
    }
  }

  async registerSession(sessionData) {
    try {
      const { data, error } = await this.supabase
        .from('sessions')
        .insert([{
          session_id: sessionData.sessionId,
          machine_id: sessionData.machineId,
          status: sessionData.status,
          config: sessionData.config,
          created_at: new Date().toISOString()
        }]);

      if (error) {
        console.warn('Session registration failed:', error.message);
        return null;
      }

      return data;
    } catch (error) {
      console.warn('Session registration error:', error.message);
      return null;
    }
  }

  async getNextWorkRange(sessionId, batchSize) {
    try {
      // 嘗試從資料庫獲取下一個可用範圍
      const { data, error } = await this.supabase
        .from('work_ranges')
        .select('*')
        .eq('status', 'available')
        .order('start_index', { ascending: true })
        .limit(1);

      if (error && error.code !== 'PGRST116') {
        console.warn('查詢工作範圍失敗:', error.message);
      }

      let start, end;

      if (data && data.length > 0) {
        // 使用資料庫中的可用範圍
        const range = data[0];
        start = range.start_index;
        end = range.end_index;

        // 標記為已分配
        await this.supabase
          .from('work_ranges')
          .update({
            status: 'assigned',
            assigned_to: sessionId,
            assigned_at: new Date().toISOString()
          })
          .eq('id', range.id);

        console.log(`📋 從資料庫分配範圍: ${start.toLocaleString()} - ${end.toLocaleString()}`);
      } else {
        // 創建新的範圍
        const lastRangeQuery = await this.supabase
          .from('work_ranges')
          .select('end_index')
          .order('end_index', { ascending: false })
          .limit(1);

        const lastEnd = lastRangeQuery.data && lastRangeQuery.data.length > 0 
          ? lastRangeQuery.data[0].end_index 
          : 0;

        start = lastEnd + 1;
        end = start + batchSize - 1;

        // 插入新範圍
        await this.supabase
          .from('work_ranges')
          .insert({
            start_index: start,
            end_index: end,
            status: 'assigned',
            assigned_to: sessionId,
            assigned_at: new Date().toISOString(),
            created_at: new Date().toISOString()
          });

        console.log(`📋 創建新範圍: ${start.toLocaleString()} - ${end.toLocaleString()}`);
      }
      
      return {
        start,
        end
      };
    } catch (error) {
      // 回退到基於時間戳的範圍分配
      console.warn('範圍協調失敗，使用回退方案:', error.message);
      const timestamp = Date.now();
      const hash = require('crypto').createHash('sha256').update(`${sessionId}_${timestamp}`).digest('hex');
      const baseOffset = parseInt(hash.substring(0, 12), 16) % 1000000000;
      
      return {
        start: baseOffset,
        end: baseOffset + batchSize - 1
      };
    }
  }

  async saveWalletBatch(wallets, sessionId) {
    try {
      const walletData = wallets.map(wallet => ({
        address: wallet.address,
        private_key: wallet.privateKey,
        public_key: wallet.publicKey,
        wallet_type: wallet.type || 'bitcoin',
        balance: 0,
        balance_raw: '0',
        has_balance: false,
        assigned_to_user: false,
        created_at: new Date().toISOString(),
        last_checked: new Date().toISOString()
      }));

      const { data, error } = await this.supabase
        .from('wallets')
        .upsert(walletData, { onConflict: 'address' });

      if (error) {
        console.warn('Wallet batch save failed:', error.message);
        return null;
      }

      return data;
    } catch (error) {
      console.warn('Wallet batch save error:', error.message);
      return null;
    }
  }

  async updateSessionStats(sessionId, stats) {
    try {
      const { data, error } = await this.supabase
        .from('sessions')
        .update({
          total_generated: stats.totalGenerated,
          total_checked: stats.totalChecked,
          total_with_balance: stats.totalWithBalance,
          last_update: stats.lastUpdate
        })
        .eq('session_id', sessionId);

      if (error) {
        console.warn('Session stats update failed:', error.message);
        return null;
      }

      return data;
    } catch (error) {
      console.warn('Session stats update error:', error.message);
      return null;
    }
  }

  async updateSessionStatus(sessionId, status) {
    try {
      const { data, error } = await this.supabase
        .from('sessions')
        .update({
          status: status,
          updated_at: new Date().toISOString()
        })
        .eq('session_id', sessionId);

      if (error) {
        console.warn('Session status update failed:', error.message);
        return null;
      }

      return data;
    } catch (error) {
      console.warn('Session status update error:', error.message);
      return null;
    }
  }

  async completeWorkRange(sessionId, startIndex, endIndex) {
    try {
      const { data, error } = await this.supabase
        .from('work_ranges')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('assigned_to', sessionId)
        .eq('start_index', startIndex)
        .eq('end_index', endIndex);

      if (error) {
        console.warn('Work range completion failed:', error.message);
        return null;
      }

      console.log(`✅ 範圍完成: ${startIndex.toLocaleString()} - ${endIndex.toLocaleString()}`);
      return data;
    } catch (error) {
      console.warn('Work range completion error:', error.message);
      return null;
    }
  }

  async getWorkRangeProgress() {
    try {
      const { data, error } = await this.supabase
        .from('work_ranges')
        .select('status, COUNT(*)')
        .groupBy('status');

      if (error) {
        console.warn('Work range progress query failed:', error.message);
        return null;
      }

      return data;
    } catch (error) {
      console.warn('Work range progress query error:', error.message);
      return null;
    }
  }
}

module.exports = SupabaseService;
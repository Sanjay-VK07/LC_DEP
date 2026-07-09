const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

let pool = null;
let isConnected = false;
let isConnecting = false;
let lastError = null;
let retryCount = 0;
let retryTimer = null;

async function executeSchema(activePool) {
  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.warn(`[DB] Schema file not found at: ${schemaPath}`);
    return;
  }

  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  let connection;
  try {
    connection = await activePool.getConnection();
    console.log('[DB] Initializing database schema and seeding...');
    // We can execute multiple statements directly because multipleStatements: true is enabled
    await connection.query(schemaSql);
    console.log('[DB] Database schema initialized and seeded successfully.');
  } catch (err) {
    console.error('[DB] Error executing schema script:', err.message);
  } finally {
    if (connection) connection.release();
  }
}

async function initializeDatabase() {
  if (isConnected) return;
  if (isConnecting) return;

  isConnecting = true;
  lastError = null;

  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD === 'your_mysql_password_here' ? '' : process.env.DB_PASSWORD,
    multipleStatements: true
  };

  console.log(`[DB] Attempting database initialization (Attempt #${retryCount + 1})...`);
  console.log(`[DB] Connecting to host: ${config.host}:${config.port} as user: ${config.user}`);

  try {
    // 1. Connect without db name to ensure DB exists
    const tempConnection = await mysql.createConnection(config);
    console.log('[DB] Successfully connected to MySQL Server.');
    
    const dbName = process.env.DB_NAME || 'leetcode_attendance';
    await tempConnection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    console.log(`[DB] Database '${dbName}' ensured.`);
    await tempConnection.end();

    // 2. Setup the connection pool with the database selected
    pool = mysql.createPool({
      ...config,
      database: dbName,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    // 3. Test pool connection
    const testConn = await pool.getConnection();
    testConn.release();

    isConnected = true;
    isConnecting = false;
    retryCount = 0;
    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }

    console.log('[DB] MySQL connection pool initialized successfully.');

    // 4. Run schema setup
    let schemaNeeded = false;
    // Skip schema if explicitly told to (e.g., during migration runs)
    if (process.env.SKIP_SCHEMA_INIT === 'true') {
      console.log('[DB] Skipping schema initialization (SKIP_SCHEMA_INIT=true).');
    } else {
      try {
        const conn = await pool.getConnection();
        try {
          await conn.query("SELECT 1 FROM Users LIMIT 1");
        } catch (err) {
          schemaNeeded = true;
        } finally {
          conn.release();
        }
      } catch (err) {
        schemaNeeded = true;
      }

      if (schemaNeeded) {
        await executeSchema(pool);
      } else {
        console.log('[DB] Database tables already exist. Skipping schema initialization.');
      }
    }

    // Check if Users table exists (migration 3 renames students -> Users)
    // Only create dependent tables if Users exists, otherwise skip until migration runs
    let usersTableExists = false;
    try {
      const conn2 = await pool.getConnection();
      try {
        await conn2.query("SELECT 1 FROM Users LIMIT 1");
        usersTableExists = true;
      } catch (e) {
        usersTableExists = false;
      } finally {
        conn2.release();
      }
    } catch (e) {
      usersTableExists = false;
    }

    if (usersTableExists) {
      // Ensure StudentPlatformSync table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS StudentPlatformSync (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          platform VARCHAR(50) NOT NULL,
          username VARCHAR(255) DEFAULT NULL,
          sync_status VARCHAR(20) DEFAULT 'Never Synced',
          last_successful_sync TIMESTAMP NULL DEFAULT NULL,
          last_attempt TIMESTAMP NULL DEFAULT NULL,
          retry_count INT DEFAULT 0,
          failure_reason TEXT DEFAULT NULL,
          failure_category VARCHAR(100) DEFAULT NULL,
          data_completeness INT DEFAULT 0,
          next_retry TIMESTAMP NULL DEFAULT NULL,
          UNIQUE KEY idx_user_platform (user_id, platform),
          FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
      `);

      // Ensure contest_attendance table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contest_attendance (
          id INT AUTO_INCREMENT PRIMARY KEY,
          contest_slug VARCHAR(255) NOT NULL,
          student_id INT NOT NULL,
          leetcode_username VARCHAR(255) NOT NULL,
          attendance ENUM('PRESENT', 'ABSENT') NOT NULL,
          \`rank\` INT DEFAULT NULL,
          score DECIMAL(10,2) DEFAULT NULL,
          finish_time INT DEFAULT NULL,
          synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_student_contest_slug_idx (student_id, contest_slug),
          FOREIGN KEY (student_id) REFERENCES Users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
      `);
    } else {
      console.log('[DB] Users table not yet available (pending migration). Skipping dependent table creation.');
    }

  } catch (error) {
    isConnecting = false;
    isConnected = false;
    pool = null;
    lastError = error;
    retryCount++;

    console.error('[DB] Failed to initialize database connection.');
    
    // Parse error for clear, friendly diagnostics
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error(`[DB DIAGNOSTIC] ACCESS DENIED: The password provided for user '${config.user}' is incorrect or user is not allowed to connect from this host. Please verify DB_USER and DB_PASSWORD in backend/.env.`);
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.error(`[DB DIAGNOSTIC] CONNECTION REFUSED: Could not reach MySQL server at ${config.host}:${config.port}. Ensure that the MySQL service (e.g. MYSQL80) is running and the host/port are correct.`);
    } else {
      console.error(`[DB DIAGNOSTIC] ERROR ${error.code || 'UNKNOWN'}: ${error.message}`);
    }

    // Schedule background retry
    if (!retryTimer) {
      console.log('[DB] Starting background database reconnection scheduler (retrying every 5 seconds)...');
      retryTimer = setInterval(() => {
        initializeDatabase().catch(err => console.error('[DB Retry Error]', err.message));
      }, 5000);
    }
  }
}

// Helper function to query the pool
async function query(sql, params) {
  if (!pool || !isConnected) {
    const errorMsg = 'Database connection is currently unavailable. Please verify your credentials in backend/.env and ensure the MySQL service is running.';
    console.error(`[DB QUERY ERROR] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  const placeholderCount = (sql.match(/\?/g) || []).length;
  const paramCount = (params || []).length;

  // Diagnostic logging
  console.log('--- DB Query Audit ---');
  console.log('SQL Statement:', sql.trim());
  console.log('Placeholders Count:', placeholderCount);
  console.log('Supplied Values Count:', paramCount);
  console.log('Supplied Values:', JSON.stringify(params || []));
  console.log('----------------------');

  if (placeholderCount !== paramCount) {
    const auditError = new Error(`Column count / Placeholder count mismatch. SQL has ${placeholderCount} placeholders but ${paramCount} values were supplied.`);
    console.error('======================================================================');
    console.error('DIAGNOSTIC REPORT: QUERY PRE-VALIDATION FAILURE');
    console.error('SQL:', sql);
    console.error('Placeholder Count:', placeholderCount);
    console.error('Value Count:', paramCount);
    console.error('Values:', params);
    console.error('======================================================================');
    throw auditError;
  }
  
  try {
    const [results] = await pool.execute(sql, params);
    return results;
  } catch (err) {
    console.error('======================================================================');
    console.error('DIAGNOSTIC REPORT: DATABASE QUERY EXECUTION FAILURE');
    console.error('SQL:', sql);
    console.error('Placeholder Count:', placeholderCount);
    console.error('Value Count:', paramCount);
    console.error('Values:', params);
    console.error('Database Error:', err.message);
    console.error('======================================================================');
    throw err;
  }
}

module.exports = {
  initializeDatabase,
  query,
  getPool: () => pool,
  getConnectionStatus: () => ({
    isConnected,
    isConnecting,
    retryCount,
    lastError: lastError ? {
      code: lastError.code,
      message: lastError.message
    } : null
  })
};

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const certPath = path.join(__dirname, '../certs/ca.pem');
let sslCA = null;

if (fs.existsSync(certPath)) {
  try {
    sslCA = fs.readFileSync(certPath);
  } catch (err) {
    console.error('[DB] Error reading CA certificate:', err.message);
  }
}

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

async function seedDefaultDataIfNeeded(activePool) {
  console.log('[DB] Running self-healing default data checks...');
  try {
    // 1. Check & Seed Default College
    try {
      await activePool.query(`
        INSERT IGNORE INTO colleges (name, code)
        VALUES ('Default Engineering College', 'DEC')
      `);
      console.log('[DB] Verified default college (DEC) seeding.');
    } catch (err) {
      console.warn('[DB] Skipping college seeding (table may not exist yet):', err.message);
    }

    // 2. Check & Seed Default 12 Departments
    try {
      const defaultDepts = [
        ['CSE', 'Computer Science Engineering', 'active'],
        ['CSBS', 'Computer Science & Business Systems', 'active'],
        ['AIDS', 'Artificial Intelligence & Data Science', 'active'],
        ['AIML', 'Artificial Intelligence & Machine Learning', 'active'],
        ['CYBER', 'Cyber Security', 'active'],
        ['IT', 'Information Technology', 'active'],
        ['ECE', 'Electronics & Communication Engineering', 'active'],
        ['EEE', 'Electrical & Electronics Engineering', 'active'],
        ['BME', 'Biomedical Engineering', 'active'],
        ['MECH', 'Mechanical Engineering', 'active'],
        ['CIVIL', 'Civil Engineering', 'active'],
        ['BIOTECH', 'Biotechnology', 'active']
      ];

      for (const [code, name, status] of defaultDepts) {
        await activePool.query(
          `INSERT IGNORE INTO departments (code, name, status) VALUES (?, ?, ?)`,
          [code, name, status]
        );
      }
      
      const [rows] = await activePool.query('SELECT COUNT(*) as count FROM departments');
      const count = rows[0]?.count || 0;
      console.log(`[DB] Verified default departments seeding. Total departments in database: ${count}`);
    } catch (err) {
      console.warn('[DB] Skipping departments seeding (table may not exist yet):', err.message);
    }
  } catch (err) {
    console.error('[DB] Error in seedDefaultDataIfNeeded:', err.message);
  }
}

async function initializeDatabase() {
  if (isConnected) return;
  if (isConnecting) return;

  isConnecting = true;
  lastError = null;

  if (!sslCA) {
    const errorMsg = 'Aiven CA certificate not found. Expected location: backend/certs/ca.pem. Download it from the Aiven Console and place it in the certs directory.';
    console.error(`\n======================================================================\n[ERROR] ${errorMsg}\n======================================================================\n`);
    const missingCertError = new Error(errorMsg);
    lastError = missingCertError;
    isConnecting = false;
    isConnected = false;
    pool = null;
    throw missingCertError;
  }

  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD === 'your_mysql_password_here' ? '' : process.env.DB_PASSWORD,
    multipleStatements: true,
    ssl: {
      ca: sslCA,
      rejectUnauthorized: false
    }
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

    pool = mysql.createPool({
      ...config,
      database: dbName,
      waitForConnections: true,
      connectionLimit: process.env.DB_CONNECTION_LIMIT ? parseInt(process.env.DB_CONNECTION_LIMIT, 10) : 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0
    });

    const originalEnd = pool.end;
    pool.end = async function(...args) {
      if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = null;
      }
      isConnected = false;
      isConnecting = false;
      return originalEnd.apply(this, args);
    };

    // 3. Test pool connection
    const testConn = await pool.getConnection();

    // Run verification queries
    const [versionRows] = await testConn.query("SELECT @@version");
    const mysqlVersion = versionRows[0]['@@version'] || 'Unknown';

    const [dbRows] = await testConn.query("SELECT DATABASE()");
    const currentDb = dbRows[0]['DATABASE()'] || dbRows[0]['database'] || 'Unknown';

    const [sslRows] = await testConn.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    const sslCipher = sslRows[0]?.Value || sslRows[0]?.value || '';

    testConn.release();

    if (!sslCipher) {
      throw new Error('SSL is not enabled on the database connection.');
    }

    isConnected = true;
    isConnecting = false;
    retryCount = 0;
    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }

    console.log('✓ Connected to Aiven MySQL');
    console.log(`Database : ${currentDb}`);
    console.log(`Host     : ${config.host}`);
    console.log(`Version  : MySQL ${mysqlVersion}`);
    console.log(`SSL      : Enabled (${sslCipher})`);

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
      // Add problems_solved column to ContestParticipants if missing
      try {
        await pool.query("ALTER TABLE ContestParticipants ADD COLUMN problems_solved INT DEFAULT 0 AFTER score");
        console.log("[DB] Added problems_solved column to ContestParticipants table.");
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') console.error("[DB] Failed to alter ContestParticipants:", err.message);
      }

      // Add problems_solved column to AttendanceRecords if missing
      try {
        await pool.query("ALTER TABLE AttendanceRecords ADD COLUMN problems_solved INT DEFAULT 0 AFTER score");
        console.log("[DB] Added problems_solved column to AttendanceRecords table.");
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') console.error("[DB] Failed to alter AttendanceRecords:", err.message);
      }

      // Add total_problems column to Contests if missing
      try {
        await pool.query("ALTER TABLE Contests ADD COLUMN total_problems INT DEFAULT 4 AFTER duration");
        console.log("[DB] Added total_problems column to Contests table.");
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') console.error("[DB] Failed to alter Contests:", err.message);
      }

    } else {
      console.log('[DB] Users table not yet available (pending migration). Skipping dependent table creation.');
    }

    // Run self-healing seed default data check
    await seedDefaultDataIfNeeded(pool);

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

function isTransientDbError(err) {
  if (!err) return false;
  const code = err.code || '';
  const message = err.message || '';
  const transientCodes = [
    'ECONNRESET',
    'PROTOCOL_CONNECTION_LOST',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ER_CON_COUNT_ERROR',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
    'PROTOCOL_UNHANDLED_ERROR',
    'EPIPE',
    'EHOSTUNREACH',
    'ENOTFOUND'
  ];
  return (
    transientCodes.includes(code) ||
    err.fatal === true ||
    message.includes('read ECONNRESET') ||
    message.includes('Connection lost') ||
    message.includes('connect ECONNREFUSED')
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function to query the pool with automatic retry for transient errors
async function query(sql, params, options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  let attempt = 0;

  while (true) {
    if (!pool || !isConnected) {
      const errorMsg = 'Database connection is currently unavailable. Please verify your credentials in backend/.env and ensure the MySQL service is running.';
      console.error(`[DB QUERY ERROR] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // Production Safety Firewall for Contests
    const isTestOrDevEnv = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'dev' || !!process.env.NODE_TEST_CONTEXT || process.argv.some(a => String(a).includes('test'));
    if (!isTestOrDevEnv) {
      const isContestInsert = /insert\s+into\s+contests/i.test(sql);
      if (isContestInsert) {
        const testPatterns = [
          /\btest\b/i,
          /\bfail\b/i,
          /\bdummy\b/i,
          /\bmock\b/i,
          /\bsample\b/i,
          /\bdemo\b/i,
          /\bdebug\b/i,
          /\bfake\b/i,
          /\bseed\b/i,
          /\btemporary\b/i
        ];
        for (const param of (params || [])) {
          if (typeof param === 'string') {
            const isMatch = testPatterns.some(pat => pat.test(param));
            if (isMatch) {
              throw new Error(`Production Database Safety Rule: Rejecting contest creation/modification with test-only keywords: "${param}"`);
            }
          }
        }
      }
    }

    // Perform diagnostic placeholder count audit only when DB_QUERY_DEBUG is enabled
    if (process.env.DB_QUERY_DEBUG === 'true') {
      const placeholderCount = (sql.match(/\?/g) || []).length;
      const paramCount = (params || []).length;

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
    }

    try {
      const [results] = await pool.execute(sql, params);
      return results;
    } catch (err) {
      if (isTransientDbError(err) && attempt < maxRetries) {
        attempt++;
        const backoffMs = Math.min(100 * Math.pow(2, attempt) + Math.floor(Math.random() * 50), 2000);
        const sqlSnippet = sql.trim().replace(/\s+/g, ' ').substring(0, 100);
        console.warn(`[DB RETRY] Transient database error detected (Code: ${err.code || 'N/A'}, Message: "${err.message}"). SQL: "${sqlSnippet}...". Retry attempt ${attempt}/${maxRetries} after ${backoffMs}ms...`);
        await sleep(backoffMs);
        continue;
      }

      const placeholderCount = (sql.match(/\?/g) || []).length;
      const paramCount = (params || []).length;
      console.error('======================================================================');
      console.error(`DIAGNOSTIC REPORT: DATABASE QUERY EXECUTION FAILURE (Attempt ${attempt + 1}/${maxRetries + 1})`);
      console.error('SQL:', sql);
      console.error('Placeholder Count:', placeholderCount);
      console.error('Value Count:', paramCount);
      console.error('Values:', params);
      console.error('Database Error Code:', err.code || 'N/A');
      console.error('Database Error Message:', err.message);
      console.error('Fatal:', err.fatal || false);
      console.error('Total Retry Count:', attempt);
      console.error('======================================================================');
      throw err;
    }
  }
}

async function closePool() {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
  if (pool) {
    await pool.end();
    pool = null;
  }
  isConnected = false;
  isConnecting = false;
}

module.exports = {
  initializeDatabase,
  query,
  getPool: () => pool,
  closePool,
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

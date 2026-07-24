# CodeTrack Generic Multi-Platform Verification Architecture

## Overview
CodeTrack provides a generic, decoupled, enterprise-ready handle verification system. The verification framework supports **LeetCode**, **CodeChef**, **Codeforces**, **HackerRank**, and future competitive programming platforms using a plugin registry architecture without requiring schema mutations when adding new platforms.

---

## Core Architecture

```
                          ┌───────────────────────────┐
                          │   Controller / Bulk API   │
                          └─────────────┬─────────────┘
                                        │
                                        ▼
                          ┌───────────────────────────┐
                          │     PlatformValidator     │
                          │   (Orchestrator Service)  │
                          └──────┬─────────────┬──────┘
                                 │             │
                    Cache Check  │             │ API Re-verify (if expired / missing)
                                 ▼             ▼
                   ┌──────────────────┐   ┌───────────────────────────┐
                   │VerificationRepo  │   │     Platform Adapters     │
                   │(HandleVerifications) │   │(LC, CC, CF, HR & Plugins) │
                   └──────────────────┘   └───────────────────────────┘
```

### Components

1. **`PlatformRegistry` (`backend/services/PlatformRegistry.js`)**:
   - Manages platform discovery and specifications (`adapterName`, `regex`, `cacheDays`, `caseSensitive`, `enabled`).
   - Plugin registration interface: `PlatformRegistry.register(spec)`.

2. **`VerificationRepository` (`backend/repositories/VerificationRepository.js`)**:
   - Handles persistence for `HandleVerifications` table.
   - Parameterized SQL queries preventing SQL injection.

3. **`PlatformValidator` (`backend/services/PlatformValidator.js`)**:
   - Lightweight orchestrator handling username normalization, cache lookup, expiration enforcement, adapter execution, validation policies (`STRICT`, `SOFT`, `DISABLED`), and metrics tracking.

4. **`ReportGenerator` (`backend/utils/importReportGenerator.js`)**:
   - Generates 3-sheet Excel reports with embedded metadata in **Sheet 1: Import Summary**, **Sheet 2: Imported Students**, and **Sheet 3: Invalid IDs** (with original `Excel Row` numbers).

5. **`verificationLogger` (`backend/utils/verificationLogger.js`)**:
   - Structured JSON logging for observability.

---

## Database Schema: `HandleVerifications`

```sql
CREATE TABLE IF NOT EXISTS HandleVerifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT NULL,
  platform VARCHAR(50) NOT NULL,
  username_original VARCHAR(100) NOT NULL,
  username_normalized VARCHAR(100) NOT NULL,
  verification_status ENUM('VERIFIED', 'PENDING', 'INVALID', 'EXPIRED', 'UNVERIFIED', 'FAILED') DEFAULT 'UNVERIFIED',
  verification_source ENUM('API', 'CACHE', 'IMPORT', 'MANUAL', 'ADMIN', 'AUTO_SYNC') DEFAULT 'API',
  verified_at TIMESTAMP NULL DEFAULT NULL,
  verification_expiry TIMESTAMP NULL DEFAULT NULL,
  last_error TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_hv_platform_norm (platform, username_normalized),
  INDEX idx_hv_platform_status (verification_status),
  INDEX idx_hv_user_platform (user_id, platform),
  INDEX idx_hv_user_id (user_id),
  UNIQUE KEY uk_user_platform (user_id, platform),
  CONSTRAINT fk_hv_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
);
```

---

## How to Add a New Competitive Programming Platform

To add support for a new platform (e.g. `atcoder`):

### Step 1: Create an Adapter
Create `backend/services/adapters/AtCoderAdapter.js` extending BaseAdapter:
```javascript
class AtCoderAdapter {
  async getProfile(username) {
    // Fetch profile from AtCoder API or web scraper
    return { verified: true, username, rating: 1400 };
  }
}
module.exports = AtCoderAdapter;
```

### Step 2: Register in `AdapterFactory`
Register adapter in `backend/services/adapters/AdapterFactory.js`.

### Step 3: Register Platform Specification in `PlatformRegistry`
```javascript
const platformRegistry = require('./services/PlatformRegistry');

platformRegistry.register({
  name: 'atcoder',
  adapterName: 'atcoder',
  regex: /^[a-zA-Z0-9_]{3,20}$/,
  cacheDays: 30,
  timeout: 5000,
  retryCount: 3,
  caseSensitive: true,
  enabled: true
});
```

---

## Configuration & Feature Flags (`verificationConfig.js`)

Environment variable overrides:

| Flag / Setting | Default | Description |
| --- | --- | --- |
| `ENABLE_PLATFORM_VALIDATION` | `true` | Enable/disable platform handle verification |
| `ENABLE_CACHE` | `true` | Enable DB cache lookups |
| `VALIDATION_POLICY` | `STRICT` | Validation mode (`STRICT`, `SOFT`, `DISABLED`) |
| `VERIFICATION_CACHE_DAYS` | `30` | Number of days before verification expires |
| `ENABLE_IMPORT_REPORTS` | `true` | Enable Excel import report generation |
| `ENABLE_STRUCTURED_LOGGING` | `true` | Enable structured JSON logging |

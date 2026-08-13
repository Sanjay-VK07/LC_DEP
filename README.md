# CodeTrack - Competitive Programming Contest Tracking & Attendance System

CodeTrack is an enterprise-grade competitive programming contest tracking and student attendance verification system for academic institutions.

---

## CLIST API Integration (v4)

CodeTrack includes a production-ready **CLIST API v4** integration (`https://clist.by/api/v4/`) implemented as a fallback provider and contest data aggregator.

### Environment Setup

Add the `CLIST_API_KEY` (and optional `CLIST_USERNAME`) to your `backend/.env` file:

```env
# CLIST API Configuration
CLIST_API_KEY=your_api_key_here
CLIST_USERNAME=your_username_here  # Optional: required for ApiKey username:key authentication
```

> [!IMPORTANT]
> **Key Security**: Never commit `.env` files or expose `CLIST_API_KEY` to frontend applications or public logs.

### Obtaining a CLIST API Key
1. Register/log in to your account at [clist.by](https://clist.by/).
2. Navigate to your user settings / API section at `https://clist.by/settings/preferences/`.
3. Copy your API Key and place it in `backend/.env`.

---

## Testing & Diagnostics

### Manual Connectivity Test Script
Run the manual connectivity test script to verify configuration, authentication, and endpoint responsiveness:

```bash
node scripts/test-clist-api.js
```

Or from the `backend/` directory:

```bash
node scripts/test-clist-api.js
```

**Expected Output**:
```text
[CLIST] Configuration: OK
[CLIST] Authentication: OK
[CLIST] API connectivity: OK
[CLIST] Contest fetch: OK
```

### Health Check Endpoint
Query the internal CLIST health endpoint:

```http
GET /api/health/providers/clist
```

**Response**:
```json
{
  "provider": "clist",
  "status": "healthy",
  "configured": true
}
```

---

## Features & Data Safety Ceiling Rules

1. **Caching & Rate Limiting**:
   - In-memory response caching (10 min TTL for standings/statistics, 1 hour TTL for contest listings).
   - Handles HTTP 429 Rate Limits using exponential backoff and `Retry-After` headers.
   - Retries transient 5xx server errors and network timeouts up to 3 times.

2. **Data Safety Ceiling Rules**:
   - CLIST data operates as **candidate evidence** and fallback data provider.
   - CLIST data **never** automatically overrides authoritative native verification logic.
   - When CLIST supplies contest participant data, records are explicitly tagged with `provider = "clist"`.
   - If `CLIST_API_KEY` is missing or unconfigured, the system logs `[CLIST] API key not configured - provider disabled` and cleanly continues operating without crashing.

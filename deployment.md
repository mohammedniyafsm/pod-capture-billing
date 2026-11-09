# HaulMark — Deployment & Local Setup Guide

**Project Name:** HaulMark (Road Transport Fleet POD Capture & Billing Automation)  
**Repository:** https://github.com/mohammedniyafsm/pod-capture-billing.git  

---

## 1. Local Setup Instructions (Step-by-Step)

Follow these steps to run the complete HaulMark application, database, and background AI worker locally.

### Prerequisites
- **Node.js**: v20.x or higher (recommended: v22.x)
- **Package Manager**: `pnpm` (install via `npm install -g pnpm`)
- **PostgreSQL**: PostgreSQL 15+ (local instance or free cloud database on [Neon](https://neon.tech))
- **Redis**: Redis 6+ (local server or cloud instance on [Upstash](https://upstash.com))

---

### Step 1: Clone the Repository & Install Dependencies
```bash
git clone https://github.com/mohammedniyafsm/pod-capture-billing..git
cd pod-capture-billing
pnpm install
```

---

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Open `.env` and fill in your connection strings (see section 2 below for details). For local evaluation without a paid Gemini key, you can set `AI_MODE=mock`.

---

### Step 3: Initialize Database Schema & Seed Data

Run Prisma schema generation and push:
```bash
pnpm db:generate
pnpm db:push
```

#### Run Primary Seed (Required)
Seeds branches, enterprise clients, driver accounts, billing executive accounts, vehicles, and active upcoming trips:

**On Linux / macOS / Git Bash:**
```bash
SEED_RESET=1 pnpm db:seed
```

**On Windows PowerShell:**
```powershell
$env:SEED_RESET = "1"
pnpm db:seed
Remove-Item Env:SEED_RESET
```

#### Seed Historical Analytics (Recommended for Dashboard Review)
Seeds 220 historical trips with authentic branch latencies and timestamps to populate the Overview Dashboard graphs:

**On Linux / macOS / Git Bash:**
```bash
SEED_HISTORY=1 pnpm db:seed:history
```

**On Windows PowerShell:**
```powershell
$env:SEED_HISTORY = "1"
pnpm db:seed:history
Remove-Item Env:SEED_HISTORY
```

---

### Step 4: Start the Application

In **Terminal 1** (Next.js Web Application):
```bash
pnpm dev
```
The application will be live at `http://localhost:3000`.

In **Terminal 2** (Background BullMQ AI Verification Worker):
```bash
pnpm worker:dev
```
The worker will listen on the `pod-verification` Redis queue and process uploaded POD images.

---

### Step 5: Run Automated Tests
Execute the comprehensive test suite (35 suites, 234 tests):
```bash
pnpm test
```

---

## 2. Environment Variables Specification

> [!IMPORTANT]
> In accordance with submission guidelines and security best practices, only environment variable **names and purposes** are listed below. No secret values or credentials are committed.

| Variable Name | Required | Default / Example Purpose |
|---|---|---|
| `DATABASE_URL` | **Yes** | Connection string for PostgreSQL database with pooling parameters |
| `DIRECT_URL` | **Yes** | Direct connection string for PostgreSQL (used for Prisma migrations and schema push) |
| `SESSION_SECRET` | **Yes** | 32+ character random secret used for `HS256` session token signing |
| `REDIS_URL` | **Yes** | Redis connection URI (`redis://localhost:6379`) for BullMQ queue broker |
| `POD_VERIFICATION_QUEUE`| Optional | Name of the BullMQ queue (defaults to `pod-verification`) |
| `AI_MODE` | Optional | Set to `gemini` for live Vision API or `mock` for deterministic test evaluation |
| `GEMINI_API_KEY` | Conditional | Google Gemini API key (required if `AI_MODE=gemini`) |
| `GEMINI_MODEL` | Optional | Gemini model identifier (default: `gemini-3.5-flash-lite`) |
| `DEMO_DRIVER_PIN` | Optional | Default 4-digit PIN assigned to demo drivers during seeding (default: `4821`) |
| `BILLING_DEMO_PASSWORD` | Optional | Password assigned to demo billing executives during seeding |
| `DEMO_POD_IMAGE_PATH` | Optional | Local relative path to fallback sample POD JPEG image (`./sample-pod.jpg`) |
| `BLOB_READ_WRITE_TOKEN` | Production | Vercel Blob access token (required only when deployed to Vercel/Railway in production) |

---

## 3. Demo Login Credentials (For Reviewers)

Use the following pre-configured credentials to evaluate both personas:

### A. Billing Executive Persona (Full Office Management)
Access all administrative interfaces at `http://localhost:3000/billing`:
- **URL**: `http://localhost:3000`
- **Email**: `meena.kulkarni@example.test` *(or `amit.joshi@example.test`)*
- **Password**: `YourStrongDemoPassword!`
- **Role Permissions**:
  - **Overview Dashboard** (`/billing`): Real-time branch latency comparison against the 4-day SLA target benchmark, Missing POD counter.
  - **Billing Queue** (`/billing/queue`): Filter by client and billing cycle, batch select trips, export Tally Excel + CSV ZIP archives with bundled POD images, "Mark as Invoiced".
  - **Trip Management** (`/billing/trips`): Comprehensive table of all trips across branches, stage filtering.
  - **Daily Trip Import** (`/billing/import`): Drag-and-drop CSV trip upload with live validation preview diagnostic table (test with `public/sample_10_trips_import.csv`).
  - **Review Queue** (`/billing/review`): Side-by-side visual inspection of AI-flagged POD discrepancies with field correction tools.

### B. Driver Persona (Mobile Field Capture)
Access mobile field capture interface at `http://localhost:3000`:
- **Driver 1 (Marathi Audio)**: Phone `9000000001` | PIN `4821` (Ramesh Pawar - Chh. Sambhajinagar depot)
- **Driver 2 (Hindi Audio)**: Phone `9000000002` | PIN `4821` (Sunil Yadav - Chh. Sambhajinagar depot)
- **Driver 3 (Marathi Audio)**: Phone `9000000003` | PIN `4821` (Dattu Shinde - Pune depot)
- **Role Permissions**:
  - Assigned & in-transit trip feed.
  - Multilingual voice playback (Hindi / Marathi / English).
  - 64px camera capture button with live preview.
  - Client-side compression (<300 KB).
  - Transparent IndexedDB offline saving and automatic background sync.

### C. Hired Driver Public Upload (Zero Login Required)
For spot-contracted drivers without app logins:
- Hired trip upload links can be generated from the Trips table or test with seeded link:
  `http://localhost:3000/upload/[token]`
- Single-use, cryptographically verified with 48-hour expiration.

---

## 4. Production Deployment Architecture

HaulMark is designed for split cloud deployment:
1. **Frontend & Next.js API**: Hosted on **Vercel** with global CDN edge caching.
2. **Database**: Hosted on **Neon Serverless PostgreSQL** (AWS `us-east-2`) with connection pooling enabled.
3. **Queue Broker**: Hosted on **Upstash Redis** (low-latency serverless Redis).
4. **AI Background Worker**: Hosted as a long-running container service on **Railway** / **Render**, connecting to the same Redis instance and Neon database to process Gemini Vision jobs independently without blocking web requests.


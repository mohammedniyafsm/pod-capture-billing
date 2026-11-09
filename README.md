This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Database & Local Setup (For Evaluators / Reviewers)

To run and evaluate this project locally with full demo and historical data:

### 1. Prerequisites
- **Node.js**: v20+ recommended
- **pnpm**: `npm install -g pnpm`
- **PostgreSQL**: Local PostgreSQL or cloud instance (e.g. [Neon](https://neon.tech))

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Ensure `.env` contains:
- `DATABASE_URL` and `DIRECT_URL`: your PostgreSQL connection string
- `SESSION_SECRET`: any 32+ character random string (e.g. `session-secret-demo-32-chars-long-fleetproof`)
- `DEMO_DRIVER_PIN`: 4-digit PIN for demo drivers (default: `4821`)
- `BILLING_DEMO_PASSWORD`: password for demo billing executives (default: `YourStrongDemoPassword!`)
- `DEMO_POD_IMAGE_PATH`: `./sample-pod.jpg`

### 3. Initialize Database Schema & Seed Data

Run the Prisma push and seed commands:

**In Bash / macOS / Linux:**
```bash
pnpm install
pnpm db:generate
pnpm db:push

# Run primary seed (creates branches, clients, drivers, billing accounts, upcoming trips):
SEED_RESET=1 pnpm db:seed

# Optional: seed historical analytics & realistic branch latencies for the billing dashboard:
SEED_HISTORY=1 pnpm db:seed:history
```

**In PowerShell (Windows):**
```powershell
pnpm install
pnpm db:generate
pnpm db:push

# Run primary seed:
$env:SEED_RESET = "1"
pnpm db:seed
Remove-Item Env:SEED_RESET

# Seed historical analytics & branch latency data:
$env:SEED_HISTORY = "1"
pnpm db:seed:history
Remove-Item Env:SEED_HISTORY
```

### 4. Demo Login Credentials

Once seeded, you can sign in to the application at `http://localhost:3000`:

| Role | Username / Identifier | Password / PIN | Description |
|---|---|---|---|
| **Billing Executive** | `meena.kulkarni@example.test` | `YourStrongDemoPassword!` | Full access to `/billing` (Queue, Trips, Overview, Daily CSV Import) |
| **Billing Executive** | `amit.joshi@example.test` | `YourStrongDemoPassword!` | Secondary billing user |
| **Driver (Marathi)** | Phone: `9000000001` | PIN: `4821` | Ramesh Pawar (Driver POD upload & audio instructions) |
| **Driver (Hindi)** | Phone: `9000000002` | PIN: `4821` | Sunil Yadav (Driver POD upload & audio instructions) |
| **Driver (Marathi)** | Phone: `9000000003` | PIN: `4821` | Dattu Shinde |

### 5. Start Development Server

```bash
pnpm dev
```
Open `http://localhost:3000` in your browser.

- **Billing Dashboard**: `http://localhost:3000/billing`
- **Billing Queue**: `http://localhost:3000/billing/queue`
- **Trip Import**: `http://localhost:3000/billing/import` (sample CSV available at `public/sample_10_trips_import.csv` or downloadable directly on the page)
- **Driver Capture / Hired Upload**: Upload links under `/upload/[token]` with Hindi/Marathi audio playback and offline capture.


### Test driver login in Postman

1. Choose any four-digit PIN for each driver and put those values in your local `.env` as `DRIVER_RAMESH_PIN`, `DRIVER_SUNIL_PIN`, and `DRIVER_DATTU_PIN`. Do not add them to source control.
2. With the development database URL configured, run `pnpm db:push`, set `$env:SEED_RESET = "1"`, then run `pnpm db:seed`.
3. In Postman, send `POST http://localhost:3000/api/auth/login` with `Content-Type: application/json` and a JSON body. Use the same PIN you configured for that driver:

```json
{
  "phone": "9000000001",
  "pin": "{{rameshPin}}",
  "role": "DRIVER"
}
```

The seeded driver phones are `9000000001` (Ramesh), `9000000002` (Sunil), and `9000000003` (Dattu). Set `{{rameshPin}}` to the same value as `DRIVER_RAMESH_PIN` in Postman's local environment; use the corresponding PIN variable for the other drivers. Postman should retain the `pod_session` cookie from the successful response for authenticated requests.

After login, call `GET http://localhost:3000/api/my-trips` with the retained `pod_session` cookie. It returns that driver's `ASSIGNED`, `IN_TRANSIT`, `POD_PENDING`, and `RETAKE_REQUESTED` trips, including `startedAt` and `deliveredAt`.

For each assigned trip, call `POST /api/trips/{id}/start` when the driver begins the trip. The server records `startedAt` and moves the trip to `IN_TRANSIT`. After arrival, call `POST /api/trips/{id}/complete`; it is valid only for an in-transit trip, records the server's `deliveredAt`, and moves it to `POD_PENDING`. Both endpoints require the owning driver's session, accept no client-supplied timestamps, and reject invalid transitions. Then submit the POD image using `POST /api/pods`.

### POD image extraction

`worker/ai/extractPod.ts` accepts image bytes and expected trip context, but extracts document values from the image rather than substituting expected values. It extracts LR, stamp, signature, written delivery date, received quantity and unit, goods description, remarks, and image quality. `worker/pods/verdict.ts` applies the existing deterministic business rules, including confidence, mismatch, retake-limit, shortage/damage and review handling. `worker/pods/verification.ts` orchestrates private image retrieval, extraction, verdict calculation, and transactional result persistence. Quantity must match numerically and the unit must match after case/whitespace normalization; no unit conversion is assumed. The POD date is compared by Asia/Kolkata calendar day only when the trip has an authoritative `deliveredAt`.

The Next.js API does not wait for Gemini. It validates the upload, stores the original in private image storage, creates the `PodSubmission` and trip state update atomically in PostgreSQL, and enqueues the verification job directly into BullMQ/Redis. It returns HTTP 202 only after the database write commits. A separate persistent Node.js worker consumes jobs from BullMQ/Redis, reads the original private image, runs Gemini and the existing verdict logic, and persists the result. The driver polls the authorized submission status endpoint. The worker retries transient AI failures with exponential backoff; permanently failed verification is recorded as `FAILED` and the driver can upload again.

Worker code lives under `worker/`: `index.ts` starts the BullMQ consumer and outbox poller, `ai/extractPod.ts` performs extraction, and `pods/verification.ts` plus `pods/verdict.ts` apply and persist verification decisions. `storage/imageStorage.ts` and `podLogger.ts` are shared by the worker and Next.js APIs. The `src/lib/pods/imageStorage.ts`, `src/lib/pods/podLogger.ts`, and `src/lib/verdict.ts` modules are re-export shims that preserve existing application imports; the single Prisma client remains in `src/lib/prisma.ts`.

The current driver page is online-only: it does not implement offline image persistence, automatic reconnect uploads, or client-side compression. Upload validation accepts JPEG, PNG, or WebP up to 1 MB. Do not treat offline capture as implemented.

### POD capture API

Authenticated drivers can list their assigned, in-transit, POD-pending, AI-checking, retake-requested, needs-review, and verified trips from `GET /api/my-trips`. `POST /api/trips/{id}/start` and `POST /api/trips/{id}/complete` advance their own trips through the delivery lifecycle. The POD capture endpoint accepts POD-pending or retake-requested trips. Hired-driver upload links use `POST /api/upload/{token}`; links are stored as SHA-256 token hashes and expire after 48 hours. `POST /api/pods` and hired-driver uploads return HTTP 202 with a submission ID and `AI_CHECKING` status after the image and durable outbox record are saved. `GET /api/pods/{submissionId}/status` returns the authorized processing result. Uploads detect the actual image format from the file signature and are idempotent by `clientSubmissionId`.

Images are private. Development stores them under `.local-private-pods/`; production uses private Vercel Blob. The Vercel web deployment needs Blob access (the Vercel Blob SDK can use linked-store OIDC or `BLOB_READ_WRITE_TOKEN`). A worker deployed outside Vercel, such as Railway, must have a Blob read/write token because it cannot use Vercel runtime OIDC. An authorized driver or billing user can request `GET /api/pods/{submissionId}/image-url`; the returned signed URL expires after five minutes. Set `POD_IMAGE_URL_SECRET` to a random secret of at least 32 characters, or reuse the configured `SESSION_SECRET`.

### Background worker: local development

The web app and worker use the same local filesystem in development. Run a local Redis service and configure `REDIS_URL`, `DATABASE_URL`, and `SESSION_SECRET` in `.env`. Use `AI_MODE=mock` to exercise the worker without Gemini; use `GEMINI_API_KEY` for real extraction. In two terminals run:

```powershell
pnpm dev
pnpm worker:dev
```

Apply the Prisma schema before starting either process:

```powershell
pnpm db:push
pnpm db:generate
```

### Deploying the worker to Railway

1. Create a managed Redis instance and a Railway worker service from this repository. Do not deploy the worker as a serverless function.
2. Set the worker build command to `pnpm install --frozen-lockfile && pnpm db:generate && pnpm worker:build` and the start command to `pnpm worker:start`. Use Node.js 20 or newer.
3. Configure `DATABASE_URL` (the same PostgreSQL database as the web app), `REDIS_URL`, `BLOB_READ_WRITE_TOKEN` (from the private Vercel Blob store), and `GEMINI_API_KEY`.
4. Configure `NODE_ENV=production`. The worker refuses to start without `REDIS_URL` and `BLOB_READ_WRITE_TOKEN` in production.
5. Optionally set `GEMINI_MODEL`, `POD_VERIFICATION_QUEUE` (default `pod-verification`), `POD_WORKER_CONCURRENCY` (default 4), `POD_JOB_ATTEMPTS` (default 4), and `POD_JOB_BACKOFF_MS` (default 2000).
6. Deploy the database schema once before running new web and worker versions: `pnpm db:push`. Back up production data and apply schema changes in a controlled deployment window.

The web process on Vercel needs `DATABASE_URL`, `SESSION_SECRET` (at least 32 characters), a connected private Blob store or `BLOB_READ_WRITE_TOKEN`, and its existing application secrets. It does not need `REDIS_URL`; the worker polls the PostgreSQL outbox and keeps records pending when queue publishing fails. After connecting the Blob store or changing Vercel environment variables, redeploy the web app.

The outbox and queue provide at-least-once delivery. Stable BullMQ job IDs, a unique extraction per submission, and transactionally guarded trip transitions make repeated jobs safe. A crash after enqueue but before marking the outbox published can enqueue the same job again; processing checks the persisted extraction and state. If all processing attempts fail, the submission is marked `FAILED` and the trip returns to `POD_PENDING`; there is not yet a billing/admin requeue screen. Pending outbox records recover automatically when Redis becomes available and the worker is running.

### Billing and review APIs

Billing executives can list review cases with `GET /api/review?reason=shortage_remark&branch=Pune`, view a trip and its review history with `GET /api/review/{tripId}`, and apply validated review actions with `POST /api/review/{tripId}/action`. The consignee and driver phone numbers are masked unless the detail request includes `?unmask=true`; each unmask is audited.

Automatic POD verification updates `Trip.deliveredQuantity` only when the verdict is `VERIFIED`. For a trip needing review, an executive can use `correct_fields` with both `fields.quantity_received` and `fields.quantity_unit` to confirm the quantity in the trip's expected unit, then approve it. Corrections are recorded in `ReviewAction.fieldChanges`; the original AI extraction is preserved. Approval is rejected until a delivered quantity has been confirmed.

`GET /api/billing/queue?client=&cycle=&branch=` groups verified trips by client and billing window. `POST /api/billing/export` accepts `{ "tripIds": ["..."] }` and only exports verified trips from one client and billing window per batch. It returns a download URL for a ZIP containing `Tally.csv` and a `POD/` directory. `GET /api/dashboard?range=7d|30d|6m|12m&branch=` returns zero-filled Asia/Kolkata event series, current status counts, branch POD ageing, selected-window POD-to-invoice averages against the four-day target, and POD receipt performance.

`POST /api/trips/import` accepts CSV text or a multipart `file` using this exact header order: `tripCode,client,vehicleNo,driverPhone,branch,origin,destination,freight,lrNumber,ewayBillNo,goodsDescription,expectedQuantity,quantityUnit,deliveredAt,consigneeName,consigneePhone`. Each row is independently validated; e-way bills must have 12 digits. `POST /api/trips/{id}/remind` queues a mock SMS reminder in `SmsOutbox`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

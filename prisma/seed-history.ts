import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  Prisma,
  PrismaClient,
  TripStatus,
  UserRole,
  PodSubmissionStatus,
  Verdict,
  ReviewActionType,
} from "@prisma/client";
import {
  access,
  copyFile,
  mkdir,
  stat,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const TOTAL_HISTORICAL_TRIPS = 220;

const routes = [
  { origin: "Chhatrapati Sambhajinagar", destination: "Mumbai", freight: 34500 },
  { origin: "Pune", destination: "Nagpur", freight: 42000 },
  { origin: "Nagpur", destination: "Hyderabad", freight: 38500 },
  { origin: "Nashik", destination: "Pune", freight: 26000 },
  { origin: "Jalna", destination: "Kolhapur", freight: 36000 },
  { origin: "Pune", destination: "Goa", freight: 35000 },
  { origin: "Mumbai", destination: "Indore", freight: 41000 },
  { origin: "Chhatrapati Sambhajinagar", destination: "Surat", freight: 39000 },
  { origin: "Pune", destination: "Indore", freight: 39700 },
  { origin: "Nagpur", destination: "Raipur", freight: 29500 },
  { origin: "Chhatrapati Sambhajinagar", destination: "Nashik", freight: 24500 },
  { origin: "Kolhapur", destination: "Belagavi", freight: 21000 },
] as const;

const goodsList = [
  { description: "Portland Pozzolana Cement", unit: "tonnes", baseQty: 22 },
  { description: "TMT Rebars Fe 550D", unit: "tonnes", baseQty: 20 },
  { description: "Refined Wheat Flour & Grains", unit: "bags", baseQty: 500 },
  { description: "FMCG Packaged Personal Care", unit: "cartons", baseQty: 450 },
  { description: "Fabricated Engineering Spares", unit: "crates", baseQty: 15 },
  { description: "Ready-Mix Aggregate Concrete", unit: "tonnes", baseQty: 24 },
  { description: "Soyabean & Mustard Feed", unit: "quintals", baseQty: 220 },
  { description: "Structural Steel Channels", unit: "tonnes", baseQty: 18 },
  { description: "Packed Blended Spices", unit: "boxes", baseQty: 320 },
  { description: "Industrial Precision Valves", unit: "pallets", baseQty: 12 },
] as const;

type HistoricalStatus =
  | "INVOICED"
  | "EXPORTED"
  | "VERIFIED"
  | "NEEDS_REVIEW"
  | "RETAKE_REQUESTED"
  | "DISPUTED"
  | "POD_PENDING";

function getHistoricalStatus(index: number): HistoricalStatus {
  const mod = index % 100;

  if (mod < 55) return "INVOICED";
  if (mod < 70) return "EXPORTED";
  if (mod < 82) return "VERIFIED";
  if (mod < 89) return "NEEDS_REVIEW";
  if (mod < 93) return "RETAKE_REQUESTED";
  if (mod < 96) return "DISPUTED";
  return "POD_PENDING";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function getSampleImagePath(): Promise<string> {
  const configuredPath = process.env.DEMO_POD_IMAGE_PATH;

  const candidates = [
    configuredPath
      ? isAbsolute(configuredPath)
        ? configuredPath
        : resolve(process.cwd(), configuredPath)
      : null,
    resolve(
      process.cwd(),
      ".local-private-pods",
      "50655bc2-a7c4-4231-b9ed-ef9894a22c0d.jpg",
    ),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      await access(candidate);
      const details = await stat(candidate);

      if (!details.isFile() || details.size === 0) {
        continue;
      }

      return candidate;
    } catch {
      // Try the next configured/default fixture path.
    }
  }

  throw new Error(
    [
      "A real sample POD image is required for historical seed data.",
      "Set DEMO_POD_IMAGE_PATH to an existing JPEG, PNG, or WebP image.",
      "Alternatively, place a sample JPEG at:",
      "  .local-private-pods/50655bc2-a7c4-4231-b9ed-ef9894a22c0d.jpg",
      "The seed will create a unique image copy for every historical submission.",
    ].join("\n"),
  );
}

async function createHistoricalImageKey(
  sourceImagePath: string,
): Promise<{ imageKey: string; sizeKb: number }> {
  const localDirectory = resolve(process.cwd(), ".local-private-pods");
  await mkdir(localDirectory, { recursive: true });

  const extension = sourceImagePath.toLowerCase().endsWith(".png")
    ? "png"
    : sourceImagePath.toLowerCase().endsWith(".webp")
      ? "webp"
      : "jpg";

  const imageKey = `${randomUUID()}.${extension}`;
  const destination = join(localDirectory, imageKey);

  await copyFile(sourceImagePath, destination);

  const imageStats = await stat(destination);

  return {
    imageKey,
    sizeKb: Math.max(1, Math.ceil(imageStats.size / 1024)),
  };
}

function buildExtractionFields(args: {
  lrNumber: string;
  expectedQuantity: number;
  deliveredQuantity: number;
  unit: string;
  goodsDescription: string;
  deliveredAt: Date;
  scenario: "GOOD" | "BLURRY" | "NO_STAMP" | "SHORTAGE" | "WRONG_LR";
}) {
  const {
    lrNumber,
    expectedQuantity,
    deliveredQuantity,
    unit,
    goodsDescription,
    deliveredAt,
    scenario,
  } = args;

  const isBlurry = scenario === "BLURRY";
  const hasNoStamp = scenario === "NO_STAMP";
  const hasShortage = scenario === "SHORTAGE";
  const hasWrongLr = scenario === "WRONG_LR";

  return {
    image_quality: {
      readable: !isBlurry,
      blur: isBlurry,
      cropped: false,
    },
    lr_number: {
      value: hasWrongLr ? "LR-X-00000" : lrNumber,
      confidence: hasWrongLr ? 0.99 : 0.98,
    },
    consignee_stamp: {
      present: !hasNoStamp,
      confidence: hasNoStamp ? 0.18 : 0.97,
    },
    signature: {
      present: !isBlurry,
      confidence: isBlurry ? 0.42 : 0.96,
    },
    delivery_date: {
      value: deliveredAt.toISOString().slice(0, 10),
      confidence: isBlurry ? 0.5 : 0.95,
    },
    quantity_received: {
      value: deliveredQuantity,
      unit,
      confidence: isBlurry ? 0.4 : 0.96,
    },
    goods_description: {
      value: goodsDescription,
      confidence: isBlurry ? 0.45 : 0.96,
    },
    remarks_text: hasShortage
      ? `Shortage of ${Math.max(1, expectedQuantity - deliveredQuantity)} ${unit} noticed at delivery.`
      : hasNoStamp
        ? "Consignee stamp is not visible."
        : "Received in good condition.",
    has_shortage_or_damage_remark: hasShortage,
    retake_hint: isBlurry
      ? "Image is blurred. Please capture the POD again in good light."
      : hasNoStamp
        ? "Please capture the consignee stamp clearly."
        : null,
  };
}

function getScenarioForStatus(
  status: HistoricalStatus,
  index: number,
): "GOOD" | "BLURRY" | "NO_STAMP" | "SHORTAGE" | "WRONG_LR" {
  if (status === "RETAKE_REQUESTED") {
    return index % 2 === 0 ? "BLURRY" : "NO_STAMP";
  }

  if (status === "NEEDS_REVIEW") {
    return index % 2 === 0 ? "SHORTAGE" : "WRONG_LR";
  }

  if (status === "DISPUTED") {
    return "SHORTAGE";
  }

  return "GOOD";
}

function getMockSourceFilename(
  scenario: ReturnType<typeof getScenarioForStatus>,
): string {
  switch (scenario) {
    case "BLURRY":
      return "blurry.jpg";
    case "NO_STAMP":
      return "no_stamp.jpg";
    case "SHORTAGE":
      return "short6.jpg";
    case "WRONG_LR":
      return "lr_wrong.jpg";
    default:
      return "good.jpg";
  }
}

async function cleanupExistingHistory() {
  const existingTrips = await prisma.trip.findMany({
    where: { tripCode: { startsWith: "HIST-2026-" } },
    select: { id: true },
  });

  if (existingTrips.length === 0) return;

  const tripIds = existingTrips.map((trip) => trip.id);

  console.log(`Removing ${tripIds.length} previous HIST-2026 trips...`);

  // Delete dependent rows before their parent records.
  await prisma.$transaction([
    prisma.podExtraction.deleteMany({
      where: { submission: { tripId: { in: tripIds } } },
    }),
    prisma.reviewAction.deleteMany({
      where: { tripId: { in: tripIds } },
    }),
    prisma.podSubmission.deleteMany({
      where: { tripId: { in: tripIds } },
    }),
    prisma.uploadLink.deleteMany({
      where: { tripId: { in: tripIds } },
    }),
    prisma.exportBatch.deleteMany({
      where: { tripIds: { hasSome: tripIds } },
    }),
    prisma.trip.deleteMany({
      where: { id: { in: tripIds } },
    }),
  ]);
}

async function createHistoricalUploadLink(args: {
  tripId: string;
  deliveredAt: Date;
  podReceivedAt: Date | null;
}) {
  const rawToken = randomBytes(32).toString("base64url");

  // The raw token is intentionally discarded. Only its SHA-256 hash is stored.
  // Historical seed records do not need a usable public upload URL.
  const tokenHash = sha256(rawToken);

  const expiresAt = args.podReceivedAt
    ? new Date(args.podReceivedAt.getTime() + 24 * HOUR_MS)
    : new Date(args.deliveredAt.getTime() + 48 * HOUR_MS);

  return prisma.uploadLink.create({
    data: {
      tokenHash,
      tripId: args.tripId,
      expiresAt,
      usedAt: args.podReceivedAt,
    },
    select: { id: true },
  });
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Historical dashboard seed data is not allowed in production.");
  }

  if (process.env.SEED_HISTORY !== "1") {
    throw new Error(
      "Set SEED_HISTORY=1 to explicitly create fictional dashboard history.",
    );
  }

  const [branches, clients, vehicles, drivers, reviewers] = await Promise.all([
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
    prisma.client.findMany({ orderBy: { name: "asc" } }),
    prisma.vehicle.findMany({ orderBy: { vehicleNo: "asc" } }),
    prisma.user.findMany({
      where: { role: UserRole.DRIVER },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { role: UserRole.BILLING_EXEC },
      orderBy: { name: "asc" },
    }),
  ]);

  if (
    branches.length === 0 ||
    clients.length === 0 ||
    vehicles.length === 0 ||
    drivers.length === 0 ||
    reviewers.length === 0
  ) {
    throw new Error(
      "Run the primary seed first and ensure branches, clients, vehicles, drivers, and billing executives exist.",
    );
  }

  const sourceImagePath = await getSampleImagePath();

  await cleanupExistingHistory();

  // The latest trip may take up to approximately 10 days to be delivered,
  // receive a POD, be verified, and be invoiced. Reserve that time so all
  // generated activity remains inside the Sep 1 – Nov 7 reporting window.
  const START_TIME = Date.UTC(2026, 8, 1, 6, 0);
  const END_TIME = Date.UTC(2026, 10, 7, 18, 0);
  const MAX_LIFECYCLE_BUFFER = 10 * DAY_MS;
  const CREATION_SPAN_MS =
    END_TIME - START_TIME - MAX_LIFECYCLE_BUFFER;

  console.log(`Using POD image fixture: ${sourceImagePath}`);
  console.log(`Generating ${TOTAL_HISTORICAL_TRIPS} historical trips...`);

  const createdExportedTripsByClient = new Map<
    string,
    { id: string; verifiedAt: Date }[]
  >();

  const statusCounts: Record<HistoricalStatus, number> = {
    INVOICED: 0,
    EXPORTED: 0,
    VERIFIED: 0,
    NEEDS_REVIEW: 0,
    RETAKE_REQUESTED: 0,
    DISPUTED: 0,
    POD_PENDING: 0,
  };

  for (let index = 0; index < TOTAL_HISTORICAL_TRIPS; index++) {
    const suffix = String(index + 1).padStart(4, "0");
    const tripCode = `HIST-2026-${suffix}`;
    const lrNumber = `LR-HIST-${suffix}`;
    const ewayBillNo = `8826${String(index + 1).padStart(8, "0")}`;

    const progress = index / (TOTAL_HISTORICAL_TRIPS - 1);
    const createdAt = new Date(
      START_TIME + Math.floor(progress * CREATION_SPAN_MS),
    );

    const client = clients[index % clients.length];
    const vehicle = vehicles[index % vehicles.length];
    const branch = branches[index % branches.length];

    const isHired = vehicle.isHired;
    const driver = isHired ? null : drivers[index % drivers.length];
    const reviewer = reviewers[index % reviewers.length];

    const route = routes[index % routes.length];
    const goods = goodsList[index % goodsList.length];

    const expectedQuantity = goods.baseQty + (index % 5);
    const freightAmount = route.freight + ((index * 730) % 6000);

    const startedAt = new Date(createdAt.getTime() + 4 * HOUR_MS);
    const transitHours = 10 + (index % 26);
    const deliveredAt = new Date(
      startedAt.getTime() + transitHours * HOUR_MS,
    );

    const status = getHistoricalStatus(index);
    statusCounts[status]++;

    let podReceivedAt: Date | null = null;
    let verifiedAt: Date | null = null;
    let invoicedAt: Date | null = null;
    let deliveredQuantity: Prisma.Decimal | null = null;
    let statusReason: string | null = null;
    let retakeCount = 0;

    const within24Hours = index % 5 !== 0;
    const podDelayHours = within24Hours
      ? 6 + (index % 16)
      : 26 + (index % 44);

    if (status !== "POD_PENDING") {
      podReceivedAt = new Date(
        deliveredAt.getTime() + podDelayHours * HOUR_MS,
      );

      if (
        status === "VERIFIED" ||
        status === "EXPORTED" ||
        status === "INVOICED"
      ) {
        verifiedAt = new Date(
          podReceivedAt.getTime() + (2 + (index % 6)) * HOUR_MS,
        );

        deliveredQuantity = new Prisma.Decimal(expectedQuantity);

        // EXPORTED means sent to the accounting/export workflow, not invoiced.
        // Only INVOICED trips receive invoicedAt.
        if (status === "INVOICED") {
          invoicedAt = new Date(
            verifiedAt.getTime() + (2 + (index % 4)) * DAY_MS,
          );
        }
      } else if (status === "NEEDS_REVIEW") {
        statusReason =
          index % 2 === 0 ? "shortage_remark" : "lr_mismatch";

        deliveredQuantity = new Prisma.Decimal(
          Math.max(1, expectedQuantity - (index % 2 === 0 ? 6 : 0)),
        );
      } else if (status === "RETAKE_REQUESTED") {
        retakeCount = 1;
        statusReason = index % 2 === 0 ? "image_blurry" : "stamp_not_visible";
      } else if (status === "DISPUTED") {
        statusReason = "quantity_mismatch";
        deliveredQuantity = new Prisma.Decimal(
          Math.max(1, expectedQuantity - 3),
        );
      }
    }

    const trip = await prisma.trip.create({
      data: {
        tripCode,
        clientId: client.id,
        vehicleNo: vehicle.vehicleNo,
        isHired,
        driverId: driver?.id ?? null,
        driverPhone: driver?.phone ?? `98${String(200000000 + index).slice(0, 8)}`,
        branchId: branch.id,
        origin: route.origin,
        destination: route.destination,
        freight: new Prisma.Decimal(freightAmount),
        lrNumber,
        ewayBillNo,
        goodsDescription: goods.description,
        expectedQuantity: new Prisma.Decimal(expectedQuantity),
        quantityUnit: goods.unit,
        deliveredQuantity,
        startedAt,
        deliveredAt,
        podReceivedAt,
        verifiedAt,
        invoicedAt,
        status: TripStatus[status],
        statusReason,
        retakeCount,
        consigneeName: `${route.destination} Industrial Distribution Centre`,
        consigneePhone: `9820${String(300000 + index).slice(1)}`,
        createdAt,
      },
      select: { id: true },
    });

    // A hired trip uses the public upload-link workflow.
    // For historical submitted PODs, link the submission to a used link.
    // A historical POD_PENDING hired trip gets an expired, unused link.
    const uploadLink =
      isHired
        ? await createHistoricalUploadLink({
          tripId: trip.id,
          deliveredAt,
          podReceivedAt,
        })
        : null;

    if (status === "POD_PENDING" || !podReceivedAt) {
      continue;
    }

    const scenario = getScenarioForStatus(status, index);
    const sourceFilename = getMockSourceFilename(scenario);

    const deliveredQtyNumber =
      deliveredQuantity === null
        ? expectedQuantity
        : Number(deliveredQuantity);

    const extractionFields = buildExtractionFields({
      lrNumber,
      expectedQuantity,
      deliveredQuantity: deliveredQtyNumber,
      unit: goods.unit,
      goodsDescription: goods.description,
      deliveredAt,
      scenario,
    });

    const submissionStatus =
      status === "VERIFIED" || status === "EXPORTED" || status === "INVOICED"
        ? PodSubmissionStatus.VERIFIED
        : status === "RETAKE_REQUESTED"
          ? PodSubmissionStatus.RETAKE
          : PodSubmissionStatus.REVIEW;

    const verdict =
      submissionStatus === PodSubmissionStatus.VERIFIED
        ? Verdict.VERIFIED
        : submissionStatus === PodSubmissionStatus.RETAKE
          ? Verdict.RETAKE
          : Verdict.REVIEW;

    const reasons =
      verdict === Verdict.VERIFIED
        ? []
        : status === "RETAKE_REQUESTED"
          ? [statusReason ?? "stamp_not_visible"]
          : status === "DISPUTED"
            ? ["quantity_mismatch"]
            : [statusReason ?? "shortage_remark"];

    const { imageKey, sizeKb } =
      await createHistoricalImageKey(sourceImagePath);

    const submissionId = randomUUID();

    await prisma.podSubmission.create({
      data: {
        id: submissionId,
        clientSubmissionId: randomUUID(),
        uploadLinkId: uploadLink?.id ?? null,
        tripId: trip.id,
        attemptNo: 1,
        imageKey,
        sourceFilename,
        sizeKb,
        gpsLat: 18.5204 + (index % 20) * 0.05,
        gpsLng: 73.8567 + (index % 20) * 0.05,
        capturedAt: podReceivedAt,
        uploadedAt: podReceivedAt,
        status: submissionStatus,
        retakeReason:
          verdict === Verdict.RETAKE ? reasons[0] : null,
        attemptsLeft:
          verdict === Verdict.RETAKE ? 1 : 2,
        extraction: {
          create: {
            fields: extractionFields,
            confidences: {
              lr_number: scenario === "WRONG_LR" ? 0.99 : 0.98,
              consignee_stamp: scenario === "NO_STAMP" ? 0.18 : 0.97,
              signature: scenario === "BLURRY" ? 0.42 : 0.96,
              delivery_date: scenario === "BLURRY" ? 0.5 : 0.95,
              quantity_received: scenario === "BLURRY" ? 0.4 : 0.96,
              goods_description: scenario === "BLURRY" ? 0.45 : 0.96,
            },
            verdict,
            reasons,
            modelName: "mock",
          },
        },
      },
    });

    if (status === "DISPUTED") {
      await prisma.reviewAction.create({
        data: {
          tripId: trip.id,
          reviewerId: reviewer.id,
          action: ReviewActionType.MARK_DISPUTED,
          fieldChanges: {
            status: "DISPUTED",
            disputeReason: "Consignee claimed partial shortage",
          },
          note: "Marked disputed pending consignee debit note review.",
          at: new Date(podReceivedAt.getTime() + 3 * HOUR_MS),
        },
      });
    }

    if (status === "EXPORTED") {
      const existing = createdExportedTripsByClient.get(client.id) ?? [];

      if (verifiedAt) {
        existing.push({ id: trip.id, verifiedAt });
      }

      createdExportedTripsByClient.set(client.id, existing);
    }
  }

  // Create one export batch per client with historical EXPORTED trips.
  // INVOICED trips are deliberately not included here: they are already
  // beyond the export stage in the trip lifecycle.
  for (const [clientId, trips] of createdExportedTripsByClient.entries()) {
    if (trips.length === 0) continue;

    const latestVerificationTime = Math.max(
      ...trips.map((trip) => trip.verifiedAt.getTime()),
    );

    const exportedAt = new Date(
      latestVerificationTime + HOUR_MS,
    );

    const client = clients.find((item) => item.id === clientId);

    if (!client) continue;

    await prisma.exportBatch.create({
      data: {
        clientId,
        cycleLabel: "NOV-2026-DEMO",
        tripIds: trips.map((trip) => trip.id),
        exportedById: reviewers[0].id,
        exportedAt,
        fileKey: `demo-exports/${clientId}-NOV-2026-DEMO.csv`,
      },
    });
  }

  console.log("=================================================");
  console.log("FleetProof historical seed completed.");
  console.log(`Total trips: ${TOTAL_HISTORICAL_TRIPS}`);
  console.log("Date range: September 1 – November 7, 2026");
  console.log("Status distribution:");

  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status}: ${count}`);
  }

  console.log("");
  console.log("Historical POD submissions include nested extraction fields.");
  console.log("Hired submissions are connected to used upload-link records.");
  console.log("POD_PENDING hired trips have expired, unused upload links.");
  console.log("Only EXPORTED trips are included in generated export batches.");
  console.log("=================================================");
}

main()
  .catch((error) => {
    console.error("Historical seed error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
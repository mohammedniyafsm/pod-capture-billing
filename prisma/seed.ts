import bcrypt from "bcryptjs";
import {
  BillingCycle,
  PodSubmissionStatus,
  Prisma,
  PrismaClient,
  TripStatus,
  UserRole,
  Verdict,
} from "@prisma/client";

const prisma = new PrismaClient();
const anchor = new Date("2026-11-01T12:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(anchor.getTime() - days * dayMs);
const hoursAfter = (date: Date, hours: number) =>
  new Date(date.getTime() + hours * 60 * 60 * 1000);

const branchNames = ["Chh. Sambhajinagar", "Pune", "Nagpur"] as const;
const branchByName = new Map<string, string>();
const userByName = new Map<string, string>();
const clientByName = new Map<string, string>();

const userSeeds = [
  ["Ramesh Pawar", UserRole.DRIVER, "9000000001", "Marathi", "Chh. Sambhajinagar"],
  ["Sunil Yadav", UserRole.DRIVER, "9000000002", "Hindi", "Chh. Sambhajinagar"],
  ["Dattu Shinde", UserRole.DRIVER, "9000000003", "Marathi", "Pune"],
  ["Meena Kulkarni", UserRole.BILLING_EXEC, "9000000004", "Marathi", "Chh. Sambhajinagar"],
] as const;

const clientSeeds = [
  ["Company B", BillingCycle.FORTNIGHTLY, "Company B - Cement"],
  ["Company C", BillingCycle.WEEKLY, "Company C - Steel"],
  ["Company D", BillingCycle.MONTHLY, "Company D - Packaged Foods"],
] as const;

const vehicleSeeds = [
  ["MH20 EL 4521", false, "Ramesh Pawar"],
  ["MH20 GT 7718", false, "Sunil Yadav"],
  ["MH17 BY 3092", true, null],
  ["MH20 AB 2201", false, "Dattu Shinde"],
  ["MH20 CD 3302", false, "Ramesh Pawar"],
  ["MH20 EF 4403", false, "Dattu Shinde"],
  ["MH12 QA 1234", true, null],
  ["MH14 ZX 4812", true, null],
] as const;

type TripSeed = {
  code: string;
  client: string;
  vehicle: string;
  driver?: string;
  phone?: string;
  branch: (typeof branchNames)[number];
  destination: string;
  freight: number;
  lr: string;
  eway: string;
  status: TripStatus;
  days?: number;
  verifyHours?: number;
  invoiceHours?: number;
  retakes?: number;
  hired?: boolean;
  statusReason?: string;
  deliveredQuantity?: number;
};

const tripSeeds: TripSeed[] = [
  { code: "TRP-66120", client: "Company B", vehicle: "MH20 EL 4521", driver: "Ramesh Pawar", branch: "Chh. Sambhajinagar", destination: "Nagpur", freight: 38500, lr: "LR-B-20481", eway: "441022876153", status: TripStatus.VERIFIED, days: 5, verifyHours: 9 },
  { code: "TRP-66134", client: "Company C", vehicle: "MH20 GT 7718", driver: "Sunil Yadav", branch: "Chh. Sambhajinagar", destination: "Pune", freight: 26000, lr: "LR-C-77302", eway: "441022910847", status: TripStatus.RETAKE_REQUESTED, days: 2, retakes: 1, statusReason: "Stamp not visible" },
  { code: "TRP-66141", client: "Company D", vehicle: "MH17 BY 3092", phone: "9000000011", branch: "Chh. Sambhajinagar", destination: "Indore", freight: 41200, lr: "LR-D-55019", eway: "441022943376", status: TripStatus.NEEDS_REVIEW, days: 1, hired: true, statusReason: "Short by 6 cartons", deliveredQuantity: 594 },
  { code: "TRP-66150", client: "Company B", vehicle: "MH20 EL 4521", driver: "Ramesh Pawar", branch: "Chh. Sambhajinagar", destination: "Aurangabad", freight: 21800, lr: "LR-B-20482", eway: "441023000001", status: TripStatus.ASSIGNED },
  { code: "TRP-66151", client: "Company C", vehicle: "MH20 GT 7718", driver: "Sunil Yadav", branch: "Chh. Sambhajinagar", destination: "Kolhapur", freight: 32800, lr: "LR-C-77303", eway: "441023000002", status: TripStatus.POD_PENDING, days: 15 },
  { code: "TRP-66152", client: "Company D", vehicle: "MH20 AB 2201", driver: "Dattu Shinde", branch: "Pune", destination: "Mumbai", freight: 19400, lr: "LR-D-55020", eway: "441023000003", status: TripStatus.AI_CHECKING, days: 1 },
  { code: "TRP-66153", client: "Company C", vehicle: "MH20 AB 2201", driver: "Dattu Shinde", branch: "Pune", destination: "Satara", freight: 27400, lr: "LR-C-77304", eway: "441023000004", status: TripStatus.INVOICED, days: 24, verifyHours: 18, invoiceHours: 72 },
  { code: "TRP-66154", client: "Company D", vehicle: "MH20 CD 3302", driver: "Ramesh Pawar", branch: "Nagpur", destination: "Amravati", freight: 30600, lr: "LR-D-55021", eway: "441023000005", status: TripStatus.INVOICED, days: 31, verifyHours: 20, invoiceHours: 120 },
  { code: "TRP-66155", client: "Company B", vehicle: "MH20 EL 4521", driver: "Ramesh Pawar", branch: "Chh. Sambhajinagar", destination: "Jalgaon", freight: 23300, lr: "LR-B-20483", eway: "441023000006", status: TripStatus.EXPORTED, days: 18, verifyHours: 12 },
  { code: "TRP-66156", client: "Company C", vehicle: "MH20 GT 7718", driver: "Sunil Yadav", branch: "Pune", destination: "Nashik", freight: 28700, lr: "LR-C-77305", eway: "441023000007", status: TripStatus.DISPUTED, days: 7 },
  { code: "TRP-66157", client: "Company B", vehicle: "MH20 CD 3302", driver: "Ramesh Pawar", branch: "Nagpur", destination: "Wardha", freight: 17600, lr: "LR-B-20484", eway: "441023000008", status: TripStatus.NEEDS_REVIEW, days: 8, retakes: 2 },
  { code: "TRP-66158", client: "Company D", vehicle: "MH20 EF 4403", driver: "Dattu Shinde", branch: "Pune", destination: "Solapur", freight: 22100, lr: "LR-D-55022", eway: "441023000009", status: TripStatus.NEEDS_REVIEW, days: 3, statusReason: "Damage remark on POD" },
  { code: "TRP-66159", client: "Company B", vehicle: "MH20 AB 2201", branch: "Pune", destination: "Latur", freight: 16500, lr: "LR-B-20485", eway: "441023000010", status: TripStatus.UNASSIGNED },
  { code: "TRP-66160", client: "Company C", vehicle: "MH12 QA 1234", phone: "9000000012", branch: "Chh. Sambhajinagar", destination: "Thane", freight: 31900, lr: "LR-C-77306", eway: "441023000011", status: TripStatus.ASSIGNED, hired: true },
  { code: "TRP-66161", client: "Company D", vehicle: "MH14 ZX 4812", phone: "9000000013", branch: "Pune", destination: "Panvel", freight: 29800, lr: "LR-D-55023", eway: "441023000012", status: TripStatus.POD_PENDING, days: 4, hired: true },
  { code: "TRP-66162", client: "Company C", vehicle: "MH12 QA 1234", phone: "9000000012", branch: "Nagpur", destination: "Bhiwandi", freight: 33700, lr: "LR-C-77307", eway: "441023000013", status: TripStatus.RETAKE_REQUESTED, days: 3, retakes: 1, hired: true },
  { code: "TRP-66163", client: "Company B", vehicle: "MH20 CD 3302", driver: "Ramesh Pawar", branch: "Nagpur", destination: "Akola", freight: 24300, lr: "LR-B-20486", eway: "441023000014", status: TripStatus.VERIFIED, days: 11, verifyHours: 11 },
  { code: "TRP-66164", client: "Company C", vehicle: "MH20 GT 7718", driver: "Sunil Yadav", branch: "Chh. Sambhajinagar", destination: "Sangli", freight: 25200, lr: "LR-C-77308", eway: "441023000015", status: TripStatus.VERIFIED, days: 9, verifyHours: 15 },
  { code: "TRP-66165", client: "Company D", vehicle: "MH20 EF 4403", driver: "Dattu Shinde", branch: "Pune", destination: "Ratnagiri", freight: 28100, lr: "LR-D-55024", eway: "441023000016", status: TripStatus.EXPORTED, days: 14, verifyHours: 19 },
  { code: "TRP-66166", client: "Company B", vehicle: "MH20 EL 4521", driver: "Ramesh Pawar", branch: "Chh. Sambhajinagar", destination: "Nanded", freight: 19100, lr: "LR-B-20487", eway: "441023000017", status: TripStatus.VERIFIED, days: 6, verifyHours: 13 },
  { code: "TRP-66167", client: "Company B", vehicle: "MH20 CD 3302", driver: "Ramesh Pawar", branch: "Nagpur", destination: "Yavatmal", freight: 20800, lr: "LR-B-20488", eway: "441023000018", status: TripStatus.INVOICED, days: 20, verifyHours: 10, invoiceHours: 96 },
  { code: "TRP-66168", client: "Company C", vehicle: "MH20 GT 7718", driver: "Sunil Yadav", branch: "Chh. Sambhajinagar", destination: "Beed", freight: 17200, lr: "LR-C-77309", eway: "441023000019", status: TripStatus.POD_PENDING, days: 13 },
  { code: "TRP-66169", client: "Company D", vehicle: "MH20 EF 4403", driver: "Dattu Shinde", branch: "Pune", destination: "Ahmednagar", freight: 26400, lr: "LR-D-55025", eway: "441023000020", status: TripStatus.VERIFIED, days: 5, verifyHours: 14 },
  { code: "TRP-66170", client: "Company B", vehicle: "MH20 AB 2201", driver: "Ramesh Pawar", branch: "Pune", destination: "Osmanabad", freight: 15900, lr: "LR-B-20489", eway: "441023000021", status: TripStatus.ASSIGNED },
  { code: "TRP-66171", client: "Company C", vehicle: "MH20 GT 7718", driver: "Sunil Yadav", branch: "Chh. Sambhajinagar", destination: "Ichalkaranji", freight: 24600, lr: "LR-C-77310", eway: "441023000022", status: TripStatus.DISPUTED, days: 12 },
  { code: "TRP-66172", client: "Company D", vehicle: "MH20 EF 4403", driver: "Dattu Shinde", branch: "Pune", destination: "Chiplun", freight: 18300, lr: "LR-D-55026", eway: "441023000023", status: TripStatus.RETAKE_REQUESTED, days: 2, retakes: 1 },
  { code: "TRP-66173", client: "Company B", vehicle: "MH20 CD 3302", driver: "Ramesh Pawar", branch: "Nagpur", destination: "Buldhana", freight: 20100, lr: "LR-B-20490", eway: "441023000024", status: TripStatus.NEEDS_REVIEW, days: 5 },
  { code: "TRP-66174", client: "Company B", vehicle: "MH20 EL 4521", driver: "Ramesh Pawar", branch: "Chh. Sambhajinagar", destination: "Parbhani", freight: 18700, lr: "LR-B-20491", eway: "441023000025", status: TripStatus.INVOICED, days: 17, verifyHours: 16, invoiceHours: 84 },
];

const submissionSeeds = [
  { tripCode: "TRP-66120", id: "00000000-0000-4000-8000-000000000001", status: PodSubmissionStatus.VERIFIED, verdict: Verdict.VERIFIED, reasons: [], fields: { lr_number: "LR-B-20481", consignee_stamp_present: true, signature_present: true, remarks_text: "" }, confidences: { lr_number: 0.99, consignee_stamp: 0.98, signature: 0.97 } },
  { tripCode: "TRP-66134", id: "00000000-0000-4000-8000-000000000002", status: PodSubmissionStatus.RETAKE, verdict: Verdict.RETAKE, reasons: ["stamp_not_visible"], fields: { lr_number: "LR-C-77302", consignee_stamp_present: false, signature_present: true, remarks_text: "" }, confidences: { lr_number: 0.98, consignee_stamp: 0.2, signature: 0.96 } },
  { tripCode: "TRP-66141", id: "00000000-0000-4000-8000-000000000003", status: PodSubmissionStatus.REVIEW, verdict: Verdict.REVIEW, reasons: ["shortage_remark"], fields: { lr_number: "LR-D-55019", consignee_stamp_present: true, signature_present: true, remarks_text: "Short by 6 cartons" }, confidences: { lr_number: 0.99, consignee_stamp: 0.96, signature: 0.97 } },
  { tripCode: "TRP-66157", id: "00000000-0000-4000-8000-000000000004", status: PodSubmissionStatus.REVIEW, verdict: Verdict.REVIEW, reasons: ["retake_limit"], fields: { lr_number: "LR-B-20484", consignee_stamp_present: false, signature_present: true, remarks_text: "" }, confidences: { lr_number: 0.98, consignee_stamp: 0.3, signature: 0.93 } },
  { tripCode: "TRP-66158", id: "00000000-0000-4000-8000-000000000005", status: PodSubmissionStatus.REVIEW, verdict: Verdict.REVIEW, reasons: ["damage"], fields: { lr_number: "LR-D-55022", consignee_stamp_present: true, signature_present: true, remarks_text: "Cartons damaged in transit" }, confidences: { lr_number: 0.99, consignee_stamp: 0.97, signature: 0.98 } },
] as const;

async function main() {
  const demoDriverPin = process.env.OTP_DEMO_CODE;
  if (demoDriverPin && !/^[0-9]{4}$/.test(demoDriverPin)) {
    throw new Error("OTP_DEMO_CODE must contain exactly four digits.");
  }
  const billingPassword = process.env.BILLING_DEMO_PASSWORD || undefined;
  if (billingPassword !== undefined && billingPassword.length < 12) {
    throw new Error("BILLING_DEMO_PASSWORD must contain at least 12 characters.");
  }
  const driverPinHash = demoDriverPin
    ? await bcrypt.hash(demoDriverPin, 12)
    : null;
  const billingPasswordHash = billingPassword
    ? await bcrypt.hash(billingPassword, 12)
    : null;

  for (const name of branchNames) {
    const branch = await prisma.branch.upsert({
      where: { name },
      update: {},
      create: { name },
      select: { id: true },
    });
    branchByName.set(name, branch.id);
  }

  for (const [name, role, phone, language, branchName] of userSeeds) {
    const credentials =
      role === UserRole.DRIVER
        ? driverPinHash
          ? { pinHash: driverPinHash }
          : {}
        : {
            email: "meena.kulkarni@example.test",
            ...(billingPasswordHash ? { passwordHash: billingPasswordHash } : {}),
          };
    const user = await prisma.user.upsert({
      where: { phone },
      update: {
        name,
        role,
        language,
        branchId: branchByName.get(branchName),
        ...credentials,
      },
      create: {
        name,
        role,
        phone,
        email: role === UserRole.BILLING_EXEC ? "meena.kulkarni@example.test" : null,
        pinHash: role === UserRole.DRIVER ? driverPinHash : null,
        passwordHash:
          role === UserRole.BILLING_EXEC ? billingPasswordHash : null,
        language,
        branchId: branchByName.get(branchName),
      },
      select: { id: true },
    });
    userByName.set(name, user.id);
  }

  for (const [name, billingCycle, tallyLedgerName] of clientSeeds) {
    const client = await prisma.client.upsert({
      where: { name },
      update: { billingCycle, tallyLedgerName },
      create: { name, billingCycle, tallyLedgerName },
      select: { id: true },
    });
    clientByName.set(name, client.id);
  }

  for (const [vehicleNo, isHired, driverName] of vehicleSeeds) {
    await prisma.vehicle.upsert({
      where: { vehicleNo },
      update: {
        isHired,
        defaultDriverId: driverName ? userByName.get(driverName) : null,
      },
      create: {
        vehicleNo,
        isHired,
        defaultDriverId: driverName ? userByName.get(driverName) : null,
      },
    });
  }

  const tripIds = new Map<string, string>();
  for (const seed of tripSeeds) {
    const deliveredAt = seed.days === undefined ? null : daysAgo(seed.days);
    const verifiedAt =
      deliveredAt && seed.verifyHours !== undefined
        ? hoursAfter(deliveredAt, seed.verifyHours)
        : null;
    const isPackagedFood = seed.client === "Company D";
    const expectedQuantity = isPackagedFood ? 600 : 25;
    const tripData = {
      clientId: clientByName.get(seed.client)!,
      vehicleNo: seed.vehicle,
      isHired: seed.hired ?? false,
      driverId: seed.driver ? userByName.get(seed.driver) : null,
      driverPhone: seed.phone ?? null,
      branchId: branchByName.get(seed.branch)!,
      origin: "Chhatrapati Sambhajinagar",
      destination: seed.destination,
      freight: new Prisma.Decimal(seed.freight),
      lrNumber: seed.lr,
      ewayBillNo: seed.eway,
      goodsDescription: isPackagedFood
        ? "Packaged foods"
        : seed.client === "Company B"
          ? "Cement"
          : "Steel",
      expectedQuantity: new Prisma.Decimal(expectedQuantity),
      quantityUnit: isPackagedFood ? "cartons" : "tonnes",
      deliveredQuantity:
        deliveredAt === null
          ? null
          : new Prisma.Decimal(seed.deliveredQuantity ?? expectedQuantity),
      deliveredAt,
      podReceivedAt:
        deliveredAt && seed.status !== TripStatus.POD_PENDING
          ? hoursAfter(deliveredAt, 1)
          : null,
      verifiedAt,
      invoicedAt:
        verifiedAt && seed.invoiceHours !== undefined
          ? hoursAfter(verifiedAt, seed.invoiceHours)
          : null,
      status: seed.status,
      statusReason: seed.statusReason ?? null,
      retakeCount: seed.retakes ?? 0,
      consigneeName: `${seed.destination} ${seed.client} Depot`,
      consigneePhone: `90000001${String(tripSeeds.indexOf(seed) + 1).padStart(2, "0")}`,
    } satisfies Prisma.TripUncheckedUpdateInput;
    const trip = await prisma.trip.upsert({
      where: { tripCode: seed.code },
      update: tripData,
      create: { tripCode: seed.code, ...tripData },
      select: { id: true },
    });
    tripIds.set(seed.code, trip.id);
  }

  for (const submission of submissionSeeds) {
    const tripId = tripIds.get(submission.tripCode)!;
    const tripSeed = tripSeeds.find((trip) => trip.code === submission.tripCode)!;
    const timestamp = daysAgo(tripSeed.days ?? 1);
    await prisma.podSubmission.upsert({
      where: { id: submission.id },
      update: {
        tripId,
        attemptNo: 1,
        imageKey: `seed/${submission.tripCode}/pod.jpg`,
        sizeKb: 180,
        capturedAt: timestamp,
        uploadedAt: timestamp,
        status: submission.status,
      },
      create: {
        id: submission.id,
        tripId,
        attemptNo: 1,
        imageKey: `seed/${submission.tripCode}/pod.jpg`,
        sizeKb: 180,
        capturedAt: timestamp,
        uploadedAt: timestamp,
        status: submission.status,
      },
    });
    await prisma.podExtraction.upsert({
      where: { submissionId: submission.id },
      update: {
        fields: submission.fields,
        confidences: submission.confidences,
        verdict: submission.verdict,
        reasons: [...submission.reasons],
        modelName: "mock-seed",
        rawResponse: { seeded: true, filename: "pod.jpg" },
      },
      create: {
        submissionId: submission.id,
        fields: submission.fields,
        confidences: submission.confidences,
        verdict: submission.verdict,
        reasons: [...submission.reasons],
        modelName: "mock-seed",
        rawResponse: { seeded: true, filename: "pod.jpg" },
      },
    });
  }

  for (const [index, code] of ["TRP-66155", "TRP-66165"].entries()) {
    const trip = tripSeeds.find((candidate) => candidate.code === code)!;
    const id = `00000000-0000-4000-8000-00000000000${index + 6}`;
    const exportData = {
      clientId: clientByName.get(trip.client)!,
      cycleLabel: `${trip.client} 2026-10`,
      tripIds: [tripIds.get(code)!],
      exportedById: userByName.get("Meena Kulkarni")!,
      exportedAt: daysAgo(3),
      fileKey: `seed/exports/${code}.csv`,
    };
    await prisma.exportBatch.upsert({
      where: { id },
      update: exportData,
      create: { id, ...exportData },
    });
  }

  console.log(
    `Seeded ${branchNames.length} branches, ${userSeeds.length} users, ${clientSeeds.length} clients, and ${tripSeeds.length} trips.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error("Database seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

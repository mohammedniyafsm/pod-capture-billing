import bcrypt from "bcryptjs";
import {
  BillingCycle,
  Prisma,
  PrismaClient,
  TripStatus,
  UserRole,
} from "@prisma/client";

const prisma = new PrismaClient();

export const branchNames = [
  "Chh. Sambhajinagar",
  "Pune",
  "Nagpur",
] as const;

export const clientSeeds = [
  { name: "Sahyadri Cements Ltd", billingCycle: BillingCycle.FORTNIGHTLY, tallyLedgerName: "Sahyadri Cements - Billing Ledger" },
  { name: "MahaSteel Ispat Corp", billingCycle: BillingCycle.WEEKLY, tallyLedgerName: "MahaSteel Ispat - Trade A/C" },
  { name: "KisanAgro Foods & Grains", billingCycle: BillingCycle.MONTHLY, tallyLedgerName: "KisanAgro Foods - Central" },
  { name: "Deccan FMCG Distributors", billingCycle: BillingCycle.WEEKLY, tallyLedgerName: "Deccan FMCG - Primary Ledger" },
  { name: "Godavari Heavy Engineering", billingCycle: BillingCycle.MONTHLY, tallyLedgerName: "Godavari Heavy Engg Ledger" },
  { name: "Vidarbha Infra & Concrete", billingCycle: BillingCycle.FORTNIGHTLY, tallyLedgerName: "Vidarbha Infra Materials A/C" },
  { name: "Western Agro Processing", billingCycle: BillingCycle.MONTHLY, tallyLedgerName: "Western Agro Commodities A/C" },
  { name: "Marathwada Steel Mills", billingCycle: BillingCycle.WEEKLY, tallyLedgerName: "Marathwada Steel Products" },
  { name: "Panchavati Spices & Packaged Goods", billingCycle: BillingCycle.FORTNIGHTLY, tallyLedgerName: "Panchavati Foods A/C" },
  { name: "Ajanta Industrial Equipments", billingCycle: BillingCycle.MONTHLY, tallyLedgerName: "Ajanta Equipments Central Ledger" },
] as const;

export const driverSeeds = [
  { name: "Ramesh Pawar", phone: "9000000001", language: "Marathi", branch: "Chh. Sambhajinagar" },
  { name: "Sunil Yadav", phone: "9000000002", language: "Hindi", branch: "Chh. Sambhajinagar" },
  { name: "Dattu Shinde", phone: "9000000003", language: "Marathi", branch: "Pune" },
  { name: "Ganesh Jadhav", phone: "9000000005", language: "Marathi", branch: "Pune" },
  { name: "Vikas More", phone: "9000000006", language: "Marathi", branch: "Chh. Sambhajinagar" },
  { name: "Pravin Kadam", phone: "9000000007", language: "Marathi", branch: "Pune" },
  { name: "Sachin Gaikwad", phone: "9000000008", language: "Marathi", branch: "Nagpur" },
  { name: "Nitin Chavan", phone: "9000000009", language: "Marathi", branch: "Nagpur" },
  { name: "Mahesh Bhosle", phone: "9000000010", language: "Marathi", branch: "Chh. Sambhajinagar" },
  { name: "Santosh Salunkhe", phone: "9000000011", language: "Marathi", branch: "Pune" },
  { name: "Ajay Wagh", phone: "9000000012", language: "Marathi", branch: "Nagpur" },
  { name: "Rajesh Shinde", phone: "9000000013", language: "Hindi", branch: "Chh. Sambhajinagar" },
  { name: "Sandip Patil", phone: "9000000014", language: "Marathi", branch: "Pune" },
  { name: "Vijay Deshmukh", phone: "9000000015", language: "Marathi", branch: "Nagpur" },
  { name: "Kailas Thorat", phone: "9000000016", language: "Marathi", branch: "Chh. Sambhajinagar" },
  { name: "Deepak Sawant", phone: "9000000017", language: "Marathi", branch: "Pune" },
  { name: "Rahul Ghodke", phone: "9000000018", language: "Marathi", branch: "Nagpur" },
  { name: "Anand Munde", phone: "9000000019", language: "Marathi", branch: "Chh. Sambhajinagar" },
  { name: "Baburao Kale", phone: "9000000020", language: "Marathi", branch: "Pune" },
  { name: "Suresh Narwade", phone: "9000000021", language: "Marathi", branch: "Nagpur" },
] as const;

export const executiveSeeds = [
  {
    name: "Meena Kulkarni",
    email: "meena.kulkarni@example.test",
    phone: "9000000004",
    language: "Marathi",
    branch: "Chh. Sambhajinagar",
  },
  {
    name: "Amit Joshi",
    email: "amit.joshi@example.test",
    phone: "9000000022",
    language: "English",
    branch: "Pune",
  },
] as const;

export const vehicleSeeds = [
  { vehicleNo: "MH20 EL 4521", isHired: false, defaultDriverIndex: 0 },
  { vehicleNo: "MH20 GT 7718", isHired: false, defaultDriverIndex: 1 },
  { vehicleNo: "MH12 AB 2201", isHired: false, defaultDriverIndex: 2 },
  { vehicleNo: "MH12 QK 5519", isHired: false, defaultDriverIndex: 3 },
  { vehicleNo: "MH20 DR 3104", isHired: false, defaultDriverIndex: 4 },
  { vehicleNo: "MH12 FC 8820", isHired: false, defaultDriverIndex: 5 },
  { vehicleNo: "MH31 TR 6632", isHired: false, defaultDriverIndex: 6 },
  { vehicleNo: "MH31 AP 4410", isHired: false, defaultDriverIndex: 7 },
  { vehicleNo: "MH20 BX 9122", isHired: false, defaultDriverIndex: 8 },
  { vehicleNo: "MH12 PN 7340", isHired: false, defaultDriverIndex: 9 },
  { vehicleNo: "MH31 BN 1128", isHired: false, defaultDriverIndex: 10 },
  { vehicleNo: "MH20 CZ 3902", isHired: false, defaultDriverIndex: 11 },
  { vehicleNo: "MH12 TY 4811", isHired: false, defaultDriverIndex: 12 },
  { vehicleNo: "MH31 DK 9504", isHired: false, defaultDriverIndex: 13 },
  { vehicleNo: "MH20 KA 6215", isHired: false, defaultDriverIndex: 14 },

  // Fictional hired-vehicle registrations for this demo dataset.
  { vehicleNo: "MH20 FN 6101", isHired: true, defaultDriverIndex: null },
  { vehicleNo: "MH12 KR 8202", isHired: true, defaultDriverIndex: null },
  { vehicleNo: "MH31 PV 3303", isHired: true, defaultDriverIndex: null },
  { vehicleNo: "MH04 QX 4404", isHired: true, defaultDriverIndex: null },
  { vehicleNo: "MH15 DL 5505", isHired: true, defaultDriverIndex: null },
] as const;

const routeCatalogue = [
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

const goodsCatalogue = [
  { description: "Portland Pozzolana Cement", unit: "tonnes", minQty: 18, maxQty: 28 },
  { description: "TMT Rebars Fe 550D", unit: "tonnes", minQty: 15, maxQty: 25 },
  { description: "Refined Wheat Flour & Grains", unit: "bags", minQty: 400, maxQty: 750 },
  { description: "FMCG Packaged Personal Care", unit: "cartons", minQty: 300, maxQty: 600 },
  { description: "Fabricated Engineering Spares", unit: "crates", minQty: 10, maxQty: 22 },
  { description: "Ready-Mix Aggregate Concrete", unit: "tonnes", minQty: 20, maxQty: 30 },
  { description: "Soyabean & Mustard Feed", unit: "quintals", minQty: 180, maxQty: 320 },
  { description: "Structural Steel Channels", unit: "tonnes", minQty: 16, maxQty: 24 },
  { description: "Packed Blended Spices", unit: "boxes", minQty: 250, maxQty: 500 },
  { description: "Industrial Precision Valves", unit: "pallets", minQty: 8, maxQty: 18 },
] as const;

function getDemoCredentials() {
  const driverPin =
    process.env.DEMO_DRIVER_PIN ||
    process.env.DRIVER_RAMESH_PIN ||
    "4821";

  if (!/^[0-9]{4}$/.test(driverPin)) {
    throw new Error("DEMO_DRIVER_PIN must be exactly 4 digits.");
  }

  const billingPassword =
    process.env.BILLING_DEMO_PASSWORD || "FleetProof@2026!";

  if (billingPassword.length < 12) {
    throw new Error("BILLING_DEMO_PASSWORD must contain at least 12 characters.");
  }

  return { driverPin, billingPassword };
}

async function removeExistingUpcomingTrips() {
  const trips = await prisma.trip.findMany({
    where: {
      OR: [
        { tripCode: { startsWith: "FUT-2026-" } },
        { tripCode: { startsWith: "TEST-OWN-" } },
        { tripCode: { startsWith: "TEST-HIRED-" } },
      ],
    },
    select: { id: true },
  });

  if (trips.length === 0) return;

  const tripIds = trips.map((trip) => trip.id);

  await prisma.$transaction([
    prisma.podExtraction.deleteMany({
      where: { submission: { tripId: { in: tripIds } } },
    }),
    prisma.reviewAction.deleteMany({ where: { tripId: { in: tripIds } } }),
    prisma.podSubmission.deleteMany({ where: { tripId: { in: tripIds } } }),
    prisma.uploadLink.deleteMany({ where: { tripId: { in: tripIds } } }),
    prisma.exportBatch.deleteMany({ where: { tripIds: { hasSome: tripIds } } }),
    prisma.trip.deleteMany({ where: { id: { in: tripIds } } }),
  ]);
}

async function main() {
  if (process.env.SEED_RESET !== "1") {
    throw new Error(
      "Set SEED_RESET=1 to confirm creation/reset of managed FleetProof demo data.",
    );
  }

  const { driverPin, billingPassword } = getDemoCredentials();

  const [driverPinHash, billingPasswordHash] = await Promise.all([
    bcrypt.hash(driverPin, 10),
    bcrypt.hash(billingPassword, 10),
  ]);

  console.log("Seeding fictional FleetProof demo master data...");

  const branchMap = new Map<string, string>();

  for (const name of branchNames) {
    const branch = await prisma.branch.upsert({
      where: { name },
      update: {},
      create: { name },
      select: { id: true },
    });

    branchMap.set(name, branch.id);
  }

  const clientMap = new Map<string, string>();

  for (const client of clientSeeds) {
    const record = await prisma.client.upsert({
      where: { name: client.name },
      update: {
        billingCycle: client.billingCycle,
        tallyLedgerName: client.tallyLedgerName,
      },
      create: {
        name: client.name,
        billingCycle: client.billingCycle,
        tallyLedgerName: client.tallyLedgerName,
      },
      select: { id: true },
    });

    clientMap.set(client.name, record.id);
  }

  const driverMap = new Map<string, string>();

  for (const driver of driverSeeds) {
    const branchId = branchMap.get(driver.branch);

    if (!branchId) {
      throw new Error(`Missing branch for driver ${driver.name}.`);
    }

    const user = await prisma.user.upsert({
      where: { phone: driver.phone },
      update: {
        name: driver.name,
        role: UserRole.DRIVER,
        language: driver.language,
        branchId,
        pinHash: driverPinHash,
      },
      create: {
        name: driver.name,
        role: UserRole.DRIVER,
        phone: driver.phone,
        language: driver.language,
        branchId,
        pinHash: driverPinHash,
      },
      select: { id: true },
    });

    driverMap.set(driver.name, user.id);
  }

  const executiveMap = new Map<string, string>();

  for (const executive of executiveSeeds) {
    const branchId = branchMap.get(executive.branch);

    if (!branchId) {
      throw new Error(`Missing branch for executive ${executive.name}.`);
    }

    const user = await prisma.user.upsert({
      where: { email: executive.email },
      update: {
        name: executive.name,
        role: UserRole.BILLING_EXEC,
        phone: executive.phone,
        language: executive.language,
        branchId,
        passwordHash: billingPasswordHash,
      },
      create: {
        name: executive.name,
        role: UserRole.BILLING_EXEC,
        email: executive.email,
        phone: executive.phone,
        language: executive.language,
        branchId,
        passwordHash: billingPasswordHash,
      },
      select: { id: true },
    });

    executiveMap.set(executive.name, user.id);
  }

  for (const vehicle of vehicleSeeds) {
    const defaultDriverId =
      vehicle.defaultDriverIndex === null
        ? null
        : driverMap.get(driverSeeds[vehicle.defaultDriverIndex].name);

    await prisma.vehicle.upsert({
      where: { vehicleNo: vehicle.vehicleNo },
      update: {
        isHired: vehicle.isHired,
        defaultDriverId,
      },
      create: {
        vehicleNo: vehicle.vehicleNo,
        isHired: vehicle.isHired,
        defaultDriverId,
      },
    });
  }

  // Only FUT-2026-* trips are removed. Historical seed data is preserved.
  await removeExistingUpcomingTrips();

  const ownVehicles = vehicleSeeds.filter((vehicle) => !vehicle.isHired);
  const upcomingTrips: Prisma.TripCreateManyInput[] = [];
  let tripCounter = 1;

  for (let driverIndex = 0; driverIndex < driverSeeds.length; driverIndex++) {
    const driver = driverSeeds[driverIndex];
    const driverId = driverMap.get(driver.name);
    const branchId = branchMap.get(driver.branch);

    if (!driverId || !branchId) {
      throw new Error(`Missing seeded driver or branch for ${driver.name}.`);
    }

    const vehicle = ownVehicles[driverIndex % ownVehicles.length];
    const tripCount = driverIndex % 3 === 0 || driverIndex % 5 === 0 ? 2 : 1;

    for (let tripIndex = 0; tripIndex < tripCount; tripIndex++) {
      const tripCodeSuffix = String(tripCounter).padStart(4, "0");
      const client = clientSeeds[(driverIndex + tripIndex * 3) % clientSeeds.length];
      const route = routeCatalogue[(driverIndex * 2 + tripIndex * 3) % routeCatalogue.length];
      const goods = goodsCatalogue[(driverIndex + tripIndex * 4) % goodsCatalogue.length];

      const quantity =
        goods.minQty +
        ((driverIndex * 7 + tripIndex * 11) % (goods.maxQty - goods.minQty + 1));

      // Stored as UTC 04:30, corresponding to 10:00 AM IST.
      const scheduledAt = new Date(
        Date.UTC(2026, 10, 8 + ((driverIndex * 2 + tripIndex * 3) % 7), 4, 30),
      );

      upcomingTrips.push({
        tripCode: `FUT-2026-${tripCodeSuffix}`,
        clientId: clientMap.get(client.name)!,
        vehicleNo: vehicle.vehicleNo,
        isHired: false,
        driverId,
        driverPhone: driver.phone,
        branchId,
        origin: route.origin,
        destination: route.destination,
        freight: new Prisma.Decimal(
          route.freight + ((driverIndex * 1230 + tripIndex * 870) % 5000),
        ),
        lrNumber: `LR-FUT-${tripCodeSuffix}`,
        ewayBillNo: `2611${String(tripCounter).padStart(8, "0")}`,
        goodsDescription: goods.description,
        expectedQuantity: new Prisma.Decimal(quantity),
        quantityUnit: goods.unit,
        deliveredQuantity: null,
        startedAt: null,
        deliveredAt: null,
        podReceivedAt: null,
        verifiedAt: null,
        invoicedAt: null,
        status: TripStatus.ASSIGNED,
        statusReason: null,
        retakeCount: 0,
        consigneeName: `${route.destination} Receiving Hub`,
        consigneePhone: `9822${String(100000 + tripCounter).slice(1)}`,
        createdAt: scheduledAt,
      });

      tripCounter++;
    }
  }

  // Explicit end-to-end test trips
  const testTrips: Prisma.TripCreateManyInput[] = [
    // 1. Own-Fleet Driver Test Trips (Assigned to driver Ramesh Pawar - 9000000001)
    {
      tripCode: "TEST-OWN-001",
      clientId: clientMap.get("Sahyadri Cements Ltd")!,
      vehicleNo: "MH20 EL 4521",
      isHired: false,
      driverId: driverMap.get("Ramesh Pawar")!,
      driverPhone: "9000000001",
      branchId: branchMap.get("Chh. Sambhajinagar")!,
      origin: "Chhatrapati Sambhajinagar",
      destination: "Mumbai",
      freight: new Prisma.Decimal(34500),
      lrNumber: "LR-TEST-OWN-001",
      ewayBillNo: "261199990001",
      goodsDescription: "Portland Pozzolana Cement",
      expectedQuantity: new Prisma.Decimal(25),
      quantityUnit: "tonnes",
      deliveredQuantity: null,
      startedAt: null,
      deliveredAt: null,
      podReceivedAt: null,
      verifiedAt: null,
      invoicedAt: null,
      status: TripStatus.ASSIGNED,
      statusReason: null,
      retakeCount: 0,
      consigneeName: "Mumbai Central Warehousing Corp",
      consigneePhone: "9822101001",
      createdAt: new Date(),
    },
    {
      tripCode: "TEST-OWN-002",
      clientId: clientMap.get("MahaSteel Ispat Corp")!,
      vehicleNo: "MH20 GT 7718",
      isHired: false,
      driverId: driverMap.get("Sunil Yadav")!,
      driverPhone: "9000000002",
      branchId: branchMap.get("Chh. Sambhajinagar")!,
      origin: "Pune",
      destination: "Nagpur",
      freight: new Prisma.Decimal(42000),
      lrNumber: "LR-TEST-OWN-002",
      ewayBillNo: "261199990002",
      goodsDescription: "TMT Rebars Fe 550D",
      expectedQuantity: new Prisma.Decimal(20),
      quantityUnit: "tonnes",
      deliveredQuantity: null,
      startedAt: null,
      deliveredAt: null,
      podReceivedAt: null,
      verifiedAt: null,
      invoicedAt: null,
      status: TripStatus.ASSIGNED,
      statusReason: null,
      retakeCount: 0,
      consigneeName: "Nagpur Metro Infrastructure Site",
      consigneePhone: "9822101002",
      createdAt: new Date(),
    },
    // 2. Hired-Driver Test Trips (Unassigned external driver, isHired: true)
    {
      tripCode: "TEST-HIRED-001",
      clientId: clientMap.get("KisanAgro Foods & Grains")!,
      vehicleNo: "MH20 FN 6101",
      isHired: true,
      driverId: null,
      driverPhone: "9876543210",
      branchId: branchMap.get("Chh. Sambhajinagar")!,
      origin: "Jalna",
      destination: "Kolhapur",
      freight: new Prisma.Decimal(36000),
      lrNumber: "LR-TEST-HIRED-001",
      ewayBillNo: "261199990003",
      goodsDescription: "Refined Wheat Flour & Grains",
      expectedQuantity: new Prisma.Decimal(500),
      quantityUnit: "bags",
      deliveredQuantity: null,
      startedAt: null,
      deliveredAt: null,
      podReceivedAt: null,
      verifiedAt: null,
      invoicedAt: null,
      status: TripStatus.UNASSIGNED,
      statusReason: null,
      retakeCount: 0,
      consigneeName: "Kolhapur Agro Distribution Depot",
      consigneePhone: "9822101003",
      createdAt: new Date(),
    },
    {
      tripCode: "TEST-HIRED-002",
      clientId: clientMap.get("Deccan FMCG Distributors")!,
      vehicleNo: "MH12 KR 8202",
      isHired: true,
      driverId: null,
      driverPhone: "9876543211",
      branchId: branchMap.get("Pune")!,
      origin: "Pune",
      destination: "Goa",
      freight: new Prisma.Decimal(35000),
      lrNumber: "LR-TEST-HIRED-002",
      ewayBillNo: "261199990004",
      goodsDescription: "FMCG Packaged Personal Care",
      expectedQuantity: new Prisma.Decimal(450),
      quantityUnit: "cartons",
      deliveredQuantity: null,
      startedAt: null,
      deliveredAt: null,
      podReceivedAt: null,
      verifiedAt: null,
      invoicedAt: null,
      status: TripStatus.UNASSIGNED,
      statusReason: null,
      retakeCount: 0,
      consigneeName: "Panaji Wholesale Logistics Terminal",
      consigneePhone: "9822101004",
      createdAt: new Date(),
    },
  ];

  await prisma.trip.createMany({
    data: [...upcomingTrips, ...testTrips],
    skipDuplicates: true,
  });

  console.log("=================================================");
  console.log("FleetProof demo primary seed completed.");
  console.log(`Branches: ${branchNames.length}`);
  console.log(`Clients: ${clientSeeds.length}`);
  console.log(`Drivers: ${driverSeeds.length}`);
  console.log(`Billing executives: ${executiveSeeds.length}`);
  console.log(`Vehicles: ${vehicleSeeds.length} (15 own, 5 hired)`);
  console.log(`Upcoming trips: ${upcomingTrips.length} (1 or 2 per driver)`);
  console.log(`Test trips created: ${testTrips.length} (2 own: TEST-OWN-001/002, 2 hired: TEST-HIRED-001/002)`);
  console.log("");
  console.log("Demo login accounts:");
  console.log("Driver phone: use one of the seeded driver phone numbers.");
  console.log("Billing emails: meena.kulkarni@example.test / amit.joshi@example.test");
  console.log("Credentials are configured through DEMO_DRIVER_PIN and BILLING_DEMO_PASSWORD.");
  console.log("Credential values are intentionally not printed.");
  console.log("=================================================");
}

main()
  .catch((error) => {
    console.error("Primary seed error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
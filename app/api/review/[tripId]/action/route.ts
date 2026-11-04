import {
  PodSubmissionStatus,
  Prisma,
  ReviewActionType,
  TripStatus,
  UserRole,
} from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/src/lib/auth/requireRole";
import { prisma } from "@/src/lib/prisma";
import { buildReviewCorrection } from "@/src/lib/review/corrections";
import { MAX_RETAKES, type RetakeReason } from "@/src/lib/verdict";

const requireBilling = requireRole(UserRole.BILLING_EXEC);
const tripIdSchema = z.uuid();
class ReviewConflictError extends Error {}
const editableFields = z
  .object({
    lr_number: z.string().max(100).nullable().optional(),
    consignee_stamp_present: z.boolean().optional(),
    signature_present: z.boolean().optional(),
    remarks_text: z.string().max(1000).optional(),
    image_readable: z.boolean().optional(),
    blurry: z.boolean().optional(),
    cropped: z.boolean().optional(),
    delivery_date: z.string().max(100).nullable().optional(),
    quantity_received: z.number().nonnegative().nullable().optional(),
    quantity_unit: z.string().max(40).nullable().optional(),
    goods_description: z.string().max(500).nullable().optional(),
    has_shortage_or_damage_remark: z.boolean().optional(),
    retake_hint: z.string().max(500).nullable().optional(),
  })
  .strict()
  .refine((fields) => Object.keys(fields).length > 0);

const retakeReasons = [
  "stamp_not_visible",
  "signature_missing",
  "blurry",
  "cropped",
  "lr_not_visible",
  "lr_mismatch",
  "quantity_unreadable",
] as const satisfies readonly RetakeReason[];

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), note: z.string().max(1000).optional() }).strict(),
  z.object({ action: z.literal("approve_with_remark"), note: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ action: z.literal("correct_fields"), fields: editableFields, note: z.string().max(1000).optional() }).strict(),
  z.object({ action: z.literal("mark_disputed"), note: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ action: z.literal("request_retake"), reason: z.enum(retakeReasons), note: z.string().max(1000).optional() }).strict(),
]);

function inputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function actionType(action: z.infer<typeof actionSchema>["action"]) {
  const mapping = {
    approve: ReviewActionType.APPROVE,
    approve_with_remark: ReviewActionType.APPROVE_WITH_REMARK,
    correct_fields: ReviewActionType.CORRECT_FIELDS,
    mark_disputed: ReviewActionType.MARK_DISPUTED,
    request_retake: ReviewActionType.REQUEST_RETAKE,
  } satisfies Record<string, ReviewActionType>;
  return mapping[action];
}

export async function POST(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  const auth = await requireBilling(request);
  if (!auth.ok) return auth.response;

  const { tripId } = await context.params;
  if (!tripIdSchema.safeParse(tripId).success) {
    return Response.json(
      { error: "Trip ID is invalid.", code: "validation_error" },
      { status: 400 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON.", code: "invalid_json" },
      { status: 400 },
    );
  }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Review action is invalid.",
        code: "validation_error",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const latest = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      podSubmissions: {
        orderBy: { attemptNo: "desc" },
        take: 1,
        include: { extraction: true },
      },
    },
  });
  if (!latest) {
    return Response.json(
      { error: "Trip not found.", code: "trip_not_found" },
      { status: 404 },
    );
  }
  if (latest.status !== TripStatus.NEEDS_REVIEW) {
    return Response.json(
      { error: "Only trips awaiting review can be actioned.", code: "trip_not_in_review" },
      { status: 409 },
    );
  }
  const submission = latest.podSubmissions[0];
  if (!submission?.extraction) {
    return Response.json(
      { error: "Trip has no extraction to review.", code: "extraction_not_found" },
      { status: 409 },
    );
  }
  const action = parsed.data;
  const before = submission.extraction.fields as Record<string, unknown>;
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  let confirmedDeliveredQuantity: number | null = null;
  if (action.action === "correct_fields") {
    const correction = buildReviewCorrection(
      before,
      action.fields,
      latest.quantityUnit,
      latest.deliveredQuantity?.toString() ?? null,
    );
    if (!correction.ok) {
      return Response.json(
        {
          error:
            correction.code === "quantity_unit_required"
              ? "Confirm the delivered quantity unit with the quantity."
              : "Confirmed delivered quantity must use the trip's expected unit.",
          code: correction.code,
        },
        { status: 400 },
      );
    }
    Object.assign(changes, correction.fieldChanges);
    confirmedDeliveredQuantity = correction.deliveredQuantity;
  } else {
    const nextStatus =
      action.action === "approve" ||
      action.action === "approve_with_remark"
        ? TripStatus.VERIFIED
        : action.action === "mark_disputed"
          ? TripStatus.DISPUTED
          : TripStatus.RETAKE_REQUESTED;
    const nextVerdict =
      action.action === "approve" ||
      action.action === "approve_with_remark"
        ? "VERIFIED"
        : action.action === "request_retake"
          ? "RETAKE"
          : "REVIEW";
    changes.status = { before: latest.status, after: nextStatus };
    changes.verdict = {
      before: submission.extraction.verdict,
      after: nextVerdict,
    };
    changes.action = { before: null, after: action.action };
  }
  if ("note" in action && action.note) {
    changes.note = { before: null, after: action.note };
  }
  if (action.action === "request_retake") {
    changes.retakeReason = {
      before: submission.retakeReason,
      after: action.reason,
    };
  }

  if (action.action === "request_retake" && latest.retakeCount >= MAX_RETAKES) {
    return Response.json(
      { error: "The retake limit has been reached.", code: "retake_limit" },
      { status: 409 },
    );
  }
  if (
    (action.action === "approve" ||
      action.action === "approve_with_remark") &&
    latest.deliveredQuantity === null
  ) {
    return Response.json(
      {
        error:
          "Confirm the actual delivered quantity before approving this trip.",
        code: "delivered_quantity_confirmation_required",
      },
      { status: 409 },
    );
  }

  let result: {
    trip: {
      id: string;
      status: TripStatus;
      statusReason: string | null;
      retakeCount: number;
      verifiedAt: Date | null;
    };
    reviewAction: { id: string; action: ReviewActionType };
  };
  try {
    result = await prisma.$transaction(async (transaction) => {
    let tripStatus: TripStatus = TripStatus.NEEDS_REVIEW;
    let statusReason = action.action === "correct_fields" ? latest.statusReason : null;
    let submissionStatus: PodSubmissionStatus = PodSubmissionStatus.REVIEW;
    let retakeReason = submission.retakeReason;
    let attemptsLeft = submission.attemptsLeft;

    switch (action.action) {
      case "approve":
      case "approve_with_remark":
        tripStatus = TripStatus.VERIFIED;
        statusReason = action.action === "approve_with_remark" ? action.note : null;
        submissionStatus = PodSubmissionStatus.VERIFIED;
        break;
      case "mark_disputed":
        tripStatus = TripStatus.DISPUTED;
        statusReason = action.note;
        break;
      case "request_retake":
        tripStatus = TripStatus.RETAKE_REQUESTED;
        statusReason = action.note ?? action.reason;
        submissionStatus = PodSubmissionStatus.RETAKE;
        retakeReason = action.reason;
        attemptsLeft = Math.max(0, MAX_RETAKES - latest.retakeCount - 1);
        break;
      case "correct_fields":
        break;
    }

    await transaction.podSubmission.update({
      where: { id: submission.id },
      data: { status: submissionStatus, retakeReason, attemptsLeft },
    });
    const claimedTrip = await transaction.trip.updateMany({
      where: {
        id: tripId,
        status: TripStatus.NEEDS_REVIEW,
        retakeCount: latest.retakeCount,
      },
      data: {
        status: tripStatus,
        statusReason,
        ...(action.action === "approve" ||
        action.action === "approve_with_remark"
          ? { verifiedAt: new Date() }
          : {}),
        ...(action.action === "request_retake"
          ? { retakeCount: { increment: 1 } }
          : {}),
        ...(confirmedDeliveredQuantity !== null
          ? {
              deliveredQuantity: new Prisma.Decimal(
                confirmedDeliveredQuantity,
              ),
            }
          : {}),
      },
    });
    if (claimedTrip.count !== 1) {
      throw new ReviewConflictError("Trip review state changed.");
    }
    const updatedTrip = await transaction.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: {
        id: true,
        status: true,
        statusReason: true,
        retakeCount: true,
        verifiedAt: true,
      },
    });
    const reviewAction = await transaction.reviewAction.create({
      data: {
        tripId,
        reviewerId: auth.session.userId,
        action: actionType(action.action),
        fieldChanges: inputJson(changes),
        note: "note" in action ? action.note ?? null : null,
      },
    });
    return { trip: updatedTrip, reviewAction };
    });
  } catch (error) {
    if (error instanceof ReviewConflictError) {
      return Response.json(
        { error: "Trip review state changed. Refresh and retry.", code: "review_state_conflict" },
        { status: 409 },
      );
    }
    throw error;
  }

  return Response.json(result);
}

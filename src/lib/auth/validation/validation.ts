import { UserRole } from "@prisma/client";
import { z } from "zod";

const driverLoginSchema = z
  .object({
    role: z.literal(UserRole.DRIVER),
    phone: z.string().regex(/^\+?[0-9]{10,15}$/),
    pin: z.string().regex(/^[0-9]{4}$/),
  })
  .strict();

const billingLoginSchema = z
  .object({
    role: z.literal(UserRole.BILLING_EXEC),
    email: z.string().trim().email().transform((email) => email.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();

export const loginSchema = z.discriminatedUnion("role", [
  driverLoginSchema,
  billingLoginSchema,
]);

export function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

import { z } from "zod";
import { MAX_UNIT_PRICE_CENTS, parseMoneyToCents } from "@/lib/money";

/** Trimmed optional text: "" → undefined. */
export const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .optional()
    .transform((v) => (v ? v : undefined));

export const reqText = (max: number, label = "This field") =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `Must be ${max} characters or fewer`);

export const optEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.email("Enter a valid email address").optional());

export const uuid = z.uuid("Invalid identifier");

export const INDUSTRIES = ["hvac", "plumbing", "electrical", "roofing", "general"] as const;
export const INDUSTRY_LABELS: Record<(typeof INDUSTRIES)[number], string> = {
  hvac: "HVAC",
  plumbing: "Plumbing",
  electrical: "Electrical",
  roofing: "Roofing",
  general: "General field service",
};

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Use 128 characters or fewer")
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), "Include at least one letter and one number");

export const registerSchema = z.object({
  fullName: reqText(120, "Your name"),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(1, "Password is required").max(128),
});

export const createOrganizationSchema = z.object({
  name: reqText(120, "Company name"),
  industry: z.enum(INDUSTRIES).default("hvac"),
});

const percentToBps = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return 0;
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(v)) {
      ctx.addIssue({ code: "custom", message: "Enter a percentage like 8.25" });
      return z.NEVER;
    }
    const [whole, frac = ""] = v.split(".");
    const bps = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
    if (bps > 10000) {
      ctx.addIssue({ code: "custom", message: "Tax rate cannot exceed 100%" });
      return z.NEVER;
    }
    return bps;
  });

export const organizationSettingsSchema = z.object({
  name: reqText(120, "Company name"),
  industry: z.enum(INDUSTRIES),
  phone: optText(40),
  email: optEmail,
  website: optText(200),
  addressLine1: optText(200),
  addressLine2: optText(200),
  city: optText(100),
  region: optText(100),
  postalCode: optText(20),
  timezone: reqText(64, "Time zone"),
  defaultTaxRatePercent: percentToBps,
  estimateValidityDays: z.coerce.number().int().min(1, "At least 1 day").max(365, "At most 365 days"),
  estimateTerms: optText(5000),
});

export const followUpSettingsSchema = z.object({
  followUpEnabled: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  followUpOffsetsDays: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (!v) return [] as number[];
      const parts = v.split(/[\s,]+/).filter(Boolean).map(Number);
      if (parts.some((n) => !Number.isInteger(n) || n < 1 || n > 365)) {
        ctx.addIssue({ code: "custom", message: "Use whole numbers of days between 1 and 365, e.g. 2, 5, 10" });
        return z.NEVER;
      }
      if (parts.length > 6) {
        ctx.addIssue({ code: "custom", message: "At most 6 reminders" });
        return z.NEVER;
      }
      return [...new Set(parts)].sort((a, b) => a - b);
    }),
});

export const customerSchema = z.object({
  name: reqText(160, "Customer name"),
  companyName: optText(160),
  email: optEmail,
  phone: optText(40),
  addressLine1: optText(200),
  addressLine2: optText(200),
  city: optText(100),
  region: optText(100),
  postalCode: optText(20),
  notes: optText(5000),
});
export type CustomerInput = z.infer<typeof customerSchema>;

export const invitationSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  role: z.enum(["admin", "technician"]),
});

/** FormData → plain object of strings (multi-value keys become arrays). */
export function formToObject(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    if (k.startsWith("$ACTION")) continue;
    const prev = out[k];
    if (prev === undefined) out[k] = v;
    else out[k] = Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase 2
// ---------------------------------------------------------------------------

export const moneyField = (label = "Price") =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .transform((v, ctx) => {
      const cents = parseMoneyToCents(v);
      if (cents === null || cents > MAX_UNIT_PRICE_CENTS) {
        ctx.addIssue({ code: "custom", message: `Enter ${label.toLowerCase()} like 129.00` });
        return z.NEVER;
      }
      return cents;
    });

export const priceBookItemSchema = z.object({
  name: reqText(160, "Service name"),
  description: optText(2000),
  category: optText(80),
  sku: optText(60),
  unitPrice: moneyField("Unit price"),
  unit: reqText(30, "Unit"),
  taxClass: z.enum(["taxable", "non_taxable"]),
  isActive: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});

export const JOB_STATUSES = ["new", "scheduled", "in_progress", "on_hold", "completed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  new: "New",
  scheduled: "Scheduled",
  in_progress: "In progress",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

const optUuid = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.uuid("Invalid selection").optional());

/** datetime-local value ("2026-11-20T09:30") interpreted in the organization's time zone by the caller. */
const optLocalDateTime = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter a valid date and time").optional());

export const jobSchema = z.object({
  customerId: z.uuid("Choose a customer"),
  title: reqText(160, "Job title"),
  status: z.enum(JOB_STATUSES).default("new"),
  serviceAddressLine1: optText(200),
  serviceAddressLine2: optText(200),
  serviceCity: optText(100),
  serviceRegion: optText(100),
  servicePostalCode: optText(20),
  equipmentType: optText(120),
  equipmentMake: optText(120),
  equipmentModel: optText(120),
  equipmentSerial: optText(120),
  equipmentAgeYears: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 150) {
        ctx.addIssue({ code: "custom", message: "Enter whole years between 0 and 150" });
        return z.NEVER;
      }
      return n;
    }),
  equipmentNotes: optText(2000),
  description: optText(5000),
  technicianObservations: optText(10000),
  internalNotes: optText(5000),
  assignedTechnicianId: optUuid,
  appointmentLocal: optLocalDateTime,
});
export type JobInput = z.infer<typeof jobSchema>;

/** Fields a technician may update on a job assigned to them. */
export const technicianJobUpdateSchema = jobSchema.pick({
  status: true,
  serviceAddressLine1: true,
  serviceAddressLine2: true,
  serviceCity: true,
  serviceRegion: true,
  servicePostalCode: true,
  equipmentType: true,
  equipmentMake: true,
  equipmentModel: true,
  equipmentSerial: true,
  equipmentAgeYears: true,
  equipmentNotes: true,
  description: true,
  technicianObservations: true,
});

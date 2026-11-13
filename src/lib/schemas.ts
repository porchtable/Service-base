import { z } from "zod";

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

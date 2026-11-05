import { z } from 'zod';

export const ASSET_STATUSES = ['ACTIVE', 'MAINTENANCE', 'RETIRED', 'LOST', 'DISPOSED'] as const;
export const INSURANCE_STATUSES = ['INSURED', 'UNINSURED', 'UNDER_REVIEW'] as const;
export const WIPE_METHODS = [
  'NIST_SP_800_88',
  'DOD_5220_22_M',
  'PHYSICAL_DESTRUCTION',
  'FACTORY_RESET',
  'DEGAUSSING',
] as const;

/** Accepts `YYYY-MM-DD` or a full ISO-8601 datetime. */
const dateInput = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

const assetFields = {
  name: z.string().trim().min(1).max(255),
  /** Category name, case-insensitive (e.g. "Hardware"). Must already exist. */
  category: z.string().trim().min(1).max(100),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED', 'LOST']),
  location: z.string().max(500),
  notes: z.string().max(2000),
  assigneeId: z.string().min(1),
  /** Department name, case-insensitive. Must already exist. */
  department: z.string().trim().min(1).max(100),
  serialNumber: z.string().max(255),
  manufacturer: z.string().max(255),
  model: z.string().max(255),
  specification: z.string().max(2000),
  vendor: z.string().max(255),
  purchaseDate: dateInput,
  purchaseCost: z.number().nonnegative().max(1e12),
  warrantyExpiry: dateInput,
  insuranceStatus: z.enum(INSURANCE_STATUSES),
  policyRef: z.string().max(255),
  usefulLifeYears: z.number().int().min(1).max(100),
};

export const createAssetSchema = z.object({
  /** Optional: generated from the category prefix when omitted (e.g. HW-48213). */
  assetId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]{1,49}$/, 'Asset ID may contain letters, numbers and dashes (2-50 chars)')
    .optional(),
  name: assetFields.name,
  category: assetFields.category,
  status: assetFields.status.optional(),
  location: assetFields.location.optional(),
  notes: assetFields.notes.optional(),
  assigneeId: assetFields.assigneeId.nullable().optional(),
  department: assetFields.department.nullable().optional(),
  serialNumber: assetFields.serialNumber.optional(),
  manufacturer: assetFields.manufacturer.optional(),
  model: assetFields.model.optional(),
  specification: assetFields.specification.optional(),
  vendor: assetFields.vendor.optional(),
  purchaseDate: assetFields.purchaseDate.optional(),
  purchaseCost: assetFields.purchaseCost.optional(),
  warrantyExpiry: assetFields.warrantyExpiry.optional(),
  insuranceStatus: assetFields.insuranceStatus.optional(),
  policyRef: assetFields.policyRef.optional(),
  usefulLifeYears: assetFields.usefulLifeYears.optional(),
});

export const updateAssetSchema = z
  .object({
    name: assetFields.name.optional(),
    category: assetFields.category.optional(),
    status: assetFields.status.optional(),
    location: assetFields.location.nullable().optional(),
    notes: assetFields.notes.nullable().optional(),
    assigneeId: assetFields.assigneeId.nullable().optional(),
    department: assetFields.department.nullable().optional(),
    serialNumber: assetFields.serialNumber.nullable().optional(),
    manufacturer: assetFields.manufacturer.nullable().optional(),
    model: assetFields.model.nullable().optional(),
    specification: assetFields.specification.nullable().optional(),
    vendor: assetFields.vendor.nullable().optional(),
    purchaseDate: assetFields.purchaseDate.nullable().optional(),
    purchaseCost: assetFields.purchaseCost.nullable().optional(),
    warrantyExpiry: assetFields.warrantyExpiry.nullable().optional(),
    insuranceStatus: assetFields.insuranceStatus.nullable().optional(),
    policyRef: assetFields.policyRef.nullable().optional(),
    usefulLifeYears: assetFields.usefulLifeYears.nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  });

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

export const listAssetsQuerySchema = z.object({
  search: z.string().max(255).optional(),
  /** Comma-separated category names. */
  category: z.string().max(500).optional(),
  /** Comma-separated statuses. */
  status: z.string().max(200).optional(),
  /** Comma-separated department names. */
  department: z.string().max(500).optional(),
  /** Comma-separated assignee user IDs. */
  assignee: z.string().max(1000).optional(),
  /** Comma-separated insurance statuses. */
  insurance: z.string().max(200).optional(),
  sort: z
    .enum(['registered_desc', 'registered_asc', 'name_asc', 'name_desc', 'warranty_asc', 'warranty_desc'])
    .default('registered_desc'),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;

export const checkoutSchema = z.object({
  assigneeId: z.string().min(1),
  dueDate: z.iso.date(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const serviceRecordSchema = z.object({
  serviceDate: dateInput,
  technician: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(2000),
  cost: z.number().nonnegative().max(1e12),
});
export type ServiceRecordInput = z.infer<typeof serviceRecordSchema>;

export const disposeSchema = z.object({
  wipedBy: z.string().trim().min(1).max(255),
  wipeMethod: z.enum(WIPE_METHODS),
  disposalDate: dateInput.optional(),
  notes: z.string().max(2000).optional(),
  /** Must be true: the operator attests the device was wiped per policy. */
  confirmed: z.literal(true, { error: 'You must confirm the data has been wiped' }),
});
export type DisposeInput = z.infer<typeof disposeSchema>;

export const importAssetsSchema = z.object({
  csv: z.string().min(1).max(1_000_000),
});
export type ImportAssetsInput = z.infer<typeof importAssetsSchema>;

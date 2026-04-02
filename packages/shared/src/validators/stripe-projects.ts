import { z } from "zod";
import {
  STRIPE_PROJECT_CONNECTION_STATUSES,
  STRIPE_PROVISIONED_SERVICE_STATUSES,
} from "../constants.js";

// ---------- Request schemas ----------

export const initStripeProjectSchema = z.object({
  name: z.string().min(1),
  directory: z.string().optional().nullable(),
});

export type InitStripeProject = z.infer<typeof initStripeProjectSchema>;

export const addStripeServiceSchema = z.object({
  providerService: z.string().min(1),
});

export type AddStripeService = z.infer<typeof addStripeServiceSchema>;

export const stripeCatalogQuerySchema = z.object({
  category: z.string().optional(),
});

export type StripeCatalogQuery = z.infer<typeof stripeCatalogQuerySchema>;

// ---------- Response schemas ----------

export const stripeProjectConnectionSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  projectId: z.string().uuid(),
  stripeProjectName: z.string(),
  stripeProjectDir: z.string().nullable(),
  status: z.enum(STRIPE_PROJECT_CONNECTION_STATUSES),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const stripeProvisionedServiceSchema = z.object({
  id: z.string().uuid(),
  connectionId: z.string().uuid(),
  providerService: z.string(),
  provider: z.string(),
  serviceType: z.string(),
  tier: z.string().nullable(),
  status: z.enum(STRIPE_PROVISIONED_SERVICE_STATUSES),
  resourceMetadata: z.record(z.unknown()).nullable(),
  provisionedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const stripeCatalogServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  category: z.string(),
  description: z.string().optional(),
});

export const stripeProjectStatusSchema = z.object({
  name: z.string(),
  directory: z.string().nullable(),
  services: z.array(stripeProvisionedServiceSchema),
  status: z.string(),
});

export const stripeSyncResultSchema = z.object({
  synced: z.boolean(),
  secretsCount: z.number().int(),
});

export const stripeRotateResultSchema = z.object({
  rotated: z.boolean(),
});

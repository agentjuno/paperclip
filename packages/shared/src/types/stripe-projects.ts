import type { StripeProjectConnectionStatus, StripeProvisionedServiceStatus } from "../constants.js";

export interface StripeProjectConnection {
  id: string;
  companyId: string;
  projectId: string;
  stripeProjectName: string;
  stripeProjectDir: string | null;
  status: StripeProjectConnectionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface StripeProvisionedService {
  id: string;
  connectionId: string;
  providerService: string;
  provider: string;
  serviceType: string;
  tier: string | null;
  status: StripeProvisionedServiceStatus;
  resourceMetadata: Record<string, unknown> | null;
  provisionedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface StripeCatalogService {
  id: string;
  name: string;
  provider: string;
  category: string;
  description?: string;
}

export interface StripeProjectStatus {
  name: string;
  directory: string | null;
  services: StripeProvisionedService[];
  status: string;
}

export interface StripeSyncResult {
  synced: boolean;
  secretsCount: number;
}

export interface StripeRotateResult {
  rotated: boolean;
}

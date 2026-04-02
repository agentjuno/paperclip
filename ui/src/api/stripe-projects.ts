import type {
  StripeCatalogService,
  StripeProjectConnection,
  StripeProvisionedService,
  StripeProjectStatus,
  StripeSyncResult,
  StripeRotateResult,
} from "@paperclipai/shared";
import { api } from "./client";

function projectBase(companyId: string, projectId: string) {
  return `/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/stripe-projects`;
}

export const stripeProjectsApi = {
  /** List available services from the Stripe Projects catalog. */
  catalog: (companyId: string, category?: string) => {
    const qs = category ? `?category=${encodeURIComponent(category)}` : "";
    return api.get<StripeCatalogService[]>(
      `/companies/${encodeURIComponent(companyId)}/stripe-projects/catalog${qs}`,
    );
  },

  /** Initialize a Stripe Project for the given Paperclip project. */
  init: (companyId: string, projectId: string, name: string) =>
    api.post<StripeProjectConnection>(`${projectBase(companyId, projectId)}/init`, { name }),

  /** Get Stripe Project status for a project. */
  status: (companyId: string, projectId: string) =>
    api.get<StripeProjectStatus>(`${projectBase(companyId, projectId)}/status`),

  /** List provisioned services for a project. */
  listServices: (companyId: string, projectId: string) =>
    api.get<StripeProvisionedService[]>(`${projectBase(companyId, projectId)}/services`),

  /** Add a service to the project. */
  addService: (companyId: string, projectId: string, providerService: string) =>
    api.post<StripeProvisionedService>(`${projectBase(companyId, projectId)}/services`, {
      providerService,
    }),

  /** Remove a provisioned service. */
  removeService: (companyId: string, projectId: string, serviceId: string) =>
    api.delete<{ ok: true }>(
      `${projectBase(companyId, projectId)}/services/${encodeURIComponent(serviceId)}`,
    ),

  /** Sync credentials from Stripe into company secrets. */
  sync: (companyId: string, projectId: string) =>
    api.post<StripeSyncResult>(`${projectBase(companyId, projectId)}/sync`, {}),

  /** Rotate credentials for a specific service. */
  rotate: (companyId: string, projectId: string, serviceId: string) =>
    api.post<StripeRotateResult>(
      `${projectBase(companyId, projectId)}/services/${encodeURIComponent(serviceId)}/rotate`,
      {},
    ),
};

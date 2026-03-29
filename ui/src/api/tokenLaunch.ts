import type { CompanyTokenLaunch, CompanyTokenLaunchDraft } from "@paperclipai/shared";
import { api } from "./client";

export const tokenLaunchApi = {
  get: (companyId: string) =>
    api.get<CompanyTokenLaunch>(`/companies/${companyId}/token-launch`),
  update: (companyId: string, draft: CompanyTokenLaunchDraft) =>
    api.patch<CompanyTokenLaunch>(`/companies/${companyId}/token-launch`, draft),
  simulate: (companyId: string) =>
    api.post<CompanyTokenLaunch>(`/companies/${companyId}/token-launch/simulate`, {}),
  submit: (companyId: string) =>
    api.post<CompanyTokenLaunch>(`/companies/${companyId}/token-launch/submit`, {}),
  confirm: (companyId: string, requestId: string) =>
    api.post<CompanyTokenLaunch>(
      `/companies/${companyId}/token-launch/requests/${requestId}/confirm`,
      {},
    ),
};

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { companyRoutes } from "../routes/companies.js";
import { errorHandler } from "../middleware/index.js";

const mockCompanyService = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  ensureMembership: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockCompanyPortabilityService = vi.hoisted(() => ({
  exportBundle: vi.fn(),
  previewExport: vi.fn(),
  previewImport: vi.fn(),
  importBundle: vi.fn(),
}));

const mockStripeBillingService = vi.hoisted(() => ({
  getCustomerByPrivyUserId: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  budgetService: () => mockBudgetService,
  companyPortabilityService: () => mockCompanyPortabilityService,
  companyService: () => mockCompanyService,
  stripeBillingService: () => mockStripeBillingService,
  logActivity: mockLogActivity,
}));

function createCompany() {
  const now = new Date("2026-04-06T13:00:00.000Z");
  return {
    id: "company-1",
    name: "ZHC Institute",
    description: null,
    status: "active",
    issuePrefix: "ZHC",
    issueCounter: 0,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    requireBoardApprovalForNewAgents: false,
    brandColor: null,
    logoAssetId: null,
    logoUrl: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createApp(
  actor: Record<string, unknown>,
  opts: { allowSelfServeCreation?: boolean } = {},
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api/companies", companyRoutes({} as any, undefined, opts));
  app.use(errorHandler);
  return app;
}

describe("POST /api/companies", () => {
  beforeEach(() => {
    mockCompanyService.create.mockReset();
    mockAccessService.ensureMembership.mockReset();
    mockBudgetService.upsertPolicy.mockReset();
    mockStripeBillingService.getCustomerByPrivyUserId.mockReset();
    mockLogActivity.mockReset();
  });

  it("allows hosted session users with active subscriptions to create companies", async () => {
    const company = createCompany();
    mockCompanyService.create.mockResolvedValue(company);
    mockStripeBillingService.getCustomerByPrivyUserId.mockResolvedValue({
      subscriptionStatus: "active",
    });
    const app = createApp(
      {
        type: "board",
        userId: "did:privy:user_123",
        source: "session",
        isInstanceAdmin: false,
      },
      { allowSelfServeCreation: true },
    );

    const res = await request(app).post("/api/companies").send({ name: "ZHC Institute" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("ZHC Institute");
    expect(mockCompanyService.create).toHaveBeenCalledWith({
      name: "ZHC Institute",
      budgetMonthlyCents: 0,
    });
    expect(mockAccessService.ensureMembership).toHaveBeenCalledWith(
      "company-1",
      "user",
      "did:privy:user_123",
      "owner",
      "active",
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        actorType: "user",
        actorId: "did:privy:user_123",
        action: "company.created",
      }),
    );
  });

  it("rejects hosted session users when their subscription is inactive", async () => {
    mockStripeBillingService.getCustomerByPrivyUserId.mockResolvedValue({
      subscriptionStatus: "none",
    });
    const app = createApp(
      {
        type: "board",
        userId: "did:privy:user_123",
        source: "session",
        isInstanceAdmin: false,
      },
      { allowSelfServeCreation: true },
    );

    const res = await request(app).post("/api/companies").send({ name: "ZHC Institute" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Active subscription required");
    expect(mockCompanyService.create).not.toHaveBeenCalled();
  });

  it("keeps instance-admin creation rules outside hosted self-serve mode", async () => {
    const app = createApp({
      type: "board",
      userId: "did:privy:user_123",
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app).post("/api/companies").send({ name: "ZHC Institute" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Instance admin required");
    expect(mockCompanyService.create).not.toHaveBeenCalled();
    expect(mockStripeBillingService.getCustomerByPrivyUserId).not.toHaveBeenCalled();
  });
});

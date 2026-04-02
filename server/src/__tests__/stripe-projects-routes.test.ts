import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockStripeProjectsService = vi.hoisted(() => ({
  catalog: vi.fn(),
  init: vi.fn(),
  status: vi.fn(),
  listServices: vi.fn(),
  addService: vi.fn(),
  removeService: vi.fn(),
  syncCredentials: vi.fn(),
  rotateCredentials: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

const mockProjectService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  stripeProjectsService: () => mockStripeProjectsService,
  projectService: () => mockProjectService,
  logActivity: mockLogActivity,
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

// Lazy-import route factory after mocks are wired
async function loadRoutes() {
  const mod = await import("../routes/stripe-projects.js");
  return mod.stripeProjectRoutes;
}

interface ActorOverrides {
  type?: string;
  userId?: string;
  companyIds?: string[];
  source?: string;
  isInstanceAdmin?: boolean;
  companyId?: string;
  agentId?: string;
}

function boardActor(overrides: ActorOverrides = {}): Record<string, unknown> {
  return {
    type: "board",
    userId: "user-1",
    companyIds: ["company-1"],
    source: "local_implicit",
    isInstanceAdmin: false,
    ...overrides,
  };
}

function nonBoardActor(overrides: ActorOverrides = {}): Record<string, unknown> {
  return {
    type: "agent",
    agentId: "agent-1",
    companyId: "company-1",
    runId: "run-1",
    ...overrides,
  };
}

function noActor(): Record<string, unknown> {
  return { type: "none" };
}

async function createApp(actor: Record<string, unknown> = boardActor()) {
  const stripeProjectRoutes = await loadRoutes();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", stripeProjectRoutes({} as any));
  app.use(errorHandler);
  return app;
}

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const COMPANY_ID = "company-1";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";
const SERVICE_ID = "33333333-3333-4333-8333-333333333333";

const sampleConnection = {
  id: CONNECTION_ID,
  companyId: COMPANY_ID,
  projectId: PROJECT_ID,
  stripeProjectName: "my-project",
  stripeProjectDir: "/tmp/proj",
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const sampleCatalogItem = {
  id: "vercel-project",
  name: "Vercel Project",
  provider: "vercel",
  category: "hosting",
  description: "A Vercel hosting project",
};

const sampleProvisionedService = {
  id: SERVICE_ID,
  connectionId: CONNECTION_ID,
  providerService: "vercel/project",
  provider: "vercel",
  serviceType: "project",
  tier: "pro",
  status: "active",
  resourceMetadata: { url: "https://my-app.vercel.app" },
  provisionedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const sampleStatus = {
  name: "my-project",
  directory: "/tmp/proj",
  services: [],
  status: "active",
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("stripe-projects routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogActivity.mockResolvedValue(undefined);
    // Default: project exists with the test company
    mockProjectService.getById.mockResolvedValue({
      id: PROJECT_ID,
      companyId: COMPANY_ID,
      name: "Test Project",
    });
  });

  /* ---------------------------------------------------------------- */
  /*  VAL-API-001: GET catalog returns available services              */
  /* ---------------------------------------------------------------- */
  describe("GET /companies/:companyId/stripe-projects/catalog", () => {
    it("returns 200 with array of service objects", async () => {
      mockStripeProjectsService.catalog.mockResolvedValue([sampleCatalogItem]);
      const app = await createApp();

      const res = await request(app)
        .get(`/api/companies/${COMPANY_ID}/stripe-projects/catalog`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([sampleCatalogItem]);
      expect(mockStripeProjectsService.catalog).toHaveBeenCalledWith(undefined);
    });

    /* VAL-API-002: GET catalog supports category filter */
    it("passes category query parameter to service", async () => {
      mockStripeProjectsService.catalog.mockResolvedValue([sampleCatalogItem]);
      const app = await createApp();

      const res = await request(app)
        .get(`/api/companies/${COMPANY_ID}/stripe-projects/catalog?category=hosting`);

      expect(res.status).toBe(200);
      expect(mockStripeProjectsService.catalog).toHaveBeenCalledWith("hosting");
    });

    /* VAL-API-019: Catalog accessible to all company members */
    it("allows non-board (agent) access to catalog", async () => {
      mockStripeProjectsService.catalog.mockResolvedValue([sampleCatalogItem]);
      const app = await createApp(nonBoardActor());

      const res = await request(app)
        .get(`/api/companies/${COMPANY_ID}/stripe-projects/catalog`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([sampleCatalogItem]);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  VAL-API-003: POST init creates a Stripe project                  */
  /* ---------------------------------------------------------------- */
  describe("POST /companies/:companyId/projects/:projectId/stripe-projects/init", () => {
    it("returns 201 with created connection record", async () => {
      mockStripeProjectsService.init.mockResolvedValue(sampleConnection);
      const app = await createApp();

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/init`)
        .send({ name: "my-project" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: CONNECTION_ID,
        projectId: PROJECT_ID,
      });
      expect(mockStripeProjectsService.init).toHaveBeenCalledWith(
        COMPANY_ID,
        PROJECT_ID,
        "my-project",
      );
    });

    /* VAL-API-017: init creates activity log entry */
    it("logs an activity entry on init", async () => {
      mockStripeProjectsService.init.mockResolvedValue(sampleConnection);
      const app = await createApp();

      await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/init`)
        .send({ name: "my-project" });

      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          companyId: COMPANY_ID,
          action: "stripe_project.initialized",
          entityType: "stripe_project_connection",
          entityId: CONNECTION_ID,
        }),
      );
    });

    /* VAL-API-015: Duplicate init returns 409 */
    it("returns 409 when service throws conflict", async () => {
      const { HttpError } = await import("../errors.js");
      mockStripeProjectsService.init.mockRejectedValue(
        new HttpError(409, "Stripe project already initialized for this company and project"),
      );
      const app = await createApp();

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/init`)
        .send({ name: "my-project" });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain("already initialized");
    });

    /* VAL-API-012: Invalid request bodies return 400 */
    it("returns 400 when name is missing", async () => {
      const app = await createApp();

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/init`)
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 400 when name is empty string", async () => {
      const app = await createApp();

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/init`)
        .send({ name: "" });

      expect(res.status).toBe(400);
    });

    it("returns 400 when name is a number", async () => {
      const app = await createApp();

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/init`)
        .send({ name: 12345 });

      expect(res.status).toBe(400);
    });

    /* VAL-API-013: Non-existent project returns 404 */
    it("returns 404 for non-existent project", async () => {
      mockProjectService.getById.mockResolvedValue(null);
      const app = await createApp();

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/init`)
        .send({ name: "my-project" });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Project not found");
    });

    /* VAL-API-018: Board-only access enforcement on mutation endpoints */
    it("returns 403 for non-board actor", async () => {
      const app = await createApp(nonBoardActor());

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/init`)
        .send({ name: "my-project" });

      expect(res.status).toBe(403);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  VAL-API-004: GET status returns Stripe project status            */
  /* ---------------------------------------------------------------- */
  describe("GET /companies/:companyId/projects/:projectId/stripe-projects/status", () => {
    it("returns 200 with status info", async () => {
      mockStripeProjectsService.status.mockResolvedValue(sampleStatus);
      // Simulate that connection exists for this project
      mockStripeProjectsService.listServices.mockResolvedValue([]);
      const app = await createApp();

      const res = await request(app)
        .get(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/status`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: "my-project",
        status: "active",
      });
    });

    it("returns 404 for non-existent project", async () => {
      mockProjectService.getById.mockResolvedValue(null);
      const app = await createApp();

      const res = await request(app)
        .get(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/status`);

      expect(res.status).toBe(404);
    });

    /* VAL-API-016: Operations before init return precondition error */
    it("returns 404/409 when connection does not exist", async () => {
      const { HttpError } = await import("../errors.js");
      mockStripeProjectsService.status.mockRejectedValue(
        new HttpError(404, "Stripe project connection not found"),
      );
      const app = await createApp();

      const res = await request(app)
        .get(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/status`);

      expect(res.status).toBe(404);
    });

    it("returns 403 for non-board actor", async () => {
      const app = await createApp(nonBoardActor());

      const res = await request(app)
        .get(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/status`);

      expect(res.status).toBe(403);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  VAL-API-005: GET services lists provisioned services             */
  /* ---------------------------------------------------------------- */
  describe("GET /companies/:companyId/projects/:projectId/stripe-projects/services", () => {
    it("returns 200 with array of service objects", async () => {
      mockStripeProjectsService.listServices.mockResolvedValue([sampleProvisionedService]);
      const app = await createApp();

      const res = await request(app)
        .get(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0]).toMatchObject({
        id: SERVICE_ID,
        providerService: "vercel/project",
      });
    });

    it("returns 404 for non-existent project", async () => {
      mockProjectService.getById.mockResolvedValue(null);
      const app = await createApp();

      const res = await request(app)
        .get(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services`);

      expect(res.status).toBe(404);
    });

    it("returns 403 for non-board actor", async () => {
      const app = await createApp(nonBoardActor());

      const res = await request(app)
        .get(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services`);

      expect(res.status).toBe(403);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  VAL-API-006: POST services adds a service                        */
  /* ---------------------------------------------------------------- */
  describe("POST /companies/:companyId/projects/:projectId/stripe-projects/services", () => {
    it("returns 201 with provisioned service record", async () => {
      mockStripeProjectsService.addService.mockResolvedValue(sampleProvisionedService);
      const app = await createApp();

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services`)
        .send({ providerService: "vercel/project" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: SERVICE_ID,
        providerService: "vercel/project",
      });
    });

    /* VAL-API-012: Invalid request bodies return 400 */
    it("returns 400 when providerService is missing", async () => {
      const app = await createApp();

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services`)
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 400 when providerService is empty", async () => {
      const app = await createApp();

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services`)
        .send({ providerService: "" });

      expect(res.status).toBe(400);
    });

    /* VAL-API-017: Mutations create activity log entries */
    it("logs an activity entry on add service", async () => {
      mockStripeProjectsService.addService.mockResolvedValue(sampleProvisionedService);
      const app = await createApp();

      await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services`)
        .send({ providerService: "vercel/project" });

      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          companyId: COMPANY_ID,
          action: "stripe_project.service_added",
          entityType: "stripe_provisioned_service",
          entityId: SERVICE_ID,
        }),
      );
    });

    /* VAL-API-016: Operations before init return precondition error */
    it("returns 404 when connection does not exist (no init)", async () => {
      const { HttpError } = await import("../errors.js");
      mockStripeProjectsService.addService.mockRejectedValue(
        new HttpError(404, "Stripe project connection not found"),
      );
      const app = await createApp();

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services`)
        .send({ providerService: "vercel/project" });

      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent project", async () => {
      mockProjectService.getById.mockResolvedValue(null);
      const app = await createApp();

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services`)
        .send({ providerService: "vercel/project" });

      expect(res.status).toBe(404);
    });

    it("returns 403 for non-board actor", async () => {
      const app = await createApp(nonBoardActor());

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services`)
        .send({ providerService: "vercel/project" });

      expect(res.status).toBe(403);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  VAL-API-007: DELETE service removes a service                    */
  /* ---------------------------------------------------------------- */
  describe("DELETE /companies/:companyId/projects/:projectId/stripe-projects/services/:serviceId", () => {
    it("returns 200 on successful removal", async () => {
      mockStripeProjectsService.removeService.mockResolvedValue(undefined);
      const app = await createApp();

      const res = await request(app)
        .delete(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services/${SERVICE_ID}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true });
    });

    /* VAL-API-014: Non-existent service returns 404 */
    it("returns 404 for non-existent service", async () => {
      const { HttpError } = await import("../errors.js");
      mockStripeProjectsService.removeService.mockRejectedValue(
        new HttpError(404, "Provisioned service not found"),
      );
      const app = await createApp();

      const res = await request(app)
        .delete(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services/${SERVICE_ID}`);

      expect(res.status).toBe(404);
    });

    /* VAL-API-017: Mutations create activity log entries */
    it("logs an activity entry on remove service", async () => {
      mockStripeProjectsService.removeService.mockResolvedValue(undefined);
      const app = await createApp();

      await request(app)
        .delete(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services/${SERVICE_ID}`);

      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          companyId: COMPANY_ID,
          action: "stripe_project.service_removed",
          entityType: "stripe_provisioned_service",
          entityId: SERVICE_ID,
        }),
      );
    });

    it("returns 403 for non-board actor", async () => {
      const app = await createApp(nonBoardActor());

      const res = await request(app)
        .delete(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services/${SERVICE_ID}`);

      expect(res.status).toBe(403);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  VAL-API-008: POST sync pushes credentials to company secrets     */
  /* ---------------------------------------------------------------- */
  describe("POST /companies/:companyId/projects/:projectId/stripe-projects/sync", () => {
    it("returns 200 with sync result", async () => {
      mockStripeProjectsService.syncCredentials.mockResolvedValue({
        synced: true,
        secretsCount: 3,
      });
      const app = await createApp();

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/sync`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        synced: true,
        secretsCount: 3,
      });
    });

    /* VAL-API-017: Mutations create activity log entries */
    it("logs an activity entry on sync", async () => {
      mockStripeProjectsService.syncCredentials.mockResolvedValue({
        synced: true,
        secretsCount: 2,
      });
      const app = await createApp();

      await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/sync`);

      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          companyId: COMPANY_ID,
          action: "stripe_project.credentials_synced",
          entityType: "stripe_project_connection",
        }),
      );
    });

    it("returns 404 for non-existent project", async () => {
      mockProjectService.getById.mockResolvedValue(null);
      const app = await createApp();

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/sync`);

      expect(res.status).toBe(404);
    });

    it("returns 403 for non-board actor", async () => {
      const app = await createApp(nonBoardActor());

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/sync`);

      expect(res.status).toBe(403);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  VAL-API-009: POST rotate regenerates service credentials         */
  /* ---------------------------------------------------------------- */
  describe("POST /companies/:companyId/projects/:projectId/stripe-projects/services/:serviceId/rotate", () => {
    it("returns 200 with rotate result", async () => {
      mockStripeProjectsService.rotateCredentials.mockResolvedValue({
        rotated: true,
      });
      const app = await createApp();

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services/${SERVICE_ID}/rotate`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ rotated: true });
    });

    /* VAL-API-014: Non-existent service returns 404 */
    it("returns 404 for non-existent service", async () => {
      const { HttpError } = await import("../errors.js");
      mockStripeProjectsService.rotateCredentials.mockRejectedValue(
        new HttpError(404, "Provisioned service not found"),
      );
      const app = await createApp();

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services/${SERVICE_ID}/rotate`);

      expect(res.status).toBe(404);
    });

    /* VAL-API-017: Mutations create activity log entries */
    it("logs an activity entry on rotate", async () => {
      mockStripeProjectsService.rotateCredentials.mockResolvedValue({
        rotated: true,
      });
      const app = await createApp();

      await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services/${SERVICE_ID}/rotate`);

      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          companyId: COMPANY_ID,
          action: "stripe_project.credentials_rotated",
          entityType: "stripe_provisioned_service",
          entityId: SERVICE_ID,
        }),
      );
    });

    it("returns 403 for non-board actor", async () => {
      const app = await createApp(nonBoardActor());

      const res = await request(app)
        .post(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services/${SERVICE_ID}/rotate`);

      expect(res.status).toBe(403);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  VAL-API-010: Unauthenticated requests return 401                 */
  /* ---------------------------------------------------------------- */
  describe("unauthenticated requests", () => {
    const endpoints = [
      { method: "get" as const, path: `/api/companies/${COMPANY_ID}/stripe-projects/catalog` },
      { method: "post" as const, path: `/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/init` },
      { method: "get" as const, path: `/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/status` },
      { method: "get" as const, path: `/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services` },
      { method: "post" as const, path: `/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services` },
      { method: "delete" as const, path: `/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services/${SERVICE_ID}` },
      { method: "post" as const, path: `/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/sync` },
      { method: "post" as const, path: `/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services/${SERVICE_ID}/rotate` },
    ];

    for (const ep of endpoints) {
      it(`returns 401 for ${ep.method.toUpperCase()} ${ep.path}`, async () => {
        const app = await createApp(noActor());

        const res = await request(app)[ep.method](ep.path).send(
          ep.method === "post" ? { name: "x", providerService: "x" } : undefined,
        );

        expect(res.status).toBe(401);
      });
    }
  });

  /* ---------------------------------------------------------------- */
  /*  VAL-API-011: Wrong company access returns 403                    */
  /* ---------------------------------------------------------------- */
  describe("wrong company access", () => {
    it("returns 403 when board user lacks company membership", async () => {
      const app = await createApp(boardActor({
        companyIds: ["other-company"],
        source: "better_auth",
      }));

      const res = await request(app)
        .get(`/api/companies/${COMPANY_ID}/stripe-projects/catalog`);

      expect(res.status).toBe(403);
    });

    it("returns 403 when agent belongs to different company", async () => {
      const app = await createApp(nonBoardActor({ companyId: "other-company" }));

      const res = await request(app)
        .get(`/api/companies/${COMPANY_ID}/stripe-projects/catalog`);

      expect(res.status).toBe(403);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  VAL-API-018: Board-only access enforcement on mutation endpoints  */
  /* ---------------------------------------------------------------- */
  describe("board-only enforcement", () => {
    const mutationEndpoints = [
      { method: "post" as const, path: `/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/init`, body: { name: "x" } },
      { method: "get" as const, path: `/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/status` },
      { method: "get" as const, path: `/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services` },
      { method: "post" as const, path: `/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services`, body: { providerService: "x" } },
      { method: "delete" as const, path: `/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services/${SERVICE_ID}` },
      { method: "post" as const, path: `/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/sync` },
      { method: "post" as const, path: `/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}/stripe-projects/services/${SERVICE_ID}/rotate` },
    ];

    for (const ep of mutationEndpoints) {
      it(`returns 403 for non-board on ${ep.method.toUpperCase()} ${ep.path}`, async () => {
        const app = await createApp(nonBoardActor());

        const res = await request(app)[ep.method](ep.path).send(
          (ep as any).body ?? undefined,
        );

        expect(res.status).toBe(403);
      });
    }
  });
});

import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";

/* ================================================================== */
/*  Cross-Area Integration Tests for Stripe Projects API               */
/*                                                                     */
/*  These tests exercise multi-step API flows end-to-end via           */
/*  supertest, verifying that sequential operations compose correctly   */
/*  and that state persists across calls. The CLI subprocess is mocked. */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/*  Types for stateful mock state                                      */
/* ------------------------------------------------------------------ */

interface MockConnection {
  id: string;
  companyId: string;
  projectId: string;
  stripeProjectName: string;
  stripeProjectDir: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

interface MockService {
  id: string;
  connectionId: string;
  providerService: string;
  provider: string;
  serviceType: string;
  tier: string | null;
  status: string;
  resourceMetadata: Record<string, unknown> | null;
  provisionedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface MockSecret {
  id: string;
  companyId: string;
  name: string;
  value: string;
  latestVersion: number;
}

/* ------------------------------------------------------------------ */
/*  Stateful mock state (reset per-test)                               */
/* ------------------------------------------------------------------ */

/** Connections keyed by projectId (route passes projectId to service) */
let connections: Map<string, MockConnection>;
/** Services keyed by serviceId */
let services: Map<string, MockService>;
/** Secrets keyed by `${companyId}:${name}` */
let secrets: Map<string, MockSecret>;

function resetState() {
  connections = new Map();
  services = new Map();
  secrets = new Map();
}

/* ------------------------------------------------------------------ */
/*  Mock declarations (hoisted)                                        */
/* ------------------------------------------------------------------ */

const mockSvc = vi.hoisted(() => ({
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
  stripeProjectsService: () => mockSvc,
  projectService: () => mockProjectService,
  logActivity: mockLogActivity,
}));

/* ------------------------------------------------------------------ */
/*  Import HttpError after mocks are wired                             */
/* ------------------------------------------------------------------ */

const { HttpError } = await import("../errors.js");

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function loadRoutes() {
  const mod = await import("../routes/stripe-projects.js");
  return mod.stripeProjectRoutes;
}

interface ActorOverrides {
  companyIds?: string[];
  userId?: string;
  companyId?: string;
}

function boardActor(overrides: ActorOverrides = {}): Record<string, unknown> {
  return {
    type: "board",
    userId: "user-1",
    companyIds: ["company-a"],
    source: "local_implicit",
    isInstanceAdmin: false,
    ...overrides,
  };
}

function nonBoardActor(overrides: ActorOverrides = {}): Record<string, unknown> {
  return {
    type: "agent",
    agentId: "agent-1",
    companyId: "company-a",
    runId: "run-1",
    ...overrides,
  };
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

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const PROJECT_A = randomUUID();
const PROJECT_B = randomUUID();

const catalogItems = [
  { id: "vercel/project", name: "Vercel Project", provider: "vercel", category: "hosting" },
  { id: "supabase/postgres", name: "Supabase Postgres", provider: "supabase", category: "databases" },
  { id: "neon/database", name: "Neon Database", provider: "neon", category: "databases" },
];

/* ------------------------------------------------------------------ */
/*  Stateful mock configuration                                        */
/* ------------------------------------------------------------------ */

/**
 * Wires the mock service methods to operate on the shared state stores.
 * Each method mirrors the real service's intent:
 * - init: stores a connection
 * - addService: validates connection exists, stores a service
 * - listServices: returns services for a connection
 * - removeService: removes a service
 * - syncCredentials: creates secrets for the connection's company
 * - rotateCredentials: updates secrets with new values
 * - catalog: returns the static catalog list
 * - status: returns connection info
 */
function wireStatefulMocks(opts?: {
  /** Make addService fail with a CLI error when called */
  failAddService?: boolean;
  /** Custom env credentials per provider (for multi-service distinct cred sets) */
  envByProvider?: Record<string, Record<string, string>>;
}) {
  mockSvc.init.mockImplementation(
    async (companyId: string, projectId: string, name: string) => {
      // Check for duplicate
      if (connections.has(projectId)) {
        throw new HttpError(409, "Stripe project already initialized for this company and project");
      }
      const connection: MockConnection = {
        id: randomUUID(),
        companyId,
        projectId,
        stripeProjectName: name,
        stripeProjectDir: `/tmp/stripe-projects/${name}`,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      connections.set(projectId, connection);
      return connection;
    },
  );

  mockSvc.catalog.mockImplementation(async (category?: string) => {
    if (category) {
      return catalogItems.filter((item) => item.category === category);
    }
    return catalogItems;
  });

  mockSvc.addService.mockImplementation(
    async (projectId: string, providerService: string) => {
      const connection = connections.get(projectId);
      if (!connection) {
        throw new HttpError(404, "Stripe project connection not found");
      }

      if (opts?.failAddService) {
        throw new HttpError(500, "Provider error: quota exceeded");
      }

      const parts = providerService.split("/");
      const provider = parts[0];
      const serviceType = parts[1] ?? providerService;

      const svc: MockService = {
        id: randomUUID(),
        connectionId: connection.id,
        providerService,
        provider,
        serviceType,
        tier: "pro",
        status: "active",
        resourceMetadata: { dashboardUrl: `https://${provider}.com/dashboard` },
        provisionedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      services.set(svc.id, svc);
      return svc;
    },
  );

  mockSvc.listServices.mockImplementation(async (projectId: string) => {
    const connection = connections.get(projectId);
    if (!connection) return [];
    return [...services.values()].filter((s) => s.connectionId === connection.id);
  });

  mockSvc.removeService.mockImplementation(async (serviceId: string) => {
    const svc = services.get(serviceId);
    if (!svc) {
      throw new HttpError(404, "Provisioned service not found");
    }
    services.delete(serviceId);
    // Also remove secrets associated with this service's provider
    const connection = [...connections.values()].find((c) => c.id === svc.connectionId);
    if (connection) {
      for (const [key, secret] of secrets.entries()) {
        if (
          secret.companyId === connection.companyId &&
          secret.name.startsWith(`${svc.provider.toUpperCase()}_`)
        ) {
          secrets.delete(key);
        }
      }
    }
  });

  mockSvc.syncCredentials.mockImplementation(async (projectId: string) => {
    const connection = connections.get(projectId);
    if (!connection) {
      throw new HttpError(404, "Stripe project connection not found");
    }

    // Generate credentials for each provisioned service in this connection
    const connServices = [...services.values()].filter(
      (s) => s.connectionId === connection.id,
    );
    let count = 0;

    for (const svc of connServices) {
      // Use custom env if provided, otherwise generate default creds
      const envMap =
        opts?.envByProvider?.[svc.provider] ??
        generateDefaultCredentials(svc.provider);

      for (const [name, value] of Object.entries(envMap)) {
        const key = `${connection.companyId}:${name}`;
        const existing = secrets.get(key);
        if (existing) {
          existing.value = value;
          existing.latestVersion++;
        } else {
          secrets.set(key, {
            id: randomUUID(),
            companyId: connection.companyId,
            name,
            value,
            latestVersion: 1,
          });
        }
        count++;
      }
    }

    return { synced: true, secretsCount: count };
  });

  mockSvc.rotateCredentials.mockImplementation(
    async (projectId: string, serviceId: string) => {
      const connection = connections.get(projectId);
      if (!connection) {
        throw new HttpError(404, "Stripe project connection not found");
      }
      const svc = services.get(serviceId);
      if (!svc || svc.connectionId !== connection.id) {
        throw new HttpError(404, "Provisioned service not found");
      }

      // Generate NEW credential values (different from existing)
      const prefix = svc.provider.toUpperCase();
      for (const [key, secret] of secrets.entries()) {
        if (
          secret.companyId === connection.companyId &&
          secret.name.startsWith(`${prefix}_`)
        ) {
          secret.value = `rotated-${randomUUID().slice(0, 8)}`;
          secret.latestVersion++;
        }
      }

      return { rotated: true };
    },
  );

  mockSvc.status.mockImplementation(async (projectId: string) => {
    const connection = connections.get(projectId);
    if (!connection) {
      throw new HttpError(404, "Stripe project connection not found");
    }
    const connServices = [...services.values()].filter(
      (s) => s.connectionId === connection.id,
    );
    return {
      name: connection.stripeProjectName,
      directory: connection.stripeProjectDir,
      services: connServices,
      status: connection.status,
    };
  });
}

/** Generate deterministic default credentials for a provider */
function generateDefaultCredentials(provider: string): Record<string, string> {
  const prefix = provider.toUpperCase();
  return {
    [`${prefix}_API_KEY`]: `${provider}-key-${randomUUID().slice(0, 8)}`,
    [`${prefix}_SECRET`]: `${provider}-secret-${randomUUID().slice(0, 8)}`,
  };
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe("Stripe Projects Integration — Cross-Area API Flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    mockLogActivity.mockResolvedValue(undefined);

    // Default: project-a belongs to company-a, project-b to company-b
    mockProjectService.getById.mockImplementation(async (id: string) => {
      if (id === PROJECT_A) return { id: PROJECT_A, companyId: COMPANY_A, name: "Project Alpha" };
      if (id === PROJECT_B) return { id: PROJECT_B, companyId: COMPANY_B, name: "Project Beta" };
      return null;
    });
  });

  /* ================================================================ */
  /*  VAL-CROSS-001: Full provisioning flow                            */
  /*  init → catalog → add → list (verify) → sync (verify secrets)    */
  /* ================================================================ */
  describe("VAL-CROSS-001: Full provisioning flow", () => {
    it("init → catalog → add → list → sync completes with all 2xx", async () => {
      wireStatefulMocks();
      const app = await createApp(boardActor({ companyIds: [COMPANY_A] }));

      // Step 1: Initialize the Stripe project
      const initRes = await request(app)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/init`)
        .send({ name: "alpha-project" });

      expect(initRes.status).toBe(201);
      expect(initRes.body).toMatchObject({
        companyId: COMPANY_A,
        projectId: PROJECT_A,
        stripeProjectName: "alpha-project",
        status: "active",
      });
      expect(initRes.body.id).toBeDefined();

      // Step 2: Browse the catalog
      const catalogRes = await request(app)
        .get(`/api/companies/${COMPANY_A}/stripe-projects/catalog`);

      expect(catalogRes.status).toBe(200);
      expect(catalogRes.body).toHaveLength(3);
      expect(catalogRes.body[0]).toMatchObject({ provider: "vercel" });

      // Step 3: Add a service from the catalog
      const addRes = await request(app)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`)
        .send({ providerService: "vercel/project" });

      expect(addRes.status).toBe(201);
      expect(addRes.body).toMatchObject({
        providerService: "vercel/project",
        provider: "vercel",
        serviceType: "project",
        status: "active",
      });
      const addedServiceId = addRes.body.id;
      expect(addedServiceId).toBeDefined();

      // Step 4: List services — verify the added service appears
      const listRes = await request(app)
        .get(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`);

      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].id).toBe(addedServiceId);
      expect(listRes.body[0].providerService).toBe("vercel/project");

      // Step 5: Sync credentials
      const syncRes = await request(app)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/sync`);

      expect(syncRes.status).toBe(200);
      expect(syncRes.body.synced).toBe(true);
      expect(syncRes.body.secretsCount).toBeGreaterThan(0);

      // Verify: secrets were created for company A
      const companySecrets = [...secrets.values()].filter(
        (s) => s.companyId === COMPANY_A,
      );
      expect(companySecrets.length).toBeGreaterThan(0);
      expect(companySecrets.some((s) => s.name.startsWith("VERCEL_"))).toBe(true);

      // Verify: activity log was called for init, add, and sync
      expect(mockLogActivity).toHaveBeenCalledTimes(3);
    });
  });

  /* ================================================================ */
  /*  VAL-CROSS-004: Credential lifecycle (rotate)                     */
  /*  add → sync → rotate → verify new creds differ from old          */
  /* ================================================================ */
  describe("VAL-CROSS-004: Credential lifecycle", () => {
    it("credentials change after rotation", async () => {
      wireStatefulMocks();
      const app = await createApp(boardActor({ companyIds: [COMPANY_A] }));

      // Pre-step: init
      const initRes = await request(app)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/init`)
        .send({ name: "cred-lifecycle" });
      expect(initRes.status).toBe(201);

      // Step 1: Add a service
      const addRes = await request(app)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`)
        .send({ providerService: "supabase/postgres" });
      expect(addRes.status).toBe(201);
      const serviceId = addRes.body.id;

      // Step 2: Sync credentials
      const syncRes = await request(app)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/sync`);
      expect(syncRes.status).toBe(200);
      expect(syncRes.body.secretsCount).toBeGreaterThan(0);

      // Record old credential values
      const oldCredentials = new Map<string, string>();
      for (const [key, secret] of secrets.entries()) {
        if (secret.companyId === COMPANY_A) {
          oldCredentials.set(secret.name, secret.value);
        }
      }
      expect(oldCredentials.size).toBeGreaterThan(0);

      // Step 3: Rotate credentials
      const rotateRes = await request(app)
        .post(
          `/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services/${serviceId}/rotate`,
        );
      expect(rotateRes.status).toBe(200);
      expect(rotateRes.body.rotated).toBe(true);

      // Step 4: Verify new creds differ from old
      for (const [key, secret] of secrets.entries()) {
        if (secret.companyId === COMPANY_A) {
          const oldValue = oldCredentials.get(secret.name);
          expect(oldValue).toBeDefined();
          expect(secret.value).not.toBe(oldValue);
          expect(secret.latestVersion).toBeGreaterThan(1);
        }
      }
    });
  });

  /* ================================================================ */
  /*  VAL-CROSS-005: Service removal cleanup                           */
  /*  add → sync → remove → verify service gone and credentials       */
  /*  cleaned up                                                       */
  /* ================================================================ */
  describe("VAL-CROSS-005: Service removal cleanup", () => {
    it("remove deletes service and associated credentials", async () => {
      wireStatefulMocks();
      const app = await createApp(boardActor({ companyIds: [COMPANY_A] }));

      // Pre-step: init
      const initRes = await request(app)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/init`)
        .send({ name: "cleanup-test" });
      expect(initRes.status).toBe(201);

      // Step 1: Add a service
      const addRes = await request(app)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`)
        .send({ providerService: "neon/database" });
      expect(addRes.status).toBe(201);
      const serviceId = addRes.body.id;

      // Step 2: Sync credentials
      const syncRes = await request(app)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/sync`);
      expect(syncRes.status).toBe(200);
      expect(syncRes.body.secretsCount).toBeGreaterThan(0);

      // Verify credentials exist before removal
      const preRemovalSecrets = [...secrets.values()].filter(
        (s) => s.companyId === COMPANY_A && s.name.startsWith("NEON_"),
      );
      expect(preRemovalSecrets.length).toBeGreaterThan(0);

      // Step 3: Remove the service
      const removeRes = await request(app)
        .delete(
          `/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services/${serviceId}`,
        );
      expect(removeRes.status).toBe(200);

      // Step 4: Verify service is gone
      const listRes = await request(app)
        .get(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(0);

      // Step 5: Verify credentials are cleaned up
      const postRemovalSecrets = [...secrets.values()].filter(
        (s) => s.companyId === COMPANY_A && s.name.startsWith("NEON_"),
      );
      expect(postRemovalSecrets).toHaveLength(0);

      // Verify service no longer in internal state
      expect(services.has(serviceId)).toBe(false);
    });
  });

  /* ================================================================ */
  /*  VAL-CROSS-006: Multi-service management                          */
  /*  add 2 services → list (verify both) → sync (verify distinct     */
  /*  credential sets)                                                 */
  /* ================================================================ */
  describe("VAL-CROSS-006: Multi-service management", () => {
    it("two services produce distinct credential sets after sync", async () => {
      wireStatefulMocks({
        envByProvider: {
          vercel: {
            VERCEL_API_KEY: "vk-key-abc123",
            VERCEL_PROJECT_ID: "prj-xyz789",
          },
          supabase: {
            SUPABASE_URL: "https://abc.supabase.co",
            SUPABASE_ANON_KEY: "sb-anon-key-456",
            SUPABASE_SERVICE_KEY: "sb-svc-key-789",
          },
        },
      });
      const app = await createApp(boardActor({ companyIds: [COMPANY_A] }));

      // Pre-step: init
      const initRes = await request(app)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/init`)
        .send({ name: "multi-service" });
      expect(initRes.status).toBe(201);

      // Step 1: Add first service (Vercel)
      const add1Res = await request(app)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`)
        .send({ providerService: "vercel/project" });
      expect(add1Res.status).toBe(201);
      expect(add1Res.body.provider).toBe("vercel");

      // Step 2: Add second service (Supabase)
      const add2Res = await request(app)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`)
        .send({ providerService: "supabase/postgres" });
      expect(add2Res.status).toBe(201);
      expect(add2Res.body.provider).toBe("supabase");

      // Step 3: List services — verify both present
      const listRes = await request(app)
        .get(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(2);

      const providers = listRes.body.map((s: any) => s.provider).sort();
      expect(providers).toEqual(["supabase", "vercel"]);

      // Step 4: Sync credentials for all services
      const syncRes = await request(app)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/sync`);
      expect(syncRes.status).toBe(200);
      expect(syncRes.body.synced).toBe(true);
      // 2 Vercel keys + 3 Supabase keys = 5
      expect(syncRes.body.secretsCount).toBe(5);

      // Step 5: Verify distinct credential sets
      const allSecrets = [...secrets.values()].filter(
        (s) => s.companyId === COMPANY_A,
      );
      expect(allSecrets).toHaveLength(5);

      const vercelSecrets = allSecrets.filter((s) => s.name.startsWith("VERCEL_"));
      const supabaseSecrets = allSecrets.filter((s) => s.name.startsWith("SUPABASE_"));

      expect(vercelSecrets).toHaveLength(2);
      expect(supabaseSecrets).toHaveLength(3);

      // Verify they are distinct (no overlap in names or values)
      const vercelNames = new Set(vercelSecrets.map((s) => s.name));
      const supabaseNames = new Set(supabaseSecrets.map((s) => s.name));
      for (const name of vercelNames) {
        expect(supabaseNames.has(name)).toBe(false);
      }

      // Verify specific values match what we configured
      const apiKeySecret = allSecrets.find((s) => s.name === "VERCEL_API_KEY");
      expect(apiKeySecret?.value).toBe("vk-key-abc123");

      const supabaseUrl = allSecrets.find((s) => s.name === "SUPABASE_URL");
      expect(supabaseUrl?.value).toBe("https://abc.supabase.co");
    });
  });

  /* ================================================================ */
  /*  VAL-CROSS-007: Error recovery                                    */
  /*  failed add → verify no orphaned records                          */
  /* ================================================================ */
  describe("VAL-CROSS-007: Error recovery", () => {
    it("failed add leaves no orphaned service records or credentials", async () => {
      wireStatefulMocks({ failAddService: true });
      const app = await createApp(boardActor({ companyIds: [COMPANY_A] }));

      // Pre-step: init
      const initRes = await request(app)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/init`)
        .send({ name: "error-recovery" });
      expect(initRes.status).toBe(201);

      // Step 1: Attempt to add a service — should fail
      const addRes = await request(app)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`)
        .send({ providerService: "vercel/project" });
      expect(addRes.status).toBe(500);

      // Step 2: Verify no orphaned service records
      const listRes = await request(app)
        .get(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(0);

      // Step 3: Verify no orphaned secrets
      const companySecrets = [...secrets.values()].filter(
        (s) => s.companyId === COMPANY_A,
      );
      expect(companySecrets).toHaveLength(0);

      // Step 4: Verify internal state is clean
      expect(services.size).toBe(0);
    });
  });

  /* ================================================================ */
  /*  VAL-CROSS-008: Cross-company isolation                           */
  /*  Company A provisions → Company B cannot access                   */
  /* ================================================================ */
  describe("VAL-CROSS-008: Cross-company isolation", () => {
    it("company B gets 403 when accessing company A endpoints directly", async () => {
      wireStatefulMocks();

      // Company A: init and add a service (session-based auth so access check runs)
      const appA = await createApp(
        boardActor({ companyIds: [COMPANY_A] }),
      );

      const initRes = await request(appA)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/init`)
        .send({ name: "isolated-project" });
      expect(initRes.status).toBe(201);

      const addRes = await request(appA)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`)
        .send({ providerService: "vercel/project" });
      expect(addRes.status).toBe(201);

      // Company B: session-based auth with only COMPANY_B membership.
      // Using source "better_auth" so assertCompanyAccess actually checks companyIds.
      const appB = await createApp({
        type: "board",
        userId: "user-2",
        companyIds: [COMPANY_B],
        source: "better_auth",
        isInstanceAdmin: false,
      });

      // Try to list company A's services → 403
      const listRes = await request(appB)
        .get(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`);
      expect(listRes.status).toBe(403);

      // Try to sync company A's credentials → 403
      const syncRes = await request(appB)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/sync`);
      expect(syncRes.status).toBe(403);

      // Try to add service to company A → 403
      const addRes2 = await request(appB)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`)
        .send({ providerService: "supabase/postgres" });
      expect(addRes2.status).toBe(403);

      // Try to get company A's status → 403
      const statusRes = await request(appB)
        .get(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/status`);
      expect(statusRes.status).toBe(403);

      // Try to get company A's catalog → 403
      const catalogRes = await request(appB)
        .get(`/api/companies/${COMPANY_A}/stripe-projects/catalog`);
      expect(catalogRes.status).toBe(403);
    });

    it("company B gets 404 when accessing own URL with company A project", async () => {
      wireStatefulMocks();

      // Company A: init a project
      const appA = await createApp(boardActor({ companyIds: [COMPANY_A] }));
      const initRes = await request(appA)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/init`)
        .send({ name: "a-project" });
      expect(initRes.status).toBe(201);

      // Company B: access their own company URL with company A's project ID.
      // resolveProject will return null because PROJECT_A belongs to COMPANY_A.
      // Use better_auth so company access check runs.
      const appB = await createApp({
        type: "board",
        userId: "user-2",
        companyIds: [COMPANY_B],
        source: "better_auth",
        isInstanceAdmin: false,
      });

      // B accessing B's company URL but with A's project → 404
      const listRes = await request(appB)
        .get(`/api/companies/${COMPANY_B}/projects/${PROJECT_A}/stripe-projects/services`);
      expect(listRes.status).toBe(404);
      expect(listRes.body.error).toContain("Project not found");

      const syncRes = await request(appB)
        .post(`/api/companies/${COMPANY_B}/projects/${PROJECT_A}/stripe-projects/sync`);
      expect(syncRes.status).toBe(404);

      const statusRes = await request(appB)
        .get(`/api/companies/${COMPANY_B}/projects/${PROJECT_A}/stripe-projects/status`);
      expect(statusRes.status).toBe(404);
    });

    it("company B can provision independently without affecting company A", async () => {
      wireStatefulMocks();

      // Company A: init and add a service (use better_auth for real access control)
      const appA = await createApp({
        type: "board",
        userId: "user-1",
        companyIds: [COMPANY_A],
        source: "better_auth",
        isInstanceAdmin: false,
      });
      const initARes = await request(appA)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/init`)
        .send({ name: "a-infra" });
      expect(initARes.status).toBe(201);

      const addARes = await request(appA)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`)
        .send({ providerService: "vercel/project" });
      expect(addARes.status).toBe(201);

      // Company B: init and add a different service (use better_auth for real access control)
      const appB = await createApp({
        type: "board",
        userId: "user-2",
        companyIds: [COMPANY_B],
        source: "better_auth",
        isInstanceAdmin: false,
      });
      const initBRes = await request(appB)
        .post(`/api/companies/${COMPANY_B}/projects/${PROJECT_B}/stripe-projects/init`)
        .send({ name: "b-infra" });
      expect(initBRes.status).toBe(201);

      const addBRes = await request(appB)
        .post(`/api/companies/${COMPANY_B}/projects/${PROJECT_B}/stripe-projects/services`)
        .send({ providerService: "supabase/postgres" });
      expect(addBRes.status).toBe(201);

      // Company A: list services — should only see Vercel, not Supabase
      const listARes = await request(appA)
        .get(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`);
      expect(listARes.status).toBe(200);
      expect(listARes.body).toHaveLength(1);
      expect(listARes.body[0].provider).toBe("vercel");

      // Company B: list services — should only see Supabase, not Vercel
      const listBRes = await request(appB)
        .get(`/api/companies/${COMPANY_B}/projects/${PROJECT_B}/stripe-projects/services`);
      expect(listBRes.status).toBe(200);
      expect(listBRes.body).toHaveLength(1);
      expect(listBRes.body[0].provider).toBe("supabase");

      // Sync company A → should only get Vercel creds
      const syncARes = await request(appA)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/sync`);
      expect(syncARes.status).toBe(200);
      const companyASecrets = [...secrets.values()].filter(
        (s) => s.companyId === COMPANY_A,
      );
      expect(companyASecrets.every((s) => s.name.startsWith("VERCEL_"))).toBe(true);

      // Sync company B → should only get Supabase creds
      const syncBRes = await request(appB)
        .post(`/api/companies/${COMPANY_B}/projects/${PROJECT_B}/stripe-projects/sync`);
      expect(syncBRes.status).toBe(200);
      const companyBSecrets = [...secrets.values()].filter(
        (s) => s.companyId === COMPANY_B,
      );
      expect(companyBSecrets.every((s) => s.name.startsWith("SUPABASE_"))).toBe(true);

      // Cross-verify: A's secrets don't leak to B and vice versa
      expect(companyASecrets.some((s) => s.name.startsWith("SUPABASE_"))).toBe(false);
      expect(companyBSecrets.some((s) => s.name.startsWith("VERCEL_"))).toBe(false);
    });
  });
});

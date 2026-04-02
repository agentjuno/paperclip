import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  companies,
  companySecrets,
  companySecretVersions,
  createDb,
  instanceSettings,
  projects,
  stripeProjectConnections,
  stripeProvisionedServices,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";

/* ================================================================== */
/*  Cross-Area Integration Tests for Stripe Projects API               */
/*                                                                     */
/*  These tests exercise multi-step API flows end-to-end via           */
/*  supertest, verifying that route → service → DB wiring works for    */
/*  real. Only the CLI subprocess (execStripeProjectsCmd) is mocked.   */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/*  Mock ONLY the CLI subprocess                                       */
/* ------------------------------------------------------------------ */

const mockExecStripeProjectsCmd = vi.hoisted(() => vi.fn());

vi.mock("../services/stripe-projects-cli.js", () => ({
  execStripeProjectsCmd: mockExecStripeProjectsCmd,
  StripeProjectsCliError: class StripeProjectsCliError extends Error {
    readonly code: string;
    readonly stderr?: string;
    readonly rawOutput?: string;
    constructor(code: string, message: string, opts?: { stderr?: string; rawOutput?: string }) {
      super(message);
      this.name = "StripeProjectsCliError";
      this.code = code;
      this.stderr = opts?.stderr;
      this.rawOutput = opts?.rawOutput;
    }
  },
}));

/* ------------------------------------------------------------------ */
/*  Embedded Postgres support probe                                    */
/* ------------------------------------------------------------------ */

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres integration tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const COMPANY_A = randomUUID();
const COMPANY_B = randomUUID();
const PROJECT_A = randomUUID();
const PROJECT_B = randomUUID();

const catalogItems = [
  { id: "vercel/project", name: "Vercel Project", provider: "vercel", category: "hosting" },
  { id: "supabase/postgres", name: "Supabase Postgres", provider: "supabase", category: "databases" },
  { id: "neon/database", name: "Neon Database", provider: "neon", category: "databases" },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

interface ActorOverrides {
  companyIds?: string[];
  userId?: string;
  companyId?: string;
}

function boardActor(overrides: ActorOverrides = {}): Record<string, unknown> {
  return {
    type: "board",
    userId: "user-1",
    companyIds: [COMPANY_A],
    source: "local_implicit",
    isInstanceAdmin: false,
    ...overrides,
  };
}

async function createApp(db: ReturnType<typeof createDb>, actor: Record<string, unknown> = boardActor()) {
  const { stripeProjectRoutes } = await import("../routes/stripe-projects.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", stripeProjectRoutes(db));
  app.use(errorHandler);
  return app;
}

/* ------------------------------------------------------------------ */
/*  CLI mock configuration helpers                                     */
/* ------------------------------------------------------------------ */

/**
 * Wires the mock CLI to respond to different subcommands.
 * This replaces the old stateful service mock — now the real service
 * calls the mocked CLI, and real DB operations happen.
 */
function wireCLIMocks(opts?: {
  /** Make the "add" CLI call fail */
  failAdd?: boolean;
  /** Custom env credentials per provider (for multi-service distinct cred sets) */
  envByProvider?: Record<string, Record<string, string>>;
  /**
   * Queue of env responses. Each call to the "env" subcommand pops
   * the next response from the queue. Falls back to provider-based
   * generation if the queue is empty or not provided.
   */
  envQueue?: Array<Record<string, string>>;
}) {
  /** Track what has been provisioned (for env/rotate CLI responses) */
  const provisionedProviders: string[] = [];
  /** Index into the envQueue */
  let envQueueIdx = 0;

  mockExecStripeProjectsCmd.mockImplementation(
    async (subcommand: string, args: string[]) => {
      switch (subcommand) {
        case "init":
          return {
            name: args.find((_a, i, arr) => arr[i - 1] === "--name") ?? "test-project",
            directory: `/tmp/stripe-projects/test-project`,
            status: "active",
          };

        case "catalog": {
          const catIdx = args.indexOf("--category");
          const category = catIdx >= 0 ? args[catIdx + 1] : undefined;
          if (category) {
            return catalogItems.filter((item) => item.category === category);
          }
          return catalogItems;
        }

        case "add": {
          if (opts?.failAdd) {
            throw new Error("Provider error: quota exceeded");
          }
          const providerService = args[0] ?? "unknown/service";
          const parts = providerService.split("/");
          const provider = parts[0];
          provisionedProviders.push(provider);
          return {
            providerService,
            provider,
            serviceType: parts[1] ?? providerService,
            tier: "pro",
            status: "active",
            dashboardUrl: `https://${provider}.com/dashboard`,
          };
        }

        case "remove":
          return { removed: true };

        case "status":
          return {
            status: "active",
            services: [],
          };

        case "env": {
          // Use envQueue if provided and not exhausted
          if (opts?.envQueue && envQueueIdx < opts.envQueue.length) {
            return opts.envQueue[envQueueIdx++];
          }
          // Fallback: return credentials for all provisioned providers
          const allEnv: Record<string, string> = {};
          for (const provider of provisionedProviders) {
            const envMap =
              opts?.envByProvider?.[provider] ??
              generateDefaultCredentials(provider);
            Object.assign(allEnv, envMap);
          }
          return allEnv;
        }

        case "rotate": {
          // Return rotated credentials for the specified provider service
          const providerService = args[0] ?? "";
          const provider = providerService.split("/")[0] ?? "";
          const prefix = provider.toUpperCase();
          return {
            [`${prefix}_API_KEY`]: `rotated-${randomUUID().slice(0, 8)}`,
            [`${prefix}_SECRET`]: `rotated-${randomUUID().slice(0, 8)}`,
          };
        }

        default:
          throw new Error(`Unknown subcommand: ${subcommand}`);
      }
    },
  );
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

describeEmbeddedPostgres("Stripe Projects Integration — Cross-Area API Flows (Real DB)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-stripe-integration-");
    db = createDb(tempDb.connectionString);

    // Seed companies
    await db.insert(companies).values([
      {
        id: COMPANY_A,
        name: "Company Alpha",
        issuePrefix: "ALPHA",
        requireBoardApprovalForNewAgents: false,
      },
      {
        id: COMPANY_B,
        name: "Company Beta",
        issuePrefix: "BETA",
        requireBoardApprovalForNewAgents: false,
      },
    ]);

    // Seed projects
    await db.insert(projects).values([
      {
        id: PROJECT_A,
        companyId: COMPANY_A,
        name: "Project Alpha",
        status: "active",
      },
      {
        id: PROJECT_B,
        companyId: COMPANY_B,
        name: "Project Beta",
        status: "active",
      },
    ]);
  }, 30_000);

  afterEach(async () => {
    vi.clearAllMocks();
    // Clean up stripe-specific tables (order matters for FK constraints)
    await db.delete(companySecretVersions);
    await db.delete(companySecrets);
    await db.delete(stripeProvisionedServices);
    await db.delete(stripeProjectConnections);
    await db.delete(activityLog);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  /* ================================================================ */
  /*  VAL-CROSS-001: Full provisioning flow                            */
  /*  init → catalog → add → list (verify) → sync (verify secrets)    */
  /* ================================================================ */
  describe("VAL-CROSS-001: Full provisioning flow", () => {
    it("init → catalog → add → list → sync completes with all 2xx", async () => {
      wireCLIMocks();
      const app = await createApp(db, boardActor({ companyIds: [COMPANY_A] }));

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

      // Verify: secrets were created in the real DB for company A
      const dbSecrets = await db
        .select()
        .from(companySecrets)
        .where(
          (await import("drizzle-orm")).eq(companySecrets.companyId, COMPANY_A),
        );
      expect(dbSecrets.length).toBeGreaterThan(0);
      expect(dbSecrets.some((s) => s.name.startsWith("VERCEL_"))).toBe(true);

      // Verify: activity log was created for init, add, and sync (3 mutations)
      const activities = await db
        .select()
        .from(activityLog)
        .where(
          (await import("drizzle-orm")).eq(activityLog.companyId, COMPANY_A),
        );
      expect(activities.length).toBe(3);
    });
  });

  /* ================================================================ */
  /*  VAL-CROSS-004: Credential lifecycle (rotate)                     */
  /*  add → sync → rotate → verify new creds differ from old          */
  /* ================================================================ */
  describe("VAL-CROSS-004: Credential lifecycle", () => {
    it("credentials change after rotation", async () => {
      wireCLIMocks();
      const app = await createApp(db, boardActor({ companyIds: [COMPANY_A] }));

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

      // Record old credential values from real DB (versions + value hashes)
      const { eq } = await import("drizzle-orm");
      const oldDbSecrets = await db
        .select()
        .from(companySecrets)
        .where(eq(companySecrets.companyId, COMPANY_A));
      const oldCredentials = new Map<string, number>();
      for (const secret of oldDbSecrets) {
        oldCredentials.set(secret.name, secret.latestVersion);
      }
      expect(oldCredentials.size).toBeGreaterThan(0);

      // Capture pre-rotation value hashes from companySecretVersions
      const preRotationVersions = await db
        .select()
        .from(companySecretVersions)
        .where(
          (await import("drizzle-orm")).inArray(
            companySecretVersions.secretId,
            oldDbSecrets.map((s) => s.id),
          ),
        );
      const preRotationHashes = new Map<string, string>();
      for (const v of preRotationVersions) {
        // Store hash keyed by secretId for comparison after rotation
        preRotationHashes.set(v.secretId, v.valueSha256);
      }
      expect(preRotationHashes.size).toBeGreaterThan(0);

      // Step 3: Rotate credentials
      const rotateRes = await request(app)
        .post(
          `/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services/${serviceId}/rotate`,
        );
      expect(rotateRes.status).toBe(200);
      expect(rotateRes.body.rotated).toBe(true);

      // Step 4: Verify creds were rotated in real DB (latestVersion incremented)
      const newDbSecrets = await db
        .select()
        .from(companySecrets)
        .where(eq(companySecrets.companyId, COMPANY_A));
      for (const secret of newDbSecrets) {
        const oldVersion = oldCredentials.get(secret.name);
        expect(oldVersion).toBeDefined();
        expect(secret.latestVersion).toBeGreaterThan(oldVersion!);
      }

      // Step 5: Verify rotated credential VALUES differ from pre-rotation values
      const postRotationVersions = await db
        .select()
        .from(companySecretVersions)
        .where(
          (await import("drizzle-orm")).inArray(
            companySecretVersions.secretId,
            newDbSecrets.map((s) => s.id),
          ),
        );
      // Group versions by secretId — the latest version's hash should differ from the original
      for (const secret of newDbSecrets) {
        const versions = postRotationVersions
          .filter((v) => v.secretId === secret.id)
          .sort((a, b) => a.version - b.version);
        expect(versions.length).toBeGreaterThanOrEqual(2); // at least original + rotated
        const originalHash = preRotationHashes.get(secret.id);
        const latestHash = versions[versions.length - 1].valueSha256;
        expect(latestHash).not.toBe(originalHash);
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
      wireCLIMocks();
      const app = await createApp(db, boardActor({ companyIds: [COMPANY_A] }));

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

      // Verify credentials exist before removal (real DB)
      const { eq, and, like } = await import("drizzle-orm");
      const preRemovalSecrets = await db
        .select()
        .from(companySecrets)
        .where(
          and(
            eq(companySecrets.companyId, COMPANY_A),
            like(companySecrets.name, "NEON_%"),
          ),
        );
      expect(preRemovalSecrets.length).toBeGreaterThan(0);

      // Step 3: Remove the service
      const removeRes = await request(app)
        .delete(
          `/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services/${serviceId}`,
        );
      expect(removeRes.status).toBe(200);

      // Step 4: Verify service is gone (real DB)
      const listRes = await request(app)
        .get(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(0);

      // Step 5: Verify the service record is deleted from real DB
      const remainingServices = await db
        .select()
        .from(stripeProvisionedServices)
        .where(eq(stripeProvisionedServices.id, serviceId));
      expect(remainingServices).toHaveLength(0);

      // Step 6: Verify credentials associated with the removed service are cleaned from company_secrets
      const postRemovalSecrets = await db
        .select()
        .from(companySecrets)
        .where(
          and(
            eq(companySecrets.companyId, COMPANY_A),
            like(companySecrets.name, "NEON_%"),
          ),
        );
      expect(postRemovalSecrets).toHaveLength(0);
    });
  });

  /* ================================================================ */
  /*  VAL-CROSS-006: Multi-service management                          */
  /*  add 2 services → list (verify both) → sync (verify distinct     */
  /*  credential sets)                                                 */
  /* ================================================================ */
  describe("VAL-CROSS-006: Multi-service management", () => {
    it("two services produce distinct credential sets after sync", async () => {
      wireCLIMocks({
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
      const app = await createApp(db, boardActor({ companyIds: [COMPANY_A] }));

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

      // Step 5: Verify distinct credential sets in real DB
      const { eq, like, and } = await import("drizzle-orm");
      const allSecrets = await db
        .select()
        .from(companySecrets)
        .where(eq(companySecrets.companyId, COMPANY_A));
      expect(allSecrets).toHaveLength(5);

      const vercelSecrets = allSecrets.filter((s) => s.name.startsWith("VERCEL_"));
      const supabaseSecrets = allSecrets.filter((s) => s.name.startsWith("SUPABASE_"));

      expect(vercelSecrets).toHaveLength(2);
      expect(supabaseSecrets).toHaveLength(3);

      // Verify they are distinct (no overlap in names)
      const vercelNames = new Set(vercelSecrets.map((s) => s.name));
      const supabaseNames = new Set(supabaseSecrets.map((s) => s.name));
      for (const name of vercelNames) {
        expect(supabaseNames.has(name)).toBe(false);
      }
    });
  });

  /* ================================================================ */
  /*  VAL-CROSS-007: Error recovery                                    */
  /*  failed add → verify no orphaned records                          */
  /* ================================================================ */
  describe("VAL-CROSS-007: Error recovery", () => {
    it("failed add leaves no orphaned service records or credentials", async () => {
      wireCLIMocks({ failAdd: true });
      const app = await createApp(db, boardActor({ companyIds: [COMPANY_A] }));

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

      // Step 2: Verify no orphaned service records in real DB
      const listRes = await request(app)
        .get(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(0);

      // Step 3: Verify no orphaned secrets in real DB
      const { eq } = await import("drizzle-orm");
      const dbSecrets = await db
        .select()
        .from(companySecrets)
        .where(eq(companySecrets.companyId, COMPANY_A));
      expect(dbSecrets).toHaveLength(0);

      // Step 4: Verify real DB has no orphaned service records for this connection
      const allConns = await db.select().from(stripeProjectConnections);
      const companyAConn = allConns.find((c) => c.companyId === COMPANY_A);
      if (companyAConn) {
        const connServices = await db
          .select()
          .from(stripeProvisionedServices)
          .where(eq(stripeProvisionedServices.connectionId, companyAConn.id));
        expect(connServices).toHaveLength(0);
      }
    });
  });

  /* ================================================================ */
  /*  VAL-CROSS-008: Cross-company isolation                           */
  /*  Company A provisions → Company B cannot access                   */
  /* ================================================================ */
  describe("VAL-CROSS-008: Cross-company isolation", () => {
    it("company B gets 403 when accessing company A endpoints directly", async () => {
      wireCLIMocks();

      // Company A: init and add a service
      const appA = await createApp(db, boardActor({ companyIds: [COMPANY_A] }));

      const initRes = await request(appA)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/init`)
        .send({ name: "isolated-project" });
      expect(initRes.status).toBe(201);

      const addRes = await request(appA)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/services`)
        .send({ providerService: "vercel/project" });
      expect(addRes.status).toBe(201);

      // Company B: session-based auth with only COMPANY_B membership
      const appB = await createApp(db, {
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
      wireCLIMocks();

      // Company A: init a project
      const appA = await createApp(db, boardActor({ companyIds: [COMPANY_A] }));
      const initRes = await request(appA)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/init`)
        .send({ name: "a-project" });
      expect(initRes.status).toBe(201);

      // Company B: access their own company URL with company A's project ID.
      // resolveProject will return null because PROJECT_A belongs to COMPANY_A.
      const appB = await createApp(db, {
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
      // Use envQueue so each sync call gets the correct scoped creds:
      // 1st env call (company A sync) → Vercel creds only
      // 2nd env call (company B sync) → Supabase creds only
      wireCLIMocks({
        envQueue: [
          { VERCEL_API_KEY: "vk-a-key", VERCEL_SECRET: "vk-a-secret" },
          { SUPABASE_API_KEY: "sb-b-key", SUPABASE_SECRET: "sb-b-secret" },
        ],
      });

      // Company A: init and add a service
      const appA = await createApp(db, {
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

      // Company B: init and add a different service
      const appB = await createApp(db, {
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

      // Sync company A → should only get Vercel creds (1st envQueue entry)
      const syncARes = await request(appA)
        .post(`/api/companies/${COMPANY_A}/projects/${PROJECT_A}/stripe-projects/sync`);
      expect(syncARes.status).toBe(200);

      const { eq } = await import("drizzle-orm");
      const companyASecrets = await db
        .select()
        .from(companySecrets)
        .where(eq(companySecrets.companyId, COMPANY_A));
      expect(companyASecrets.every((s) => s.name.startsWith("VERCEL_"))).toBe(true);

      // Sync company B → should only get Supabase creds (2nd envQueue entry)
      const syncBRes = await request(appB)
        .post(`/api/companies/${COMPANY_B}/projects/${PROJECT_B}/stripe-projects/sync`);
      expect(syncBRes.status).toBe(200);

      const companyBSecrets = await db
        .select()
        .from(companySecrets)
        .where(eq(companySecrets.companyId, COMPANY_B));
      expect(companyBSecrets.every((s) => s.name.startsWith("SUPABASE_"))).toBe(true);

      // Cross-verify: A's secrets don't leak to B and vice versa
      expect(companyASecrets.some((s) => s.name.startsWith("SUPABASE_"))).toBe(false);
      expect(companyBSecrets.some((s) => s.name.startsWith("VERCEL_"))).toBe(false);
    });
  });
});

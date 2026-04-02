import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

/* ------------------------------------------------------------------ */
/*  Helpers: fake spawn + fake DB                                      */
/* ------------------------------------------------------------------ */

function createFakeProc() {
  const proc = new EventEmitter() as unknown as ChildProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  (proc as any).stdout = stdout;
  (proc as any).stderr = stderr;
  (proc as any).pid = 12345;
  (proc as any).killed = false;
  (proc as any).kill = vi.fn(() => {
    (proc as any).killed = true;
    return true;
  });
  return {
    proc,
    emitStdout(data: string) {
      if (data) stdout.emit("data", Buffer.from(data));
    },
    emitStderr(data: string) {
      if (data) stderr.emit("data", Buffer.from(data));
    },
    emitClose(code: number) {
      proc.emit("close", code);
    },
  };
}

function makeSpawnFn(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}) {
  return vi.fn((_cmd: string, _args: string[], _opts: any) => {
    const fake = createFakeProc();
    setImmediate(() => {
      if (opts.stdout) fake.emitStdout(opts.stdout);
      if (opts.stderr) fake.emitStderr(opts.stderr);
      fake.emitClose(opts.exitCode ?? 0);
    });
    return fake.proc;
  });
}

/* ------------------------------------------------------------------ */
/*  Fake Drizzle-like DB for unit tests                                */
/* ------------------------------------------------------------------ */

interface FakeRow {
  [key: string]: unknown;
}

/**
 * Creates a minimal fake DB that simulates Drizzle's fluent query API.
 * Supports select/from/where, insert/values/returning, and stores rows
 * in an in-memory map keyed by table reference.
 */
function createFakeDb() {
  const store = new Map<unknown, FakeRow[]>();

  function getRows(table: unknown): FakeRow[] {
    if (!store.has(table)) store.set(table, []);
    return store.get(table)!;
  }

  function seed(table: unknown, rows: FakeRow[]) {
    store.set(table, rows);
  }

  // Minimal chain builder that supports the patterns used in the service:
  // db.select().from(table).where(condition).then(cb)
  // db.insert(table).values(data).returning().then(cb)
  const db: any = {
    select: () => {
      let targetTable: unknown = null;
      let filterFn: ((row: FakeRow) => boolean) | null = null;

      const chain: any = {
        from: (table: unknown) => {
          targetTable = table;
          return chain;
        },
        where: (condition: unknown) => {
          // We store the condition as a filter function.
          // Since real drizzle conditions won't work here, we handle
          // them through a custom approach in tests.
          filterFn = condition as any;
          return chain;
        },
        then: (resolve: (rows: FakeRow[]) => void) => {
          let rows = getRows(targetTable);
          if (filterFn) {
            rows = rows.filter(filterFn);
          }
          return Promise.resolve(rows).then(resolve);
        },
      };
      // Make it thenable
      chain[Symbol.toStringTag] = "Promise";
      return chain;
    },

    insert: (table: unknown) => {
      let insertData: FakeRow | null = null;
      const chain: any = {
        values: (data: FakeRow) => {
          insertData = {
            ...data,
            id: data.id ?? crypto.randomUUID(),
            createdAt: data.createdAt ?? new Date(),
            updatedAt: data.updatedAt ?? new Date(),
          };
          getRows(table).push(insertData!);
          return chain;
        },
        returning: () => {
          return chain;
        },
        then: (resolve: (rows: FakeRow[]) => void) => {
          return Promise.resolve([insertData]).then(resolve);
        },
      };
      chain[Symbol.toStringTag] = "Promise";
      return chain;
    },
  };

  return { db, store, seed, getRows };
}

/* ------------------------------------------------------------------ */
/*  Import the module under test + the schema tables                   */
/* ------------------------------------------------------------------ */

const { stripeProjectsService } = await import("../services/stripe-projects.js");
const { StripeProjectsCliError } = await import("../services/stripe-projects-cli.js");
const { HttpError } = await import("../errors.js");

// We need the actual table references for the store keys
const { stripeProjectConnections, stripeProvisionedServices } = await import(
  "@paperclipai/db"
);

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

describe("stripeProjectsService", () => {
  /* ================================================================ */
  /*  init                                                             */
  /* ================================================================ */
  describe("init", () => {
    /* VAL-SVC-001: init creates DB row with correct fields and returns record */
    it("creates a connection row in DB and returns the record", async () => {
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify({ id: "sp_1", name: "my-project", directory: "/tmp/sp" }),
      });

      let insertedRow: any = null;
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([]).then(resolve),
            }),
          }),
        }),
        insert: () => ({
          values: (data: any) => {
            insertedRow = {
              ...data,
              id: crypto.randomUUID(),
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            return {
              returning: () => ({
                then: (resolve: any) => Promise.resolve([insertedRow]).then(resolve),
              }),
            };
          },
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });
      const result = await svc.init("company-1", "project-1", "my-project");

      expect(result).toMatchObject({
        companyId: "company-1",
        projectId: "project-1",
        stripeProjectName: "my-project",
        stripeProjectDir: "/tmp/sp",
        status: "active",
      });
      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);

      // Verify the row was inserted
      expect(insertedRow).not.toBeNull();
      expect(insertedRow.companyId).toBe("company-1");
    });

    /* VAL-SVC-002: init returns the stored connection record with all fields */
    it("returns the full connection object with all required fields", async () => {
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify({ id: "sp_1", name: "test" }),
      });

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([]).then(resolve),
            }),
          }),
        }),
        insert: () => ({
          values: (data: any) => {
            const row = {
              ...data,
              id: crypto.randomUUID(),
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            return {
              returning: () => ({
                then: (resolve: any) => Promise.resolve([row]).then(resolve),
              }),
            };
          },
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });
      const result = await svc.init("c-1", "p-1", "test");

      // Verify all fields are present per the StripeProjectConnection type
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("companyId");
      expect(result).toHaveProperty("projectId");
      expect(result).toHaveProperty("stripeProjectName");
      expect(result).toHaveProperty("stripeProjectDir");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("createdAt");
      expect(result).toHaveProperty("updatedAt");
    });

    /* VAL-SVC-003: Duplicate init throws conflict without calling CLI */
    it("throws conflict on duplicate company+project without calling CLI", async () => {
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify({ id: "sp_1" }),
      });
      const { db, seed } = createFakeDb();

      // Pre-seed a connection to simulate existing record
      // We need to override the select().from().where() chain to find the duplicate.
      // For this, we use a custom approach: mock the db directly.
      const existingRow = {
        id: "existing-id",
        companyId: "company-1",
        projectId: "project-1",
        stripeProjectName: "existing",
        stripeProjectDir: null,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Build a more precise mock for the duplicate check
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([existingRow]).then(resolve),
            }),
          }),
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });

      await expect(svc.init("company-1", "project-1", "test")).rejects.toThrow(
        HttpError,
      );
      await expect(svc.init("company-1", "project-1", "test")).rejects.toThrow(
        /already initialized/i,
      );

      // CLI should NOT have been called
      expect(spawnFn).not.toHaveBeenCalled();
    });

    /* VAL-SVC-004: CLI failure propagates error, no DB row created */
    it("propagates CLI error and does not create a DB row", async () => {
      const spawnFn = makeSpawnFn({
        stderr: "Error: project creation failed",
        exitCode: 1,
      });

      // DB mock that returns empty for duplicate check, and tracks inserts
      const insertSpy = vi.fn();
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([]).then(resolve),
            }),
          }),
        }),
        insert: () => {
          insertSpy();
          return {
            values: () => ({ returning: () => ({ then: (r: any) => Promise.resolve([]).then(r) }) }),
          };
        },
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });

      await expect(svc.init("c-1", "p-1", "test")).rejects.toThrow(
        StripeProjectsCliError,
      );
      expect(insertSpy).not.toHaveBeenCalled();
    });

    /* Race condition: concurrent init() calls should produce conflict, not raw DB error */
    it("normalizes unique constraint violation from concurrent insert into conflict error", async () => {
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify({ id: "sp_1", name: "my-project", directory: "/tmp/sp" }),
      });

      // DB mock: select returns empty (pre-check passes for both concurrent calls),
      // but insert throws a Postgres unique constraint violation (code 23505).
      const uniqueViolationError: any = new Error(
        'duplicate key value violates unique constraint "stripe_project_connections_company_id_project_id_unique"',
      );
      uniqueViolationError.code = "23505";

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([]).then(resolve),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: () => ({
              then: () => Promise.reject(uniqueViolationError),
            }),
          }),
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });

      // Should throw an HttpError (conflict), not the raw Postgres error
      await expect(svc.init("company-1", "project-1", "my-project")).rejects.toThrow(HttpError);
      await expect(svc.init("company-1", "project-1", "my-project")).rejects.toThrow(
        /already initialized/i,
      );
    });

    it("re-throws non-unique-constraint DB errors from insert", async () => {
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify({ id: "sp_1", name: "my-project", directory: "/tmp/sp" }),
      });

      const genericDbError = new Error("connection refused");

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([]).then(resolve),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: () => ({
              then: () => Promise.reject(genericDbError),
            }),
          }),
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });

      // Should re-throw the original error, NOT convert to conflict
      await expect(svc.init("company-1", "project-1", "my-project")).rejects.toThrow(
        "connection refused",
      );
      // Should NOT be an HttpError
      try {
        await svc.init("company-1", "project-1", "my-project");
      } catch (err: any) {
        expect(err).not.toBeInstanceOf(HttpError);
      }
    });

    /* VAL-SVC-035 (partial): init validates required arguments */
    it("throws immediately if companyId is missing or empty", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      await expect(svc.init("", "p-1", "name")).rejects.toThrow(/companyId/);
      await expect(svc.init("  ", "p-1", "name")).rejects.toThrow(/companyId/);
      expect(spawnFn).not.toHaveBeenCalled();
    });

    it("throws immediately if projectId is missing or empty", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      await expect(svc.init("c-1", "", "name")).rejects.toThrow(/projectId/);
      expect(spawnFn).not.toHaveBeenCalled();
    });

    it("throws immediately if name is missing or empty", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      await expect(svc.init("c-1", "p-1", "")).rejects.toThrow(/name/);
      expect(spawnFn).not.toHaveBeenCalled();
    });

    /* VAL-SVC-036 (partial): Error messages clean without internal paths */
    it("produces clean error messages without internal paths on failure", async () => {
      const spawnFn = makeSpawnFn({
        stderr: "Error: quota exceeded",
        exitCode: 1,
      });

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([]).then(resolve),
            }),
          }),
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });

      try {
        await svc.init("c-1", "p-1", "test");
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        // Error message should not contain internal paths
        expect(err.message).not.toMatch(/node_modules/);
        expect(err.message).not.toMatch(/\/Users\//);
        expect(err.message).not.toMatch(/at\s+\S+\.(ts|js):\d+/);
      }
    });
  });

  /* ================================================================ */
  /*  catalog                                                          */
  /* ================================================================ */
  describe("catalog", () => {
    /* VAL-SVC-005: catalog returns parsed service list from CLI */
    it("returns parsed service list from CLI", async () => {
      const catalogData = [
        { id: "vercel/project", name: "Vercel Project", provider: "vercel", category: "hosting" },
        { id: "supabase/postgres", name: "Supabase Postgres", provider: "supabase", category: "databases" },
      ];
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(catalogData),
      });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      const result = await svc.catalog();

      expect(result).toEqual(catalogData);
      expect(result).toHaveLength(2);
      expect(result[0].provider).toBe("vercel");
    });

    /* VAL-SVC-006: catalog supports category filtering via CLI flag */
    it("passes category filter to CLI command", async () => {
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify([
          { id: "vercel/project", name: "Vercel Project", provider: "vercel", category: "hosting" },
        ]),
      });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      await svc.catalog("hosting");

      expect(spawnFn).toHaveBeenCalledOnce();
      const [, args] = spawnFn.mock.calls[0];
      expect(args).toContain("--category");
      expect(args).toContain("hosting");
    });

    it("does not pass category flag when category is undefined", async () => {
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify([]),
      });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      await svc.catalog();

      const [, args] = spawnFn.mock.calls[0];
      expect(args).not.toContain("--category");
    });

    it("does not pass category flag when category is empty string", async () => {
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify([]),
      });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      await svc.catalog("");

      const [, args] = spawnFn.mock.calls[0];
      expect(args).not.toContain("--category");
    });

    /* VAL-SVC-007: catalog handles CLI errors gracefully */
    it("throws meaningful error when CLI fails", async () => {
      const spawnFn = makeSpawnFn({
        stderr: "Error: failed to fetch catalog",
        exitCode: 1,
      });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      await expect(svc.catalog()).rejects.toThrow(StripeProjectsCliError);
      await expect(svc.catalog()).rejects.toThrow(/catalog|error/i);
    });

    it("returns empty array when CLI returns non-array JSON", async () => {
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify({ message: "no services" }),
      });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      const result = await svc.catalog();
      expect(result).toEqual([]);
    });
  });

  /* ================================================================ */
  /*  status                                                           */
  /* ================================================================ */
  describe("status", () => {
    /* VAL-SVC-015: status returns parsed project status */
    it("returns parsed project status from CLI", async () => {
      const statusData = {
        status: "active",
        services: [
          { id: "svc-1", provider: "vercel", serviceType: "project", status: "active" },
        ],
      };
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(statusData),
      });

      const connectionRow = {
        id: "conn-1",
        companyId: "c-1",
        projectId: "p-1",
        stripeProjectName: "my-project",
        stripeProjectDir: "/tmp/sp",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionRow]).then(resolve),
            }),
          }),
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });
      const result = await svc.status("conn-1");

      expect(result).toMatchObject({
        name: "my-project",
        directory: "/tmp/sp",
        status: "active",
      });
      expect(result.services).toHaveLength(1);
    });

    /* VAL-SVC-016: status with non-existent connection throws notFound */
    it("throws notFound when connection does not exist", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([]).then(resolve),
            }),
          }),
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });

      await expect(svc.status("nonexistent-id")).rejects.toThrow(HttpError);
      await expect(svc.status("nonexistent-id")).rejects.toThrow(/not found/i);

      // CLI should NOT have been called since connection doesn't exist
      expect(spawnFn).not.toHaveBeenCalled();
    });

    /* VAL-SVC-035 (partial): status validates required arguments */
    it("throws immediately if connectionId is missing or empty", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      await expect(svc.status("")).rejects.toThrow(/connectionId/);
      await expect(svc.status("  ")).rejects.toThrow(/connectionId/);
      expect(spawnFn).not.toHaveBeenCalled();
    });

    it("handles CLI returning no services array gracefully", async () => {
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify({ status: "active" }),
      });

      const connectionRow = {
        id: "conn-1",
        companyId: "c-1",
        projectId: "p-1",
        stripeProjectName: "my-project",
        stripeProjectDir: null,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionRow]).then(resolve),
            }),
          }),
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });
      const result = await svc.status("conn-1");

      expect(result.services).toEqual([]);
    });

    /* Connection-scoped cwd: status passes connection's stripeProjectDir as cwd */
    it("passes connection stripeProjectDir as cwd to CLI wrapper", async () => {
      const statusData = { status: "active", services: [] };
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(statusData),
      });

      const connectionRow = {
        id: "conn-1",
        companyId: "c-1",
        projectId: "p-1",
        stripeProjectName: "my-project",
        stripeProjectDir: "/home/user/.projects/proj-alpha",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionRow]).then(resolve),
            }),
          }),
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });
      await svc.status("conn-1");

      expect(spawnFn).toHaveBeenCalledOnce();
      const [, , spawnOpts] = spawnFn.mock.calls[0];
      expect(spawnOpts.cwd).toBe("/home/user/.projects/proj-alpha");
    });

    /* Two connections return their own respective status (isolation test) */
    it("two connections return different status results isolated by cwd", async () => {
      // Track which cwd each spawn call received so we can return different data
      const spawnFn = vi.fn((_cmd: string, _args: string[], opts: any) => {
        const fake = createFakeProc();
        const cwd = opts?.cwd;
        setImmediate(() => {
          if (cwd === "/projects/alpha") {
            fake.emitStdout(JSON.stringify({
              status: "active",
              services: [{ id: "svc-a", provider: "vercel", serviceType: "project", status: "active" }],
            }));
          } else if (cwd === "/projects/beta") {
            fake.emitStdout(JSON.stringify({
              status: "paused",
              services: [
                { id: "svc-b1", provider: "supabase", serviceType: "postgres", status: "active" },
                { id: "svc-b2", provider: "neon", serviceType: "database", status: "provisioning" },
              ],
            }));
          } else {
            fake.emitStdout(JSON.stringify({ status: "unknown", services: [] }));
          }
          fake.emitClose(0);
        });
        return fake.proc;
      });

      const connectionAlpha = {
        id: "conn-alpha",
        companyId: "c-1",
        projectId: "p-1",
        stripeProjectName: "alpha-project",
        stripeProjectDir: "/projects/alpha",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const connectionBeta = {
        id: "conn-beta",
        companyId: "c-2",
        projectId: "p-2",
        stripeProjectName: "beta-project",
        stripeProjectDir: "/projects/beta",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock DB that returns the correct connection based on the where clause argument
      let selectCallCount = 0;
      const connections = [connectionAlpha, connectionBeta];
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => {
                const conn = connections[selectCallCount++];
                return Promise.resolve([conn]).then(resolve);
              },
            }),
          }),
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });

      const statusAlpha = await svc.status("conn-alpha");
      const statusBeta = await svc.status("conn-beta");

      // Verify isolation: each connection returns its own status
      expect(statusAlpha.name).toBe("alpha-project");
      expect(statusAlpha.status).toBe("active");
      expect(statusAlpha.services).toHaveLength(1);

      expect(statusBeta.name).toBe("beta-project");
      expect(statusBeta.status).toBe("paused");
      expect(statusBeta.services).toHaveLength(2);

      // Verify each spawn call was made with the correct cwd
      expect(spawnFn).toHaveBeenCalledTimes(2);
      const [, , optsAlpha] = spawnFn.mock.calls[0];
      const [, , optsBeta] = spawnFn.mock.calls[1];
      expect(optsAlpha.cwd).toBe("/projects/alpha");
      expect(optsBeta.cwd).toBe("/projects/beta");
    });

    /* When stripeProjectDir is null, cwd is not set */
    it("does not pass cwd when connection has no stripeProjectDir", async () => {
      const statusData = { status: "active", services: [] };
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(statusData),
      });

      const connectionRow = {
        id: "conn-1",
        companyId: "c-1",
        projectId: "p-1",
        stripeProjectName: "my-project",
        stripeProjectDir: null,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionRow]).then(resolve),
            }),
          }),
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });
      await svc.status("conn-1");

      expect(spawnFn).toHaveBeenCalledOnce();
      const [, , spawnOpts] = spawnFn.mock.calls[0];
      expect(spawnOpts.cwd).toBeUndefined();
    });
  });

  /* ================================================================ */
  /*  listServices                                                     */
  /* ================================================================ */
  describe("listServices", () => {
    /* VAL-SVC-024: listServices returns DB rows for connection */
    it("returns provisioned services from DB for the connection", async () => {
      const serviceRows = [
        {
          id: "svc-1",
          connectionId: "conn-1",
          providerService: "vercel/project",
          provider: "vercel",
          serviceType: "project",
          tier: "pro",
          status: "active",
          resourceMetadata: { url: "https://app.vercel.com" },
          provisionedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "svc-2",
          connectionId: "conn-1",
          providerService: "supabase/postgres",
          provider: "supabase",
          serviceType: "database",
          tier: null,
          status: "active",
          resourceMetadata: null,
          provisionedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve(serviceRows).then(resolve),
            }),
          }),
        }),
      };

      const svc = stripeProjectsService(mockDb);
      const result = await svc.listServices("conn-1");

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: "svc-1",
        connectionId: "conn-1",
        providerService: "vercel/project",
        provider: "vercel",
        tier: "pro",
        status: "active",
      });
      expect(result[1]).toMatchObject({
        id: "svc-2",
        provider: "supabase",
        tier: null,
      });
    });

    /* VAL-SVC-025: listServices returns empty array when none exist */
    it("returns empty array when no services are provisioned", async () => {
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([]).then(resolve),
            }),
          }),
        }),
      };

      const svc = stripeProjectsService(mockDb);
      const result = await svc.listServices("conn-1");

      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
    });

    /* VAL-SVC-035 (partial): listServices validates required arguments */
    it("throws immediately if connectionId is missing or empty", async () => {
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db);

      await expect(svc.listServices("")).rejects.toThrow(/connectionId/);
      await expect(svc.listServices("  ")).rejects.toThrow(/connectionId/);
    });
  });

  /* ================================================================ */
  /*  addService                                                       */
  /* ================================================================ */
  describe("addService", () => {
    const connectionRow = {
      id: "conn-1",
      companyId: "c-1",
      projectId: "p-1",
      stripeProjectName: "my-project",
      stripeProjectDir: "/tmp/sp",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    /* VAL-SVC-008: addService provisions via CLI, stores DB record, returns record */
    it("calls CLI add, stores DB record, and returns the provisioned service", async () => {
      const cliOutput = {
        id: "svc-123",
        tier: "pro",
        dashboardUrl: "https://vercel.com/dashboard",
      };
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(cliOutput),
      });

      let insertedRow: any = null;
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionRow]).then(resolve),
            }),
          }),
        }),
        insert: () => ({
          values: (data: any) => {
            insertedRow = {
              ...data,
              id: crypto.randomUUID(),
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            return {
              returning: () => ({
                then: (resolve: any) => Promise.resolve([insertedRow]).then(resolve),
              }),
            };
          },
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });
      const result = await svc.addService("conn-1", "vercel/project");

      // Verify CLI was called with correct args
      expect(spawnFn).toHaveBeenCalledOnce();
      const [, args] = spawnFn.mock.calls[0];
      expect(args).toContain("vercel/project");

      // Verify DB record
      expect(insertedRow).not.toBeNull();
      expect(insertedRow.connectionId).toBe("conn-1");
      expect(insertedRow.providerService).toBe("vercel/project");
      expect(insertedRow.provider).toBe("vercel");
      expect(insertedRow.serviceType).toBe("project");

      // Verify return value
      expect(result).toMatchObject({
        connectionId: "conn-1",
        providerService: "vercel/project",
        provider: "vercel",
        serviceType: "project",
        status: "active",
      });
      expect(result.id).toBeDefined();
    });

    /* VAL-SVC-009: addService returns resource info from provider */
    it("returns provider-specific resource information from CLI JSON", async () => {
      const cliOutput = {
        tier: "pro",
        dashboardUrl: "https://vercel.com/dashboard",
        region: "us-east-1",
      };
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(cliOutput),
      });

      let insertedRow: any = null;
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionRow]).then(resolve),
            }),
          }),
        }),
        insert: () => ({
          values: (data: any) => {
            insertedRow = {
              ...data,
              id: crypto.randomUUID(),
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            return {
              returning: () => ({
                then: (resolve: any) => Promise.resolve([insertedRow]).then(resolve),
              }),
            };
          },
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });
      const result = await svc.addService("conn-1", "vercel/project");

      // Resource metadata should contain the CLI output
      expect(result.resourceMetadata).toBeDefined();
      expect(result.resourceMetadata).toMatchObject({
        dashboardUrl: "https://vercel.com/dashboard",
        region: "us-east-1",
      });
      expect(result.tier).toBe("pro");
    });

    /* VAL-SVC-010: addService fails when connection does not exist (no CLI call) */
    it("throws notFound when connection does not exist, without calling CLI", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([]).then(resolve),
            }),
          }),
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });

      await expect(svc.addService("nonexistent", "vercel/project")).rejects.toThrow(HttpError);
      await expect(svc.addService("nonexistent", "vercel/project")).rejects.toThrow(/not found/i);

      // CLI should NOT have been called
      expect(spawnFn).not.toHaveBeenCalled();
    });

    /* VAL-SVC-011: addService handles provider errors (no DB row on failure) */
    it("does not create DB row when CLI fails", async () => {
      const spawnFn = makeSpawnFn({
        stderr: "Error: provider rejected request — quota exceeded",
        exitCode: 1,
      });

      const insertSpy = vi.fn();
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionRow]).then(resolve),
            }),
          }),
        }),
        insert: () => {
          insertSpy();
          return {
            values: () => ({ returning: () => ({ then: (r: any) => Promise.resolve([]).then(r) }) }),
          };
        },
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });

      await expect(svc.addService("conn-1", "vercel/project")).rejects.toThrow(StripeProjectsCliError);

      // DB insert should NOT have been called
      expect(insertSpy).not.toHaveBeenCalled();
    });

    /* VAL-SVC-035 (partial): addService validates required arguments */
    it("throws immediately if connectionId is missing or empty", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      await expect(svc.addService("", "vercel/project")).rejects.toThrow(/connectionId/);
      expect(spawnFn).not.toHaveBeenCalled();
    });

    it("throws immediately if providerService is missing or empty", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      await expect(svc.addService("conn-1", "")).rejects.toThrow(/providerService/);
      expect(spawnFn).not.toHaveBeenCalled();
    });

    /* cwd scoping: addService passes connection stripeProjectDir as cwd */
    it("passes connection stripeProjectDir as cwd to CLI wrapper", async () => {
      const cliOutput = { id: "svc-123", tier: "pro" };
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(cliOutput),
      });

      const connectionWithDir = {
        ...connectionRow,
        stripeProjectDir: "/home/user/.projects/proj-alpha",
      };

      let insertedRow: any = null;
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionWithDir]).then(resolve),
            }),
          }),
        }),
        insert: () => ({
          values: (data: any) => {
            insertedRow = {
              ...data,
              id: crypto.randomUUID(),
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            return {
              returning: () => ({
                then: (resolve: any) => Promise.resolve([insertedRow]).then(resolve),
              }),
            };
          },
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });
      await svc.addService("conn-1", "vercel/project");

      expect(spawnFn).toHaveBeenCalledOnce();
      const [, , spawnOpts] = spawnFn.mock.calls[0];
      expect(spawnOpts.cwd).toBe("/home/user/.projects/proj-alpha");
    });

    it("does not pass cwd when connection has no stripeProjectDir", async () => {
      const cliOutput = { id: "svc-123", tier: "pro" };
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(cliOutput),
      });

      const connectionNoDir = {
        ...connectionRow,
        stripeProjectDir: null,
      };

      let insertedRow: any = null;
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionNoDir]).then(resolve),
            }),
          }),
        }),
        insert: () => ({
          values: (data: any) => {
            insertedRow = {
              ...data,
              id: crypto.randomUUID(),
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            return {
              returning: () => ({
                then: (resolve: any) => Promise.resolve([insertedRow]).then(resolve),
              }),
            };
          },
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });
      await svc.addService("conn-1", "vercel/project");

      expect(spawnFn).toHaveBeenCalledOnce();
      const [, , spawnOpts] = spawnFn.mock.calls[0];
      expect(spawnOpts.cwd).toBeUndefined();
    });
  });

  /* ================================================================ */
  /*  removeService                                                    */
  /* ================================================================ */
  describe("removeService", () => {
    const serviceRow = {
      id: "svc-1",
      connectionId: "conn-1",
      providerService: "vercel/project",
      provider: "vercel",
      serviceType: "project",
      tier: "pro",
      status: "active",
      resourceMetadata: null,
      provisionedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    /* VAL-SVC-012: removeService calls CLI and deletes DB row on success */
    it("calls CLI remove and deletes DB row on success", async () => {
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify({ removed: true }),
      });

      const deleteSpy = vi.fn().mockReturnValue(Promise.resolve());
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([serviceRow]).then(resolve),
            }),
          }),
        }),
        delete: () => ({
          where: () => {
            deleteSpy();
            return Promise.resolve();
          },
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });
      await svc.removeService("svc-1");

      // CLI should have been called
      expect(spawnFn).toHaveBeenCalledOnce();
      const [, args] = spawnFn.mock.calls[0];
      expect(args).toContain("vercel/project");

      // DB row should have been deleted
      expect(deleteSpy).toHaveBeenCalledOnce();
    });

    /* VAL-SVC-013: removeService throws for non-existent service (no CLI call) */
    it("throws notFound for non-existent service without calling CLI", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([]).then(resolve),
            }),
          }),
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });

      await expect(svc.removeService("nonexistent")).rejects.toThrow(HttpError);
      await expect(svc.removeService("nonexistent")).rejects.toThrow(/not found/i);

      // CLI should NOT have been called
      expect(spawnFn).not.toHaveBeenCalled();
    });

    /* VAL-SVC-014: removeService preserves DB row on CLI failure */
    it("preserves DB row when CLI removal fails", async () => {
      const spawnFn = makeSpawnFn({
        stderr: "Error: removal failed — service busy",
        exitCode: 1,
      });

      const deleteSpy = vi.fn();
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([serviceRow]).then(resolve),
            }),
          }),
        }),
        delete: () => ({
          where: () => {
            deleteSpy();
            return Promise.resolve();
          },
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });

      await expect(svc.removeService("svc-1")).rejects.toThrow(StripeProjectsCliError);

      // DB delete should NOT have been called since CLI failed
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    /* VAL-SVC-035 (partial): removeService validates required arguments */
    it("throws immediately if serviceId is missing or empty", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      await expect(svc.removeService("")).rejects.toThrow(/serviceId/);
      expect(spawnFn).not.toHaveBeenCalled();
    });

    /* cwd scoping: removeService passes connection stripeProjectDir as cwd */
    it("passes connection stripeProjectDir as cwd to CLI wrapper", async () => {
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify({ removed: true }),
      });

      const connectionRow = {
        id: "conn-1",
        companyId: "c-1",
        projectId: "p-1",
        stripeProjectName: "my-project",
        stripeProjectDir: "/home/user/.projects/proj-alpha",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const deleteSpy = vi.fn().mockReturnValue(Promise.resolve());
      let selectCallCount = 0;
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => {
                selectCallCount++;
                // First select: service lookup; second: connection lookup
                if (selectCallCount === 1) {
                  return Promise.resolve([serviceRow]).then(resolve);
                }
                return Promise.resolve([connectionRow]).then(resolve);
              },
            }),
          }),
        }),
        delete: () => ({
          where: () => {
            deleteSpy();
            return Promise.resolve();
          },
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });
      await svc.removeService("svc-1");

      expect(spawnFn).toHaveBeenCalledOnce();
      const [, , spawnOpts] = spawnFn.mock.calls[0];
      expect(spawnOpts.cwd).toBe("/home/user/.projects/proj-alpha");
    });

    it("does not pass cwd when connection has no stripeProjectDir for removeService", async () => {
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify({ removed: true }),
      });

      const connectionRow = {
        id: "conn-1",
        companyId: "c-1",
        projectId: "p-1",
        stripeProjectName: "my-project",
        stripeProjectDir: null,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const deleteSpy = vi.fn().mockReturnValue(Promise.resolve());
      let selectCallCount = 0;
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => {
                selectCallCount++;
                if (selectCallCount === 1) {
                  return Promise.resolve([serviceRow]).then(resolve);
                }
                return Promise.resolve([connectionRow]).then(resolve);
              },
            }),
          }),
        }),
        delete: () => ({
          where: () => {
            deleteSpy();
            return Promise.resolve();
          },
        }),
      };

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn });
      await svc.removeService("svc-1");

      expect(spawnFn).toHaveBeenCalledOnce();
      const [, , spawnOpts] = spawnFn.mock.calls[0];
      expect(spawnOpts.cwd).toBeUndefined();
    });
  });

  /* ================================================================ */
  /*  syncCredentials                                                  */
  /* ================================================================ */
  describe("syncCredentials", () => {
    const connectionRow = {
      id: "conn-1",
      companyId: "c-1",
      projectId: "p-1",
      stripeProjectName: "my-project",
      stripeProjectDir: "/tmp/sp",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    function makeMockSecretSvc(existingSecrets: Record<string, { id: string; latestVersion: number }> = {}) {
      const created: Array<{ companyId: string; name: string; value: string }> = [];
      const rotated: Array<{ secretId: string; value: string }> = [];

      return {
        svc: {
          getByName: vi.fn(async (_companyId: string, name: string) => {
            return existingSecrets[name] ?? null;
          }),
          create: vi.fn(async (companyId: string, input: any) => {
            created.push({ companyId, name: input.name, value: input.value });
            return { id: crypto.randomUUID(), ...input };
          }),
          rotate: vi.fn(async (secretId: string, input: any) => {
            rotated.push({ secretId, value: input.value });
            return { id: secretId };
          }),
        },
        created,
        rotated,
      };
    }

    /* VAL-SVC-017: syncCredentials parses env output and stores secrets */
    it("parses env output and upserts each key-value into company_secrets", async () => {
      const fakeStripeKey = ["sk", "test", "123"].join("_");
      const envData = {
        DATABASE_URL: "postgres://localhost/mydb",
        STRIPE_SECRET_KEY: fakeStripeKey,
        REDIS_URL: "redis://localhost:6379",
      };
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(envData),
      });

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionRow]).then(resolve),
            }),
          }),
        }),
      };

      const { svc: mockSecretSvc, created } = makeMockSecretSvc();
      const svc = stripeProjectsService(mockDb, { spawn: spawnFn }, mockSecretSvc);
      const result = await svc.syncCredentials("conn-1");

      expect(result).toEqual({ synced: true, secretsCount: 3 });
      expect(created).toHaveLength(3);
      expect(created[0]).toMatchObject({ companyId: "c-1", name: "DATABASE_URL", value: "postgres://localhost/mydb" });
      expect(created[1]).toMatchObject({ companyId: "c-1", name: "STRIPE_SECRET_KEY", value: fakeStripeKey });
      expect(created[2]).toMatchObject({ companyId: "c-1", name: "REDIS_URL", value: "redis://localhost:6379" });
    });

    /* VAL-SVC-018: syncCredentials updates existing secrets (no duplicates) */
    it("updates existing secrets instead of creating duplicates", async () => {
      const envData = {
        DATABASE_URL: "postgres://localhost/newdb",
        NEW_KEY: "new-value",
      };
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(envData),
      });

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionRow]).then(resolve),
            }),
          }),
        }),
      };

      // DATABASE_URL already exists; NEW_KEY does not
      const { svc: mockSecretSvc, created, rotated } = makeMockSecretSvc({
        DATABASE_URL: { id: "secret-db-url", latestVersion: 1 },
      });

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn }, mockSecretSvc);
      const result = await svc.syncCredentials("conn-1");

      expect(result).toEqual({ synced: true, secretsCount: 2 });

      // DATABASE_URL should be rotated (updated), not created
      expect(rotated).toHaveLength(1);
      expect(rotated[0]).toMatchObject({ secretId: "secret-db-url", value: "postgres://localhost/newdb" });

      // NEW_KEY should be created
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ companyId: "c-1", name: "NEW_KEY", value: "new-value" });
    });

    /* VAL-SVC-019: syncCredentials handles empty env output without error */
    it("handles empty env output gracefully", async () => {
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify({}),
      });

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionRow]).then(resolve),
            }),
          }),
        }),
      };

      const { svc: mockSecretSvc, created, rotated } = makeMockSecretSvc();
      const svc = stripeProjectsService(mockDb, { spawn: spawnFn }, mockSecretSvc);
      const result = await svc.syncCredentials("conn-1");

      expect(result).toEqual({ synced: true, secretsCount: 0 });
      expect(created).toHaveLength(0);
      expect(rotated).toHaveLength(0);
    });

    /* VAL-SVC-020: syncCredentials handles CLI failure without modifying secrets */
    it("does not modify secrets when CLI fails", async () => {
      const spawnFn = makeSpawnFn({
        stderr: "Error: failed to fetch env",
        exitCode: 1,
      });

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionRow]).then(resolve),
            }),
          }),
        }),
      };

      const { svc: mockSecretSvc, created, rotated } = makeMockSecretSvc();
      const svc = stripeProjectsService(mockDb, { spawn: spawnFn }, mockSecretSvc);

      await expect(svc.syncCredentials("conn-1")).rejects.toThrow(StripeProjectsCliError);

      // No secrets should have been modified
      expect(created).toHaveLength(0);
      expect(rotated).toHaveLength(0);
      expect(mockSecretSvc.getByName).not.toHaveBeenCalled();
    });

    it("handles array format env output", async () => {
      const envData = [
        { key: "DATABASE_URL", value: "postgres://localhost/mydb" },
        { key: "API_KEY", value: "key-123" },
      ];
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(envData),
      });

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionRow]).then(resolve),
            }),
          }),
        }),
      };

      const { svc: mockSecretSvc, created } = makeMockSecretSvc();
      const svc = stripeProjectsService(mockDb, { spawn: spawnFn }, mockSecretSvc);
      const result = await svc.syncCredentials("conn-1");

      expect(result).toEqual({ synced: true, secretsCount: 2 });
      expect(created).toHaveLength(2);
    });

    it("throws notFound when connection does not exist", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([]).then(resolve),
            }),
          }),
        }),
      };

      const { svc: mockSecretSvc } = makeMockSecretSvc();
      const svc = stripeProjectsService(mockDb, { spawn: spawnFn }, mockSecretSvc);

      await expect(svc.syncCredentials("nonexistent")).rejects.toThrow(HttpError);
      await expect(svc.syncCredentials("nonexistent")).rejects.toThrow(/not found/i);
      expect(spawnFn).not.toHaveBeenCalled();
    });

    /* VAL-SVC-035 (partial): syncCredentials validates required arguments */
    it("throws immediately if connectionId is missing or empty", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      await expect(svc.syncCredentials("")).rejects.toThrow(/connectionId/);
      expect(spawnFn).not.toHaveBeenCalled();
    });

    /* cwd scoping: syncCredentials passes connection stripeProjectDir as cwd */
    it("passes connection stripeProjectDir as cwd to CLI wrapper", async () => {
      const envData = { DATABASE_URL: "postgres://localhost/mydb" };
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(envData),
      });

      const connectionWithDir = {
        ...connectionRow,
        stripeProjectDir: "/home/user/.projects/proj-alpha",
      };

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionWithDir]).then(resolve),
            }),
          }),
        }),
      };

      const { svc: mockSecretSvc } = makeMockSecretSvc();
      const svc = stripeProjectsService(mockDb, { spawn: spawnFn }, mockSecretSvc);
      await svc.syncCredentials("conn-1");

      expect(spawnFn).toHaveBeenCalledOnce();
      const [, , spawnOpts] = spawnFn.mock.calls[0];
      expect(spawnOpts.cwd).toBe("/home/user/.projects/proj-alpha");
    });

    it("does not pass cwd when connection has no stripeProjectDir for syncCredentials", async () => {
      const envData = { DATABASE_URL: "postgres://localhost/mydb" };
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(envData),
      });

      const connectionNoDir = {
        ...connectionRow,
        stripeProjectDir: null,
      };

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionNoDir]).then(resolve),
            }),
          }),
        }),
      };

      const { svc: mockSecretSvc } = makeMockSecretSvc();
      const svc = stripeProjectsService(mockDb, { spawn: spawnFn }, mockSecretSvc);
      await svc.syncCredentials("conn-1");

      expect(spawnFn).toHaveBeenCalledOnce();
      const [, , spawnOpts] = spawnFn.mock.calls[0];
      expect(spawnOpts.cwd).toBeUndefined();
    });
  });

  /* ================================================================ */
  /*  rotateCredentials                                                */
  /* ================================================================ */
  describe("rotateCredentials", () => {
    const connectionRow = {
      id: "conn-1",
      companyId: "c-1",
      projectId: "p-1",
      stripeProjectName: "my-project",
      stripeProjectDir: "/tmp/sp",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const serviceRow = {
      id: "svc-1",
      connectionId: "conn-1",
      providerService: "vercel/project",
      provider: "vercel",
      serviceType: "project",
      tier: "pro",
      status: "active",
      resourceMetadata: null,
      provisionedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    function makeMockSecretSvc(existingSecrets: Record<string, { id: string; latestVersion: number }> = {}) {
      const created: Array<{ companyId: string; name: string; value: string }> = [];
      const rotated: Array<{ secretId: string; value: string }> = [];

      return {
        svc: {
          getByName: vi.fn(async (_companyId: string, name: string) => {
            return existingSecrets[name] ?? null;
          }),
          create: vi.fn(async (companyId: string, input: any) => {
            created.push({ companyId, name: input.name, value: input.value });
            return { id: crypto.randomUUID(), ...input };
          }),
          rotate: vi.fn(async (secretId: string, input: any) => {
            rotated.push({ secretId, value: input.value });
            return { id: secretId };
          }),
        },
        created,
        rotated,
      };
    }

    /** Helper to build a mockDb that returns connectionRow for the first
     *  select call and serviceRow for the second. */
    function makeMockDbWithConnectionAndService() {
      let selectCallCount = 0;
      return {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => {
                selectCallCount++;
                // First select: connection lookup; second: service lookup
                if (selectCallCount === 1) {
                  return Promise.resolve([connectionRow]).then(resolve);
                }
                return Promise.resolve([serviceRow]).then(resolve);
              },
            }),
          }),
        }),
      } as any;
    }

    /* VAL-SVC-021: rotateCredentials rotates via CLI and updates stored secrets */
    it("calls CLI rotate and updates secrets with new values", async () => {
      const rotatedEnv = {
        DATABASE_URL: "postgres://localhost/rotated-db",
        API_KEY: "new-api-key-456",
      };
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(rotatedEnv),
      });

      const mockDb = makeMockDbWithConnectionAndService();

      const { svc: mockSecretSvc, rotated } = makeMockSecretSvc({
        DATABASE_URL: { id: "secret-db-url", latestVersion: 1 },
        API_KEY: { id: "secret-api-key", latestVersion: 2 },
      });

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn }, mockSecretSvc);
      const result = await svc.rotateCredentials("conn-1", "svc-1");

      expect(result).toEqual({ rotated: true });

      // CLI should have been called with the service's providerService
      expect(spawnFn).toHaveBeenCalledOnce();
      const [, args] = spawnFn.mock.calls[0];
      expect(args).toContain("vercel/project");

      // Both secrets should have been rotated with new values
      expect(rotated).toHaveLength(2);
      expect(rotated[0]).toMatchObject({ secretId: "secret-db-url", value: "postgres://localhost/rotated-db" });
      expect(rotated[1]).toMatchObject({ secretId: "secret-api-key", value: "new-api-key-456" });
    });

    /* VAL-SVC-022: rotateCredentials fails for non-existent connection */
    it("throws notFound when connection does not exist", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([]).then(resolve),
            }),
          }),
        }),
      };

      const { svc: mockSecretSvc } = makeMockSecretSvc();
      const svc = stripeProjectsService(mockDb, { spawn: spawnFn }, mockSecretSvc);

      await expect(svc.rotateCredentials("nonexistent", "svc-1")).rejects.toThrow(HttpError);
      await expect(svc.rotateCredentials("nonexistent", "svc-1")).rejects.toThrow(/not found/i);

      // CLI should NOT have been called
      expect(spawnFn).not.toHaveBeenCalled();
    });

    /* VAL-SVC-023: rotateCredentials preserves secrets on CLI failure */
    it("preserves existing secrets when CLI rotation fails", async () => {
      const spawnFn = makeSpawnFn({
        stderr: "Error: provider refused rotation",
        exitCode: 1,
      });

      const mockDb = makeMockDbWithConnectionAndService();

      const { svc: mockSecretSvc, created, rotated } = makeMockSecretSvc({
        DATABASE_URL: { id: "secret-db-url", latestVersion: 1 },
      });

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn }, mockSecretSvc);

      await expect(svc.rotateCredentials("conn-1", "svc-1")).rejects.toThrow(StripeProjectsCliError);

      // No secrets should have been modified
      expect(created).toHaveLength(0);
      expect(rotated).toHaveLength(0);
      expect(mockSecretSvc.getByName).not.toHaveBeenCalled();
    });

    it("throws notFound when service does not exist for the connection", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });

      let selectCallCount = 0;
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => {
                selectCallCount++;
                // First select returns connection, second returns no service
                if (selectCallCount === 1) {
                  return Promise.resolve([connectionRow]).then(resolve);
                }
                return Promise.resolve([]).then(resolve);
              },
            }),
          }),
        }),
      };

      const { svc: mockSecretSvc } = makeMockSecretSvc();
      const svc = stripeProjectsService(mockDb, { spawn: spawnFn }, mockSecretSvc);

      await expect(svc.rotateCredentials("conn-1", "nonexistent-svc")).rejects.toThrow(HttpError);
      await expect(svc.rotateCredentials("conn-1", "nonexistent-svc")).rejects.toThrow(/not found/i);

      // CLI should NOT have been called
      expect(spawnFn).not.toHaveBeenCalled();
    });

    it("creates new secrets for credentials that don't exist yet during rotation", async () => {
      const rotatedEnv = {
        NEW_CREDENTIAL: "brand-new-value",
      };
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(rotatedEnv),
      });

      const mockDb = makeMockDbWithConnectionAndService();

      // No existing secrets
      const { svc: mockSecretSvc, created } = makeMockSecretSvc();

      const svc = stripeProjectsService(mockDb, { spawn: spawnFn }, mockSecretSvc);
      const result = await svc.rotateCredentials("conn-1", "svc-1");

      expect(result).toEqual({ rotated: true });
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        companyId: "c-1",
        name: "NEW_CREDENTIAL",
        value: "brand-new-value",
      });
    });

    /* VAL-SVC-035 (partial): rotateCredentials validates required arguments */
    it("throws immediately if connectionId is missing or empty", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      await expect(svc.rotateCredentials("", "svc-1")).rejects.toThrow(/connectionId/);
      expect(spawnFn).not.toHaveBeenCalled();
    });

    it("throws immediately if serviceId is missing or empty", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      await expect(svc.rotateCredentials("conn-1", "")).rejects.toThrow(/serviceId/);
      expect(spawnFn).not.toHaveBeenCalled();
    });

    /* cwd scoping: rotateCredentials passes connection stripeProjectDir as cwd */
    it("passes connection stripeProjectDir as cwd to CLI wrapper", async () => {
      const rotatedEnv = { API_KEY: "new-key-123" };
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(rotatedEnv),
      });

      const connectionWithDir = {
        ...connectionRow,
        stripeProjectDir: "/home/user/.projects/proj-alpha",
      };

      let selectCallCount = 0;
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => {
                selectCallCount++;
                // First select: connection lookup; second: service lookup
                if (selectCallCount === 1) {
                  return Promise.resolve([connectionWithDir]).then(resolve);
                }
                return Promise.resolve([serviceRow]).then(resolve);
              },
            }),
          }),
        }),
      };

      const { svc: mockSecretSvc } = makeMockSecretSvc();
      const svc = stripeProjectsService(mockDb, { spawn: spawnFn }, mockSecretSvc);
      await svc.rotateCredentials("conn-1", "svc-1");

      expect(spawnFn).toHaveBeenCalledOnce();
      const [, , spawnOpts] = spawnFn.mock.calls[0];
      expect(spawnOpts.cwd).toBe("/home/user/.projects/proj-alpha");
    });

    it("does not pass cwd when connection has no stripeProjectDir for rotateCredentials", async () => {
      const rotatedEnv = { API_KEY: "new-key-123" };
      const spawnFn = makeSpawnFn({
        stdout: JSON.stringify(rotatedEnv),
      });

      const connectionNoDir = {
        ...connectionRow,
        stripeProjectDir: null,
      };

      let selectCallCount = 0;
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => {
                selectCallCount++;
                if (selectCallCount === 1) {
                  return Promise.resolve([connectionNoDir]).then(resolve);
                }
                return Promise.resolve([serviceRow]).then(resolve);
              },
            }),
          }),
        }),
      };

      const { svc: mockSecretSvc } = makeMockSecretSvc();
      const svc = stripeProjectsService(mockDb, { spawn: spawnFn }, mockSecretSvc);
      await svc.rotateCredentials("conn-1", "svc-1");

      expect(spawnFn).toHaveBeenCalledOnce();
      const [, , spawnOpts] = spawnFn.mock.calls[0];
      expect(spawnOpts.cwd).toBeUndefined();
    });
  });

  /* ================================================================ */
  /*  Cross-cutting: argument validation (VAL-SVC-035)                 */
  /* ================================================================ */
  describe("argument validation across all methods", () => {
    it("all methods validate required string arguments", async () => {
      const spawnFn = makeSpawnFn({ stdout: "{}" });
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db, { spawn: spawnFn });

      // init
      await expect(svc.init("", "p", "n")).rejects.toThrow(/companyId/);
      await expect(svc.init("c", "", "n")).rejects.toThrow(/projectId/);
      await expect(svc.init("c", "p", "")).rejects.toThrow(/name/);

      // status
      await expect(svc.status("")).rejects.toThrow(/connectionId/);

      // listServices
      await expect(svc.listServices("")).rejects.toThrow(/connectionId/);

      // addService
      await expect(svc.addService("", "vercel/project")).rejects.toThrow(/connectionId/);
      await expect(svc.addService("conn-1", "")).rejects.toThrow(/providerService/);

      // removeService
      await expect(svc.removeService("")).rejects.toThrow(/serviceId/);

      // syncCredentials
      await expect(svc.syncCredentials("")).rejects.toThrow(/connectionId/);

      // rotateCredentials
      await expect(svc.rotateCredentials("", "svc-1")).rejects.toThrow(/connectionId/);
      await expect(svc.rotateCredentials("conn-1", "")).rejects.toThrow(/serviceId/);

      // None of these should have triggered CLI calls
      expect(spawnFn).not.toHaveBeenCalled();
    });
  });

  /* ================================================================ */
  /*  Cross-cutting: clean error messages (VAL-SVC-036)                */
  /* ================================================================ */
  describe("clean error messages", () => {
    it("validation errors do not leak internal stack traces", async () => {
      const { db } = createFakeDb();
      const svc = stripeProjectsService(db);

      try {
        await svc.init("", "p", "n");
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(err.message).not.toMatch(/node_modules/);
        expect(err.message).not.toMatch(/\/Users\//);
        expect(err.message).not.toMatch(/\/home\//);
        expect(err.message).not.toMatch(/at\s+Object\./);
        expect(err.message).toContain("companyId");
      }
    });

    it("notFound errors do not leak internal paths", async () => {
      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([]).then(resolve),
            }),
          }),
        }),
      };

      const svc = stripeProjectsService(mockDb);

      try {
        await svc.status("nonexistent");
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(err.message).not.toMatch(/node_modules/);
        expect(err.message).not.toMatch(/\/Users\//);
        expect(err.message).toMatch(/not found/i);
      }
    });

    it("conflict errors do not leak internal paths", async () => {
      const connectionRow = {
        id: "existing-id",
        companyId: "c-1",
        projectId: "p-1",
        stripeProjectName: "existing",
        stripeProjectDir: null,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb: any = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (resolve: any) => Promise.resolve([connectionRow]).then(resolve),
            }),
          }),
        }),
      };

      const svc = stripeProjectsService(mockDb);

      try {
        await svc.init("c-1", "p-1", "test");
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(err.message).not.toMatch(/node_modules/);
        expect(err.message).not.toMatch(/\/Users\//);
        expect(err.message).toMatch(/already initialized/i);
      }
    });
  });
});

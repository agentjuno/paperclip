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

import { and, eq, like } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companySecrets, stripeProjectConnections, stripeProvisionedServices } from "@paperclipai/db";
import type {
  StripeProjectConnection,
  StripeCatalogService,
  StripeProjectStatus,
  StripeProvisionedService,
  StripeSyncResult,
  StripeRotateResult,
} from "@paperclipai/shared";
import { badRequest, conflict, notFound } from "../errors.js";
import {
  execStripeProjectsCmd,
  type ExecStripeProjectsCmdOptions,
} from "./stripe-projects-cli.js";
import { secretService as createSecretService } from "./secrets.js";

/* ------------------------------------------------------------------ */
/*  Argument validation helpers                                        */
/* ------------------------------------------------------------------ */

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`Missing required argument: ${name}`);
  }
  return value.trim();
}

/* ------------------------------------------------------------------ */
/*  Row → domain type mappers                                          */
/* ------------------------------------------------------------------ */

type ConnectionRow = typeof stripeProjectConnections.$inferSelect;
type ServiceRow = typeof stripeProvisionedServices.$inferSelect;

function toConnection(row: ConnectionRow): StripeProjectConnection {
  return {
    id: row.id,
    companyId: row.companyId,
    projectId: row.projectId,
    stripeProjectName: row.stripeProjectName,
    stripeProjectDir: row.stripeProjectDir,
    status: row.status as StripeProjectConnection["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toProvisionedService(row: ServiceRow): StripeProvisionedService {
  return {
    id: row.id,
    connectionId: row.connectionId,
    providerService: row.providerService,
    provider: row.provider,
    serviceType: row.serviceType,
    tier: row.tier,
    status: row.status as StripeProvisionedService["status"],
    resourceMetadata: row.resourceMetadata,
    provisionedAt: row.provisionedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* ------------------------------------------------------------------ */
/*  Secret-service interface (subset used by this module)               */
/* ------------------------------------------------------------------ */

/** Minimal interface for the methods we need from secretService */
export interface SecretServiceLike {
  getByName: (companyId: string, name: string) => Promise<{ id: string; latestVersion: number } | null>;
  create: (
    companyId: string,
    input: { name: string; provider: "local_encrypted"; value: string; description?: string | null },
  ) => Promise<unknown>;
  rotate: (
    secretId: string,
    input: { value: string },
  ) => Promise<unknown>;
}

/* ------------------------------------------------------------------ */
/*  Service factory                                                     */
/* ------------------------------------------------------------------ */

export function stripeProjectsService(
  db: Db,
  cliOptions?: ExecStripeProjectsCmdOptions,
  secretSvc?: SecretServiceLike,
) {
  /** Lazily resolve the secret service (create from db if not injected) */
  function getSecretSvc(): SecretServiceLike {
    if (secretSvc) return secretSvc;
    return createSecretService(db) as unknown as SecretServiceLike;
  }

  return {
    /**
     * Initialize a Stripe Project for a company+project pair.
     * Validates args, checks for duplicate, calls CLI, stores connection.
     */
    init: async (
      companyId: string,
      projectId: string,
      name: string,
    ): Promise<StripeProjectConnection> => {
      requireString(companyId, "companyId");
      requireString(projectId, "projectId");
      requireString(name, "name");

      // Check for duplicate before calling CLI
      const existing = await db
        .select()
        .from(stripeProjectConnections)
        .where(
          and(
            eq(stripeProjectConnections.companyId, companyId),
            eq(stripeProjectConnections.projectId, projectId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (existing) {
        throw conflict(
          `Stripe project already initialized for this company and project`,
        );
      }

      // Call CLI to initialize the Stripe project
      const cliResult = (await execStripeProjectsCmd(
        "init",
        ["--name", name],
        cliOptions,
      )) as Record<string, unknown>;

      // Store connection in DB — wrap in try-catch to normalize unique
      // constraint violations from concurrent requests into conflict errors.
      let row: ConnectionRow;
      try {
        row = await db
          .insert(stripeProjectConnections)
          .values({
            companyId,
            projectId,
            stripeProjectName: name,
            stripeProjectDir:
              typeof cliResult.directory === "string"
                ? cliResult.directory
                : null,
            status: "active",
          })
          .returning()
          .then((rows) => rows[0]);
      } catch (err: unknown) {
        // Catch unique constraint violations (Postgres error code 23505)
        if (isUniqueViolation(err)) {
          throw conflict(
            `Stripe project already initialized for this company and project`,
          );
        }
        throw err;
      }

      return toConnection(row);
    },

    /**
     * List the Stripe service catalog, optionally filtered by category.
     */
    catalog: async (category?: string): Promise<StripeCatalogService[]> => {
      const args: string[] = [];
      if (category && category.trim().length > 0) {
        args.push("--category", category.trim());
      }

      const result = await execStripeProjectsCmd("catalog", args, cliOptions);

      // The CLI returns an array of catalog entries
      if (!Array.isArray(result)) {
        return [];
      }

      return result as StripeCatalogService[];
    },

    /**
     * Get the status of a Stripe project connection.
     * Looks up the connection first — throws notFound if missing.
     */
    status: async (connectionId: string): Promise<StripeProjectStatus> => {
      requireString(connectionId, "connectionId");

      const connection = await db
        .select()
        .from(stripeProjectConnections)
        .where(eq(stripeProjectConnections.id, connectionId))
        .then((rows) => rows[0] ?? null);

      if (!connection) {
        throw notFound("Stripe project connection not found");
      }

      const statusCliOptions = connection.stripeProjectDir
        ? { ...cliOptions, cwd: connection.stripeProjectDir }
        : cliOptions;

      const cliResult = (await execStripeProjectsCmd(
        "status",
        [],
        statusCliOptions,
      )) as Record<string, unknown>;

      return {
        name: connection.stripeProjectName,
        directory: connection.stripeProjectDir,
        services: Array.isArray(cliResult.services)
          ? (cliResult.services as StripeProvisionedService[])
          : [],
        status: typeof cliResult.status === "string" ? cliResult.status : connection.status,
      };
    },

    /**
     * List provisioned services for a connection from the DB.
     * Returns empty array if none exist.
     */
    listServices: async (
      connectionId: string,
    ): Promise<StripeProvisionedService[]> => {
      requireString(connectionId, "connectionId");

      const rows = await db
        .select()
        .from(stripeProvisionedServices)
        .where(eq(stripeProvisionedServices.connectionId, connectionId));

      return rows.map(toProvisionedService);
    },

    /**
     * Provision a new service via CLI and store a DB record.
     * Validates the connection exists before calling CLI.
     * No DB write on CLI failure.
     */
    addService: async (
      connectionId: string,
      providerService: string,
    ): Promise<StripeProvisionedService> => {
      requireString(connectionId, "connectionId");
      requireString(providerService, "providerService");

      // Validate connection exists before calling CLI
      const connection = await db
        .select()
        .from(stripeProjectConnections)
        .where(eq(stripeProjectConnections.id, connectionId))
        .then((rows) => rows[0] ?? null);

      if (!connection) {
        throw notFound("Stripe project connection not found");
      }

      // Parse provider and service type from "provider/serviceType" format
      const slashIdx = providerService.indexOf("/");
      const provider = slashIdx > 0 ? providerService.slice(0, slashIdx) : providerService;
      const serviceType = slashIdx > 0 ? providerService.slice(slashIdx + 1) : providerService;

      // Call CLI to provision the service
      const addCliOptions = connection.stripeProjectDir
        ? { ...cliOptions, cwd: connection.stripeProjectDir }
        : cliOptions;
      const cliResult = (await execStripeProjectsCmd(
        "add",
        [providerService],
        addCliOptions,
      )) as Record<string, unknown>;

      // Store service record in DB
      const row = await db
        .insert(stripeProvisionedServices)
        .values({
          connectionId,
          providerService,
          provider,
          serviceType,
          tier: typeof cliResult.tier === "string" ? cliResult.tier : null,
          status: "active",
          resourceMetadata: typeof cliResult === "object" ? (cliResult as Record<string, unknown>) : null,
          provisionedAt: new Date(),
        })
        .returning()
        .then((rows) => rows[0]);

      return toProvisionedService(row);
    },

    /**
     * Remove a provisioned service via CLI and delete the DB record.
     * Validates the service exists before calling CLI.
     * DB row is preserved on CLI failure (no corruption).
     */
    removeService: async (serviceId: string): Promise<void> => {
      requireString(serviceId, "serviceId");

      // Validate service exists before calling CLI
      const service = await db
        .select()
        .from(stripeProvisionedServices)
        .where(eq(stripeProvisionedServices.id, serviceId))
        .then((rows) => rows[0] ?? null);

      if (!service) {
        throw notFound("Provisioned service not found");
      }

      // Look up the connection to get the project directory for cwd scoping
      const connection = await db
        .select()
        .from(stripeProjectConnections)
        .where(eq(stripeProjectConnections.id, service.connectionId))
        .then((rows) => rows[0] ?? null);

      const removeCliOptions = connection?.stripeProjectDir
        ? { ...cliOptions, cwd: connection.stripeProjectDir }
        : cliOptions;

      // Call CLI to remove the service — if this throws, DB row is preserved
      await execStripeProjectsCmd(
        "remove",
        [service.providerService],
        removeCliOptions,
      );

      // Only delete DB row on successful CLI removal
      await db
        .delete(stripeProvisionedServices)
        .where(eq(stripeProvisionedServices.id, serviceId));

      // Clean up associated credentials from company_secrets.
      // Credentials synced from this provider use a PROVIDER_ name prefix
      // (e.g., NEON_API_KEY, NEON_SECRET for the "neon" provider).
      if (connection) {
        const prefix = `${service.provider.toUpperCase()}_%`;
        await db
          .delete(companySecrets)
          .where(
            and(
              eq(companySecrets.companyId, connection.companyId),
              like(companySecrets.name, prefix),
            ),
          );
      }
    },

    /**
     * Sync credentials from Stripe Projects env into company_secrets.
     * Calls `stripe projects env --json`, parses key-value pairs,
     * and upserts each into company_secrets via secretService.
     * Uses provider 'local_encrypted'. Updates existing secrets (no duplicates).
     * Handles empty env output gracefully.
     */
    syncCredentials: async (connectionId: string): Promise<StripeSyncResult> => {
      requireString(connectionId, "connectionId");

      // Validate connection exists
      const connection = await db
        .select()
        .from(stripeProjectConnections)
        .where(eq(stripeProjectConnections.id, connectionId))
        .then((rows) => rows[0] ?? null);

      if (!connection) {
        throw notFound("Stripe project connection not found");
      }

      // Call CLI to get environment variables — if this throws, no secrets are modified
      const syncCliOptions = connection.stripeProjectDir
        ? { ...cliOptions, cwd: connection.stripeProjectDir }
        : cliOptions;
      const cliResult = await execStripeProjectsCmd("env", [], syncCliOptions);

      // Parse key-value pairs from the result
      const envEntries = parseEnvEntries(cliResult);

      if (envEntries.length === 0) {
        return { synced: true, secretsCount: 0 };
      }

      // Upsert each credential into company_secrets
      const svc = getSecretSvc();
      let count = 0;

      for (const { key, value } of envEntries) {
        const existing = await svc.getByName(connection.companyId, key);

        if (existing) {
          // Update existing secret via rotate (no duplicates)
          await svc.rotate(existing.id, { value });
        } else {
          // Create new secret
          await svc.create(connection.companyId, {
            name: key,
            provider: "local_encrypted",
            value,
            description: `Synced from Stripe Projects (${connection.stripeProjectName})`,
          });
        }
        count++;
      }

      return { synced: true, secretsCount: count };
    },

    /**
     * Rotate credentials for a specific service via CLI
     * and update the corresponding secrets in company_secrets.
     * Validates connection and service exist before calling CLI.
     * Preserves existing secrets on CLI failure.
     */
    rotateCredentials: async (
      connectionId: string,
      serviceId: string,
    ): Promise<StripeRotateResult> => {
      requireString(connectionId, "connectionId");
      requireString(serviceId, "serviceId");

      // Validate connection exists
      const connection = await db
        .select()
        .from(stripeProjectConnections)
        .where(eq(stripeProjectConnections.id, connectionId))
        .then((rows) => rows[0] ?? null);

      if (!connection) {
        throw notFound("Stripe project connection not found");
      }

      // Validate service exists
      const service = await db
        .select()
        .from(stripeProvisionedServices)
        .where(
          and(
            eq(stripeProvisionedServices.id, serviceId),
            eq(stripeProvisionedServices.connectionId, connectionId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!service) {
        throw notFound("Provisioned service not found");
      }

      // Call CLI to rotate credentials — if this throws, secrets are preserved
      const rotateCliOptions = connection.stripeProjectDir
        ? { ...cliOptions, cwd: connection.stripeProjectDir }
        : cliOptions;
      const cliResult = await execStripeProjectsCmd(
        "rotate",
        [service.providerService],
        rotateCliOptions,
      );

      // Parse the rotated credential values and update secrets
      const envEntries = parseEnvEntries(cliResult);
      const svc = getSecretSvc();

      for (const { key, value } of envEntries) {
        const existing = await svc.getByName(connection.companyId, key);

        if (existing) {
          await svc.rotate(existing.id, { value });
        } else {
          await svc.create(connection.companyId, {
            name: key,
            provider: "local_encrypted",
            value,
            description: `Rotated from Stripe Projects (${connection.stripeProjectName})`,
          });
        }
      }

      return { rotated: true };
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Unique-constraint violation detection                               */
/* ------------------------------------------------------------------ */

/**
 * Detects Postgres unique-constraint violations (error code "23505")
 * regardless of the DB driver in use (node-postgres, PGlite, etc.).
 */
function isUniqueViolation(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const obj = err as Record<string, unknown>;
  // node-postgres / PGlite expose `code` directly
  if (obj.code === "23505") return true;
  // Some drivers wrap the PG error in a `cause` or `detail` field
  if (typeof obj.message === "string" && /unique.*constraint|duplicate key/i.test(obj.message)) {
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Env output parsing helper                                          */
/* ------------------------------------------------------------------ */

/**
 * Parses CLI env/rotate output into key-value pairs.
 * Handles both object format { KEY: "value" } and
 * array format [{ key: "KEY", value: "value" }].
 * Returns empty array for null/undefined/empty input.
 */
function parseEnvEntries(
  result: unknown,
): Array<{ key: string; value: string }> {
  if (result == null) return [];

  // Array format: [{ key: "K", value: "V" }, ...]
  if (Array.isArray(result)) {
    return result
      .filter(
        (entry): entry is { key: string; value: string } =>
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.key === "string" &&
          typeof entry.value === "string",
      )
      .map((entry) => ({ key: entry.key, value: entry.value }));
  }

  // Object format: { KEY: "value", ... }
  if (typeof result === "object") {
    const entries: Array<{ key: string; value: string }> = [];
    for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
      if (typeof value === "string") {
        entries.push({ key, value });
      }
    }
    return entries;
  }

  return [];
}

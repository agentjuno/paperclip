import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { stripeProjectConnections, stripeProvisionedServices } from "@paperclipai/db";
import type {
  StripeProjectConnection,
  StripeCatalogService,
  StripeProjectStatus,
  StripeProvisionedService,
} from "@paperclipai/shared";
import { badRequest, conflict, notFound } from "../errors.js";
import {
  execStripeProjectsCmd,
  type ExecStripeProjectsCmdOptions,
} from "./stripe-projects-cli.js";

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
/*  Service factory                                                     */
/* ------------------------------------------------------------------ */

export function stripeProjectsService(
  db: Db,
  cliOptions?: ExecStripeProjectsCmdOptions,
) {
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

      // Store connection in DB
      const row = await db
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

      const cliResult = (await execStripeProjectsCmd(
        "status",
        [],
        cliOptions,
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
  };
}

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  initStripeProjectSchema,
  addStripeServiceSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import {
  stripeProjectsService,
  projectService,
  logActivity,
} from "../services/index.js";

/**
 * Stripe Projects route factory.
 *
 * Mounts endpoints under:
 *   GET  /companies/:companyId/stripe-projects/catalog
 *   POST /companies/:companyId/projects/:projectId/stripe-projects/init
 *   GET  /companies/:companyId/projects/:projectId/stripe-projects/status
 *   GET  /companies/:companyId/projects/:projectId/stripe-projects/services
 *   POST /companies/:companyId/projects/:projectId/stripe-projects/services
 *   DELETE /companies/:companyId/projects/:projectId/stripe-projects/services/:serviceId
 *   POST /companies/:companyId/projects/:projectId/stripe-projects/sync
 *   POST /companies/:companyId/projects/:projectId/stripe-projects/services/:serviceId/rotate
 */
export function stripeProjectRoutes(db: Db) {
  const router = Router();
  const svc = stripeProjectsService(db);
  const projSvc = projectService(db);

  /* ---------------------------------------------------------------- */
  /*  Helper: resolve and validate the project belongs to the company  */
  /* ---------------------------------------------------------------- */

  async function resolveProject(companyId: string, projectId: string) {
    const project = await projSvc.getById(projectId);
    if (!project) return null;
    if (project.companyId !== companyId) return null;
    return project;
  }

  /* ================================================================ */
  /*  Catalog (accessible to all company members)                      */
  /* ================================================================ */

  router.get(
    "/companies/:companyId/stripe-projects/catalog",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const category =
        typeof req.query.category === "string" && req.query.category.trim().length > 0
          ? req.query.category.trim()
          : undefined;

      const result = await svc.catalog(category);
      res.json(result);
    },
  );

  /* ================================================================ */
  /*  Init (board-only)                                                */
  /* ================================================================ */

  router.post(
    "/companies/:companyId/projects/:projectId/stripe-projects/init",
    validate(initStripeProjectSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const projectId = req.params.projectId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);

      const project = await resolveProject(companyId, projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const connection = await svc.init(companyId, projectId, req.body.name);

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "stripe_project.initialized",
        entityType: "stripe_project_connection",
        entityId: connection.id,
        details: { name: connection.stripeProjectName, projectId },
      });

      res.status(201).json(connection);
    },
  );

  /* ================================================================ */
  /*  Status (board-only)                                              */
  /* ================================================================ */

  router.get(
    "/companies/:companyId/projects/:projectId/stripe-projects/status",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const projectId = req.params.projectId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);

      const project = await resolveProject(companyId, projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // The service's status method looks up by connectionId.
      // We need to find the connection for this project first.
      // Pass projectId to the status method — the service will resolve it.
      const result = await svc.status(projectId);
      res.json(result);
    },
  );

  /* ================================================================ */
  /*  List services (board-only)                                       */
  /* ================================================================ */

  router.get(
    "/companies/:companyId/projects/:projectId/stripe-projects/services",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const projectId = req.params.projectId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);

      const project = await resolveProject(companyId, projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const services = await svc.listServices(projectId);
      res.json(services);
    },
  );

  /* ================================================================ */
  /*  Add service (board-only)                                         */
  /* ================================================================ */

  router.post(
    "/companies/:companyId/projects/:projectId/stripe-projects/services",
    validate(addStripeServiceSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const projectId = req.params.projectId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);

      const project = await resolveProject(companyId, projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const service = await svc.addService(projectId, req.body.providerService);

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "stripe_project.service_added",
        entityType: "stripe_provisioned_service",
        entityId: service.id,
        details: { providerService: req.body.providerService, projectId },
      });

      res.status(201).json(service);
    },
  );

  /* ================================================================ */
  /*  Remove service (board-only)                                      */
  /* ================================================================ */

  router.delete(
    "/companies/:companyId/projects/:projectId/stripe-projects/services/:serviceId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const projectId = req.params.projectId as string;
      const serviceId = req.params.serviceId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);

      const project = await resolveProject(companyId, projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      await svc.removeService(serviceId);

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "stripe_project.service_removed",
        entityType: "stripe_provisioned_service",
        entityId: serviceId,
        details: { projectId },
      });

      res.json({ ok: true });
    },
  );

  /* ================================================================ */
  /*  Sync credentials (board-only)                                    */
  /* ================================================================ */

  router.post(
    "/companies/:companyId/projects/:projectId/stripe-projects/sync",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const projectId = req.params.projectId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);

      const project = await resolveProject(companyId, projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const result = await svc.syncCredentials(projectId);

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "stripe_project.credentials_synced",
        entityType: "stripe_project_connection",
        entityId: projectId,
        details: { secretsCount: result.secretsCount },
      });

      res.json(result);
    },
  );

  /* ================================================================ */
  /*  Rotate credentials (board-only)                                  */
  /* ================================================================ */

  router.post(
    "/companies/:companyId/projects/:projectId/stripe-projects/services/:serviceId/rotate",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const projectId = req.params.projectId as string;
      const serviceId = req.params.serviceId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);

      const project = await resolveProject(companyId, projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const result = await svc.rotateCredentials(projectId, serviceId);

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "stripe_project.credentials_rotated",
        entityType: "stripe_provisioned_service",
        entityId: serviceId,
        details: { projectId },
      });

      res.json(result);
    },
  );

  return router;
}

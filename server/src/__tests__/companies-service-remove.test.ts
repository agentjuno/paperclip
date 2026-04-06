import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  approvals,
  assets,
  budgetIncidents,
  budgetPolicies,
  companies,
  companySkills,
  companyTokenLaunchRequests,
  companyTokenLaunches,
  createDb,
  documents,
  goals,
  heartbeatRunEvents,
  heartbeatRuns,
  issueAttachments,
  issueComments,
  issueDocuments,
  issueInboxArchives,
  issueReadStates,
  issues,
  projects,
  stripeProjectConnections,
  workspaceOperations,
  workspaceRuntimeServices,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { companyService } from "../services/companies.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres company delete tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("companyService.remove", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof companyService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-companies-remove-");
    db = createDb(tempDb.connectionString);
    svc = companyService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(workspaceOperations);
    await db.delete(companyTokenLaunchRequests);
    await db.delete(budgetIncidents);
    await db.delete(issueInboxArchives);
    await db.delete(issueReadStates);
    await db.delete(activityLog);
    await db.delete(heartbeatRunEvents);
    await db.delete(workspaceRuntimeServices);
    await db.delete(heartbeatRuns);
    await db.delete(issueComments);
    await db.delete(issueAttachments);
    await db.delete(issueDocuments);
    await db.delete(approvals);
    await db.delete(companySkills);
    await db.delete(companyTokenLaunches);
    await db.delete(budgetPolicies);
    await db.delete(stripeProjectConnections);
    await db.delete(issues);
    await db.delete(documents);
    await db.delete(projects);
    await db.delete(assets);
    await db.delete(goals);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("removes companies with production-style dependent records", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const goalId = randomUUID();
    const projectId = randomUUID();
    const issueId = randomUUID();
    const assetId = randomUUID();
    const documentId = randomUUID();
    const budgetApprovalId = randomUUID();
    const launchApprovalId = randomUUID();
    const launchId = randomUUID();
    const policyId = randomUUID();
    const runtimeServiceId = randomUUID();
    const heartbeatRunId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Delete Me Inc",
      issuePrefix: `D${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Cleanup Agent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Ship deletion fix",
      status: "planned",
    });

    await db.insert(projects).values({
      id: projectId,
      companyId,
      goalId,
      name: "Deletion Project",
      status: "in_progress",
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      projectId,
      goalId,
      title: "Delete the company",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
      createdByUserId: "user-1",
    });

    await db.insert(issueComments).values({
      companyId,
      issueId,
      authorAgentId: agentId,
      body: "This row used to block issue deletion.",
    });

    await db.insert(issueReadStates).values({
      companyId,
      issueId,
      userId: "user-1",
    });

    await db.insert(issueInboxArchives).values({
      companyId,
      issueId,
      userId: "user-1",
    });

    await db.insert(assets).values({
      id: assetId,
      companyId,
      provider: "filesystem",
      objectKey: `assets/${assetId}.png`,
      contentType: "image/png",
      byteSize: 128,
      sha256: "abc123",
      createdByAgentId: agentId,
    });

    await db.insert(issueAttachments).values({
      companyId,
      issueId,
      assetId,
    });

    await db.insert(documents).values({
      id: documentId,
      companyId,
      title: "Deletion notes",
      latestBody: "These docs should go away with the company.",
      createdByAgentId: agentId,
    });

    await db.insert(issueDocuments).values({
      companyId,
      issueId,
      documentId,
      key: "spec",
    });

    await db.insert(approvals).values([
      {
        id: budgetApprovalId,
        companyId,
        type: "budget_override",
        requestedByAgentId: agentId,
        payload: { kind: "budget" },
      },
      {
        id: launchApprovalId,
        companyId,
        type: "token_launch",
        requestedByAgentId: agentId,
        payload: { kind: "launch" },
      },
    ]);

    await db.insert(budgetPolicies).values({
      id: policyId,
      companyId,
      scopeType: "company",
      scopeId: companyId,
      windowKind: "monthly",
      amount: 10_000,
      createdByUserId: "user-1",
    });

    await db.insert(budgetIncidents).values({
      companyId,
      policyId,
      scopeType: "company",
      scopeId: companyId,
      metric: "billed_cents",
      windowKind: "monthly",
      windowStart: new Date("2026-01-01T00:00:00Z"),
      windowEnd: new Date("2026-02-01T00:00:00Z"),
      thresholdType: "hard_stop",
      amountLimit: 10_000,
      amountObserved: 12_000,
      approvalId: budgetApprovalId,
    });

    await db.insert(companySkills).values({
      companyId,
      key: "delete-skill",
      slug: "delete-skill",
      name: "Delete Skill",
      markdown: "# Delete Skill",
    });

    await db.insert(companyTokenLaunches).values({
      id: launchId,
      companyId,
      tokenName: "Delete Token",
      tokenSymbol: "DLT",
    });

    await db.insert(companyTokenLaunchRequests).values({
      companyId,
      launchId,
      approvalId: launchApprovalId,
      submittedByUserId: "user-1",
      feeWalletAddress: "0x123",
      simulationFingerprint: "fingerprint-1",
      bankrPayload: { mode: "test" },
      simulationResult: { ok: true },
    });

    await db.insert(stripeProjectConnections).values({
      companyId,
      projectId,
      stripeProjectName: "delete-project",
    });

    await db.insert(heartbeatRuns).values({
      id: heartbeatRunId,
      companyId,
      agentId,
      invocationSource: "manual",
      status: "queued",
    });

    await db.insert(heartbeatRunEvents).values({
      companyId,
      runId: heartbeatRunId,
      agentId,
      seq: 1,
      eventType: "status",
      message: "queued",
    });

    await db.insert(workspaceRuntimeServices).values({
      id: runtimeServiceId,
      companyId,
      projectId,
      issueId,
      scopeType: "project",
      scopeId: projectId,
      serviceName: "preview",
      status: "running",
      lifecycle: "persistent",
      provider: "local",
    });

    await db.insert(workspaceOperations).values({
      companyId,
      heartbeatRunId,
      phase: "boot",
      status: "running",
    });

    await db.insert(activityLog).values({
      companyId,
      actorType: "agent",
      actorId: agentId,
      action: "heartbeat.started",
      entityType: "heartbeat_run",
      entityId: heartbeatRunId,
      agentId,
      runId: heartbeatRunId,
      details: { source: "test" },
    });

    const removed = await svc.remove(companyId);

    expect(removed?.id).toBe(companyId);

    const [
      remainingCompanies,
      remainingProjects,
      remainingGoals,
      remainingIssues,
      remainingDocuments,
      remainingPolicies,
      remainingLaunches,
      remainingSkills,
      remainingConnections,
      remainingRuntimeServices,
      remainingOperations,
      remainingRuns,
      remainingActivity,
    ] = await Promise.all([
      db.select().from(companies).where(eq(companies.id, companyId)),
      db.select().from(projects).where(eq(projects.companyId, companyId)),
      db.select().from(goals).where(eq(goals.companyId, companyId)),
      db.select().from(issues).where(eq(issues.companyId, companyId)),
      db.select().from(documents).where(eq(documents.companyId, companyId)),
      db.select().from(budgetPolicies).where(eq(budgetPolicies.companyId, companyId)),
      db.select().from(companyTokenLaunches).where(eq(companyTokenLaunches.companyId, companyId)),
      db.select().from(companySkills).where(eq(companySkills.companyId, companyId)),
      db.select().from(stripeProjectConnections).where(eq(stripeProjectConnections.companyId, companyId)),
      db.select().from(workspaceRuntimeServices).where(eq(workspaceRuntimeServices.companyId, companyId)),
      db.select().from(workspaceOperations).where(eq(workspaceOperations.companyId, companyId)),
      db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId)),
      db.select().from(activityLog).where(eq(activityLog.companyId, companyId)),
    ]);

    expect(remainingCompanies).toHaveLength(0);
    expect(remainingProjects).toHaveLength(0);
    expect(remainingGoals).toHaveLength(0);
    expect(remainingIssues).toHaveLength(0);
    expect(remainingDocuments).toHaveLength(0);
    expect(remainingPolicies).toHaveLength(0);
    expect(remainingLaunches).toHaveLength(0);
    expect(remainingSkills).toHaveLength(0);
    expect(remainingConnections).toHaveLength(0);
    expect(remainingRuntimeServices).toHaveLength(0);
    expect(remainingOperations).toHaveLength(0);
    expect(remainingRuns).toHaveLength(0);
    expect(remainingActivity).toHaveLength(0);
  });
});

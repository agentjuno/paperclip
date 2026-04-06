import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentMailRoutes, agentMailWebhookRoute } from "../routes/agentmail.js";
import { errorHandler } from "../middleware/index.js";

const mockAgentMailService = vi.hoisted(() => ({
  status: vi.fn(),
  provision: vi.fn(),
  listInboxes: vi.fn(),
  createInbox: vi.fn(),
  updateInbox: vi.fn(),
  deleteInbox: vi.fn(),
  listThreads: vi.fn(),
  listMessages: vi.fn(),
  getMessage: vi.fn(),
  updateMessage: vi.fn(),
  sendMessage: vi.fn(),
  replyToMessage: vi.fn(),
  forwardMessage: vi.fn(),
  getAttachment: vi.fn(),
  listDrafts: vi.fn(),
  createDraft: vi.fn(),
  updateDraft: vi.fn(),
  sendDraft: vi.fn(),
  deleteDraft: vi.fn(),
  listDomains: vi.fn(),
  createDomain: vi.fn(),
  verifyDomain: vi.fn(),
  deleteDomain: vi.fn(),
  listLists: vi.fn(),
  createList: vi.fn(),
  createListEntry: vi.fn(),
  deleteList: vi.fn(),
  deleteListEntry: vi.fn(),
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  listWebhooks: vi.fn(),
  createWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  handleWebhook: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  agentMailService: () => mockAgentMailService,
  logActivity: mockLogActivity,
}));

function createBoardActor(companyIds: string[] = ["company-1"]) {
  return {
    type: "board" as const,
    userId: "user-1",
    source: "session",
    companyIds,
    isInstanceAdmin: false,
    runId: null,
  };
}

function createMailStatus(overrides: Record<string, unknown> = {}) {
  return {
    companyId: "company-1",
    provisioningStatus: "ready",
    podId: "pod_123",
    podClientId: "company.company-1",
    primaryInboxId: "inbox_123",
    primaryInboxEmail: "founder@agentmail.to",
    webhookId: "wh_123",
    webhookConfigured: true,
    lastWebhookEventType: "message.received",
    lastWebhookEventAt: new Date("2026-04-06T10:00:00.000Z"),
    lastDeliveryEventType: "message.delivered",
    lastDomainEventType: "domain.verified",
    lastError: null,
    provisionedAt: new Date("2026-04-06T09:00:00.000Z"),
    smtp: {
      host: "smtp.agentmail.to",
      port: 465,
      secure: true,
      username: "founder@agentmail.to",
    },
    imap: {
      host: "imap.agentmail.to",
      port: 993,
      secure: true,
      username: "founder@agentmail.to",
      availability: "preview",
    },
    ...overrides,
  };
}

function createApp(actor = createBoardActor()) {
  const app = express();
  app.use(express.json({
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody: Buffer }).rawBody = buf;
    },
  }));
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = actor;
    next();
  });
  app.use("/api", agentMailWebhookRoute({} as any));
  app.use("/api", agentMailRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("agentmail routes", () => {
  beforeEach(() => {
    for (const fn of Object.values(mockAgentMailService)) {
      fn.mockReset();
    }
    mockLogActivity.mockReset();
  });

  it("returns company mail status for an authorized board user", async () => {
    mockAgentMailService.status.mockResolvedValue(createMailStatus());
    const app = createApp();

    const res = await request(app).get("/api/companies/company-1/mail/status");

    expect(res.status).toBe(200);
    expect(res.body.primaryInboxEmail).toBe("founder@agentmail.to");
    expect(mockAgentMailService.status).toHaveBeenCalledWith("company-1");
  });

  it("rejects board users without access to the target company", async () => {
    const app = createApp(createBoardActor(["company-2"]));

    const res = await request(app).get("/api/companies/company-1/mail/status");

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("does not have access");
    expect(mockAgentMailService.status).not.toHaveBeenCalled();
  });

  it("passes attachment-rich send payloads through to AgentMail and logs the activity", async () => {
    mockAgentMailService.sendMessage.mockResolvedValue({
      message_id: "msg_123",
      inbox_id: "inbox_123",
      subject: "Partnership intro",
    });
    const app = createApp();
    const body = {
      inboxId: "inbox_123",
      to: ["founders@example.com"],
      cc: ["ops@example.com"],
      subject: "Partnership intro",
      text: "Hello from Paperclip",
      html: "<p>Hello from Paperclip</p>",
      labels: ["outreach", "priority"],
      attachments: [
        {
          filename: "deck.pdf",
          content: "ZmFrZS1jb250ZW50",
          contentType: "application/pdf",
        },
      ],
    };

    const res = await request(app)
      .post("/api/companies/company-1/mail/messages/send")
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.message_id).toBe("msg_123");
    expect(mockAgentMailService.sendMessage).toHaveBeenCalledWith("company-1", body);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        action: "company.mail_message_sent",
        entityType: "company_mail_message",
        details: { inboxId: "inbox_123" },
      }),
    );
  });

  it("allows manual reprovisioning through the provision route", async () => {
    mockAgentMailService.provision.mockResolvedValue({
      status: createMailStatus({ provisioningStatus: "setting_up", webhookConfigured: false }),
    });
    const app = createApp();

    const res = await request(app)
      .post("/api/companies/company-1/mail/provision")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status.provisioningStatus).toBe("setting_up");
    expect(mockAgentMailService.provision).toHaveBeenCalledWith("company-1");
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        action: "company.mail_provisioned",
        details: { provisioningStatus: "setting_up" },
      }),
    );
  });

  it("hands the raw webhook body and signature headers to the AgentMail service", async () => {
    mockAgentMailService.handleWebhook.mockResolvedValue({ ok: true });
    const app = createApp();
    const payload = {
      event_type: "message.received",
      data: { message_id: "msg_123" },
    };

    const res = await request(app)
      .post("/api/agentmail/webhooks/company-1")
      .set("svix-id", "msg_123")
      .set("svix-timestamp", "1712390400")
      .set("svix-signature", "v1,test")
      .send(payload);

    expect(res.status).toBe(204);
    expect(mockAgentMailService.handleWebhook).toHaveBeenCalledWith(
      "company-1",
      expect.any(Buffer),
      expect.objectContaining({
        "svix-id": "msg_123",
        "svix-timestamp": "1712390400",
        "svix-signature": "v1,test",
      }),
    );
  });
});

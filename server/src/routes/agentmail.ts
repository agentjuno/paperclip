import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  companyMailMessageSendSchema,
  companyMailMessageReplySchema,
  companyMailMessageForwardSchema,
  companyMailMessageUpdateSchema,
  createCompanyMailApiKeySchema,
  createCompanyMailDomainSchema,
  createCompanyMailDraftSchema,
  createCompanyMailInboxSchema,
  createCompanyMailListEntrySchema,
  createCompanyMailListSchema,
  createCompanyMailWebhookSchema,
  updateCompanyMailDraftSchema,
  updateCompanyMailInboxSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { logActivity, agentMailService } from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

function assertBoardCompanyAccess(req: Parameters<typeof assertBoard>[0], companyId: string) {
  assertBoard(req);
  assertCompanyAccess(req, companyId);
}

async function logMailMutation(
  db: Db,
  req: Parameters<typeof getActorInfo>[0],
  companyId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  details?: Record<string, unknown>,
) {
  const actor = getActorInfo(req);
  await logActivity(db, {
    companyId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    agentId: actor.agentId,
    runId: actor.runId,
    action,
    entityType,
    entityId: entityId ?? `${entityType}:${companyId}`,
    details,
  });
}

export function agentMailRoutes(db: Db) {
  const router = Router();
  const svc = agentMailService(db);

  router.get("/companies/:companyId/mail/status", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoardCompanyAccess(req, companyId);
    res.json(await svc.status(companyId));
  });

  router.post("/companies/:companyId/mail/provision", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoardCompanyAccess(req, companyId);
    const result = await svc.provision(companyId);
    await logMailMutation(
      db,
      req,
      companyId,
      "company.mail_provisioned",
      "company_mail",
      companyId,
      { provisioningStatus: result.status.provisioningStatus },
    );
    res.json(result);
  });

  router.get("/companies/:companyId/mail/inboxes", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoardCompanyAccess(req, companyId);
    res.json(await svc.listInboxes(companyId, req.query as Record<string, unknown>));
  });

  router.post(
    "/companies/:companyId/mail/inboxes",
    validate(createCompanyMailInboxSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoardCompanyAccess(req, companyId);
      const inbox = await svc.createInbox(companyId, req.body);
      await logMailMutation(
        db,
        req,
        companyId,
        "company.mail_inbox_created",
        "company_mail_inbox",
        (inbox.inbox_id as string | undefined) ?? null,
        { email: inbox.email ?? null, name: inbox.name ?? null },
      );
      res.status(201).json(inbox);
    },
  );

  router.patch(
    "/companies/:companyId/mail/inboxes/:inboxId",
    validate(updateCompanyMailInboxSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const inboxId = req.params.inboxId as string;
      assertBoardCompanyAccess(req, companyId);
      const inbox = await svc.updateInbox(companyId, inboxId, req.body);
      await logMailMutation(
        db,
        req,
        companyId,
        "company.mail_inbox_updated",
        "company_mail_inbox",
        inboxId,
        { name: inbox.name ?? null },
      );
      res.json(inbox);
    },
  );

  router.delete("/companies/:companyId/mail/inboxes/:inboxId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const inboxId = req.params.inboxId as string;
    assertBoardCompanyAccess(req, companyId);
    const result = await svc.deleteInbox(companyId, inboxId);
    await logMailMutation(db, req, companyId, "company.mail_inbox_deleted", "company_mail_inbox", inboxId);
    res.json(result);
  });

  router.get("/companies/:companyId/mail/threads", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoardCompanyAccess(req, companyId);
    res.json(await svc.listThreads(companyId, req.query as Record<string, unknown>));
  });

  router.get("/companies/:companyId/mail/inboxes/:inboxId/messages", async (req, res) => {
    const companyId = req.params.companyId as string;
    const inboxId = req.params.inboxId as string;
    assertBoardCompanyAccess(req, companyId);
    res.json(await svc.listMessages(companyId, inboxId, req.query as Record<string, unknown>));
  });

  router.get("/companies/:companyId/mail/inboxes/:inboxId/messages/:messageId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const inboxId = req.params.inboxId as string;
    const messageId = req.params.messageId as string;
    assertBoardCompanyAccess(req, companyId);
    res.json(await svc.getMessage(companyId, inboxId, messageId));
  });

  router.patch(
    "/companies/:companyId/mail/inboxes/:inboxId/messages/:messageId",
    validate(companyMailMessageUpdateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const inboxId = req.params.inboxId as string;
      const messageId = req.params.messageId as string;
      assertBoardCompanyAccess(req, companyId);
      const message = await svc.updateMessage(companyId, inboxId, messageId, req.body);
      await logMailMutation(
        db,
        req,
        companyId,
        "company.mail_message_updated",
        "company_mail_message",
        messageId,
        {
          addLabels: req.body.addLabels ?? null,
          removeLabels: req.body.removeLabels ?? null,
          labels: req.body.labels ?? null,
        },
      );
      res.json(message);
    },
  );

  router.post(
    "/companies/:companyId/mail/messages/send",
    validate(companyMailMessageSendSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoardCompanyAccess(req, companyId);
      const message = await svc.sendMessage(companyId, req.body);
      await logMailMutation(
        db,
        req,
        companyId,
        "company.mail_message_sent",
        "company_mail_message",
        (message.message_id as string | undefined) ?? null,
        { inboxId: req.body.inboxId },
      );
      res.status(201).json(message);
    },
  );

  router.post(
    "/companies/:companyId/mail/inboxes/:inboxId/messages/:messageId/reply",
    validate(companyMailMessageReplySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const inboxId = req.params.inboxId as string;
      const messageId = req.params.messageId as string;
      assertBoardCompanyAccess(req, companyId);
      const message = await svc.replyToMessage(companyId, inboxId, messageId, req.body);
      await logMailMutation(db, req, companyId, "company.mail_message_replied", "company_mail_message", messageId);
      res.status(201).json(message);
    },
  );

  router.post(
    "/companies/:companyId/mail/inboxes/:inboxId/messages/:messageId/forward",
    validate(companyMailMessageForwardSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const inboxId = req.params.inboxId as string;
      const messageId = req.params.messageId as string;
      assertBoardCompanyAccess(req, companyId);
      const message = await svc.forwardMessage(companyId, inboxId, messageId, req.body);
      await logMailMutation(db, req, companyId, "company.mail_message_forwarded", "company_mail_message", messageId);
      res.status(201).json(message);
    },
  );

  router.get(
    "/companies/:companyId/mail/inboxes/:inboxId/messages/:messageId/attachments/:attachmentId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const inboxId = req.params.inboxId as string;
      const messageId = req.params.messageId as string;
      const attachmentId = req.params.attachmentId as string;
      assertBoardCompanyAccess(req, companyId);
      res.json(await svc.getAttachment(companyId, inboxId, messageId, attachmentId));
    },
  );

  router.get("/companies/:companyId/mail/drafts", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoardCompanyAccess(req, companyId);
    res.json(await svc.listDrafts(companyId, req.query as Record<string, unknown>));
  });

  router.post(
    "/companies/:companyId/mail/drafts",
    validate(createCompanyMailDraftSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoardCompanyAccess(req, companyId);
      const draft = await svc.createDraft(companyId, req.body);
      await logMailMutation(
        db,
        req,
        companyId,
        "company.mail_draft_created",
        "company_mail_draft",
        (draft.draft_id as string | undefined) ?? null,
        { inboxId: req.body.inboxId },
      );
      res.status(201).json(draft);
    },
  );

  router.patch(
    "/companies/:companyId/mail/inboxes/:inboxId/drafts/:draftId",
    validate(updateCompanyMailDraftSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const inboxId = req.params.inboxId as string;
      const draftId = req.params.draftId as string;
      assertBoardCompanyAccess(req, companyId);
      const draft = await svc.updateDraft(companyId, inboxId, draftId, req.body);
      await logMailMutation(db, req, companyId, "company.mail_draft_updated", "company_mail_draft", draftId);
      res.json(draft);
    },
  );

  router.post("/companies/:companyId/mail/inboxes/:inboxId/drafts/:draftId/send", async (req, res) => {
    const companyId = req.params.companyId as string;
    const inboxId = req.params.inboxId as string;
    const draftId = req.params.draftId as string;
    assertBoardCompanyAccess(req, companyId);
    const message = await svc.sendDraft(companyId, inboxId, draftId);
    await logMailMutation(db, req, companyId, "company.mail_draft_sent", "company_mail_draft", draftId);
    res.json(message);
  });

  router.delete("/companies/:companyId/mail/inboxes/:inboxId/drafts/:draftId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const inboxId = req.params.inboxId as string;
    const draftId = req.params.draftId as string;
    assertBoardCompanyAccess(req, companyId);
    const result = await svc.deleteDraft(companyId, inboxId, draftId);
    await logMailMutation(db, req, companyId, "company.mail_draft_deleted", "company_mail_draft", draftId);
    res.json(result);
  });

  router.get("/companies/:companyId/mail/domains", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoardCompanyAccess(req, companyId);
    res.json(await svc.listDomains(companyId, req.query as Record<string, unknown>));
  });

  router.post(
    "/companies/:companyId/mail/domains",
    validate(createCompanyMailDomainSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoardCompanyAccess(req, companyId);
      const domain = await svc.createDomain(companyId, req.body);
      await logMailMutation(
        db,
        req,
        companyId,
        "company.mail_domain_created",
        "company_mail_domain",
        (domain.domain_id as string | undefined) ?? null,
        { domain: domain.domain ?? req.body.domain },
      );
      res.status(201).json(domain);
    },
  );

  router.post("/companies/:companyId/mail/domains/:domainId/verify", async (req, res) => {
    const companyId = req.params.companyId as string;
    const domainId = req.params.domainId as string;
    assertBoardCompanyAccess(req, companyId);
    const domain = await svc.verifyDomain(companyId, domainId);
    await logMailMutation(db, req, companyId, "company.mail_domain_verified", "company_mail_domain", domainId);
    res.json(domain);
  });

  router.delete("/companies/:companyId/mail/domains/:domainId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const domainId = req.params.domainId as string;
    assertBoardCompanyAccess(req, companyId);
    const result = await svc.deleteDomain(companyId, domainId);
    await logMailMutation(db, req, companyId, "company.mail_domain_deleted", "company_mail_domain", domainId);
    res.json(result);
  });

  router.get("/companies/:companyId/mail/inboxes/:inboxId/lists", async (req, res) => {
    const companyId = req.params.companyId as string;
    const inboxId = req.params.inboxId as string;
    assertBoardCompanyAccess(req, companyId);
    res.json(await svc.listLists(companyId, inboxId, req.query as Record<string, unknown>));
  });

  router.post(
    "/companies/:companyId/mail/inboxes/:inboxId/lists",
    validate(createCompanyMailListSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const inboxId = req.params.inboxId as string;
      assertBoardCompanyAccess(req, companyId);
      const list = await svc.createList(companyId, { ...req.body, inboxId });
      await logMailMutation(
        db,
        req,
        companyId,
        "company.mail_list_created",
        "company_mail_list",
        (list.list_id as string | undefined) ?? null,
        { inboxId },
      );
      res.status(201).json(list);
    },
  );

  router.post(
    "/companies/:companyId/mail/inboxes/:inboxId/lists/:listId/entries",
    validate(createCompanyMailListEntrySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const inboxId = req.params.inboxId as string;
      const listId = req.params.listId as string;
      assertBoardCompanyAccess(req, companyId);
      const entry = await svc.createListEntry(companyId, inboxId, listId, req.body);
      await logMailMutation(
        db,
        req,
        companyId,
        "company.mail_list_entry_created",
        "company_mail_list_entry",
        null,
        { inboxId, listId, value: req.body.value },
      );
      res.status(201).json(entry);
    },
  );

  router.delete("/companies/:companyId/mail/inboxes/:inboxId/lists/:listId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const inboxId = req.params.inboxId as string;
    const listId = req.params.listId as string;
    assertBoardCompanyAccess(req, companyId);
    const result = await svc.deleteList(companyId, inboxId, listId);
    await logMailMutation(db, req, companyId, "company.mail_list_deleted", "company_mail_list", listId, { inboxId });
    res.json(result);
  });

  router.delete("/companies/:companyId/mail/inboxes/:inboxId/lists/:listId/entries/:entryId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const inboxId = req.params.inboxId as string;
    const listId = req.params.listId as string;
    const entryId = req.params.entryId as string;
    assertBoardCompanyAccess(req, companyId);
    const result = await svc.deleteListEntry(companyId, inboxId, listId, entryId);
    await logMailMutation(
      db,
      req,
      companyId,
      "company.mail_list_entry_deleted",
      "company_mail_list_entry",
      entryId,
      { inboxId, listId },
    );
    res.json(result);
  });

  router.get("/companies/:companyId/mail/api-keys", async (req, res) => {
    const companyId = req.params.companyId as string;
    const scope = (req.query.scope as string | undefined) === "inbox" ? "inbox" : "pod";
    const inboxId = (req.query.inboxId as string | undefined) ?? null;
    assertBoardCompanyAccess(req, companyId);
    res.json(await svc.listApiKeys(companyId, { scope, inboxId }));
  });

  router.post(
    "/companies/:companyId/mail/api-keys",
    validate(createCompanyMailApiKeySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoardCompanyAccess(req, companyId);
      const issued = await svc.createApiKey(
        companyId,
        req.body,
        { userId: req.actor.userId ?? "board", agentId: null },
      );
      await logMailMutation(
        db,
        req,
        companyId,
        "company.mail_api_key_created",
        "company_mail_api_key",
        issued.apiKeyId,
        {
          scope: req.body.scope ?? "pod",
          inboxId: req.body.inboxId ?? null,
          secretName: issued.secretName,
        },
      );
      res.status(201).json(issued);
    },
  );

  router.delete("/companies/:companyId/mail/api-keys/:apiKeyId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const apiKeyId = req.params.apiKeyId as string;
    const scope = (req.query.scope as string | undefined) === "inbox" ? "inbox" : "pod";
    const inboxId = (req.query.inboxId as string | undefined) ?? null;
    assertBoardCompanyAccess(req, companyId);
    const result = await svc.deleteApiKey(companyId, apiKeyId, { scope, inboxId });
    await logMailMutation(
      db,
      req,
      companyId,
      "company.mail_api_key_deleted",
      "company_mail_api_key",
      apiKeyId,
      { scope, inboxId },
    );
    res.json(result);
  });

  router.get("/companies/:companyId/mail/webhooks", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoardCompanyAccess(req, companyId);
    res.json(await svc.listWebhooks(companyId));
  });

  router.post(
    "/companies/:companyId/mail/webhooks",
    validate(createCompanyMailWebhookSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoardCompanyAccess(req, companyId);
      const result = await svc.createWebhook(companyId, req.body);
      await logMailMutation(
        db,
        req,
        companyId,
        "company.mail_webhook_created",
        "company_mail_webhook",
        (result.webhook.webhook_id as string | undefined) ?? null,
        { url: result.webhook.url ?? null },
      );
      res.status(201).json(result);
    },
  );

  router.delete("/companies/:companyId/mail/webhooks/:webhookId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const webhookId = req.params.webhookId as string;
    assertBoardCompanyAccess(req, companyId);
    const result = await svc.deleteWebhook(companyId, webhookId);
    await logMailMutation(db, req, companyId, "company.mail_webhook_deleted", "company_mail_webhook", webhookId);
    res.json(result);
  });

  return router;
}

export function agentMailWebhookRoute(db: Db) {
  const router = Router();
  const svc = agentMailService(db);

  router.post("/agentmail/webhooks/:companyId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    await svc.handleWebhook(companyId, rawBody, req.headers as Record<string, string | string[] | undefined>);
    res.status(204).end();
  });

  return router;
}

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import type { StripeSubscriptionStatus } from "@paperclipai/shared";
import Stripe from "stripe";
import {
  getStripeSecretKey,
  getStripeWebhookSecret,
} from "../services/stripe-billing-config.js";
import { stripeBillingService } from "../services/index.js";

/* ------------------------------------------------------------------ */
/*  Subscription event types we handle                                 */
/* ------------------------------------------------------------------ */

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

/* ------------------------------------------------------------------ */
/*  Route factory                                                      */
/* ------------------------------------------------------------------ */

/**
 * Stripe webhook route:
 *   POST /stripe/webhook — verifies Stripe signature & processes events.
 *
 * This route does NOT require user session auth. It authenticates via
 * the Stripe webhook signature header. It must be registered BEFORE
 * the actorMiddleware in the Express app.
 */
export function stripeWebhookRoute(db: Db) {
  const router = Router();
  const billing = stripeBillingService(db);
  const stripe = new Stripe(getStripeSecretKey());

  router.post("/stripe/webhook", async (req, res) => {
    /* ------------------------------------------------------------ */
    /*  1. Verify webhook signature                                  */
    /* ------------------------------------------------------------ */

    const sig = req.headers["stripe-signature"] as string | undefined;
    if (!sig) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    let event: Stripe.Event;
    try {
      const rawBody = (req as unknown as { rawBody: Buffer }).rawBody;
      event = stripe.webhooks.constructEvent(
        rawBody,
        sig,
        getStripeWebhookSecret(),
      );
    } catch (err) {
      console.error(
        "[stripe-webhook] Signature verification failed:",
        err instanceof Error ? err.message : err,
      );
      res.status(400).json({ error: "Invalid webhook signature" });
      return;
    }

    /* ------------------------------------------------------------ */
    /*  2. Process the event                                         */
    /* ------------------------------------------------------------ */

    try {
      if (SUBSCRIPTION_EVENTS.has(event.type)) {
        const subscription = event.data.object as Stripe.Subscription;
        const stripeCustomerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id;

        // For deletion events, always set status to "canceled" regardless
        // of what Stripe reports — this ensures the local state is clear.
        // For creation events, always set status to "active" — a newly
        // created subscription should be treated as active regardless of
        // what Stripe reports (e.g. trialing).
        const status: StripeSubscriptionStatus =
          event.type === "customer.subscription.deleted"
            ? "canceled"
            : event.type === "customer.subscription.created"
              ? "active"
              : (subscription.status as StripeSubscriptionStatus);

        await billing.updateSubscriptionStatus(
          stripeCustomerId,
          subscription.id,
          status,
        );
      } else if (event.type === "invoice.paid") {
        // Stripe v22 SDK uses parent.subscription_details for invoices, but
        // the webhook payload still includes top-level customer/subscription
        // fields. Use a generic record to safely access them.
        const invoiceData = event.data.object as unknown as Record<string, unknown>;

        const rawCustomer = invoiceData.customer;
        const stripeCustomerId =
          typeof rawCustomer === "string"
            ? rawCustomer
            : (rawCustomer as { id?: string } | null)?.id ?? null;

        // Resolve subscription from parent.subscription_details or legacy field
        const parent = invoiceData.parent as
          | { subscription_details?: { subscription?: string } }
          | null
          | undefined;
        const subscriptionId =
          (parent?.subscription_details?.subscription as string | undefined) ??
          (typeof invoiceData.subscription === "string"
            ? invoiceData.subscription
            : null);

        // Only update if the invoice is tied to a subscription
        if (subscriptionId && stripeCustomerId) {
          await billing.updateSubscriptionStatus(
            stripeCustomerId,
            subscriptionId,
            "active",
          );
        }
      }
      // Unrecognized event types are silently acknowledged (no-op)

      res.json({ received: true });
    } catch (err) {
      console.error(
        `[stripe-webhook] Error processing ${event.type}:`,
        err instanceof Error ? err.message : err,
      );
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  return router;
}

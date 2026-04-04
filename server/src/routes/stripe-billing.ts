import { Router } from "express";
import type { Db } from "@paperclipai/db";
import Stripe from "stripe";
import type {
  CheckoutSessionResponse,
  PortalSessionResponse,
  SubscriptionStatusResponse,
} from "@paperclipai/shared";
import { unauthorized } from "../errors.js";
import {
  getStripeSecretKey,
  getStripePricingPlanId,
  getStripePricingPlanVersion,
} from "../services/stripe-billing-config.js";
import { stripeBillingService } from "../services/index.js";

/* ------------------------------------------------------------------ */
/*  Lazy Stripe singleton                                              */
/* ------------------------------------------------------------------ */

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(getStripeSecretKey());
  }
  return stripeInstance;
}

/* ------------------------------------------------------------------ */
/*  Auth guard helper                                                  */
/* ------------------------------------------------------------------ */

/**
 * Asserts the request has a board-level authenticated user.
 * Returns the Privy user ID and optional email.
 * Throws 401 if the request is unauthenticated.
 */
function requireAuth(req: import("express").Request): {
  privyUserId: string;
  email: string | null;
} {
  if (req.actor.type !== "board" || !req.actor.userId) {
    throw unauthorized();
  }
  return {
    privyUserId: req.actor.userId,
    email: req.actor.userEmail ?? null,
  };
}

/* ------------------------------------------------------------------ */
/*  Stripe Checkout preview API version                                */
/* ------------------------------------------------------------------ */

const CHECKOUT_PREVIEW_VERSION =
  "2025-09-30.preview;checkout_product_catalog_preview=v1";

/* ------------------------------------------------------------------ */
/*  Route factory                                                      */
/* ------------------------------------------------------------------ */

/**
 * Stripe billing routes:
 *   POST /stripe/create-checkout    — create Stripe Checkout session
 *   POST /stripe/portal             — create Stripe Billing Portal session
 *   GET  /stripe/subscription-status — return subscription status from local DB
 */
export function stripeBillingRoutes(db: Db) {
  const router = Router();
  const billing = stripeBillingService(db);

  /* ================================================================ */
  /*  POST /stripe/create-checkout                                     */
  /* ================================================================ */

  router.post("/stripe/create-checkout", async (req, res) => {
    const { privyUserId, email } = requireAuth(req);

    // Get or create the Stripe customer
    const customer = await billing.getOrCreateCustomer(privyUserId, email);

    // If user already has an active subscription, reject with portal suggestion
    if (
      customer.subscriptionStatus === "active" ||
      customer.subscriptionStatus === "trialing"
    ) {
      res.status(409).json({
        error:
          "You already have an active subscription. Use the billing portal to manage it.",
      });
      return;
    }

    // Create a Stripe Checkout session using the preview checkout_items API
    const stripe = getStripe();
    const pricingPlanId = getStripePricingPlanId();
    const pricingPlanVersion = getStripePricingPlanVersion();

    const successUrl =
      process.env.STRIPE_CHECKOUT_SUCCESS_URL ||
      `${req.protocol}://${req.get("host")}/billing?checkout=success`;
    const cancelUrl =
      process.env.STRIPE_CHECKOUT_CANCEL_URL ||
      `${req.protocol}://${req.get("host")}/billing?checkout=cancel`;

    try {
      const rawResponse = await stripe.rawRequest(
        "POST",
        "/v1/checkout/sessions",
        {
          customer: customer.stripeCustomerId,
          "checkout_items[0][type]": "pricing_plan_subscription_item",
          "checkout_items[0][pricing_plan_subscription_item][pricing_plan]":
            pricingPlanId,
          "checkout_items[0][pricing_plan_subscription_item][pricing_plan_version]":
            pricingPlanVersion,
          success_url: successUrl,
          cancel_url: cancelUrl,
        },
        {
          additionalHeaders: {
            "Stripe-Version": CHECKOUT_PREVIEW_VERSION,
          },
        },
      );

      const session = rawResponse as Record<string, unknown>;

      const body: CheckoutSessionResponse = {
        url: session.url as string,
        sessionId: session.id as string,
      };

      res.json(body);
    } catch (err) {
      console.error(
        "[stripe-billing] Failed to create checkout session:",
        err instanceof Error ? err.message : err,
      );
      res.status(502).json({
        error: "Failed to create checkout session",
      });
    }
  });

  /* ================================================================ */
  /*  POST /stripe/portal                                              */
  /* ================================================================ */

  router.post("/stripe/portal", async (req, res) => {
    const { privyUserId } = requireAuth(req);

    // Look up the Stripe customer — if none exists, return 404
    const customer = await billing.getCustomerByPrivyUserId(privyUserId);
    if (!customer) {
      res.status(404).json({
        error: "No Stripe customer found. Please subscribe first.",
      });
      return;
    }

    const stripe = getStripe();
    const returnUrl =
      process.env.STRIPE_PORTAL_RETURN_URL ||
      `${req.protocol}://${req.get("host")}/billing`;

    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customer.stripeCustomerId,
        return_url: returnUrl,
      });

      const body: PortalSessionResponse = {
        url: session.url,
      };

      res.json(body);
    } catch (err) {
      console.error(
        "[stripe-billing] Failed to create portal session:",
        err instanceof Error ? err.message : err,
      );
      res.status(502).json({
        error: "Failed to create billing portal session",
      });
    }
  });

  /* ================================================================ */
  /*  GET /stripe/subscription-status                                  */
  /* ================================================================ */

  router.get("/stripe/subscription-status", async (req, res) => {
    const { privyUserId } = requireAuth(req);

    const customer = await billing.getCustomerByPrivyUserId(privyUserId);

    const body: SubscriptionStatusResponse = customer
      ? {
          status: customer.subscriptionStatus,
          stripeCustomerId: customer.stripeCustomerId,
          subscriptionId: customer.subscriptionId,
        }
      : {
          status: "none",
          stripeCustomerId: null,
          subscriptionId: null,
        };

    res.json(body);
  });

  /* ================================================================ */
  /*  GET /stripe/billing-usage                                        */
  /*  Aggregated usage across ALL companies owned by the user.         */
  /* ================================================================ */

  router.get("/stripe/billing-usage", async (req, res) => {
    const { privyUserId } = requireAuth(req);

    // Parse optional date-range query params (from / to).
    const fromRaw = req.query.from as string | undefined;
    const toRaw = req.query.to as string | undefined;
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;

    if (from && isNaN(from.getTime())) {
      res.status(400).json({ error: "invalid 'from' date" });
      return;
    }
    if (to && isNaN(to.getTime())) {
      res.status(400).json({ error: "invalid 'to' date" });
      return;
    }

    const result = await billing.getAggregatedUsage(privyUserId, { from, to });
    res.json(result);
  });

  return router;
}

import { describe, expect, it, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mock: stripe SDK                                                   */
/* ------------------------------------------------------------------ */

const mockStripeCustomersCreate = vi.fn();
const mockStripeCustomersRetrieve = vi.fn();

vi.mock("stripe", () => {
  const StripeClass = vi.fn().mockImplementation(() => ({
    customers: {
      create: mockStripeCustomersCreate,
      retrieve: mockStripeCustomersRetrieve,
    },
  }));
  return { default: StripeClass };
});

/* ------------------------------------------------------------------ */
/*  Mock: @privy-io/node SDK                                           */
/* ------------------------------------------------------------------ */

const mockSetCustomMetadata = vi.fn();
const mockUsersGet = vi.fn();

vi.mock("@privy-io/node", () => {
  const PrivyClient = vi.fn().mockImplementation(() => ({
    users: () => ({
      setCustomMetadata: mockSetCustomMetadata,
      _get: mockUsersGet,
    }),
  }));
  return { PrivyClient };
});

/* ------------------------------------------------------------------ */
/*  Mock: stripe-billing-config                                        */
/* ------------------------------------------------------------------ */

vi.mock("../services/stripe-billing-config.js", () => ({
  getStripeSecretKey: () => "sk_test_mock_key",
  isStripeBillingConfigured: () => true,
}));

/* ------------------------------------------------------------------ */
/*  Fake Drizzle DB                                                    */
/* ------------------------------------------------------------------ */

interface FakeRow {
  [key: string]: unknown;
}

function createFakeDb(initialRows: FakeRow[] = []) {
  let rows = [...initialRows];
  let nextId = initialRows.length + 1;

  // Track the "where" predicate callback for filtering
  let pendingSelectWhere: ((row: FakeRow) => boolean) | null = null;
  let pendingUpdateSet: FakeRow | null = null;
  let pendingUpdateWhere: ((row: FakeRow) => boolean) | null = null;

  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn((predicate?: any) => {
      // For tests, we store a simple filter — in practice, the service
      // passes drizzle `eq(...)` expressions. We'll handle this by
      // checking for specific column matches via row scanning.
      return {
        then: vi.fn((resolve: any) =>
          resolve(rows),
        ),
        [Symbol.toStringTag]: "Promise",
      };
    }),
    then: vi.fn((resolve: any) => resolve(rows)),
  };

  const db: any = {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue({
      values: vi.fn((data: FakeRow) => ({
        returning: vi.fn().mockImplementation(() => {
          const newRow = { id: nextId++, ...data, createdAt: new Date(), updatedAt: new Date() };
          rows.push(newRow);
          return Promise.resolve([newRow]);
        }),
        then: vi.fn((resolve: any) => {
          const newRow = { id: nextId++, ...data, createdAt: new Date(), updatedAt: new Date() };
          rows.push(newRow);
          return resolve([newRow]);
        }),
      })),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn((setData: FakeRow) => ({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockImplementation(() => {
            // Update the first matching row
            if (rows.length > 0) {
              const idx = rows.length - 1;
              rows[idx] = { ...rows[idx], ...setData };
              return Promise.resolve([rows[idx]]);
            }
            return Promise.resolve([]);
          }),
          then: vi.fn((resolve: any) => resolve(undefined)),
        }),
      })),
    }),
    transaction: vi.fn(async (callback: (tx: any) => Promise<any>) => {
      // Create a transaction-scoped DB proxy that delegates to the same store
      return callback(db);
    }),
    _rows: rows,
    _setRows(newRows: FakeRow[]) {
      rows = newRows;
      this._rows = newRows;
    },
  };

  return db;
}

/* ------------------------------------------------------------------ */
/*  Import the service under test (after mocks are set up)             */
/* ------------------------------------------------------------------ */

// We need to import the service factory.
// Since the service file doesn't exist yet, we'll use dynamic import.
const { stripeBillingService } = await import("../services/stripe-billing.js");

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("stripeBillingService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env vars for Privy
    process.env.PRIVY_APP_ID = "test-app-id";
    process.env.PRIVY_APP_SECRET = "test-app-secret";
  });

  describe("getOrCreateCustomer", () => {
    it("creates a Stripe customer and DB row for new users", async () => {
      const db = createFakeDb();
      const service = stripeBillingService(db);

      // DB returns no existing row — service should create one
      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      mockStripeCustomersCreate.mockResolvedValue({
        id: "cus_test_new",
        metadata: { privyUserId: "did:privy:user1" },
      });
      mockSetCustomMetadata.mockResolvedValue({});

      // Mock insert chain for the transaction
      db.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: 1,
            privyUserId: "did:privy:user1",
            stripeCustomerId: "cus_test_new",
            subscriptionId: null,
            subscriptionStatus: "none",
            createdAt: new Date(),
            updatedAt: new Date(),
          }]),
        }),
      });

      const result = await service.getOrCreateCustomer("did:privy:user1", "user@example.com");

      expect(result.stripeCustomerId).toBe("cus_test_new");
      expect(result.privyUserId).toBe("did:privy:user1");
      expect(mockStripeCustomersCreate).toHaveBeenCalledWith({
        email: "user@example.com",
        metadata: { privyUserId: "did:privy:user1" },
      });
      expect(mockSetCustomMetadata).toHaveBeenCalledWith(
        "did:privy:user1",
        { custom_metadata: { stripeCustomerId: "cus_test_new" } },
      );
    });

    it("returns existing customer for known users (no duplicate creation)", async () => {
      const db = createFakeDb();
      const service = stripeBillingService(db);

      const existingRow = {
        id: 1,
        privyUserId: "did:privy:user1",
        stripeCustomerId: "cus_existing",
        subscriptionId: "sub_123",
        subscriptionStatus: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([existingRow]),
        }),
      });

      const result = await service.getOrCreateCustomer("did:privy:user1", "user@example.com");

      expect(result.stripeCustomerId).toBe("cus_existing");
      expect(result.privyUserId).toBe("did:privy:user1");
      expect(mockStripeCustomersCreate).not.toHaveBeenCalled();
      expect(mockSetCustomMetadata).not.toHaveBeenCalled();
    });

    it("sets Stripe customer metadata.privyUserId", async () => {
      const db = createFakeDb();
      const service = stripeBillingService(db);

      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      mockStripeCustomersCreate.mockResolvedValue({
        id: "cus_meta_test",
        metadata: { privyUserId: "did:privy:user2" },
      });
      mockSetCustomMetadata.mockResolvedValue({});

      db.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: 2,
            privyUserId: "did:privy:user2",
            stripeCustomerId: "cus_meta_test",
            subscriptionId: null,
            subscriptionStatus: "none",
            createdAt: new Date(),
            updatedAt: new Date(),
          }]),
        }),
      });

      await service.getOrCreateCustomer("did:privy:user2", "user2@example.com");

      expect(mockStripeCustomersCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { privyUserId: "did:privy:user2" },
        }),
      );
    });

    it("handles email-less users (wallet-only Privy users)", async () => {
      const db = createFakeDb();
      const service = stripeBillingService(db);

      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      mockStripeCustomersCreate.mockResolvedValue({
        id: "cus_no_email",
        metadata: { privyUserId: "did:privy:walletuser" },
      });
      mockSetCustomMetadata.mockResolvedValue({});

      db.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: 3,
            privyUserId: "did:privy:walletuser",
            stripeCustomerId: "cus_no_email",
            subscriptionId: null,
            subscriptionStatus: "none",
            createdAt: new Date(),
            updatedAt: new Date(),
          }]),
        }),
      });

      const result = await service.getOrCreateCustomer("did:privy:walletuser");

      expect(result.stripeCustomerId).toBe("cus_no_email");
      // When no email provided, Stripe API should not receive email or receive undefined
      expect(mockStripeCustomersCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { privyUserId: "did:privy:walletuser" },
        }),
      );
      const callArgs = mockStripeCustomersCreate.mock.calls[0][0];
      expect(callArgs.email).toBeUndefined();
    });

    it("Stripe API errors result in clear error with no partial DB row", async () => {
      const db = createFakeDb();
      const service = stripeBillingService(db);

      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      mockStripeCustomersCreate.mockRejectedValue(
        new Error("Stripe API error: invalid api key"),
      );

      await expect(
        service.getOrCreateCustomer("did:privy:user_fail", "fail@example.com"),
      ).rejects.toThrow();

      // DB insert should not have been called since Stripe failed first
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("handles race condition via DB unique constraint", async () => {
      const db = createFakeDb();
      const service = stripeBillingService(db);

      // First select returns empty (no existing customer)
      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      mockStripeCustomersCreate.mockResolvedValue({
        id: "cus_race",
        metadata: { privyUserId: "did:privy:raceuser" },
      });
      mockSetCustomMetadata.mockResolvedValue({});

      // Simulate unique constraint violation on insert
      const uniqueError = new Error("duplicate key value violates unique constraint");
      (uniqueError as any).code = "23505";

      db.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(uniqueError),
        }),
      });

      // After the constraint violation, the service should re-query and find the existing row
      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            id: 99,
            privyUserId: "did:privy:raceuser",
            stripeCustomerId: "cus_winner",
            subscriptionId: null,
            subscriptionStatus: "none",
            createdAt: new Date(),
            updatedAt: new Date(),
          }]),
        }),
      });

      const result = await service.getOrCreateCustomer("did:privy:raceuser", "race@example.com");

      // Should return the row created by the race winner
      expect(result.stripeCustomerId).toBe("cus_winner");
    });

    it("updates Privy custom metadata with stripeCustomerId", async () => {
      const db = createFakeDb();
      const service = stripeBillingService(db);

      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      mockStripeCustomersCreate.mockResolvedValue({
        id: "cus_privy_meta",
        metadata: { privyUserId: "did:privy:privymeta" },
      });
      mockSetCustomMetadata.mockResolvedValue({});

      db.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: 4,
            privyUserId: "did:privy:privymeta",
            stripeCustomerId: "cus_privy_meta",
            subscriptionId: null,
            subscriptionStatus: "none",
            createdAt: new Date(),
            updatedAt: new Date(),
          }]),
        }),
      });

      await service.getOrCreateCustomer("did:privy:privymeta", "privymeta@example.com");

      expect(mockSetCustomMetadata).toHaveBeenCalledWith(
        "did:privy:privymeta",
        { custom_metadata: { stripeCustomerId: "cus_privy_meta" } },
      );
    });
  });

  describe("getCustomerByPrivyUserId", () => {
    it("returns customer record from DB (fast local lookup)", async () => {
      const db = createFakeDb();
      const service = stripeBillingService(db);

      const existingRow = {
        id: 1,
        privyUserId: "did:privy:lookup",
        stripeCustomerId: "cus_lookup",
        subscriptionId: "sub_active",
        subscriptionStatus: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([existingRow]),
        }),
      });

      const result = await service.getCustomerByPrivyUserId("did:privy:lookup");

      expect(result).toBeTruthy();
      expect(result!.stripeCustomerId).toBe("cus_lookup");
      expect(result!.subscriptionStatus).toBe("active");
      // Should NOT call Stripe API — pure DB lookup
      expect(mockStripeCustomersCreate).not.toHaveBeenCalled();
      expect(mockStripeCustomersRetrieve).not.toHaveBeenCalled();
    });

    it("returns null when no customer exists", async () => {
      const db = createFakeDb();
      const service = stripeBillingService(db);

      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getCustomerByPrivyUserId("did:privy:nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("updateSubscriptionStatus", () => {
    it("correctly updates the DB row", async () => {
      const db = createFakeDb();
      const service = stripeBillingService(db);

      const updateSetMock = vi.fn();
      const updateWhereMock = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          id: 1,
          privyUserId: "did:privy:subuser",
          stripeCustomerId: "cus_sub",
          subscriptionId: "sub_new",
          subscriptionStatus: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        }]),
      });
      updateSetMock.mockReturnValue({ where: updateWhereMock });
      db.update.mockReturnValue({ set: updateSetMock });

      const result = await service.updateSubscriptionStatus(
        "cus_sub",
        "sub_new",
        "active",
      );

      expect(result).toBeTruthy();
      expect(updateSetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: "sub_new",
          subscriptionStatus: "active",
        }),
      );
    });

    it("returns null when customer not found", async () => {
      const db = createFakeDb();
      const service = stripeBillingService(db);

      const updateSetMock = vi.fn();
      const updateWhereMock = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      });
      updateSetMock.mockReturnValue({ where: updateWhereMock });
      db.update.mockReturnValue({ set: updateSetMock });

      const result = await service.updateSubscriptionStatus(
        "cus_nonexistent",
        "sub_xxx",
        "active",
      );

      expect(result).toBeNull();
    });

    it("handles null subscriptionId (for cancellations)", async () => {
      const db = createFakeDb();
      const service = stripeBillingService(db);

      const updateSetMock = vi.fn();
      const updateWhereMock = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          id: 1,
          privyUserId: "did:privy:canceled",
          stripeCustomerId: "cus_canceled",
          subscriptionId: null,
          subscriptionStatus: "canceled",
          createdAt: new Date(),
          updatedAt: new Date(),
        }]),
      });
      updateSetMock.mockReturnValue({ where: updateWhereMock });
      db.update.mockReturnValue({ set: updateSetMock });

      const result = await service.updateSubscriptionStatus(
        "cus_canceled",
        null,
        "canceled",
      );

      expect(result).toBeTruthy();
      expect(result!.subscriptionStatus).toBe("canceled");
    });
  });
});

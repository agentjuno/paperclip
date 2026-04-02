import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

/* ------------------------------------------------------------------ */
/*  Helpers: fake spawn that emulates child_process.spawn              */
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
    emitError(err: NodeJS.ErrnoException) {
      proc.emit("error", err);
    },
  };
}

/** Creates a spawn function that emits stdout/stderr/close asynchronously */
function makeSpawnFn(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: NodeJS.ErrnoException;
  /** If true, never emits close (for timeout tests) */
  hang?: boolean;
}) {
  return vi.fn((_cmd: string, _args: string[], _opts: any) => {
    const fake = createFakeProc();
    if (opts.hang) return fake.proc;

    // Use setImmediate to emit after spawn returns and event handlers are attached
    setImmediate(() => {
      if (opts.error) {
        fake.emitError(opts.error);
        return;
      }
      if (opts.stdout) fake.emitStdout(opts.stdout);
      if (opts.stderr) fake.emitStderr(opts.stderr);
      fake.emitClose(opts.exitCode ?? 0);
    });

    return fake.proc;
  });
}

/* ------------------------------------------------------------------ */
/*  Dynamic import of the module under test                            */
/* ------------------------------------------------------------------ */

const { execStripeProjectsCmd, StripeProjectsCliError } = await import(
  "../services/stripe-projects-cli.js"
);

/* ------------------------------------------------------------------ */
/*  Tests — non-timeout tests use real timers (setImmediate callback)   */
/* ------------------------------------------------------------------ */

describe("execStripeProjectsCmd", () => {
  /* VAL-SVC-031: --json and -y flags always appended */
  it("spawns stripe CLI with correct command format including --json and -y flags", async () => {
    const spawnFn = makeSpawnFn({
      stdout: JSON.stringify({ id: "proj_1", name: "test" }),
    });

    const result = await execStripeProjectsCmd("init", ["--name", "my-project"], { spawn: spawnFn });

    expect(spawnFn).toHaveBeenCalledOnce();
    const [cmd, args] = spawnFn.mock.calls[0];
    expect(cmd).toBe("stripe");
    expect(args).toContain("projects");
    expect(args).toContain("init");
    expect(args).toContain("--name");
    expect(args).toContain("my-project");
    expect(args).toContain("--json");
    expect(args).toContain("-y");
    expect(result).toEqual({ id: "proj_1", name: "test" });
  });

  /* Successful CLI call returns parsed JSON */
  it("returns parsed JSON object on successful CLI exit", async () => {
    const payload = { services: [{ id: "svc_1", provider: "vercel" }] };
    const spawnFn = makeSpawnFn({ stdout: JSON.stringify(payload) });

    const result = await execStripeProjectsCmd("catalog", [], { spawn: spawnFn });
    expect(result).toEqual(payload);
  });

  /* VAL-SVC-029: Non-zero exit throws with stderr content */
  it("throws StripeProjectsCliError with stderr on non-zero exit code", async () => {
    const spawnFn = makeSpawnFn({
      stderr: "Error: project quota exceeded",
      exitCode: 1,
    });

    try {
      await execStripeProjectsCmd("add", ["vercel/project"], { spawn: spawnFn });
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(StripeProjectsCliError);
      expect(err.code).toBe("CLI_ERROR");
      expect(err.stderr).toContain("project quota exceeded");
      expect(err.message).toContain("project quota exceeded");
    }
  });

  /* VAL-SVC-026: Default 30s timeout enforced */
  it("enforces default 30s timeout and kills process", async () => {
    vi.useFakeTimers();
    try {
      const spawnFn = makeSpawnFn({ hang: true });
      const promise = execStripeProjectsCmd("init", [], { spawn: spawnFn });
      promise.catch(() => {}); // prevent unhandled rejection warning

      await vi.advanceTimersByTimeAsync(31_000);

      try {
        await promise;
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(StripeProjectsCliError);
        expect(err.code).toBe("TIMEOUT");
        expect(err.message).toMatch(/timed out/i);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  /* VAL-SVC-027: Custom timeout respected */
  it("respects custom timeout option", async () => {
    vi.useFakeTimers();
    try {
      const spawnFn = makeSpawnFn({ hang: true });
      const promise = execStripeProjectsCmd("status", [], {
        spawn: spawnFn,
        timeoutMs: 5_000,
      });
      promise.catch(() => {}); // prevent unhandled rejection warning

      // 4s should NOT trigger timeout
      await vi.advanceTimersByTimeAsync(4_000);
      // Promise should still be pending — can't easily test "still pending" so just advance more

      // Cross the 5s boundary
      await vi.advanceTimersByTimeAsync(2_000);

      try {
        await promise;
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(StripeProjectsCliError);
        expect(err.code).toBe("TIMEOUT");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  /* VAL-SVC-028: Malformed JSON in stdout throws parse error with raw output */
  it("throws parse error with raw output snippet on malformed JSON", async () => {
    const spawnFn = makeSpawnFn({ stdout: "not-valid-json{{{" });

    try {
      await execStripeProjectsCmd("status", [], { spawn: spawnFn });
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(StripeProjectsCliError);
      expect(err.code).toBe("PARSE_ERROR");
      expect(err.rawOutput).toContain("not-valid-json");
    }
  });

  /* VAL-SVC-032: Missing CLI binary throws user-friendly error */
  it("throws user-friendly error when stripe binary is not found (ENOENT)", async () => {
    const enoentErr: NodeJS.ErrnoException = new Error("spawn stripe ENOENT");
    enoentErr.code = "ENOENT";
    const spawnFn = makeSpawnFn({ error: enoentErr });

    try {
      await execStripeProjectsCmd("init", [], { spawn: spawnFn });
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(StripeProjectsCliError);
      expect(err.code).toBe("NOT_FOUND");
      expect(err.message).toMatch(/stripe cli.*not found|install/i);
    }
  });

  /* VAL-SVC-033: Auth expired stderr produces re-auth error */
  it("throws auth-specific error when CLI reports authentication failure", async () => {
    const spawnFn = makeSpawnFn({
      stderr: "Error: Your authentication token has expired. Please run `stripe login` to re-authenticate.",
      exitCode: 1,
    });

    try {
      await execStripeProjectsCmd("status", [], { spawn: spawnFn });
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(StripeProjectsCliError);
      expect(err.code).toBe("AUTH_EXPIRED");
      expect(err.message).toMatch(/authenticat|login|re-auth/i);
    }
  });

  /* VAL-SVC-034: Network failure stderr produces network-specific error */
  it("throws network-specific error when CLI reports network failure", async () => {
    const spawnFn = makeSpawnFn({
      stderr: "Error: could not connect to Stripe API: dial tcp: lookup api.stripe.com: no such host",
      exitCode: 1,
    });

    try {
      await execStripeProjectsCmd("catalog", [], { spawn: spawnFn });
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(StripeProjectsCliError);
      expect(err.code).toBe("NETWORK_ERROR");
      expect(err.message).toMatch(/network|connect|check your internet/i);
    }
  });

  /* VAL-SVC-030: Credential redaction in logging */
  it("redacts credential patterns in log output", async () => {
    const logSpy = vi.fn();
    const spawnFn = makeSpawnFn({
      stdout: JSON.stringify({ database_url: "postgres://user:pass@host/db" }),
    });

    const result = await execStripeProjectsCmd("env", [], {
      spawn: spawnFn,
      log: logSpy,
    });

    // Result should still have the raw value (redaction is only for logs)
    expect(result).toEqual({ database_url: "postgres://user:pass@host/db" });

    // No raw postgres connection strings should appear in log calls
    for (const call of logSpy.mock.calls) {
      const logStr = JSON.stringify(call);
      expect(logStr).not.toContain("postgres://user:pass@host/db");
    }
  });

  it("redacts API key patterns in log output", async () => {
    const logSpy = vi.fn();
    const spawnFn = makeSpawnFn({
      stderr: "Error: Invalid API key: sk_live_abcdef1234567890",
      exitCode: 1,
    });

    try {
      await execStripeProjectsCmd("status", [], {
        spawn: spawnFn,
        log: logSpy,
      });
    } catch {
      // expected to throw
    }

    // Log calls must not contain the raw API key
    for (const call of logSpy.mock.calls) {
      const logStr = JSON.stringify(call);
      expect(logStr).not.toContain("sk_live_abcdef1234567890");
    }
  });

  /* Edge case: empty stdout with exit 0 throws parse error */
  it("handles empty stdout with exit 0 as parse error", async () => {
    // Empty string won't trigger emitStdout, so stdout buffer is empty
    const spawnFn = makeSpawnFn({ stdout: "" });

    try {
      await execStripeProjectsCmd("remove", ["svc_1"], { spawn: spawnFn });
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(StripeProjectsCliError);
      expect(err.code).toBe("PARSE_ERROR");
    }
  });

  /* Args are passed through correctly */
  it("passes subcommand and args through to spawn correctly", async () => {
    const spawnFn = makeSpawnFn({
      stdout: JSON.stringify({ ok: true }),
    });

    await execStripeProjectsCmd("add", ["vercel/project", "--tier", "pro"], {
      spawn: spawnFn,
    });

    const [, args] = spawnFn.mock.calls[0];
    expect(args[0]).toBe("projects");
    expect(args[1]).toBe("add");
    expect(args).toContain("vercel/project");
    expect(args).toContain("--tier");
    expect(args).toContain("pro");
  });

  /* Shell mode is used */
  it("uses shell mode in spawn options", async () => {
    const spawnFn = makeSpawnFn({
      stdout: JSON.stringify({ ok: true }),
    });

    await execStripeProjectsCmd("status", [], { spawn: spawnFn });

    const spawnOpts = spawnFn.mock.calls[0][2];
    expect(spawnOpts.shell).toBe(true);
  });

  /* Additional stderr patterns: "not logged in" triggers AUTH_EXPIRED */
  it("classifies 'not logged in' stderr as AUTH_EXPIRED", async () => {
    const spawnFn = makeSpawnFn({
      stderr: "Error: not logged in, run `stripe login` first",
      exitCode: 1,
    });

    try {
      await execStripeProjectsCmd("status", [], { spawn: spawnFn });
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("AUTH_EXPIRED");
    }
  });

  /* Additional stderr patterns: ECONNREFUSED triggers NETWORK_ERROR */
  it("classifies ECONNREFUSED stderr as NETWORK_ERROR", async () => {
    const spawnFn = makeSpawnFn({
      stderr: "Error: connect ECONNREFUSED 127.0.0.1:443",
      exitCode: 1,
    });

    try {
      await execStripeProjectsCmd("catalog", [], { spawn: spawnFn });
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err.code).toBe("NETWORK_ERROR");
    }
  });

  /* Returns array JSON */
  it("returns parsed JSON array on successful CLI exit", async () => {
    const payload = [{ id: "svc_1" }, { id: "svc_2" }];
    const spawnFn = makeSpawnFn({ stdout: JSON.stringify(payload) });

    const result = await execStripeProjectsCmd("catalog", [], { spawn: spawnFn });
    expect(result).toEqual(payload);
  });
});

describe("StripeProjectsCliError", () => {
  it("is an instance of Error", () => {
    const err = new StripeProjectsCliError("CLI_ERROR", "some error");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("StripeProjectsCliError");
  });

  it("exposes code, message, stderr, and rawOutput properties", () => {
    const err = new StripeProjectsCliError("PARSE_ERROR", "bad json", {
      stderr: "warning output",
      rawOutput: "not{json",
    });
    expect(err.code).toBe("PARSE_ERROR");
    expect(err.message).toBe("bad json");
    expect(err.stderr).toBe("warning output");
    expect(err.rawOutput).toBe("not{json");
  });
});

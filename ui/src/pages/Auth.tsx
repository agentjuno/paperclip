import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AsciiArtAnimation } from "@/components/AsciiArtAnimation";
import { Sparkles } from "lucide-react";

type AuthMode = "sign_in" | "sign_up";

export function AuthPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<AuthMode>("sign_in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(() => searchParams.get("next") || "/", [searchParams]);
  const { data: session, isLoading: isSessionLoading } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  useEffect(() => {
    if (session) {
      navigate(nextPath, { replace: true });
    }
  }, [session, navigate, nextPath]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "sign_in") {
        await authApi.signInEmail({ email: email.trim(), password });
        return;
      }
      await authApi.signUpEmail({
        name: name.trim(),
        email: email.trim(),
        password,
      });
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      navigate(nextPath, { replace: true });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Authentication failed");
    },
  });

  const canSubmit =
    email.trim().length > 0 &&
    password.trim().length > 0 &&
    (mode === "sign_in" || (name.trim().length > 0 && password.trim().length >= 8));

  if (isSessionLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="paperclip-panel rounded-[24px] px-5 py-3 text-sm text-muted-foreground shadow-2xl">
          Checking session…
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.12),_transparent_34%),radial-gradient(circle_at_75%_20%,_rgba(255,255,255,0.05),_transparent_28%),linear-gradient(to_bottom,_rgba(255,255,255,0.03),_transparent_20%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
        <div className="flex items-center justify-between gap-4 px-1 text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            <span>Paperclip / Auth</span>
          </div>
          <Badge variant="outline" className="border-border/70 bg-background/40 text-[10px] uppercase tracking-[0.28em]">
            {mode === "sign_in" ? "Sign in" : "Sign up"}
          </Badge>
        </div>

        <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
          <div className="paperclip-panel paperclip-panel-strong flex min-h-[min(100%,44rem)] flex-col justify-between rounded-[28px] p-5 sm:p-7 lg:p-8">
            <div className="space-y-8">
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-1 duration-300">
                <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  <span>Instance access</span>
                  <span className="h-1 w-1 rounded-full bg-emerald-400/80" />
                  <span>Secure session gate</span>
                </div>
                <div className="space-y-3">
                  <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                    {mode === "sign_in" ? "Sign in to Paperclip" : "Create your Paperclip account"}
                  </h1>
                  <p className="max-w-xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
                    {mode === "sign_in"
                      ? "Use your email and password to access this instance."
                      : "Create an account for this instance. Email confirmation is not required in v1."}
                  </p>
                </div>

                <div className="inline-flex rounded-full border border-border/70 bg-background/60 p-1 text-xs">
                  <button
                    type="button"
                    className={`rounded-full px-3 py-1.5 transition-colors ${
                      mode === "sign_in"
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => {
                      setError(null);
                      setMode("sign_in");
                    }}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    className={`rounded-full px-3 py-1.5 transition-colors ${
                      mode === "sign_up"
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => {
                      setError(null);
                      setMode("sign_up");
                    }}
                  >
                    Sign up
                  </button>
                </div>
              </div>

              <form
                className="space-y-4"
                method="post"
                action={mode === "sign_up" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email"}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (mutation.isPending) return;
                  if (!canSubmit) {
                    setError("Please fill in all required fields.");
                    return;
                  }
                  mutation.mutate();
                }}
              >
                {mode === "sign_up" && (
                  <div className="space-y-1.5">
                    <label htmlFor="name" className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                      Name
                    </label>
                    <input
                      id="name"
                      name="name"
                      className="h-11 w-full rounded-xl border border-border/70 bg-background/60 px-3.5 text-sm outline-none transition-shadow placeholder:text-muted-foreground/50 focus:border-emerald-400/50 focus:ring-1 focus:ring-emerald-400/30"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="name"
                      autoFocus
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <label htmlFor="email" className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    className="h-11 w-full rounded-xl border border-border/70 bg-background/60 px-3.5 text-sm outline-none transition-shadow placeholder:text-muted-foreground/50 focus:border-emerald-400/50 focus:ring-1 focus:ring-emerald-400/30"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    autoFocus={mode === "sign_in"}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="password" className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    className="h-11 w-full rounded-xl border border-border/70 bg-background/60 px-3.5 text-sm outline-none transition-shadow placeholder:text-muted-foreground/50 focus:border-emerald-400/50 focus:ring-1 focus:ring-emerald-400/30"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
                  />
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
                <Button
                  type="submit"
                  disabled={mutation.isPending}
                  aria-disabled={!canSubmit || mutation.isPending}
                  className={`h-11 w-full rounded-xl ${!canSubmit && !mutation.isPending ? "opacity-50" : ""}`}
                >
                  {mutation.isPending
                    ? "Working…"
                    : mode === "sign_in"
                      ? "Sign in"
                      : "Create account"}
                </Button>
              </form>
            </div>

            <div className="mt-8 border-t border-border/60 pt-4 text-sm text-muted-foreground">
              {mode === "sign_in" ? "Need an account?" : "Already have an account?"}{" "}
              <button
                type="button"
                className="font-medium text-foreground underline underline-offset-2 transition-opacity hover:opacity-80"
                onClick={() => {
                  setError(null);
                  setMode(mode === "sign_in" ? "sign_up" : "sign_in");
                }}
              >
                {mode === "sign_in" ? "Create one" : "Sign in"}
              </button>
            </div>
          </div>

          <div className="paperclip-panel overflow-hidden rounded-[28px]">
            <div className="flex h-full min-h-[28rem] flex-col">
              <div className="border-b border-border/60 px-5 py-4 sm:px-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">System surface</div>
                    <div className="mt-1 text-sm font-medium">ASCII access panel</div>
                  </div>
                  <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                    Live
                  </Badge>
                </div>
              </div>
              <div className="relative flex-1">
                <AsciiArtAnimation />
                <div className="absolute inset-x-0 bottom-0 border-t border-border/60 bg-background/75 px-5 py-4 backdrop-blur-xl sm:px-6">
                  <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
                    <div className="space-y-1">
                      <div className="uppercase tracking-[0.22em]">Session</div>
                      <div className="text-foreground">Single instance access</div>
                    </div>
                    <div className="space-y-1">
                      <div className="uppercase tracking-[0.22em]">Security</div>
                      <div className="text-foreground">Password-only in v1</div>
                    </div>
                    <div className="space-y-1">
                      <div className="uppercase tracking-[0.22em]">Mode</div>
                      <div className="text-foreground">{mode === "sign_in" ? "Returning user" : "New account"}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

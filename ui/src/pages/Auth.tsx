import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";

const ZHC_SITE_URL = (import.meta.env.VITE_ZHC_SITE_URL || "https://zhcinstitute.com").replace(/\/$/, "");

export function AuthPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") || "/", [searchParams]);
  const { data: session, isLoading } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  useEffect(() => {
    if (session) {
      navigate(nextPath, { replace: true });
    }
  }, [navigate, nextPath, session]);

  if (isLoading) {
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
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
        <div className="flex items-center justify-between gap-4 px-1 text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            <span>Paperclip / ZHC Access</span>
          </div>
          <Badge
            variant="outline"
            className="border-border/70 bg-background/40 text-[10px] uppercase tracking-[0.28em]"
          >
            Privy only
          </Badge>
        </div>

        <div className="paperclip-panel paperclip-panel-strong flex flex-1 flex-col justify-between rounded-[28px] p-6 sm:p-8">
          <div className="space-y-8">
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-1 duration-300">
              <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.28em] text-muted-foreground">
                <span>Shared session</span>
                <span className="h-1 w-1 rounded-full bg-emerald-400/80" />
                <span>ZHC account required</span>
              </div>
              <div className="space-y-3">
                <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
                  Sign in through your ZHC account
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
                  This app no longer uses standalone email or password auth. Access is issued from
                  the main ZHC site after Privy verifies your account and wallets.
                </p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
              <div className="space-y-4 rounded-2xl border border-border/70 bg-background/40 p-5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  Hosted access flow
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Open the ZHC dashboard, sign in with Privy if needed, then launch the company app
                  from your account. That flow creates the shared session for this subdomain.
                </p>
              </div>

              <div className="space-y-3 rounded-2xl border border-border/70 bg-background/40 p-5 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">What changed</p>
                <p>Standalone Paperclip auth is disabled in the hosted product.</p>
                <p>Company access is now tied to your ZHC user, memberships, and wallet snapshot.</p>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild className="h-11 rounded-xl">
              <a href={`${ZHC_SITE_URL}/dashboard`}>
                Open ZHC dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button asChild variant="outline" className="h-11 rounded-xl">
              <a href={ZHC_SITE_URL}>Back to main site</a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

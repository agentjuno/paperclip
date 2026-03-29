import { useEffect } from "react";
import { Link, useLocation } from "@/lib/router";
import { AlertTriangle, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";

type NotFoundScope = "board" | "invalid_company_prefix" | "global";

interface NotFoundPageProps {
  scope?: NotFoundScope;
  requestedPrefix?: string;
}

export function NotFoundPage({ scope = "global", requestedPrefix }: NotFoundPageProps) {
  const location = useLocation();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { companies, selectedCompany } = useCompany();

  useEffect(() => {
    setBreadcrumbs([{ label: "Not Found" }]);
  }, [setBreadcrumbs]);

  const fallbackCompany = selectedCompany ?? companies[0] ?? null;
  const dashboardHref = fallbackCompany ? `/${fallbackCompany.issuePrefix}/command-center` : "/";
  const currentPath = `${location.pathname}${location.search}${location.hash}`;
  const normalizedPrefix = requestedPrefix?.toUpperCase();

  const title = scope === "invalid_company_prefix" ? "Company not found" : "Page not found";
  const description =
    scope === "invalid_company_prefix"
      ? `No company matches prefix "${normalizedPrefix ?? "unknown"}".`
      : "This route does not exist.";

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.1),_transparent_28%),radial-gradient(circle_at_70%_16%,_rgba(255,255,255,0.05),_transparent_20%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mb-4 flex items-center justify-between gap-4 text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
          <span>System / not found</span>
          <Badge variant="outline" className="border-border/70 bg-background/50 text-[10px] uppercase tracking-[0.24em]">
            Recovery
          </Badge>
        </div>

        <div className="paperclip-panel paperclip-panel-strong flex flex-1 flex-col justify-between rounded-[var(--paperclip-radius-shell)] p-5 sm:p-7 lg:p-8">
          <div className="space-y-6">
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-1 duration-300">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                <span>Route recovery</span>
              </div>
              <div className="space-y-2">
                <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
                <p className="max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
              <div className="paperclip-panel p-5">
                <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Requested path</div>
                <div className="mt-2 break-all font-mono text-sm text-foreground">{currentPath}</div>
              </div>
              <div className="paperclip-panel p-5 text-sm text-muted-foreground">
                <div className="flex items-center gap-2 text-foreground">
                  <Compass className="h-4 w-4 text-emerald-400" />
                  Recovery actions
                </div>
                <p className="mt-2 leading-6">Return to the command center or open the home board.</p>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            <Button asChild className="h-11 rounded-lg">
              <Link to={dashboardHref}>
                <Compass className="mr-1.5 h-4 w-4" />
                Open command center
              </Link>
            </Button>
            <Button variant="outline" asChild className="h-11 rounded-lg">
              <Link to="/">Go home</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

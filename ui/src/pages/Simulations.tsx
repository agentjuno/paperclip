import { useEffect } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";

export function Simulations() {
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Simulations" }]);
  }, [setBreadcrumbs]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <section className="paperclip-panel paperclip-panel-strong command-fade-up rounded-[var(--paperclip-radius-shell)] p-4 sm:p-5">
        <div className="space-y-2">
          <p className="paperclip-kicker">Research</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-[2.4rem]">Simulations</h1>
        </div>
      </section>
    </div>
  );
}

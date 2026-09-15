import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Consistent horizontal rhythm and max width for every page. */
export function PageContainer({
  children,
  className,
  width = "default",
}: {
  children: ReactNode;
  className?: string;
  width?: "default" | "wide" | "narrow";
}) {
  const widthClass =
    width === "wide" ? "max-w-6xl" : width === "narrow" ? "max-w-2xl" : "max-w-4xl";

  return (
    <div className={cn("mx-auto w-full px-4 py-6 sm:px-6 lg:py-8", widthClass, className)}>
      {children}
    </div>
  );
}

/** Page title block: one h1 per page, with optional description and actions. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {breadcrumb ? <div className="mb-2 text-sm text-muted">{breadcrumb}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

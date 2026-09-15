import { cn } from "@/lib/utils";

/** Small, dependency-free loading indicator with an accessible label. */
export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-line-strong border-t-primary",
        className,
      )}
    />
  );
}

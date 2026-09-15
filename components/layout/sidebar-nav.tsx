"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_MAP, findActiveNavItem } from "./nav-items";

export function SidebarNav({ navKey, label }: { navKey: string; label: string }) {
  const pathname = usePathname();
  const items = NAV_MAP[navKey];
  const active = findActiveNavItem(items, pathname);

  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      {items.map((item) => {
        const isActive = item.href === active?.href;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-surface text-primary shadow-sm"
                : "text-muted hover:bg-surface hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

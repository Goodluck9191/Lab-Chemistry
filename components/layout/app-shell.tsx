import type { ReactNode } from "react";
import type { UserRole } from "@/domain/profiles";
import { AppHeader } from "./app-header";
import { SidebarNav } from "./sidebar-nav";
import type { NavItem } from "./nav-items";

/**
 * The signed-in application shell: skip link, header, sidebar navigation and a
 * main landmark. It is responsive from phone width up, and the navigation is a
 * real <nav> with a label so screen readers can jump straight to it.
 */
export function AppShell({
  navItems,
  navLabel,
  user,
  children,
}: {
  navItems: NavItem[];
  navLabel: string;
  user: { fullName: string; email: string; role: UserRole };
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to main content
      </a>

      <AppHeader fullName={user.fullName} email={user.email} role={user.role} />

      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="border-b border-line bg-surface-muted px-3 py-3 lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r lg:px-3 lg:py-6">
          <SidebarNav items={navItems} label={navLabel} />
        </aside>

        <main id="main-content" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}

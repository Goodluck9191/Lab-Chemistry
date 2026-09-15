import { LogOut } from "lucide-react";
import { signOutAction } from "@/application/auth/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { UserRole } from "@/domain/profiles";

export function AppHeader({
  fullName,
  email,
  role,
}: {
  fullName: string;
  email: string;
  role: UserRole;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold tracking-tight">
          Virtual Chemistry Laboratory
        </span>
        <Badge tone={role === "instructor" ? "primary" : "neutral"}>
          {role === "instructor" ? "Instructor" : "Student"}
        </Badge>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium leading-tight">{fullName || email}</p>
          <p className="text-xs text-muted">{email}</p>
        </div>
        {/* Progressive enhancement: the form works without client-side JS. */}
        <form action={signOutAction}>
          <Button type="submit" variant="secondary" size="sm">
            <LogOut aria-hidden="true" className="size-4" />
            <span>Sign out</span>
          </Button>
        </form>
      </div>
    </header>
  );
}

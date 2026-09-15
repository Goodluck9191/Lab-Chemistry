import type { ReactNode } from "react";
import { PageContainer } from "@/components/layout/page-container";

/** Shared frame for the sign-in and registration screens. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-surface-muted">
      <PageContainer width="narrow" className="w-full">
        {children}
      </PageContainer>
    </div>
  );
}

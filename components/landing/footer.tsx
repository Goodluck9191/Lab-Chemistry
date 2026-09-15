import Link from "next/link";
import { FlaskConical } from "lucide-react";

export function LandingFooter() {
  return (
    <footer className="bg-background">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <FlaskConical aria-hidden="true" className="size-5 text-primary" />
          <span>Virtual Chemistry Laboratory</span>
        </Link>

        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
          <a href="#how-it-works" className="transition-colors hover:text-foreground">
            How It Works
          </a>
          <a href="#experiments" className="transition-colors hover:text-foreground">
            Experiments
          </a>
          <a href="#about" className="transition-colors hover:text-foreground">
            About
          </a>
          <Link href="/login" className="transition-colors hover:text-foreground">
            Sign In
          </Link>
          <Link href="/register" className="transition-colors hover:text-foreground">
            Create an Account
          </Link>
        </nav>

        <p className="text-xs text-muted">Physical Chemistry Practical I</p>
      </div>
    </footer>
  );
}

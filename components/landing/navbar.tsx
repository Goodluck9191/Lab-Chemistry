"use client";

import { useState } from "react";
import Link from "next/link";
import { FlaskConical, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClassName } from "@/components/ui/button";

const NAV_LINKS = [
  { label: "How It Works", href: "#how-it-works" },
  { label: "Experiments", href: "#experiments" },
  { label: "About", href: "#about" },
] as const;

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface/80 backdrop-blur-md">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6"
      >
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <FlaskConical aria-hidden="true" className="size-6 text-primary" />
          <span className="hidden sm:inline">Virtual Chemistry Laboratory</span>
          <span className="sm:hidden">VCL</span>
        </Link>

        {/* Desktop links */}
        <ul className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="text-sm font-medium text-muted transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        {/* Desktop auth */}
        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/login"
            className="text-sm font-medium text-muted transition-colors hover:text-foreground"
          >
            Login
          </Link>
          <Link
            href="/register"
            className={buttonClassName({ size: "sm", className: "rounded-md" })}
          >
            Get Started
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="inline-flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:text-foreground md:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>

      {/* Mobile menu */}
      <div
        className={cn(
          "overflow-hidden border-t border-line bg-surface transition-all duration-200 md:hidden",
          open ? "max-h-80 opacity-100" : "max-h-0 opacity-0",
        )}
        aria-hidden={!open}
      >
        <div className="flex flex-col gap-1 px-4 py-3">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
          <hr className="my-2 border-line" />
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            Login
          </Link>
          <Link
            href="/register"
            onClick={() => setOpen(false)}
            className="rounded-md bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground"
          >
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

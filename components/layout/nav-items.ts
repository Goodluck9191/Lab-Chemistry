import {
  ClipboardCheck,
  FileText,
  FlaskConical,
  LayoutDashboard,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Optional short description used by page headers and empty states. */
  description?: string;
}

export const STUDENT_NAV_ITEMS: NavItem[] = [
  { href: "/student/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/student/experiments", label: "Experiments", icon: FlaskConical },
  { href: "/student/progress", label: "Progress", icon: TrendingUp },
  { href: "/student/reports", label: "Reports", icon: FileText },
];

export const INSTRUCTOR_NAV_ITEMS: NavItem[] = [
  { href: "/instructor/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/instructor/students", label: "Students", icon: Users },
  { href: "/instructor/experiments", label: "Experiments", icon: FlaskConical },
  { href: "/instructor/submissions", label: "Submissions", icon: ClipboardCheck },
  { href: "/instructor/reports", label: "Reports", icon: FileText },
];

export const NAV_MAP: Record<string, NavItem[]> = {
  student: STUDENT_NAV_ITEMS,
  instructor: INSTRUCTOR_NAV_ITEMS,
};

/** The nav item that should look active for a given pathname. */
export function findActiveNavItem(items: NavItem[], pathname: string): NavItem | undefined {
  return items.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}

import { LayoutDashboard, Compass, ListChecks, Send, Radar, Telescope, BarChart3, FileText, FileStack, FolderOpen, Settings } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

// Single source of truth for the app's primary destinations — shared by the
// desktop sidebar and the mobile nav so they can never drift.
export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  chip?: string;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Today", icon: LayoutDashboard },
  { href: "/explore", label: "Explore", icon: Compass, chip: "New" },
  { href: "/pipeline", label: "Pipeline", icon: ListChecks },
  { href: "/files", label: "Files", icon: FolderOpen },
  { href: "/followups", label: "Follow-ups", icon: Send },
  { href: "/portals", label: "Portals", icon: Radar },
  { href: "/discovered", label: "Discovered", icon: Telescope },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/cv", label: "CV", icon: FileText },
  { href: "/resumes", label: "Resumes", icon: FileStack },
  { href: "/config", label: "Config", icon: Settings },
];

export function isActivePath(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

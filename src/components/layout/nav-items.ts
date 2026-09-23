import {
  Bell,
  Boxes,
  Container,
  Database,
  FileClock,
  Gauge,
  HeartPulse,
  GraduationCap,
  HardDrive,
  LayoutDashboard,
  Lightbulb,
  Network,
  Receipt,
  Server,
  Settings,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/rbac";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Cosmetic only — the page itself re-checks server-side. */
  permission: Permission;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard, permission: "org:read" },
      { href: "/checkup", label: "Check-up", icon: HeartPulse, permission: "inventory:read" },
      { href: "/resources", label: "Resources", icon: Boxes, permission: "inventory:read" },
    ],
  },
  {
    label: "Everyday tasks",
    items: [
      { href: "/budget", label: "Budget planner", icon: Receipt, permission: "cost:read" },
      { href: "/projects", label: "Business projects", icon: Boxes, permission: "org:read" },
      { href: "/start", label: "Start a task", icon: GraduationCap, permission: "inventory:read" },
      { href: "/help", label: "Team help", icon: Bell, permission: "org:read" },
      { href: "/weekly", label: "Weekly summary", icon: FileClock, permission: "org:read" },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { href: "/cloud/ec2", label: "EC2", icon: Server, permission: "inventory:read" },
      { href: "/cloud/s3", label: "S3", icon: HardDrive, permission: "inventory:read" },
      { href: "/cloud/network", label: "Network", icon: Network, permission: "inventory:read" },
      { href: "/cloud/databases", label: "Databases", icon: Database, permission: "inventory:read" },
      { href: "/cloud/serverless", label: "Serverless", icon: Zap, permission: "inventory:read" },
      { href: "/cloud/containers", label: "Containers", icon: Container, permission: "inventory:read" },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/cost", label: "Cost Explorer", icon: Receipt, permission: "cost:read" },
      { href: "/optimization", label: "Optimization", icon: Lightbulb, permission: "optimization:read" },
      { href: "/security", label: "Security", icon: ShieldCheck, permission: "security:read" },
      { href: "/monitoring", label: "Monitoring", icon: Gauge, permission: "metrics:read" },
      { href: "/alerts", label: "Alerts", icon: Bell, permission: "alerts:read" },
      { href: "/guides", label: "Guides", icon: GraduationCap, permission: "inventory:read" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/audit", label: "Audit Logs", icon: FileClock, permission: "audit:read" },
      { href: "/settings", label: "Settings", icon: Settings, permission: "org:read" },
    ],
  },
];

import {
  Receipt,
  Upload,
  CreditCard,
  LayoutDashboard,
  FileText,
  GitCompare,
  Settings,
  Users,
  Receipt as ReceiptIcon,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";

const employeeItems = [
  { title: "My Receipts", url: "/employee/receipts", icon: Receipt },
  { title: "Submit Receipt", url: "/employee/submit", icon: Upload },
  { title: "My Transactions", url: "/employee/transactions", icon: CreditCard },
];

const adminItems = [
  { title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboard },
  { title: "All Receipts", url: "/admin/receipts", icon: FileText },
  { title: "Import Transactions", url: "/admin/import", icon: Upload },
  { title: "Reconciliation", url: "/admin/reconciliation", icon: GitCompare },
  { title: "Settings", url: "/admin/settings", icon: Settings },
  { title: "Users", url: "/admin/users", icon: Users },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { role } = useAuth();
  const location = useLocation();

  const items = role === "admin" ? adminItems : employeeItems;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-2 text-sidebar-primary">
          <ReceiptIcon className="h-6 w-6 shrink-0" />
          {!collapsed && (
            <span
              className="text-lg font-bold tracking-tight"
              style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}
            >
              SpendSync
            </span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            {role === "admin" ? "Administration" : "Expenses"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === item.url}
                    tooltip={item.title}
                  >
                    <NavLink
                      to={item.url}
                      end
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-4 py-3">
        {!collapsed && (
          <p className="text-xs text-sidebar-foreground/60">
            {role === "admin" ? "Admin Portal" : "Employee Portal"}
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

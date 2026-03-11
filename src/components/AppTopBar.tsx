import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useStatementPeriod } from "@/hooks/useStatementPeriod";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { LogOut, Calendar } from "lucide-react";

export function AppTopBar() {
  const { profile, signOut } = useAuth();
  const { currentPeriod } = useStatementPeriod();
  const navigate = useNavigate();
  const isAdmin = profile?.role === "admin";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-card px-4">
      <SidebarTrigger className="-ml-1" />

      <button
        className={`flex items-center gap-2 text-sm text-muted-foreground ${isAdmin ? "hover:text-foreground cursor-pointer" : ""}`}
        onClick={() => isAdmin && navigate("/admin/settings?tab=general")}
        disabled={!isAdmin}
      >
        <Calendar className="h-4 w-4" />
        <span>{currentPeriod ?? "No active period"}</span>
      </button>

      <div className="ml-auto flex items-center gap-4">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium leading-none text-foreground">
            {profile?.full_name || "User"}
          </p>
          {profile?.department && (
            <p className="text-xs text-muted-foreground">{profile.department}</p>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={signOut} title="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}

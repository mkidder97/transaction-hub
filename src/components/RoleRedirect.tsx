import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const RoleRedirect = () => {
  const { user, role, loading, profile } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Wait for profile to load
  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (role === "admin") return <Navigate to="/admin/dashboard" replace />;
  return <Navigate to="/employee/receipts" replace />;
};

export default RoleRedirect;

import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import RoleRedirect from "@/components/RoleRedirect";
import AppLayout from "@/components/AppLayout";
import RoleGuard from "@/components/RoleGuard";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFound";
import { Loader2 } from "lucide-react";

// Lazy-loaded pages — only downloaded when navigated to
const EmployeeReceipts = lazy(() => import("@/pages/employee/Receipts"));
const SubmitReceipt = lazy(() => import("@/pages/employee/SubmitReceipt"));
const EmployeeTransactions = lazy(() => import("@/pages/employee/Transactions"));

const AdminDashboard = lazy(() => import("@/pages/admin/Dashboard"));
const AdminReceipts = lazy(() => import("@/pages/admin/Receipts"));
const ImportTransactions = lazy(() => import("@/pages/admin/ImportTransactions"));
const Reconciliation = lazy(() => import("@/pages/admin/Reconciliation"));
const Matching = lazy(() => import("@/pages/admin/Matching"));
const AdminSettings = lazy(() => import("@/pages/admin/Settings"));
const AdminUsers = lazy(() => import("@/pages/admin/Users"));

const queryClient = new QueryClient();

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-[50vh]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />

              {/* Role-based redirect */}
              <Route path="/" element={<RoleRedirect />} />
              <Route path="/dashboard" element={<RoleRedirect />} />

              {/* Employee routes */}
              <Route element={<AppLayout />}>
                <Route path="/employee/receipts" element={<RoleGuard allowedRole="employee"><EmployeeReceipts /></RoleGuard>} />
                <Route path="/employee/submit" element={<SubmitReceipt />} />
                <Route path="/employee/transactions" element={<RoleGuard allowedRole="employee"><EmployeeTransactions /></RoleGuard>} />
              </Route>

              {/* Admin routes */}
              <Route element={<AppLayout />}>
                <Route path="/admin/dashboard" element={<RoleGuard allowedRole="admin"><AdminDashboard /></RoleGuard>} />
                <Route path="/admin/receipts" element={<RoleGuard allowedRole="admin"><AdminReceipts /></RoleGuard>} />
                <Route path="/admin/import" element={<RoleGuard allowedRole="admin"><ImportTransactions /></RoleGuard>} />
                <Route path="/admin/reconciliation" element={<RoleGuard allowedRole="admin"><Reconciliation /></RoleGuard>} />
                <Route path="/admin/matching" element={<RoleGuard allowedRole="admin"><Matching /></RoleGuard>} />
                <Route path="/admin/settings" element={<RoleGuard allowedRole="admin"><AdminSettings /></RoleGuard>} />
                <Route path="/admin/users" element={<RoleGuard allowedRole="admin"><AdminUsers /></RoleGuard>} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

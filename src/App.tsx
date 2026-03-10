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

// Employee pages
import EmployeeReceipts from "@/pages/employee/Receipts";
import SubmitReceipt from "@/pages/employee/SubmitReceipt";
import EmployeeTransactions from "@/pages/employee/Transactions";

// Admin pages
import AdminDashboard from "@/pages/admin/Dashboard";
import AdminReceipts from "@/pages/admin/Receipts";
import ImportTransactions from "@/pages/admin/ImportTransactions";
import Reconciliation from "@/pages/admin/Reconciliation";
import AdminSettings from "@/pages/admin/Settings";
import AdminUsers from "@/pages/admin/Users";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />

            {/* Role-based redirect */}
            <Route path="/" element={<RoleRedirect />} />
            <Route path="/dashboard" element={<RoleRedirect />} />

            {/* Employee routes */}
            <Route element={<AppLayout />}>
              <Route path="/employee/receipts" element={<RoleGuard allowedRole="employee"><EmployeeReceipts /></RoleGuard>} />
              <Route path="/employee/submit" element={<RoleGuard allowedRole="employee"><SubmitReceipt /></RoleGuard>} />
              <Route path="/employee/transactions" element={<RoleGuard allowedRole="employee"><EmployeeTransactions /></RoleGuard>} />
            </Route>

            {/* Admin routes */}
            <Route element={<AppLayout />}>
              <Route path="/admin/dashboard" element={<RoleGuard allowedRole="admin"><AdminDashboard /></RoleGuard>} />
              <Route path="/admin/receipts" element={<RoleGuard allowedRole="admin"><AdminReceipts /></RoleGuard>} />
              <Route path="/admin/import" element={<RoleGuard allowedRole="admin"><ImportTransactions /></RoleGuard>} />
              <Route path="/admin/reconciliation" element={<RoleGuard allowedRole="admin"><Reconciliation /></RoleGuard>} />
              <Route path="/admin/settings" element={<RoleGuard allowedRole="admin"><AdminSettings /></RoleGuard>} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

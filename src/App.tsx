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
import Signup from "@/pages/Signup";
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
            <Route path="/signup" element={<Signup />} />

            {/* Role-based redirect */}
            <Route path="/" element={<RoleRedirect />} />
            <Route path="/dashboard" element={<RoleRedirect />} />

            {/* Employee routes */}
            <Route element={<AppLayout />}>
              <Route path="/employee/receipts" element={<EmployeeReceipts />} />
              <Route path="/employee/submit" element={<SubmitReceipt />} />
              <Route path="/employee/transactions" element={<EmployeeTransactions />} />
            </Route>

            {/* Admin routes */}
            <Route element={<AppLayout />}>
              <Route path="/admin/dashboard" element={<AdminDashboard />} />
              <Route path="/admin/receipts" element={<AdminReceipts />} />
              <Route path="/admin/import" element={<ImportTransactions />} />
              <Route path="/admin/reconciliation" element={<Reconciliation />} />
              <Route path="/admin/settings" element={<AdminSettings />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

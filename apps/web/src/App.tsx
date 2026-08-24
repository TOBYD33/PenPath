import { Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Users from "./pages/admin/Users";
import AuditLog from "./pages/admin/AuditLog";
import Institutions from "./pages/admin/Institutions";
import ScanIntake from "./pages/ops/ScanIntake";
import MyCases from "./pages/ops/MyCases";
import CaseAssignment from "./pages/supervisor/CaseAssignment";
import CaseDetail from "./pages/CaseDetail";
import Complaints from "./pages/Complaints";
import RevenueDashboard from "./pages/management/RevenueDashboard";
import ActivityDashboard from "./pages/management/ActivityDashboard";
import { ProtectedRoute } from "./components/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/cases/:id" element={<CaseDetail />} />
      </Route>
      <Route element={<ProtectedRoute allowedRoles={["OPS_OFFICER"]} />}>
        <Route path="/my-cases" element={<MyCases />} />
      </Route>
      <Route element={<ProtectedRoute allowedRoles={["OPS_SUPERVISOR", "SUPER_ADMIN"]} />}>
        <Route path="/assignment" element={<CaseAssignment />} />
      </Route>
      <Route element={<ProtectedRoute allowedRoles={["MANAGEMENT", "SUPER_ADMIN"]} />}>
        <Route path="/dashboard/revenue" element={<RevenueDashboard />} />
      </Route>
      <Route element={<ProtectedRoute allowedRoles={["OPS_SUPERVISOR", "MANAGEMENT", "SUPER_ADMIN"]} />}>
        <Route path="/dashboard/activity" element={<ActivityDashboard />} />
      </Route>
      <Route element={<ProtectedRoute allowedRoles={["OPS_OFFICER", "OPS_SUPERVISOR", "ADMIN", "SUPER_ADMIN"]} />}>
        <Route path="/scan-intake" element={<ScanIntake />} />
      </Route>
      <Route
        element={
          <ProtectedRoute
            allowedRoles={["CUSTOMER_CARE", "OPS_OFFICER", "OPS_SUPERVISOR", "ACCOUNTING", "MANAGEMENT", "ADMIN", "SUPER_ADMIN"]}
          />
        }
      >
        <Route path="/complaints" element={<Complaints />} />
      </Route>
      <Route element={<ProtectedRoute allowedRoles={["ADMIN", "SUPER_ADMIN"]} />}>
        <Route path="/admin/institutions" element={<Institutions />} />
      </Route>
      <Route element={<ProtectedRoute allowedRoles={["SUPER_ADMIN"]} />}>
        <Route path="/admin/users" element={<Users />} />
        <Route path="/admin/audit-log" element={<AuditLog />} />
      </Route>
    </Routes>
  );
}

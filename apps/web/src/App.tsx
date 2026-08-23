import { Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Users from "./pages/admin/Users";
import AuditLog from "./pages/admin/AuditLog";
import Institutions from "./pages/admin/Institutions";
import ScanIntake from "./pages/ops/ScanIntake";
import { ProtectedRoute } from "./components/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<Dashboard />} />
      </Route>
      <Route element={<ProtectedRoute allowedRoles={["OPS_OFFICER", "OPS_SUPERVISOR", "ADMIN", "SUPER_ADMIN"]} />}>
        <Route path="/scan-intake" element={<ScanIntake />} />
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

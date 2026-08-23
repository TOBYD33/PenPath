import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../../components/AppShell";
import { api, ApiError } from "../../lib/api";

interface MyCase {
  id: string;
  status: string;
  intakeSource: "DIGITAL_LINK" | "PHYSICAL_SCAN";
  createdAt: string;
  client: { name: string; email: string };
  pfa: { name: string };
  pmb: { name: string };
}

export default function MyCases() {
  const [cases, setCases] = useState<MyCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ cases: MyCase[] }>("/api/cases")
      .then((data) => setCases(data.cases))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load your cases"));
  }, []);

  return (
    <AppShell>
      <h1 className="text-lg font-semibold text-text-primary mb-4">My Cases</h1>
      {error && <p className="text-sm text-status-error mb-4">{error}</p>}

      <div className="bg-bg-base border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">PFA</th>
              <th className="px-4 py-3 font-medium">PMB</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Received</th>
            </tr>
          </thead>
          <tbody>
            {cases === null ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                  Loading…
                </td>
              </tr>
            ) : cases.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                  No cases assigned to you yet.
                </td>
              </tr>
            ) : (
              cases.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-text-primary">
                    <Link to={`/cases/${c.id}`} className="text-accent hover:text-accent-light">
                      {c.client.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-text-muted">{c.pfa.name}</td>
                  <td className="px-4 py-3 text-text-muted">{c.pmb.name}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium bg-bg-secondary rounded-full px-3 py-1">
                      {c.status.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-muted">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

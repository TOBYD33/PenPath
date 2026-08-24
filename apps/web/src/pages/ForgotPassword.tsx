import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post<{ message: string }>("/api/auth/forgot-password", { email });
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-secondary">
      <div className="w-full max-w-sm bg-bg-base border border-border rounded-lg shadow-sm p-8">
        <h1 className="text-xl font-semibold text-brand-primary mb-1">Forgot password</h1>
        <p className="text-sm text-text-muted mb-6">We'll email you a link to reset it.</p>

        {message ? (
          <div className="space-y-4">
            <p className="text-sm text-status-success">{message}</p>
            <Link to="/login" className="text-sm text-accent hover:text-accent-light">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
              />
            </div>

            {error && <p className="text-sm text-status-error">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-brand-primary hover:bg-brand-dark text-white font-medium rounded-md py-2 text-sm transition-colors disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Send reset link"}
            </button>

            <Link to="/login" className="block text-center text-sm text-text-muted hover:text-text-primary">
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}

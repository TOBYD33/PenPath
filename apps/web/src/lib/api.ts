const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

// ngrok's free tier shows an interstitial warning page to requests that look
// browser-originated unless this header is present. Harmless against any
// other host (e.g. Render in production) — only relevant while demoing
// through a tunnel.
const NGROK_BYPASS_HEADERS: Record<string, string> = API_BASE.includes("ngrok")
  ? { "ngrok-skip-browser-warning": "true" }
  : {};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}, jsonBody = true): Promise<T> {
  const token = localStorage.getItem("penpath_token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...NGROK_BYPASS_HEADERS,
      ...(jsonBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error ?? "Request failed", res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  postForm: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: "POST", body: formData }, false),
  downloadFile: async (path: string, filename: string) => {
    const token = localStorage.getItem("penpath_token");
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { ...NGROK_BYPASS_HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(body.error ?? "Download failed", res.status);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

"use client";

import { useAuth } from "./auth-provider";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { authenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="flex gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" />
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-10 text-center shadow-xl">
          {/* Logo / Icon */}
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600">
            <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>

          <h1 className="mb-1 text-xl font-semibold text-zinc-100">Go-Go-Gadget Agents</h1>
          <p className="mb-8 text-sm text-zinc-400">
            Sign in with your Microsoft account to continue
          </p>

          <a
            href="/api/auth/login"
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#2F2F2F] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#404040] border border-zinc-700"
          >
            {/* Microsoft logo */}
            <svg width="20" height="20" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1h9v9H1z" fill="#F25022"/>
              <path d="M11 1h9v9h-9z" fill="#7FBA00"/>
              <path d="M1 11h9v9H1z" fill="#00A4EF"/>
              <path d="M11 11h9v9h-9z" fill="#FFB900"/>
            </svg>
            Sign in with Microsoft
          </a>
        </div>
        <p className="mt-6 text-xs text-zinc-600">
          Powered by Azure AI Foundry · Secured by Microsoft Entra ID
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

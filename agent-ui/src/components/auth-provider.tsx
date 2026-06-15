"use client";

import { createContext, useContext, useEffect, useState } from "react";

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  userName?: string;
  userEmail?: string;
}

const AuthContext = createContext<AuthState>({
  authenticated: false,
  loading: true,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    authenticated: false,
    loading: true,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    if (code) {
      // Forward the auth code to the server-side callback for token exchange
      window.history.replaceState({}, "", "/");
      fetch(`/api/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state ?? "")}`)
        .then((res) => {
          if (res.ok) {
            return fetch("/api/auth/me");
          }
          throw new Error("Token exchange failed");
        })
        .then((res) => res.json())
        .then((data) => {
          setAuthState({
            authenticated: data.authenticated,
            loading: false,
            userName: data.userName,
            userEmail: data.userEmail,
          });
        })
        .catch(() => {
          setAuthState({ authenticated: false, loading: false });
        });
    } else {
      fetch("/api/auth/me")
        .then((res) => res.json())
        .then((data) => {
          setAuthState({
            authenticated: data.authenticated,
            loading: false,
            userName: data.userName,
            userEmail: data.userEmail,
          });
        })
        .catch(() => {
          setAuthState({ authenticated: false, loading: false });
        });
    }
  }, []);

  return (
    <AuthContext.Provider value={authState}>{children}</AuthContext.Provider>
  );
}

"use client";

import { createContext, useContext, useEffect, useState } from "react";

export interface AppConfig {
  clientId: string;
  tenantId: string;
  redirectUri: string;
  gitCommit: string;
  buildDate: string;
}

interface ConfigState {
  config: AppConfig | null;
  loading: boolean;
}

const ConfigContext = createContext<ConfigState>({ config: null, loading: true });

export function useConfig(): AppConfig {
  const { config } = useContext(ConfigContext);
  if (!config) throw new Error("useConfig() called before config loaded");
  return config;
}

export function useConfigLoading(): boolean {
  return useContext(ConfigContext).loading;
}

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfigState>({ config: null, loading: true });

  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((config: AppConfig) => setState({ config, loading: false }))
      .catch(() => setState({ config: null, loading: false }));
  }, []);

  return (
    <ConfigContext.Provider value={state}>{children}</ConfigContext.Provider>
  );
}

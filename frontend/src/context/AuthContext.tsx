import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import { api, clearToken, setToken, type CynUser } from "@/src/api/client";
import { storage } from "@/src/utils/storage";

const CYNLABS_LOGIN_URL =
  "https://cynlabs.xyz/api/login?mobile=1&returnUrl=suno-mobile://auth-callback";
const RETURN_URL = "suno-mobile://auth-callback";

type AuthState = {
  user: CynUser | null;
  loading: boolean;
  signingIn: boolean;
  signInWithGoogle: () => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

// On native, complete pending sessions on app start (recommended by expo-web-browser).
WebBrowser.maybeCompleteAuthSession();

async function fetchMe(): Promise<CynUser | null> {
  try {
    const res = await api<{ user: CynUser | null }>("/auth/user");
    return res?.user ?? null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CynUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await storage.secureGet<string>("cynlabs_token", "");
      if (token) {
        const u = await fetchMe();
        if (u) setUser(u);
        else await clearToken();
      }
      setLoading(false);
    })();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setSigningIn(true);
    try {
      const result = await WebBrowser.openAuthSessionAsync(CYNLABS_LOGIN_URL, RETURN_URL);
      if (result.type !== "success" || !result.url) return;

      // Extract token from suno-mobile://auth-callback?token=XYZ
      const url = result.url;
      const tokenMatch = url.match(/[?&]token=([^&#]+)/);
      if (!tokenMatch) {
        throw { message: "No token in callback URL", status: 0 };
      }
      const token = decodeURIComponent(tokenMatch[1]);
      await setToken(token);

      const u = await fetchMe();
      if (!u) {
        await clearToken();
        throw { message: "Session token rejected by server", status: 401 };
      }
      setUser(u);
    } finally {
      setSigningIn(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const u = await fetchMe();
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    await clearToken();
    setUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, signingIn, signInWithGoogle, refresh, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}

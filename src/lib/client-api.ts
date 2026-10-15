"use client";

import { useCallback, useEffect, useState } from "react";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
export function makeApi(base: string): Api {
  return async <T>(path: string, init: RequestInit = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(init.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...init.headers,
      },
    });
    const json = await response.json().catch(() => null);
    if (!response.ok)
      throw new HttpError(
        response.status,
        json?.error?.message || "The request failed. Please try again.",
      );
    return json.data as T;
  };
}
export const jsonBody = (value: unknown) => JSON.stringify(value);
export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

export function useData<T>(api: Api, path: string | null, poll = 0) {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{
    path: string;
    data?: T;
    error?: Error;
  } | null>(null);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let stopped = false;
    let pending = false;
    async function load() {
      if (pending || !path) return;
      pending = true;
      try {
        const data = await api<T>(path, { signal: controller.signal });
        if (!stopped) setResult({ path, data });
      } catch (error) {
        if (!stopped)
          setResult((previous) => ({
            path,
            data: previous?.path === path ? previous.data : undefined,
            error: error instanceof Error ? error : new Error(String(error)),
          }));
      } finally {
        pending = false;
      }
    }
    void load();
    const timer = poll
      ? setInterval(() => {
          if (!document.hidden) void load();
        }, poll)
      : undefined;
    const visible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [api, path, poll, version]);
  const current = result?.path === path ? result : null;
  return {
    data: current?.data,
    error: current?.error,
    loading: Boolean(path && !current),
    refresh,
  };
}

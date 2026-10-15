"use client";

import { useState, type FormEvent } from "react";
import type { AppMode } from "@/lib/app-mode";
import { errorText, jsonBody, type Api } from "@/lib/client-api";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { SCHOOL_DOMAIN } from "@/lib/school";

export default function AccountForm({
  api,
  mode,
  onReady,
}: {
  api: Api;
  mode: AppMode;
  onReady: () => void;
}) {
  const [signup, setSignup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(`/auth/${signup ? "signup" : "login"}`, {
        method: "POST",
        body: jsonBody({
          email: String(form.get("email")),
          password: String(form.get("password")),
          ...(signup ? { name: String(form.get("name")) } : {}),
        }),
      });
      onReady();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function google() {
    setBusy(true);
    setError("");
    try {
      const { error } = await supabaseBrowser().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${location.origin}/auth/callback`,
          queryParams: { hd: SCHOOL_DOMAIN, prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch (error) {
      setError(errorText(error));
      setBusy(false);
    }
  }
  return (
    <main className="account-screen">
      <section className="account-card">
        <div className="brand">
          <span className="brand-mark">w</span>WICKY
        </div>
        <h1>
          {mode === "setup"
            ? "Connect your school workspace"
            : signup && mode === "local"
              ? "Create your profile"
              : "Welcome back"}
        </h1>
        <p className="muted">
          {mode === "local"
            ? "This local workspace saves accounts and chats on this computer. Your chat list starts empty."
            : "A simple place to stay connected with your school."}
        </p>
        {mode === "setup" ? (
          <p className="setup-note">
            Run <code>npm run dev</code> for a local workspace, or configure
            your school&apos;s Supabase connection to use shared accounts.
          </p>
        ) : mode === "supabase" ? (
          <button className="primary-button" onClick={google} disabled={busy}>
            {busy ? "Connecting…" : "Continue with school Google account"}
          </button>
        ) : (
          <>
            <form onSubmit={submit} className="stack-form">
              {signup && (
                <label>
                  Name
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={80}
                  />
                </label>
              )}
              <label>
                School email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@chadwickschool.org"
                  maxLength={254}
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete={signup ? "new-password" : "current-password"}
                  minLength={10}
                  maxLength={128}
                  required
                />
              </label>
              <span className="field-help">
                At least 10 characters. Never use your school account password
                here.
              </span>
              <button className="primary-button" disabled={busy}>
                {busy ? "Please wait…" : signup ? "Create profile" : "Sign in"}
              </button>
            </form>
            <button
              className="text-button"
              onClick={() => {
                setSignup((value) => !value);
                setError("");
              }}
            >
              {signup
                ? "Already have a local profile? Sign in"
                : "Create a local profile"}
            </button>
            {signup && (
              <p className="field-help">
                The first local account manages the workspace. Later accounts
                join as students.
              </p>
            )}
          </>
        )}
        {error && (
          <p className="error-notice" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}

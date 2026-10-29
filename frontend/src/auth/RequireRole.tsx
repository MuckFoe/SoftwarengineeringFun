import { type ReactNode, useEffect } from "react";
import { useLocation } from "react-router";
import { loginUrl } from "../api/client";
import { Forbidden } from "../pages/Forbidden";
import { useMe } from "./useMe";

/** Full-page navigation: `/api/auth/login` is a server route, not a client one. */
function assignLocation(url: string) {
  window.location.assign(url);
}

interface Props {
  role: string;
  children: ReactNode;
  /** Injectable for tests; defaults to a full-page navigation. */
  redirect?: (url: string) => void;
}

/**
 * Renders `children` only for a signed-in user holding `role`.
 * Signed-out visitors go to single sign-on (FR-1); signed-in users without
 * the role are told so (FR-2a).
 */
export function RequireRole({ role, children, redirect = assignLocation }: Props) {
  const state = useMe();
  const { pathname, search, hash } = useLocation();
  const signedOut = state.status === "ready" && !state.me.signed_in;
  const next = pathname + search + hash;

  useEffect(() => {
    if (signedOut) redirect(loginUrl(next));
  }, [signedOut, next, redirect]);

  if (state.status === "loading" || signedOut) return <p>Loading…</p>;
  if (state.status === "error") {
    return <p role="alert">Could not check your sign-in. Try reloading the page.</p>;
  }
  if (!state.me.roles.includes(role)) return <Forbidden missingRole={role} />;
  return <>{children}</>;
}

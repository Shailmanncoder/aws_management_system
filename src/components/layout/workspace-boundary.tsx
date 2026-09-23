"use client";

import { useEffect } from "react";
import { WORKSPACE_CHANGED, workspaceDestination } from "@/lib/workspace-navigation";

/** Cookies are shared by tabs; their rendered data and router caches must change together. */
export function WorkspaceBoundary({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const reload = () => window.location.replace(workspaceDestination(window.location.pathname));
    const changed = (event: StorageEvent) => {
      if (event.key === WORKSPACE_CHANGED && event.newValue) reload();
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) reload();
    };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(WORKSPACE_CHANGED) : null;
    if (channel) channel.onmessage = reload;
    window.addEventListener("storage", changed);
    window.addEventListener("pageshow", restored);
    return () => {
      channel?.close();
      window.removeEventListener("storage", changed);
      window.removeEventListener("pageshow", restored);
    };
  }, []);
  return children;
}

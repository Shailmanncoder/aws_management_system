/** Keep the section, never an entity ID or filters belonging to the previous workspace. */
export function workspaceDestination(pathname: string): string {
  const sections = [
    "/settings/cloud-accounts", "/settings/members", "/settings/alerts", "/settings/workspace", "/settings/profile",
    "/cloud/ec2", "/cloud/s3", "/cloud/network", "/cloud/databases", "/cloud/serverless", "/cloud/containers",
    "/resources", "/cost", "/security", "/optimization", "/monitoring", "/alerts", "/audit",
    "/budget", "/projects", "/help", "/weekly", "/start", "/guides", "/checkup", "/settings",
  ];
  return sections.find(section => pathname === section || pathname.startsWith(`${section}/`)) ?? "/";
}
export const WORKSPACE_CHANGED = "stratus-workspace-changed";

/** Called after the server accepts a workspace selection, never during rendering. */
export function announceWorkspaceChange() {
  const message = crypto.randomUUID();
  try {
    localStorage.setItem(WORKSPACE_CHANGED, message);
  } catch {
    // BroadcastChannel still works when persistent storage is unavailable.
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(WORKSPACE_CHANGED);
      channel.postMessage(message);
      channel.close();
    }
  }
}

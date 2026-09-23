"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Square, RotateCw, Trash2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/api-client";
import { TagEditorDialog, type TagItem } from "./tag-editor-dialog";

export function Ec2Actions({
  orgId,
  resourceId,
  instanceId,
  instanceName,
  state,
  currentType,
  monitoring,
  tags,
  canRequest,
  canConfigure,
}: {
  orgId: string;
  resourceId: string;
  instanceId: string;
  instanceName: string;
  state: string | null;
  currentType: string;
  monitoring: string;
  tags: TagItem[];
  canRequest: boolean;
  canConfigure: boolean;
}) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Terminate modal state
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState("");

  // Edit config modal state
  const [editOpen, setEditOpen] = useState(false);
  const [selectedType, setSelectedType] = useState(currentType);
  const [enableMonitoring, setEnableMonitoring] = useState(monitoring === "enabled");
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const isRunning = state === "running";
  const isStopped = state === "stopped";

  const executeAction = async (action: "start" | "stop" | "reboot" | "terminate") => {
    setBusyAction(action);
    setError(null);
    try {
      await api(`/api/v1/orgs/${orgId}/resources/${resourceId}/action`, {
        method: "POST",
        body: { type: "ec2:action", action },
      });
      router.refresh();
      if (action === "terminate") {
        setTerminateOpen(false);
        setConfirmPhrase("");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditPending(true);
    setEditError(null);
    try {
      await api(`/api/v1/orgs/${orgId}/resources/${resourceId}/action`, {
        method: "POST",
        body: {
          type: "ec2:modify",
          modifications: {
            ...(selectedType !== currentType ? { instanceType: selectedType } : {}),
            monitoring: enableMonitoring,
          },
        },
      });
      setEditOpen(false);
      router.refresh();
    } catch (err) {
      setEditError(errorMessage(err));
    } finally {
      setEditPending(false);
    }
  };

  if (!canRequest) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}

      {/* Start Button */}
      {isStopped && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={busyAction !== null}
          onClick={() => executeAction("start")}
        >
          <Play className="size-3.5 text-success-text" />
          {busyAction === "start" ? "Starting…" : "Start"}
        </Button>
      )}

      {/* Stop Button */}
      {isRunning && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={busyAction !== null}
          onClick={() => executeAction("stop")}
        >
          <Square className="size-3.5 text-amber-500" />
          {busyAction === "stop" ? "Stopping…" : "Stop"}
        </Button>
      )}

      {/* Reboot Button */}
      {isRunning && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={busyAction !== null}
          onClick={() => executeAction("reboot")}
        >
          <RotateCw className="size-3.5" />
          {busyAction === "reboot" ? "Rebooting…" : "Reboot"}
        </Button>
      )}

      {/* Modify Configuration Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5" disabled={busyAction !== null}>
            <Settings2 className="size-3.5" />
            Edit configuration
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit instance configuration</DialogTitle>
            <DialogDescription>
              Modify compute specs and monitoring settings for <strong className="font-medium text-foreground">{instanceId}</strong>.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveConfig} className="space-y-4 py-2">
            {editError && (
              <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
                {editError}
              </p>
            )}

            <div className="space-y-1.5">
              <label htmlFor="ec2-instance-type" className="text-xs font-medium">Instance type</label>
              <select
                id="ec2-instance-type"
                aria-label="Instance type"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                disabled={!isStopped || editPending}
              >
                {["t3.micro", "t3.small", "t3.medium", "t3.large", "t4g.micro", "t4g.small", "t4g.medium", "m5.large"].map((t) => (
                  <option key={t} value={t}>
                    {t} {t === currentType ? "(Current)" : ""}
                  </option>
                ))}
              </select>
              {!isStopped && (
                <p className="text-xs text-muted-foreground">
                  Instance must be in <strong>stopped</strong> state to change instance type.
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="detailed-monitoring"
                checked={enableMonitoring}
                onChange={(e) => setEnableMonitoring(e.target.checked)}
                disabled={editPending}
                className="size-4 rounded border-input"
              />
              <label htmlFor="detailed-monitoring" className="text-xs">
                Enable 1-minute detailed CloudWatch monitoring
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-3">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditOpen(false)} disabled={editPending}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={editPending}>
                {editPending ? "Applying in AWS…" : "Apply changes"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Tags */}
      <TagEditorDialog
        orgId={orgId}
        resourceId={resourceId}
        resourceName={instanceName || instanceId}
        initialTags={tags}
      />

      {/* Terminate Dialog */}
      {canConfigure && state !== "terminated" && (
        <Dialog open={terminateOpen} onOpenChange={setTerminateOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:bg-destructive/10" disabled={busyAction !== null}>
              <Trash2 className="size-3.5" />
              Terminate
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-destructive">Terminate EC2 instance</DialogTitle>
              <DialogDescription>
                Terminating <strong className="font-medium text-foreground">{instanceId}</strong> ({instanceName}) is permanent.
                Attached root storage volumes will be deleted and this instance cannot be restarted.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <p className="text-xs text-muted-foreground">
                Type <strong>terminate</strong> below to confirm deletion:
              </p>
              <Input
                value={confirmPhrase}
                onChange={(e) => setConfirmPhrase(e.target.value)}
                placeholder="terminate"
                className="font-mono text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setTerminateOpen(false)} disabled={busyAction !== null}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={confirmPhrase.trim().toLowerCase() !== "terminate" || busyAction !== null}
                onClick={() => executeAction("terminate")}
              >
                {busyAction === "terminate" ? "Terminating…" : "Permanently terminate"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

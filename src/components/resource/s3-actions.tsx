"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, ShieldAlert, History, Lock, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export function S3Actions({
  orgId,
  resourceId,
  bucketName,
  versioning,
  encryption,
  pab,
  tags,
  canRequest,
}: {
  orgId: string;
  resourceId: string;
  bucketName: string;
  versioning: string | null;
  encryption: { algorithm?: string } | null;
  pab: {
    blockPublicAcls?: boolean;
    ignorePublicAcls?: boolean;
    blockPublicPolicy?: boolean;
    restrictPublicBuckets?: boolean;
  } | null;
  tags: TagItem[];
  canRequest: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [selectedVersioning, setSelectedVersioning] = useState<"Enabled" | "Suspended">(
    versioning === "Enabled" ? "Enabled" : "Suspended",
  );
  const [selectedEncryption, setSelectedEncryption] = useState<"AES256" | "aws:kms">(
    encryption?.algorithm === "aws:kms" ? "aws:kms" : "AES256",
  );
  const [blockAcls, setBlockAcls] = useState(pab?.blockPublicAcls ?? true);
  const [ignoreAcls, setIgnoreAcls] = useState(pab?.ignorePublicAcls ?? true);
  const [blockPolicy, setBlockPolicy] = useState(pab?.blockPublicPolicy ?? true);
  const [restrictBuckets, setRestrictBuckets] = useState(pab?.restrictPublicBuckets ?? true);

  if (!canRequest) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api(`/api/v1/orgs/${orgId}/resources/${resourceId}/action`, {
        method: "POST",
        body: {
          type: "s3:modify",
          modifications: {
            versioning: selectedVersioning,
            encryption: selectedEncryption,
            publicAccessBlock: {
              blockPublicAcls: blockAcls,
              ignorePublicAcls: ignoreAcls,
              blockPublicPolicy: blockPolicy,
              restrictPublicBuckets: restrictBuckets,
            },
          },
        },
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const allPublicBlocked = blockAcls && ignoreAcls && blockPolicy && restrictBuckets;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Configure S3 Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Settings2 className="size-3.5" />
            Configure bucket
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Configure S3 bucket</DialogTitle>
            <DialogDescription>
              Update security, encryption, and versioning settings for{" "}
              <strong className="font-medium text-foreground">{bucketName}</strong>.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 py-2">
            {error && (
              <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
                {error}
              </p>
            )}

            {/* Block Public Access */}
            <div className="rounded-lg border bg-muted/20 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs font-semibold">
                  {allPublicBlocked ? (
                    <Shield className="size-4 text-success-text" />
                  ) : (
                    <ShieldAlert className="size-4 text-status-critical" />
                  )}
                  Block Public Access (Bucket settings)
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    const next = !allPublicBlocked;
                    setBlockAcls(next);
                    setIgnoreAcls(next);
                    setBlockPolicy(next);
                    setRestrictBuckets(next);
                  }}
                >
                  {allPublicBlocked ? "Uncheck all" : "Enable all (Recommended)"}
                </Button>
              </div>

              <div className="space-y-2 text-xs">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={blockAcls}
                    onChange={(e) => setBlockAcls(e.target.checked)}
                    className="mt-0.5 size-3.5 rounded border-input"
                  />
                  <span>Block public ACLs (prevent new public access via ACLs)</span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ignoreAcls}
                    onChange={(e) => setIgnoreAcls(e.target.checked)}
                    className="mt-0.5 size-3.5 rounded border-input"
                  />
                  <span>Ignore public ACLs (enforces private bucket regardless of object ACLs)</span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={blockPolicy}
                    onChange={(e) => setBlockPolicy(e.target.checked)}
                    className="mt-0.5 size-3.5 rounded border-input"
                  />
                  <span>Block public policy (rejects bucket policies allowing public access)</span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restrictBuckets}
                    onChange={(e) => setRestrictBuckets(e.target.checked)}
                    className="mt-0.5 size-3.5 rounded border-input"
                  />
                  <span>Restrict public buckets (only authorized AWS users/services may access)</span>
                </label>
              </div>
            </div>

            {/* Versioning & Encryption */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="s3-versioning" className="flex items-center gap-1.5 text-xs font-medium">
                  <History className="size-3.5 text-muted-foreground" /> Bucket versioning
                </label>
                <select
                  id="s3-versioning"
                  aria-label="Bucket versioning"
                  className="w-full rounded-md border bg-background px-3 py-2 text-xs"
                  value={selectedVersioning}
                  onChange={(e) => setSelectedVersioning(e.target.value as "Enabled" | "Suspended")}
                >
                  <option value="Enabled">Enabled</option>
                  <option value="Suspended">Suspended</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="s3-encryption" className="flex items-center gap-1.5 text-xs font-medium">
                  <Lock className="size-3.5 text-muted-foreground" /> Default encryption
                </label>
                <select
                  id="s3-encryption"
                  aria-label="Default encryption"
                  className="w-full rounded-md border bg-background px-3 py-2 text-xs"
                  value={selectedEncryption}
                  onChange={(e) => setSelectedEncryption(e.target.value as "AES256" | "aws:kms")}
                >
                  <option value="AES256">Amazon S3 managed key (SSE-S3)</option>
                  <option value="aws:kms">AWS KMS key (SSE-KMS)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving in AWS…" : "Apply configuration"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Tags */}
      <TagEditorDialog
        orgId={orgId}
        resourceId={resourceId}
        resourceName={bucketName}
        initialTags={tags}
      />
    </div>
  );
}

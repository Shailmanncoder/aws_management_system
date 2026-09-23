"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tag, Plus, Trash2 } from "lucide-react";
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

export interface TagItem {
  key: string;
  value: string;
}

export function TagEditorDialog({
  orgId,
  resourceId,
  resourceName,
  initialTags,
  disabled = false,
}: {
  orgId: string;
  resourceId: string;
  resourceName: string;
  initialTags: TagItem[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<TagItem[]>(initialTags);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleOpen = (next: boolean) => {
    if (next) {
      setTags(initialTags);
      setNewKey("");
      setNewValue("");
      setError(null);
      setSuccess(false);
    }
    setOpen(next);
  };

  const handleAddTag = () => {
    const k = newKey.trim();
    const v = newValue.trim();
    if (!k) return;
    if (k.toLowerCase().startsWith("aws:")) {
      setError("Tag keys starting with 'aws:' are reserved by AWS.");
      return;
    }
    if (tags.some((t) => t.key.toLowerCase() === k.toLowerCase())) {
      setError(`A tag with key '${k}' already exists.`);
      return;
    }
    setError(null);
    setTags([...tags, { key: k, value: v }]);
    setNewKey("");
    setNewValue("");
  };

  const handleRemoveTag = (index: number) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  const handleUpdateValue = (index: number, val: string) => {
    setTags(tags.map((t, i) => (i === index ? { ...t, value: val } : t)));
  };

  const handleSave = async () => {
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      await api(`/api/v1/orgs/${orgId}/resources/${resourceId}/tags`, {
        method: "PUT",
        body: { tags },
      });
      setSuccess(true);
      router.refresh();
      setTimeout(() => setOpen(false), 800);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className="gap-1.5">
          <Tag className="size-3.5" aria-hidden />
          Edit tags
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit tags</DialogTitle>
          <DialogDescription>
            Manage AWS tags for <strong className="font-medium text-foreground">{resourceName}</strong>.
            Changes are applied directly in AWS and reflected in Stratus inventory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && (
            <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="rounded-md border border-success-text/20 bg-success-text/10 p-2.5 text-xs text-success-text">
              Tags saved successfully.
            </p>
          )}

          <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
            {tags.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No tags configured on this resource.</p>
            ) : (
              tags.map((tag, idx) => (
                <div key={tag.key} className="flex items-center gap-2">
                  <div className="w-1/3 truncate rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-xs" title={tag.key}>
                    {tag.key}
                  </div>
                  <Input
                    className="h-8 flex-1 text-xs"
                    value={tag.value}
                    onChange={(e) => handleUpdateValue(idx, e.target.value)}
                    placeholder="Value"
                    disabled={pending}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemoveTag(idx)}
                    disabled={pending}
                    aria-label={`Remove tag ${tag.key}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="mb-2 text-xs font-medium">Add new tag</p>
            <div className="flex items-center gap-2">
              <Input
                className="h-8 w-1/3 text-xs"
                placeholder="Key"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                disabled={pending}
              />
              <Input
                className="h-8 flex-1 text-xs"
                placeholder="Value"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                disabled={pending}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={handleAddTag}
                disabled={pending || !newKey.trim()}
              >
                <Plus className="size-3" /> Add
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={pending}>
            {pending ? "Saving tags in AWS…" : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

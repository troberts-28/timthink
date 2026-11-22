import type { ProjectStatus } from "@timthink/server";
import { useState } from "react";
import { setProjectStatus } from "../api/projects";
import { useToast } from "../lib/toast";

const PROJECT_STATUS_STYLES: Record<ProjectStatus, { label: string; chipClass: string; dotClass: string }> = {
  active: { label: "Active", chipClass: "chip-info", dotClass: "bg-info" },
  paused: { label: "Paused", chipClass: "chip-neutral", dotClass: "bg-ink-32" },
  shipped: { label: "Shipped", chipClass: "chip-ok", dotClass: "bg-ok" },
  dropped: { label: "Dropped", chipClass: "chip-muted", dotClass: "bg-line" },
};

const STATUS_ORDER: ProjectStatus[] = ["active", "paused", "shipped", "dropped"];

export function ProjectStatusDot({ status }: { status: ProjectStatus }) {
  const style = PROJECT_STATUS_STYLES[status];
  return (
    <span
      role="img"
      aria-label={style.label}
      title={style.label}
      className={`inline-block size-2 flex-none rounded-full ${style.dotClass}`}
    />
  );
}

export function ProjectStatusPicker({ projectId, status }: { projectId: string; status: ProjectStatus }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const style = PROJECT_STATUS_STYLES[status];
  const changeStatus = async (next: ProjectStatus) => {
    setSaving(true);
    try {
      await setProjectStatus(projectId, next);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't change the status", "bad");
    } finally {
      setSaving(false);
    }
  };
  return (
    <label className={`chip ${style.chipClass} relative cursor-pointer`}>
      <span>{style.label}</span>
      <select
        aria-label="Project status"
        value={status}
        disabled={saving}
        onChange={(event) => {
          const next = STATUS_ORDER.find((candidate) => candidate === event.target.value);
          if (next) {
            void changeStatus(next);
          }
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {STATUS_ORDER.map((candidate) => (
          <option key={candidate} value={candidate}>
            {PROJECT_STATUS_STYLES[candidate].label}
          </option>
        ))}
      </select>
    </label>
  );
}

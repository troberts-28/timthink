import { countTasks, linesOutsideFences } from "./summarize.js";
import type { PhaseSummary } from "./types.js";

const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const PHASE_TITLE = /^phase\s+(\d{1,3})\b[\s:.)–—-]*(.*)$/i;

interface OpenPhase {
  level: number;
  number: number;
  title: string;
  lines: string[];
}

function close(phase: OpenPhase): PhaseSummary {
  return { number: phase.number, title: phase.title, tasks: countTasks(phase.lines.join("\n")) };
}

export function listPhases(body: string): PhaseSummary[] {
  const phases: PhaseSummary[] = [];
  let open: OpenPhase | null = null;
  for (const line of linesOutsideFences(body)) {
    const heading = HEADING.exec(line);
    if (heading?.[1] && heading[2]) {
      const level = heading[1].length;
      if (open && level <= open.level) {
        phases.push(close(open));
        open = null;
      }
      const phase = PHASE_TITLE.exec(heading[2].replace(/[*_`]/g, ""));
      if (phase?.[1] && !open) {
        open = { level, number: Number(phase[1]), title: phase[2]?.trim() ?? "", lines: [] };
        continue;
      }
    }
    open?.lines.push(line);
  }
  if (open) phases.push(close(open));
  return phases;
}

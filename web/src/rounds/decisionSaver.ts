import type { RoundDecision, RoundView } from "@timthink/server";
import { saveRoundDecision } from "../api/rounds";

const TYPING_DEBOUNCE_MS = 400;

export interface DecisionSaverEvents {
  onSaved: (view: RoundView) => void;
  onError: (error: unknown) => void;
}

export class DecisionSaver {
  private readonly queued = new Map<string, RoundDecision>();
  private readonly timers = new Map<string, number>();
  private readonly lastSave = new Map<string, Promise<void>>();

  constructor(
    private readonly roundId: string,
    private readonly events: DecisionSaverEvents,
  ) {}

  saveNow(itemId: string, decision: RoundDecision) {
    this.queued.set(itemId, decision);
    this.send(itemId);
  }

  saveSoon(itemId: string, decision: RoundDecision) {
    this.queued.set(itemId, decision);
    window.clearTimeout(this.timers.get(itemId));
    this.timers.set(
      itemId,
      window.setTimeout(() => this.send(itemId), TYPING_DEBOUNCE_MS),
    );
  }

  async flush() {
    for (const itemId of [...this.queued.keys()]) {
      this.send(itemId);
    }
    await Promise.all(this.lastSave.values());
  }

  private send(itemId: string) {
    window.clearTimeout(this.timers.get(itemId));
    this.timers.delete(itemId);
    const decision = this.queued.get(itemId);
    if (!decision) {
      return;
    }
    this.queued.delete(itemId);
    const previous = this.lastSave.get(itemId) ?? Promise.resolve();
    const save = previous
      .then(() => saveRoundDecision(this.roundId, itemId, decision))
      .then(this.events.onSaved, this.events.onError);
    this.lastSave.set(itemId, save);
  }
}

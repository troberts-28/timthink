export type HubEvent =
  | { type: "index-changed"; version: number }
  | { type: "doc-changed"; path: string; version: number }
  | { type: "doc-removed"; path: string; version: number }
  | { type: "review-changed"; path: string; version: number }
  | { type: "sessions-changed"; sessionIds: string[]; docPaths: string[]; version: number }
  | { type: "history-changed"; path: string; version: number }
  | { type: "seen-changed"; path: string; version: number }
  | { type: "archive-changed"; paths: string[]; version: number }
  | { type: "prs-changed"; paths: string[]; version: number };

type Listener = (event: HubEvent) => void;

export class EventHub {
  private readonly listeners = new Set<Listener>();
  private version = 0;
  private viewers = 0;

  trackViewer(): () => void {
    this.viewers += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.viewers -= 1;
    };
  }

  get viewerCount(): number {
    return this.viewers;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  nextVersion(): number {
    this.version += 1;
    return this.version;
  }

  publish(event: HubEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

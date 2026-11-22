import { appendSessionEvent, MAX_SESSION_LABEL_LENGTH, type TimthinkConfig } from "@timthink/server";

export const SESSION_USAGE = `Usage: timthink session <command>

Commands:
  label "<text>"    Name this Claude session on its project's page (up to ${MAX_SESSION_LABEL_LENGTH} characters)

Run it from inside a Claude Code session: it finds the session through its parent processes.`;

export interface SessionIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

export interface SessionCommand {
  config: Pick<TimthinkConfig, "stateDir">;
  args: readonly string[];
  io: SessionIo;
  ownSessionId: () => Promise<string | null>;
}

export const NOT_IN_SESSION_MESSAGE =
  "This isn't running inside a Claude Code session, so there is no session to name or bind.";

export async function runSession({ config, args, io, ownSessionId }: SessionCommand): Promise<number> {
  const [subcommand, ...words] = args;
  const label = words.join(" ").trim();
  if (subcommand !== "label" || label === "") {
    io.err(SESSION_USAGE);
    return 1;
  }
  if (label.length > MAX_SESSION_LABEL_LENGTH) {
    io.err(`Keep the label to ${MAX_SESSION_LABEL_LENGTH} characters.`);
    return 1;
  }
  const sessionId = await ownSessionId();
  if (!sessionId) {
    io.err(NOT_IN_SESSION_MESSAGE);
    return 1;
  }
  await appendSessionEvent(config.stateDir, { event: "Label", sessionId, at: new Date().toISOString(), label });
  io.out(`Labelled this session "${label}".`);
  return 0;
}

// The agent's work as Sonar draws it: turns of rows, the route, the counts, and each row's details.
// Pure and synchronous, so the panel only feeds it timeline entries and events and reads `view(now)`.
import {
  backgroundTaskId,
  classify,
  errorText,
  firstLine,
  monitorLifetime,
  oneLine,
  outputText,
  type ToolCallLike,
} from "./classify";
import { shortPath } from "./shell";
import { STATIONS, type StationId } from "./stations";

export type RowStatus = "running" | "ok" | "err" | "canceled";
type RowKind = "tool" | "message" | "reply" | "thinking" | "compaction" | "notice";

/** Background work a call left running: a background shell, a monitor, an async agent. */
interface TaskState {
  taskId?: string;
  /** When it gives up by itself, if it says. */
  expiresAt?: number;
  endedAt?: number;
  status?: RowStatus;
  exitCode?: number;
}

interface Row {
  key: string;
  kind: RowKind;
  station: StationId;
  title: string;
  doing: string;
  tool: string;
  facts: string[];
  /** For tools, the item's own status; message rows derive theirs in `view`. */
  status: RowStatus;
  startedAt: number;
  endedAt?: number;
  failure?: string;
  exitCode?: number;
  command?: string;
  /** What a receipt in the output makes of the call, and its word for it. */
  verdict?: "err" | "warn";
  outcome?: string;
  receipt?: boolean;
  /** Text of a message, reply or thinking; replies and thinking grow chunk by chunk. */
  text?: string;
  callId?: string;
  provider?: string;
  /** The call's detail and error, kept for the expanded row. */
  detail?: Record<string, unknown>;
  error?: string;
  task?: TaskState;
  /** Measured from its own start and end events, so worth keeping across reloads. */
  measured?: boolean;
}

interface Turn {
  key: string;
  startedAt: number;
  endedAt?: number;
  rows: Row[];
}

/** A provider subagent, from `agent.provider_subagents.update`. */
interface Subagent {
  id: string;
  title: string;
  task: string | null;
  status: RowStatus;
  startedAt: number;
  endedAt?: number;
  toolCallId: string | null;
  steps: { text: string; at: number; tone: "normal" | "err" }[];
  lastSeen: number;
}

/** Any timeline item; only the fields Sonar reads are named. */
export type TimelineItemLike =
  | ({ type: "tool_call"; callId: string } & ToolCallLike)
  | { type: "user_message"; text: string; messageId?: string }
  | { type: "assistant_message"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "compaction"; status: "loading" | "completed" }
  | { type: "error"; message: string }
  | { type: string; [key: string]: unknown };

export interface EntryLike {
  item: TimelineItemLike;
  timestamp: string | number;
  turnId?: string;
  seq?: number;
  provider?: string;
}

/** An `agent.provider_subagents.update` payload. */
export type SubagentUpdateLike =
  | {
      kind: "upsert";
      subagent: {
        id: string;
        parentAgentId: string;
        title: string | null;
        description: string | null;
        subtitle?: string | null;
        status: "running" | "completed" | "failed" | "canceled";
        createdAt: string;
        updatedAt: string;
        toolCallId: string | null;
      };
    }
  | { kind: "timeline"; parentAgentId: string; subagentId: string; item: TimelineItemLike; timestamp: string };

/** An `AgentStreamEvent` as the live subscription delivers it. */
export interface StreamEventLike {
  type: string;
  turnId?: string;
  provider?: string;
  item?: TimelineItemLike;
  usage?: { contextWindowUsedTokens?: number; contextWindowMaxTokens?: number };
}

// ---- View -------------------------------------------------------------------------------------

export interface RowView {
  key: string;
  station: StationId;
  title: string;
  /** The line under the title: "python3 · exit 0", "Edit · +12 −3". */
  meta: string;
  metaTone: "normal" | "err" | "warn";
  status: RowStatus;
  /** Running now; the panel draws a spinner and the elapsed time. */
  live: boolean;
  /** Right column: an elapsed or total time, "exit 1", "failed", "·", or "" when unknown. */
  trailing: string;
  startedAt: number;
  /** Kept open: live work and recent failures. */
  pinned: boolean;
  /** Work left running in the background, shown at the top of the newest turn. */
  background: boolean;
}

export interface TurnView {
  key: string;
  label: string;
  startedAt: number;
  /** Total length of a finished turn, in ms. */
  duration?: number;
  active: boolean;
  rows: RowView[];
}

export interface RouteStop {
  station: StationId;
  state: "live" | "err" | "normal";
}

export interface Headline {
  station: StationId;
  title: string;
  sub: string;
  running: boolean;
}

export interface SonarView {
  empty: boolean;
  running: boolean;
  /** "NOW · 4M 12S" or "IDLE · 3M AGO". */
  clock: string;
  /** The right of the clock line: "2 running", "1 in background", or nothing. */
  activity: string | null;
  runningCount: number;
  backgroundCount: number;
  headline: Headline;
  /** A second call running beside the headline's. */
  parallel: { station: StationId; text: string; elapsed: string } | null;
  route: RouteStop[];
  turns: TurnView[];
  counts: Record<StationId, number>;
  /** "SESSION" when every entry is loaded, "RECENT" when older ones are not. */
  scope: "SESSION" | "RECENT";
  liveStations: ReadonlySet<StationId>;
  errorStations: ReadonlySet<StationId>;
  context: { percent: number } | null;
}

/** What an expanded row shows. */
export type DetailView =
  | { kind: "shell"; command: string; cwd: string | null; output: string; failed: boolean; note: string | null }
  | { kind: "diff"; lines: { sign: "+" | "-" | " " | "@"; text: string }[] }
  | { kind: "agent"; task: string | null; steps: { text: string; when: string; tone: "normal" | "err" }[]; log: string }
  | { kind: "text"; text: string }
  | { kind: "fields"; fields: { label: string; value: string }[]; output: string };

export interface AgentFacts {
  /** The agent's status; "running" means a turn is open. */
  status: string;
  model: string | null;
  thinking: string | null;
}

// ---- Formatting -------------------------------------------------------------------------------

/** 0.4s, 3.2s, 1m 52s, 2h 05m. */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 60_000) return `${(Math.max(safe, 100) / 1000).toFixed(1)}s`;
  const totalSeconds = Math.floor(safe / 1000);
  if (totalSeconds < 3600) return `${Math.floor(totalSeconds / 60)}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
  const minutes = Math.floor(totalSeconds / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** 4M 12S for the clock line. */
function clockDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}S`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}M ${seconds % 60}S`;
  return `${Math.floor(seconds / 3600)}H ${Math.floor((seconds % 3600) / 60)}M`;
}

/** How long ago, in minutes: JUST NOW, 9M AGO, 2H 5M AGO. */
function idleFor(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "JUST NOW";
  if (minutes < 60) return `${minutes}M AGO`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}H ${minutes % 60}M AGO`;
  return `${Math.floor(minutes / (60 * 24))}D AGO`;
}

/** "now", "40s", "2m", "1h": how long ago a step happened. */
function ago(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

/** 23:23:22 in the device's time zone. */
export function formatClock(ms: number, seconds = true): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}${seconds ? `:${pad(date.getSeconds())}` : ""}`;
}

/** `claude-opus-5-5` reads as `opus-5.5`; other ids stay as they are. */
export function shortModel(model: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model);
  return match ? `${match[1]}-${match[2]}${match[3] !== undefined ? `.${match[3]}` : ""}` : model;
}

const time = (value: string | number): number => (typeof value === "number" ? value : Date.parse(value));

/** Background work with no word of its end is taken as over after this long. */
const TASK_GIVE_UP_MS = 12 * 3_600_000;
/** Thinking shorter than this is left out of the turn. */
const SHORT_THINKING_MS = 1000;
/** Strings kept per call for its expanded row. */
const KEEP_CHARS = 60_000;

function keep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > KEEP_CHARS ? value.slice(value.length - KEEP_CHARS) : value;
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => keep(entry, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, keep(entry, depth + 1)]));
}

const statusOf = (value: string | undefined): RowStatus | undefined =>
  value === "completed" ? "ok" : value === "failed" ? "err" : value === "killed" || value === "stopped" || value === "canceled" ? "canceled" : undefined;

// ---- Model ------------------------------------------------------------------------------------

export class SonarModel {
  private turns: Turn[] = [];
  private byCall = new Map<string, Row>();
  private maxSeq = -1;
  private hasOlder = false;
  private context: { used: number; max: number } | null = null;
  private serial = 0;
  private subagents = new Map<string, Subagent>();
  /** Durations measured earlier, by call id, from the tab's saved state. */
  private remembered = new Map<string, number>();

  /** Starts over from a page of history, oldest first. */
  load(entries: readonly EntryLike[], options: { hasOlder: boolean; maxSeq: number }): void {
    this.turns = [];
    this.byCall.clear();
    this.hasOlder = options.hasOlder;
    this.maxSeq = -1;
    for (const entry of entries) this.applyItem(entry.item, time(entry.timestamp), entry.turnId, false, entry.provider);
    this.maxSeq = options.maxSeq;
  }

  setContext(used: number | undefined, max: number | undefined): void {
    if (used !== undefined && max !== undefined && max > 0) this.context = { used, max };
  }

  /** Durations measured while the panel watched, by call id, to keep in the tab's state. */
  measuredDurations(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const row of this.byCall.values()) {
      if (row.measured && row.callId && row.endedAt !== undefined) out[row.callId] = row.endedAt - row.startedAt;
    }
    return out;
  }

  remember(durations: Record<string, number>): void {
    for (const [callId, ms] of Object.entries(durations)) if (Number.isFinite(ms) && ms >= 0) this.remembered.set(callId, ms);
  }

  /** Applies one live event. Timeline items at or below the loaded history's last seq are skipped. */
  applyStream(event: StreamEventLike, timestamp: string | number, seq?: number): void {
    const at = time(timestamp);
    switch (event.type) {
      case "turn_started":
        this.turn(event.turnId, at);
        return;
      case "turn_completed":
      case "turn_failed":
      case "turn_canceled": {
        const turn = this.turn(event.turnId, at);
        turn.endedAt = at;
        for (const row of turn.rows) {
          if (row.kind === "tool" && row.status === "running") {
            row.status = event.type === "turn_completed" ? "ok" : "canceled";
            row.endedAt = at;
            row.measured = true;
          }
        }
        this.setContext(event.usage?.contextWindowUsedTokens, event.usage?.contextWindowMaxTokens);
        return;
      }
      case "usage_updated":
        this.setContext(event.usage?.contextWindowUsedTokens, event.usage?.contextWindowMaxTokens);
        return;
      case "timeline":
        if (!event.item) return;
        if (seq !== undefined) {
          if (seq <= this.maxSeq) return;
          this.maxSeq = seq;
        }
        this.applyItem(event.item, at, event.turnId, true, event.provider);
    }
  }

  /**
   * Applies a provider subagent update. Paseo 0.15 offers plugins these updates but not the list
   * they follow, so a subagent already running when the panel opens appears at its next step.
   */
  applySubagent(update: SubagentUpdateLike): void {
    if (update.kind === "upsert") {
      const { subagent } = update;
      const status = subagent.status === "running" ? "running" : (statusOf(subagent.status) ?? "ok");
      const existing = this.subagents.get(subagent.id);
      const updatedAt = time(subagent.updatedAt);
      const title = oneLine(subagent.description || subagent.title || "Subagent", 60);
      const task = subagent.title && subagent.title !== subagent.description ? subagent.title : (subagent.subtitle ?? null);
      this.subagents.set(subagent.id, {
        steps: existing?.steps ?? [],
        id: subagent.id,
        title,
        task,
        status,
        startedAt: time(subagent.createdAt),
        endedAt: status === "running" ? undefined : updatedAt,
        toolCallId: subagent.toolCallId,
        lastSeen: Math.max(existing?.lastSeen ?? 0, updatedAt),
      });
      return;
    }
    const at = time(update.timestamp);
    const entry: Subagent = this.subagents.get(update.subagentId) ?? {
      id: update.subagentId,
      title: "Subagent",
      task: null,
      status: "running",
      startedAt: at,
      toolCallId: null,
      steps: [],
      lastSeen: at,
    };
    entry.lastSeen = Math.max(entry.lastSeen, at);
    const item = update.item;
    let step: { text: string; tone: "normal" | "err" } | null = null;
    if (item.type === "tool_call") {
      const call = item as ToolCallLike & { callId: string };
      const facts = classify(call);
      const tally = facts.facts[0];
      step = {
        text: [facts.title, call.status === "failed" ? (facts.failure ?? "failed") : tally].filter(Boolean).join(" · "),
        tone: call.status === "failed" ? "err" : "normal",
      };
      const last = entry.steps[entry.steps.length - 1];
      // A call's running and finished updates are one step.
      if (last && last.text.startsWith(facts.title)) entry.steps.pop();
    } else if (item.type === "reasoning") step = { text: "Thinking…", tone: "normal" };
    else if (item.type === "assistant_message") step = { text: "Writing its report…", tone: "normal" };
    if (step) {
      const last = entry.steps[entry.steps.length - 1];
      if (!(last && last.text === step.text)) entry.steps.push({ ...step, at });
      else last.at = at;
      if (entry.steps.length > 3) entry.steps.splice(0, entry.steps.length - 3);
    }
    this.subagents.set(update.subagentId, entry);
  }

  private turn(turnId: string | undefined, at: number): Turn {
    const last = this.turns[this.turns.length - 1];
    if (turnId === undefined) {
      if (last) return last;
    } else {
      for (let i = this.turns.length - 1; i >= 0; i--) if (this.turns[i]!.key === turnId) return this.turns[i]!;
    }
    const turn: Turn = { key: turnId ?? `turn-at-${at}`, startedAt: at, rows: [] };
    this.turns.push(turn);
    return turn;
  }

  private applyItem(item: TimelineItemLike, at: number, turnId: string | undefined, live: boolean, provider?: string): void {
    if (item.type === "tool_call") {
      const call = item as ToolCallLike & { callId: string };
      if (call.name === "task_notification") {
        this.applyNotification(call, at);
        return;
      }
      this.applyTool(call, at, turnId, live, provider);
      return;
    }
    // A message without a turn id opens a turn of its own; anything else joins the latest.
    const turn = item.type === "user_message" && turnId === undefined ? this.turn(`turn-at-${at}`, at) : this.turn(turnId, at);
    const last = turn.rows[turn.rows.length - 1];
    switch (item.type) {
      case "user_message": {
        const text = String((item as { text?: unknown }).text ?? "");
        this.push(turn, {
          kind: "message",
          station: "you",
          title: "New message",
          doing: "Reading your message",
          tool: "",
          facts: text.trim() ? [`“${firstLine(text, 60)}”`] : [],
          status: "ok",
          startedAt: at,
          text,
        });
        return;
      }
      case "assistant_message":
      case "reasoning": {
        const kind: RowKind = item.type === "reasoning" ? "thinking" : "reply";
        const chunk = String((item as { text?: unknown }).text ?? "");
        if (live && last && last.kind === kind) {
          last.text = (last.text ?? "") + chunk;
          if (kind === "reply") last.facts = replyFacts(last.text);
          return;
        }
        this.push(turn, {
          kind,
          station: "model",
          title: kind === "thinking" ? "Thinking" : "Reply",
          doing: kind === "thinking" ? "Thinking" : "Writing the reply",
          tool: "",
          facts: kind === "reply" ? replyFacts(chunk) : [],
          status: "ok",
          startedAt: at,
          text: chunk,
        });
        return;
      }
      case "compaction": {
        const loading = (item as { status?: unknown }).status === "loading";
        if (last && last.kind === "compaction") {
          if (!loading) {
            last.status = "ok";
            last.endedAt = at;
          }
          return;
        }
        this.push(turn, {
          kind: "compaction",
          station: "model",
          title: "Compacting the context",
          doing: "Compacting the context",
          tool: "",
          facts: [],
          status: loading ? "running" : "ok",
          startedAt: at,
        });
        return;
      }
      case "error": {
        const message = String((item as { message?: unknown }).message ?? "");
        this.push(turn, {
          kind: "notice",
          station: "model",
          title: "Error",
          doing: "Error",
          tool: "",
          facts: [firstLine(message, 72)].filter(Boolean),
          status: "err",
          startedAt: at,
          text: message,
        });
        return;
      }
      default:
        return;
    }
  }

  /** A background task's report: it closes the call that started the task. */
  private applyNotification(call: ToolCallLike, at: number): void {
    const meta = call.metadata ?? {};
    const toolUseId = typeof meta.toolUseId === "string" ? meta.toolUseId : undefined;
    const row = toolUseId ? this.byCall.get(toolUseId) : undefined;
    if (!row) return;
    const label = String(call.detail.label ?? call.detail.text ?? "");
    const exit = /exit code (\d+)/i.exec(label)?.[1];
    const status = statusOf(typeof meta.status === "string" ? meta.status : undefined) ?? "ok";
    row.task = {
      ...row.task,
      endedAt: at,
      status: exit !== undefined && exit !== "0" ? "err" : status,
      ...(exit !== undefined ? { exitCode: Number(exit) } : {}),
    };
  }

  private applyTool(call: ToolCallLike & { callId: string }, at: number, turnId: string | undefined, live: boolean, provider?: string): void {
    const facts = classify(call);
    const existing = this.byCall.get(call.callId);
    const own: RowStatus =
      call.status === "running" ? "running" : call.status === "failed" ? "err" : call.status === "canceled" ? "canceled" : "ok";
    // A call that ended well but whose receipt says it failed (a blocked landing, a failed gate) failed.
    const status: RowStatus = own === "ok" && facts.verdict === "err" ? "err" : own;
    const taskId = own === "ok" ? backgroundTaskId(call) : undefined;
    const detail = keep(call.detail) as Record<string, unknown>;
    const error = errorText(call.error) || undefined;
    if (existing) {
      const wasRunning = existing.status === "running";
      // What an earlier update said and this one does not, it no longer says.
      Object.assign(existing, { failure: undefined, exitCode: undefined, verdict: undefined, outcome: undefined, receipt: undefined, ...facts, status, detail, error });
      if (wasRunning && status !== "running" && live) {
        existing.endedAt = at;
        existing.measured = true;
      }
      if (taskId && !existing.task) existing.task = this.taskFor(call, taskId, existing.startedAt);
      return;
    }
    const turn = this.turn(turnId, at);
    const durationMs = typeof call.detail.durationMs === "number" ? call.detail.durationMs : this.remembered.get(call.callId);
    const row = this.push(turn, {
      kind: "tool",
      ...facts,
      callId: call.callId,
      provider,
      status,
      startedAt: at,
      endedAt: durationMs !== undefined ? at + durationMs : undefined,
      detail,
      error,
      ...(taskId ? { task: this.taskFor(call, taskId, at) } : {}),
    });
    this.byCall.set(call.callId, row);
  }

  private taskFor(call: ToolCallLike, taskId: string, startedAt: number): TaskState {
    const lifetime = monitorLifetime(call);
    return { taskId, ...(lifetime !== undefined ? { expiresAt: startedAt + lifetime } : {}) };
  }

  private push(turn: Turn, row: Omit<Row, "key">): Row {
    const full: Row = { key: `r${this.serial++}`, ...row };
    turn.rows.push(full);
    if (row.startedAt < turn.startedAt) turn.startedAt = row.startedAt;
    return full;
  }

  // ---- Reading ------------------------------------------------------------------------------

  /** Where each row stands now: its status, end, and the background work it stands for. */
  private resolve(now: number, agentRunning: boolean) {
    const lastTurn = this.turns[this.turns.length - 1];
    const activeTurn = agentRunning && lastTurn && lastTurn.endedAt === undefined ? lastTurn : undefined;
    const launchedBy = new Map<string, Subagent>();
    for (const work of this.subagents.values()) if (work.toolCallId) launchedBy.set(work.toolCallId, work);

    const resolved: { row: Row; turn: Turn; status: RowStatus; endedAt?: number; background: boolean; subagent?: Subagent }[] = [];
    for (const turn of this.turns) {
      turn.rows.forEach((row, index) => {
        if (row.kind === "tool" || row.kind === "compaction" || row.kind === "notice") {
          const subagent = row.callId ? launchedBy.get(row.callId) : undefined;
          if (subagent && row.status === "ok") {
            resolved.push({ row, turn, status: subagent.status, endedAt: subagent.endedAt, background: subagent.status === "running", subagent });
            return;
          }
          if (row.task && row.status === "ok") {
            const { task } = row;
            if (task.endedAt !== undefined) {
              resolved.push({ row, turn, status: task.status ?? "ok", endedAt: task.endedAt, background: false });
              return;
            }
            const gaveUp = now > (task.expiresAt ?? row.startedAt + TASK_GIVE_UP_MS) + 60_000;
            resolved.push({ row, turn, status: gaveUp ? "ok" : "running", background: !gaveUp });
            return;
          }
          resolved.push({ row, turn, status: row.status, endedAt: row.endedAt, background: false, subagent });
          return;
        }
        const next = turn.rows[index + 1];
        if (row.kind === "message") {
          resolved.push({ row, turn, status: "ok", endedAt: row.startedAt, background: false });
          return;
        }
        const open = turn === activeTurn && next === undefined;
        resolved.push({ row, turn, status: open ? "running" : "ok", endedAt: open ? undefined : (next?.startedAt ?? turn.endedAt), background: false });
      });
    }
    return { resolved, activeTurn, lastTurn };
  }

  view(now: number, agent: AgentFacts): SonarView {
    const agentRunning = agent.status === "running";
    const { resolved, activeTurn, lastTurn } = this.resolve(now, agentRunning);
    const modelFacts = [agent.model ? shortModel(agent.model) : "", agent.thinking ?? ""].filter(Boolean);

    // What a row's line under the title says.
    const metaOf = (entry: (typeof resolved)[number]): { meta: string; tone: RowView["metaTone"] } => {
      const { row, status } = entry;
      if (row.kind === "thinking") return { meta: modelFacts.join(" · "), tone: "normal" };
      if (row.kind !== "tool") return { meta: row.facts.join(" · "), tone: status === "err" ? "err" : "normal" };
      if (row.station === "agents" && row.detail?.type === "sub_agent") {
        return { meta: [...row.facts, entry.background ? "background" : ""].filter(Boolean).join(" · "), tone: status === "err" ? "err" : "normal" };
      }
      if (row.command !== undefined) {
        const exit = row.task?.exitCode ?? row.exitCode;
        // A receipt's word says more than the exit code of the last command in the line.
        const exitText =
          status === "running" ? (entry.background ? "background" : "")
          : status === "err" ? ""
          : row.outcome ? row.outcome
          : row.receipt ? ""
          : exit !== undefined ? `exit ${exit}`
          : status === "ok" && row.provider?.startsWith("claude") && !row.task ? "exit 0"
          : "";
        const facts = status === "err" && row.failure ? [row.failure] : row.facts;
        const tone = status === "err" ? "err" : status === "ok" && row.verdict === "warn" ? "warn" : "normal";
        return { meta: [row.tool, exitText, ...facts].filter(Boolean).join(" · "), tone };
      }
      const facts = status === "err" && row.failure ? [row.failure] : row.facts;
      return { meta: [row.tool, ...(entry.background ? ["background"] : []), ...facts].filter(Boolean).join(" · "), tone: status === "err" ? "err" : "normal" };
    };
    const trailingOf = (row: Row, status: RowStatus, endedAt: number | undefined): string => {
      if (status === "running") return formatDuration(now - row.startedAt);
      if (status === "err") {
        // A receipt's failure behind exit 0 reads by its own word: "blocked", "failed".
        if (row.verdict === "err" && (row.exitCode ?? 0) === 0) return row.outcome ?? "failed";
        const exit = row.task?.exitCode ?? row.exitCode;
        return exit !== undefined ? `exit ${exit}` : "failed";
      }
      if (status === "canceled") return "canceled";
      if (row.kind === "message") return "·";
      return endedAt !== undefined ? formatDuration(endedAt - row.startedAt) : "";
    };
    // Thinking under a second and replies with nothing to quote are noise in a turn.
    const shown = (entry: (typeof resolved)[number]): boolean => {
      const { row, status, endedAt } = entry;
      if (row.kind === "thinking" && status !== "running") return endedAt !== undefined && endedAt - row.startedAt >= SHORT_THINKING_MS;
      if (row.kind === "reply" && status !== "running") return (row.text ?? "").trim() !== "";
      return true;
    };

    const recentTurns = new Set(this.turns.slice(-2));
    const toView = (entry: (typeof resolved)[number], origin: string | null): RowView => {
      const { row, status, endedAt, background, turn } = entry;
      const { meta, tone } = metaOf(entry);
      return {
        key: row.key,
        station: row.station,
        title: row.title,
        meta: origin ? [meta, origin].filter(Boolean).join(" · ") : meta,
        metaTone: tone,
        status,
        live: status === "running",
        trailing: trailingOf(row, status, endedAt),
        startedAt: row.startedAt,
        pinned: status === "running" || (status === "err" && recentTurns.has(turn)),
        background,
      };
    };

    const numbered = !this.hasOlder;
    const labelOf = (turn: Turn, index: number) => {
      const number = numbered ? String(index + 1) : turnNumberFromId(turn.key);
      return number ? `TURN ${number}` : "TURN";
    };
    const turnViews: TurnView[] = [];
    // Background work is drawn at the top of the newest turn, wherever it started.
    const carried: RowView[] = [];
    this.turns.forEach((turn, index) => {
      const own = resolved.filter((entry) => entry.turn === turn && shown(entry));
      const rows: RowView[] = [];
      for (const entry of own) {
        if (entry.background) carried.push(toView(entry, turn !== lastTurn ? `from ${labelOf(turn, index).toLowerCase()}` : null));
        else rows.push(toView(entry, null));
      }
      rows.reverse();
      const active = turn === activeTurn;
      const end = turn.endedAt ?? (active ? undefined : turn.rows[turn.rows.length - 1]?.startedAt);
      turnViews.push({ key: turn.key, label: labelOf(turn, index), startedAt: turn.startedAt, duration: end !== undefined ? end - turn.startedAt : undefined, active, rows });
    });
    turnViews.reverse();
    if (carried.length > 0 && turnViews[0]) turnViews[0].rows.unshift(...carried.reverse());
    const visibleTurns = turnViews.filter((turn) => turn.rows.length > 0);

    const counts = Object.fromEntries(STATIONS.map((id) => [id, 0])) as Record<StationId, number>;
    for (const { row } of resolved) counts[row.station]++;

    const foreground = resolved.filter((entry) => entry.status === "running" && !entry.background);
    // Subagents with no row of their own here, such as one launched before the loaded history.
    const unlinked = [...this.subagents.values()].filter(
      (work) => work.status === "running" && !(work.toolCallId && this.byCall.has(work.toolCallId)),
    );
    const backgroundCount = resolved.filter((entry) => entry.background).length + unlinked.length;

    const liveStations = new Set(resolved.filter((entry) => entry.status === "running").map((entry) => entry.row.station));
    if (unlinked.length > 0) liveStations.add("agents");
    const errorStations = new Set(
      resolved.filter((entry) => entry.status === "err" && entry.turn === lastTurn).map((entry) => entry.row.station),
    );

    // The route: the stations the work went through, model steps only while they run.
    const route: RouteStop[] = [];
    for (const { row, status } of resolved) {
      if (row.station === "model" && status !== "running") continue;
      const state: RouteStop["state"] = status === "running" ? "live" : status === "err" ? "err" : "normal";
      const previous = route[route.length - 1];
      if (previous && previous.station === row.station) {
        if (state !== "normal") previous.state = state;
        continue;
      }
      route.push({ station: row.station, state });
    }
    if (unlinked.length > 0) route.push({ station: "agents", state: "live" });

    const newest = [...foreground].sort((a, b) => b.row.startedAt - a.row.startedAt);
    const lead = newest[0];
    const second = newest[1];
    let headline: Headline;
    if (lead) {
      const facts = lead.row.kind === "thinking" ? modelFacts : lead.row.facts;
      headline = {
        station: lead.row.station,
        title: lead.row.doing,
        sub: [lead.row.station, lead.row.tool, ...facts, formatDuration(now - lead.row.startedAt)].filter(Boolean).join(" · "),
        running: true,
      };
    } else if (agentRunning) {
      headline = { station: "model", title: "Working", sub: modelFacts.join(" · "), running: true };
    } else {
      const finished = turnViews.find((turn) => !turn.active);
      const sub = finished
        ? [
            finished.label.toLowerCase(),
            finished.duration !== undefined ? `took ${formatDuration(finished.duration)}` : "",
            finished.duration !== undefined ? `ended ${formatClock(finished.startedAt + finished.duration, false)}` : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : "";
      headline = { station: "you", title: finished ? "Waiting for you" : "No activity yet", sub, running: false };
    }

    const lastActivity = resolved[resolved.length - 1]?.row.startedAt;
    const clock = activeTurn
      ? `NOW · ${clockDuration(now - activeTurn.startedAt)}`
      : lastActivity !== undefined
        ? `IDLE · ${idleFor(now - (lastTurn?.endedAt ?? lastActivity))}`
        : "IDLE";
    const runningCount = foreground.filter((entry) => entry.row.kind === "tool").length;
    const activity =
      runningCount > 0
        ? `${runningCount} running${backgroundCount > 0 ? ` · ${backgroundCount} in background` : ""}`
        : backgroundCount > 0
          ? `${backgroundCount} in background`
          : agentRunning
            ? "working"
            : null;

    return {
      empty: resolved.length === 0,
      running: agentRunning,
      clock,
      activity,
      runningCount,
      backgroundCount,
      headline,
      parallel: second
        ? {
            station: second.row.station,
            text: newest.length > 2 ? `${second.row.doing} and ${newest.length - 2} more` : `${second.row.doing} in parallel`,
            elapsed: formatDuration(now - second.row.startedAt),
          }
        : null,
      route: route.slice(-9),
      turns: visibleTurns,
      counts,
      scope: this.hasOlder ? "RECENT" : "SESSION",
      liveStations,
      errorStations,
      context: this.context ? { percent: Math.min(100, Math.round((this.context.used / this.context.max) * 100)) } : null,
    };
  }

  /** What the expanded row `key` shows. */
  details(key: string, now: number): DetailView | null {
    let row: Row | undefined;
    for (const turn of this.turns) {
      row = turn.rows.find((candidate) => candidate.key === key);
      if (row) break;
    }
    if (!row) return null;
    if (row.kind !== "tool") return { kind: "text", text: (row.text ?? row.facts.join("\n")).trim() };
    const detail = row.detail ?? {};
    const str = (value: unknown): string => (typeof value === "string" ? value : "");

    if (row.command !== undefined) {
      const cwd = str(detail.cwd);
      const task = row.task;
      if (task) {
        // What a background call returned is only its launch notice; its notice of the end is what says something.
        const failed = task.status === "err";
        const note = task.endedAt !== undefined
          ? `background task ${task.taskId ?? ""} · ended ${formatClock(task.endedAt)}${task.exitCode !== undefined ? ` · exit ${task.exitCode}` : ""}`
          : `background task ${task.taskId ?? ""} · running since ${formatClock(row.startedAt)}${task.expiresAt ? ` · gives up at ${formatClock(task.expiresAt, false)}` : ""}`;
        return { kind: "shell", command: row.command, cwd: cwd ? shortPath(cwd) : null, output: "", failed, note: note.replace("task  ·", "task ·") };
      }
      const failed = row.status === "err";
      // "Tool call failed" says nothing the red row does not; the command's own output may.
      const error = row.error && !/^tool call failed\.?$/i.test(row.error.trim()) ? row.error : "";
      const output = (failed ? error || outputText(detail) : outputText(detail) || error).replace(/\s+$/, "");
      return { kind: "shell", command: row.command, cwd: cwd ? shortPath(cwd) : null, output, failed, note: null };
    }
    if (detail.type === "edit") {
      const diff = str(detail.unifiedDiff);
      return { kind: "diff", lines: diff ? unifiedLines(diff) : diffLines(str(detail.oldString), str(detail.newString)) };
    }
    if (detail.type === "write") {
      return { kind: "diff", lines: splitLines(str(detail.content)).map((text) => ({ sign: "+" as const, text })) };
    }
    if (row.station === "agents" && detail.type === "sub_agent") {
      const subagent = row.callId ? [...this.subagents.values()].find((work) => work.toolCallId === row!.callId) : undefined;
      const actions = Array.isArray(detail.actions) ? (detail.actions as { toolName?: string; summary?: string }[]) : [];
      const steps = subagent?.steps.length
        ? subagent.steps.map((step) => ({ text: step.text, when: ago(now - step.at), tone: step.tone }))
        : actions.slice(-3).map((action) => ({ text: [action.toolName, action.summary].filter(Boolean).join(" "), when: "", tone: "normal" as const }));
      // A task that only repeats the subagent's type, already on the row's line, says nothing.
      const task = subagent?.task && !row.facts.includes(subagent.task) && subagent.task !== row.title ? subagent.task : null;
      return { kind: "agent", task, steps, log: str(detail.log).trim() };
    }
    const fields: { label: string; value: string }[] = [];
    const add = (label: string, value: unknown) => {
      const text = typeof value === "string" ? value : value === undefined || value === null ? "" : JSON.stringify(value, null, 1);
      if (text.trim()) fields.push({ label, value: text.length > 1200 ? `${text.slice(0, 1199)}…` : text });
    };
    add("path", detail.filePath ? shortPath(str(detail.filePath)) : undefined);
    add("url", detail.url);
    add("query", detail.query);
    add("prompt", detail.prompt);
    if (Array.isArray(detail.filePaths)) add("files", (detail.filePaths as string[]).slice(0, 12).map(shortPath).join("\n"));
    if (detail.type === "unknown" || detail.type === "plain_text") add("input", detail.input ?? detail.text);
    const output = row.status === "err" ? row.error || outputText(detail) : outputText(detail) || str(detail.content) || str(detail.result);
    return { kind: "fields", fields, output: output.trim() };
  }
}

/** The number a provider wrote in a turn id: Claude counts from 1, Codex from 0. */
function turnNumberFromId(key: string): string | null {
  const match = /turn-(\d+)$/.exec(key);
  if (!match) return null;
  return String(Number(match[1]) + (key.startsWith("codex-") ? 1 : 0));
}

/** The first line of a reply that says something: no rule, heading marks or list bullets. */
function replyFacts(text: string): string[] {
  const line = text
    .split("\n")
    .map((candidate) => candidate.replace(/^[\s#>*\-+`_]+/, "").trim())
    .find((candidate) => /[\p{L}\p{N}]/u.test(candidate));
  return line ? [oneLine(line, 60)] : [];
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function unifiedLines(diff: string): { sign: "+" | "-" | " " | "@"; text: string }[] {
  return splitLines(diff)
    .filter((line) => !line.startsWith("+++") && !line.startsWith("---") && !line.startsWith("diff ") && !line.startsWith("index "))
    .map((line) => {
      const first = line[0];
      if (first === "@") return { sign: "@" as const, text: line };
      if (first === "+" || first === "-") return { sign: first, text: line.slice(1) };
      return { sign: " " as const, text: line.startsWith(" ") ? line.slice(1) : line };
    });
}

/** A line diff of two texts, with at most two lines of context around each change. */
export function diffLines(before: string, after: string): { sign: "+" | "-" | " " | "@"; text: string }[] {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length * b.length > 250_000) return [...a.map((text) => ({ sign: "-" as const, text })), ...b.map((text) => ({ sign: "+" as const, text }))];
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const ops: { sign: "+" | "-" | " "; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push({ sign: " ", text: a[i]! });
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || table[i]![j + 1]! >= table[i + 1]![j]!)) {
      ops.push({ sign: "+", text: b[j]! });
      j++;
    } else {
      ops.push({ sign: "-", text: a[i]! });
      i++;
    }
  }
  // Keep two lines of context around changes.
  const near = (index: number) => ops.slice(Math.max(0, index - 2), index + 3).some((op) => op.sign !== " ");
  return ops.filter((op, index) => op.sign !== " " || near(index));
}

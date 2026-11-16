// Feeds a SonarModel from one agent's timeline: history first, then the live stream, with the
// events that arrive while the history loads held back and applied after it. Paseo's own lists
// say which background work still runs and which agents this one created.
import { useAgent, usePaseo } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SonarModel,
  type BackgroundItemLike,
  type ChildAgentLike,
  type DetailView,
  type EntryLike,
  type SonarView,
  type StreamEventLike,
  type SubagentUpdateLike,
} from "./model";

/** History pages to read: enough for the counts of a long session without a heavy first load. */
const PAGE = 400;
const MAX_ENTRIES = 3000;
/** Measured durations kept in the tab's state, newest last. */
export const KEPT_DURATIONS = 400;

export interface SonarAgent {
  title: string | null;
  provider: string;
  status: string;
  model: string | null;
  thinking: string | null;
}

export type SonarState =
  | { phase: "loading"; agent: SonarAgent | null }
  | { phase: "error"; agent: SonarAgent | null; message: string; retry(): void }
  | { phase: "ready"; agent: SonarAgent | null; view: SonarView; details(key: string): DetailView | null; stop(itemId: string): Promise<void> };

/** Durations the tab remembers, by call id, and how to save more. */
export interface Durations {
  saved: Readonly<Record<string, number>>;
  save(next: Record<string, number>): void;
}

/** The fields of a listed agent this hook reads. */
interface ListedAgent extends ChildAgentLike {
  parentAgentId?: string | null;
  labels?: Record<string, string> | null;
  archivedAt?: string | null;
}

/** Paseo records the agent that created another in a label of the new agent. */
const PARENT_LABEL = "paseo.parent-agent-id";
const parentOf = (agent: ListedAgent): string | null => agent.parentAgentId ?? agent.labels?.[PARENT_LABEL]?.trim() ?? null;

interface LiveEvent {
  event: { type: string; [key: string]: unknown };
  timestamp?: string;
  seq?: number;
}

export function useSonar(agentId: string, durations: Durations): SonarState {
  const paseo = usePaseo();
  const agent = useAgent(agentId, (snapshot) => ({
    title: snapshot.title,
    provider: snapshot.provider,
    status: snapshot.status,
    model: snapshot.model,
    thinking: snapshot.thinkingOptionId,
  }));
  const model = useMemo(() => {
    const created = new SonarModel();
    created.remember(durations.saved);
    return created;
    // The saved durations are read once, when the model is made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const bump = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let disposed = false;
    let buffer: LiveEvent[] | null = [];
    let generation = 0;
    const handle = paseo.agents.ref(agentId);

    const apply = (live: LiveEvent) => {
      model.applyStream(live.event as unknown as StreamEventLike, live.timestamp ?? Date.now(), live.seq);
    };

    const load = async (mine: number) => {
      const stale = () => disposed || mine !== generation;
      const pages: EntryLike[][] = [];
      let page = await handle.timeline.refetch({ direction: "tail", limit: PAGE, projection: "projected" });
      const maxSeq = page.window.maxSeq;
      pages.unshift(page.entries as unknown as EntryLike[]);
      let total = page.entries.length;
      while (page.hasOlder && page.startCursor && total < MAX_ENTRIES && !stale()) {
        page = await handle.timeline.refetch({ direction: "before", cursor: page.startCursor, limit: PAGE, projection: "projected" });
        pages.unshift(page.entries as unknown as EntryLike[]);
        total += page.entries.length;
      }
      if (stale()) return;
      model.load(pages.flat(), { hasOlder: page.hasOlder, maxSeq });
      const usage = handle.current()?.lastUsage;
      model.setContext(usage?.contextWindowUsedTokens ?? undefined, usage?.contextWindowMaxTokens ?? undefined);
      const held = buffer ?? [];
      buffer = null;
      for (const live of held) apply(live);
      setPhase("ready");
      bump();
    };

    const fail = (message: string) => {
      if (disposed) return;
      setError(message);
      setPhase("error");
    };

    const reload = () => {
      buffer = [];
      const mine = ++generation;
      load(mine).catch((cause: unknown) => {
        if (mine !== generation) return;
        fail(cause instanceof Error ? cause.message : String(cause));
      });
    };

    const unsubscribe = handle.timeline.subscribe((message) => {
      if (disposed) return;
      const event = (message as { event: { type: string } }).event;
      if (event.type === "replacement" || event.type === "subscription_restored") {
        // A new epoch or a reconnect: what was missed is only in the history.
        reload();
        return;
      }
      if (event.type === "error") {
        // The subscription is released after an error: nothing live arrives any more.
        fail(`the live updates stopped (${String((event as { error?: unknown }).error ?? "unknown error")})`);
        return;
      }
      const live = message as unknown as LiveEvent;
      if (buffer) buffer.push(live);
      else {
        apply(live);
        bump();
      }
    });
    unsubscribe.ready.catch((cause: unknown) => fail(cause instanceof Error ? cause.message : String(cause)));

    // Subagents the agent left working, such as Claude's background Agent calls. Without them a
    // finished turn reads as idle while a subagent still works.
    const lifetime = new AbortController();
    const subagents = paseo.observeEvents(["agent.provider_subagents.update"], { signal: lifetime.signal });
    const stopSubagents = subagents.subscribe({
      snapshot() {},
      update(message) {
        if (disposed || message.type !== "agent.provider_subagents.update") return;
        const update = message.payload as unknown as SubagentUpdateLike;
        const parent = update.kind === "upsert" ? update.subagent.parentAgentId : update.parentAgentId;
        if (parent !== agentId) return;
        model.applySubagent(update);
        bump();
      },
      error(cause) {
        console.warn("[paseo-sonar] subagent updates stopped", cause);
      },
    });
    subagents.ready.catch((cause: unknown) => console.warn("[paseo-sonar] could not follow subagents", cause));

    // Shells and monitors still running: Paseo's list, not a guess from the launch notice.
    const stopWork = handle.backgroundWork.subscribe(
      (items) => {
        if (disposed) return;
        model.setBackgroundWork(items as readonly BackgroundItemLike[], Date.now());
        bump();
      },
      { onError: (cause: unknown) => console.warn("[paseo-sonar] could not read background work", cause) },
    );

    // Agents this one created through Paseo, with their live status.
    const follow = (agent: ListedAgent) => {
      if (parentOf(agent) !== agentId) return;
      if (agent.archivedAt) model.removeChildAgent(agent.id);
      else model.setChildAgent(agent);
    };
    paseo.agents
      .list({ subscribe: {}, signal: lifetime.signal })
      .then(({ subscription }) => {
        subscription.subscribe({
          snapshot: ({ entries }) => {
            if (disposed) return;
            for (const { agent } of entries) follow(agent as unknown as ListedAgent);
            bump();
          },
          update: (message) => {
            if (disposed || message.type !== "agent_update") return;
            const update = message.payload;
            if (update.kind === "remove") model.removeChildAgent(update.agentId);
            else follow(update.agent as unknown as ListedAgent);
            bump();
          },
        });
      })
      .catch((cause: unknown) => {
        if (!disposed) console.warn("[paseo-sonar] could not follow this agent's Paseo agents", cause);
      });

    setPhase("loading");
    reload();
    return () => {
      disposed = true;
      unsubscribe();
      stopSubagents();
      stopWork();
      lifetime.abort();
      void subagents.release().catch(() => {});
    };
  }, [agentId, attempt, bump, model, paseo]);

  const view = useMemo(
    () =>
      model.view(now, {
        status: agent?.status ?? "idle",
        model: agent?.model ?? null,
        thinking: agent?.thinking ?? null,
      }),
    // `version` stands for the model's changes, which React cannot see.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, now, version, agent?.status, agent?.model, agent?.thinking],
  );

  // Every second while anything runs, so elapsed times move; at rest only the "idle for" clock
  // moves, and it counts minutes.
  const ticking = view.running || view.runningCount > 0 || view.backgroundCount > 0;
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ticking ? 1000 : 15_000);
    return () => clearInterval(timer);
  }, [ticking]);
  useEffect(() => {
    if (!ticking) setNow(Date.now());
  }, [ticking, version]);

  // Durations measured while the panel watched outlive a reload: the timeline keeps only starts.
  const latest = useRef(durations);
  latest.current = durations;
  useEffect(() => {
    const timer = setTimeout(() => {
      const measured = model.measuredDurations();
      const { saved, save } = latest.current;
      if (Object.entries(measured).every(([callId, ms]) => saved[callId] === ms)) return;
      save({ ...saved, ...measured });
    }, 3000);
    return () => clearTimeout(timer);
  }, [model, version]);

  const details = useCallback((key: string) => model.details(key, now), [model, now]);
  const stop = useCallback(
    async (itemId: string) => {
      const handle = paseo.agents.ref(agentId);
      const item = (await handle.backgroundWork.list()).find((candidate) => candidate.id === itemId);
      if (item) await handle.backgroundWork.stop(item);
    },
    [agentId, paseo],
  );
  const retry = useRef(() => setAttempt((value) => value + 1)).current;
  if (phase === "error") return { phase, agent, message: error, retry };
  if (phase === "loading") return { phase, agent };
  return { phase, agent, view, details, stop };
}

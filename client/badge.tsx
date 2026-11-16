// The line under a workspace's title in the sidebar: what its agent is doing now, a failure seen
// in its current turn, or the work it left in the background. Only a running agent's live stream
// is followed, so idle workspaces cost nothing.
import { useAgents, usePaseo, type PluginWorkspaceRowBadgeItemProps } from "@getpaseo/plugin/client";
import { WorkspaceRowBadge } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { classify, type ToolCallLike } from "./classify";
import { stationSvg, type StationId } from "./stations";

const LABEL_MAX = 28;
const short = (text: string) => (text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text);

interface Step {
  title: string;
  station: StationId;
}

/**
 * The last call that failed in each agent's current turn, kept past the turn's end, when it matters
 * most, until the agent's next turn starts. Shared by every row of this client.
 */
const failures = new Map<string, Step>();

/** The call one running agent is running now, from its live stream only. */
function useLiveStep(agentId: string | null): Step | null {
  const paseo = usePaseo();
  const [step, setStep] = useState<Step | null>(null);
  useEffect(() => {
    setStep(null);
    if (!agentId) return;
    const unsubscribe = paseo.agents.ref(agentId).timeline.subscribe((message) => {
      const event = (message as { event?: { type?: string; item?: { type?: string } } }).event;
      if (!event) return;
      if (event.type === "turn_started") {
        failures.delete(agentId);
        setStep(null);
        return;
      }
      if (event.type !== "timeline" || event.item?.type !== "tool_call") return;
      const call = event.item as unknown as ToolCallLike & { name: string };
      if (call.name === "task_notification") return;
      const facts = classify(call);
      const next = { title: facts.title, station: facts.station };
      if (call.status === "failed" || facts.verdict === "err") failures.set(agentId, next);
      setStep((current) => (call.status === "running" ? next : current?.title === next.title ? null : current));
    });
    unsubscribe.ready.catch(() => {});
    return () => unsubscribe();
  }, [agentId, paseo]);
  return step;
}

export function SonarRowBadge({ workspaceId }: PluginWorkspaceRowBadgeItemProps) {
  const [running] = useAgents({
    where: (agent) => agent.workspaceId === workspaceId && !agent.background && agent.status === "running",
    orderBy: ["lastActivityAt", "desc"],
  });
  const [latest] = useAgents({
    where: (agent) => agent.workspaceId === workspaceId && !agent.background,
    orderBy: ["lastActivityAt", "desc"],
  });
  const background = useAgents({ where: (agent) => agent.workspaceId === workspaceId && agent.backgroundWork.count > 0 });
  const now = useLiveStep(running?.id ?? null);
  const failed = latest ? failures.get(latest.id) : undefined;

  // While the agent works, what it does now (a failure mid-turn is often retried); once it stops, the turn's failure.
  if (running && now) {
    return <WorkspaceRowBadge icon={{ svg: stationSvg(now.station) }} label={short(now.title)} tone="info" accessibilityLabel={`Now: ${now.title}`} />;
  }
  if (failed && !running) {
    return <WorkspaceRowBadge icon={{ svg: stationSvg(failed.station) }} label={short(failed.title)} tone="danger" accessibilityLabel={`Failed: ${failed.title}`} />;
  }
  if (background.length > 0) {
    return <WorkspaceRowBadge icon={{ svg: stationSvg("shell") }} label="background" tone="muted" accessibilityLabel="Work left running in the background" />;
  }
  return null;
}

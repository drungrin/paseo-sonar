// Which agent the Sonar panel follows. Paseo tells a plugin which composer has focus but not whose
// it is, so each agent's composer writes a key of Sonar's own into the agent's metadata, and the
// panel finds the focused agent by that key.
import { useAgent, useAgents, useComposers, type PluginComposer } from "@getpaseo/plugin/client";
import { useEffect, useRef } from "react";

/** The metadata entry Sonar keeps on each agent: `{ "paseo-sonar": { "key": "…" } }`. */
export const METADATA = "paseo-sonar";

/** Sonar's key in an agent's metadata, or null. */
export function sonarKey(metadata: Readonly<Record<string, unknown>> | undefined): string | null {
  const entry = metadata?.[METADATA];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const key = (entry as Record<string, unknown>).key;
  return typeof key === "string" && key ? key : null;
}

/** A key no other agent has; it only has to tell agents apart, not be secret. */
export function newKey(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Gives a running agent's composer Sonar's key once, so the panel can tell whose composer has focus. */
export function useKeyedComposer(composer: PluginComposer): string | null {
  const key = sonarKey(composer.agent.metadata);
  const isAgent = composer.context === "agent";
  // One write at a time: a render before the metadata comes back must not write a second key.
  const writing = useRef(false);
  useEffect(() => {
    if (!isAgent || key || writing.current) return;
    writing.current = true;
    composer
      .setMetadata({ [METADATA]: { key: newKey() } })
      .catch((cause: unknown) => console.warn("[paseo-sonar] could not mark this agent for Sonar", cause))
      .finally(() => {
        writing.current = false;
      });
  }, [composer, isAgent, key]);
  return isAgent ? key : null;
}

/** The agent with this key and its workspace, or null. */
export function useAgentByKey(key: string | null): { id: string; workspaceId: string } | null {
  const [ref] = useAgents({ where: (agent) => key !== null && sonarKey(agent.metadata) === key });
  const workspaceId = useAgent(ref?.id ?? "", (agent) => agent.workspaceId);
  return ref && workspaceId ? { id: ref.id, workspaceId } : null;
}

/**
 * The agent a workspace's Sonar panel follows: the focused agent when it belongs to this workspace,
 * else the one it followed last while it still exists, else the workspace's latest active agent.
 */
export function useFollowedAgent(workspaceId: string, last: string | null): string | null {
  const [focused] = useComposers({ focused: true });
  const key = focused ? sonarKey(focused.agent.metadata) : null;
  const [focusedHere] = useAgents({
    where: (agent) => key !== null && agent.workspaceId === workspaceId && sonarKey(agent.metadata) === key,
  });
  const [lastHere] = useAgents({ where: (agent) => last !== null && agent.id === last && agent.workspaceId === workspaceId });
  const [latest] = useAgents({
    where: (agent) => agent.workspaceId === workspaceId && !agent.background && agent.status !== "closed",
    orderBy: ["lastActivityAt", "desc"],
  });
  return focusedHere?.id ?? lastHere?.id ?? latest?.id ?? null;
}

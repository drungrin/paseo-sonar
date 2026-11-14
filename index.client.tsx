import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { SonarPanel } from "./client/panel";
import { SONAR_SVG } from "./client/stations";

const PANEL = "sonar";
const ICON = { svg: SONAR_SVG };

export default function contribute(client: PluginClientContext) {
  client.addAgentPanel({ id: PANEL, title: "Sonar", icon: ICON, locations: ["explorer", "workspace"], Component: SonarPanel });

  client.addCommandCenterItem({
    id: "open-sonar",
    title: "Open Sonar",
    icon: ICON,
    keywords: ["activity", "trace", "timeline", "steps", "tools"],
    context: "agent",
    onSelect({ openPanel }) {
      openPanel(PANEL, { location: "explorer" });
    },
  });

  client.addSlashCommand({
    name: "sonar",
    description: "Open this agent's Sonar beside the chat",
    argumentHint: "",
    context: "agent",
    onSubmit({ openPanel }) {
      openPanel(PANEL, { location: "explorer" });
    },
  });

  // A pill in each agent's composer opens that agent's Sonar. Paseo 0.15 tells a plugin nothing
  // about which tab has focus, so each agent gets its own panel.
  const pills = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();
  let stopped = false;
  const register = (agent: { id: string; workspaceId?: string | null; archivedAt?: string | null }) => {
    if (stopped) return;
    pills.get(agent.id)?.remove();
    pills.delete(agent.id);
    if (!agent.workspaceId || agent.archivedAt) return;
    const workspaceId = agent.workspaceId;
    const agentId = agent.id;
    pills.set(
      agentId,
      client.addComposerPill({
        id: "sonar",
        workspaceId,
        agentId,
        button: {
          title: "Open Sonar beside the chat",
          label: "Sonar",
          icon: ICON,
          behavior: {
            kind: "action",
            onPress() {
              client.openPanel(PANEL, { workspaceId, agentId, location: "explorer" });
            },
          },
        },
      }),
    );
  };
  const forget = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };

  client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          for (const pill of pills.values()) pill.remove();
          pills.clear();
          for (const { agent } of entries) register(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") forget(update.agentId);
          else register(update.agent);
        },
      });
    })
    .catch((error: unknown) => {
      if (!stopped) console.error("[paseo-sonar] could not follow the agent list", error);
    });

  return () => {
    stopped = true;
    lifetime.abort();
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };
}

import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SonarRowBadge } from "./client/badge";
import { makeComposerItem } from "./client/composer-item";
import { SonarPanel } from "./client/panel";
import { SONAR_SVG } from "./client/stations";

const PANEL = "sonar";
const ICON = { svg: SONAR_SVG };

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    // One Sonar per workspace, in the Explorer beside the chat; it follows the agent in focus.
    client.addWorkspacePanel({ id: PANEL, title: "Sonar", icon: ICON, locations: ["explorer", "workspace"], Component: SonarPanel }),

    client.addComposerItem({
      id: "sonar",
      Component: makeComposerItem((workspaceId) => client.openPanel(PANEL, { workspaceId, location: "explorer" })),
    }),

    client.addCommandCenterItem({
      id: "open-sonar",
      title: "Open Sonar",
      icon: ICON,
      keywords: ["activity", "trace", "timeline", "steps", "tools"],
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel(PANEL, { location: "explorer" });
      },
    }),

    client.addSlashCommand({
      name: "sonar",
      description: "Open Sonar beside the chat",
      argumentHint: "",
      context: "agent",
      onSubmit({ openPanel }) {
        openPanel(PANEL, { location: "explorer" });
      },
    }),

    client.addWorkspaceRowBadgeItem({ id: "sonar", title: "Sonar activity", icon: ICON, Component: SonarRowBadge }),
  ];

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

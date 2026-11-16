// Sonar's control in each agent's composer. It opens the workspace's Sonar beside the chat, and it
// is what gives each agent Sonar's key, so the panel can tell whose composer has focus.
import { useComposer } from "@getpaseo/plugin/client";
import { Action } from "@getpaseo/plugin/client/ui";
import { useAgentByKey, useKeyedComposer } from "./focus";
import { SONAR_SVG } from "./stations";

/** The composer item, with the way to open the panel in a workspace. */
export function makeComposerItem(open: (workspaceId: string) => void) {
  return function SonarComposerItem() {
    const composer = useComposer();
    const key = useKeyedComposer(composer);
    const agent = useAgentByKey(key);
    if (composer.context !== "agent") return null;
    return (
      <Action
        title="Open Sonar beside the chat"
        icon={{ svg: SONAR_SVG }}
        disabled={!agent}
        onPress={() => {
          if (agent) open(agent.workspaceId);
        }}
      />
    );
  };
}

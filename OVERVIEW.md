Sonar docks a live trace of an agent's work beside the chat. Each tool call, message and reply becomes a row on the station it belongs to (You, Model, Memory, Files, Shell, Network, Browser, Agents, Skills), so you see where the work goes and what runs right now without reading the transcript. One Sonar per workspace follows the agent in focus, and the sidebar says what each workspace's agent is doing.

## What it shows

- **Now**: how long the turn has run, what runs right now as a headline, a second call in parallel, what still runs in the background, and the context window in use.
- **Background work**: background commands, monitors and background agents stay live while Paseo lists them as running, and their notice of the end gives their real length and exit code. Open one to stop it.
- **Paseo agents**: agents this one started through Paseo, on the row of the call that started them, with their live status and a link to open them.
- **Route**: the last nine stations the work went through, old to new, the live one lit and a failed one red.
- **Turns**: the newest turn whole and earlier ones folded; commands named by what they do (`dispatch_driver.py finish T002`), with `python3 · exit 0` and their time. Open a row for the full command, its output, an edit's diff or a subagent's last steps.
- **In the sidebar**: under each workspace's title, what its agent runs now, the call that failed in its last turn, or `background`.
- **Counts**: rows per station in the session.
- **GSD Path**: helper calls read by what they do (`Land T004`, `Transition plan → build`), with their outcome taken from the helper's receipt rather than the exit code (a blocked landing or a failed handoff check turns red), and subagents shown by their task (`Build T003 · builder`).

It reads Paseo's own timeline, so it works with Claude, Codex and every other provider Paseo runs.

## Open it

Press the Sonar control in an agent's composer, type `/sonar`, or choose **Open Sonar** in the Command Center. It opens in the Explorer and follows the agent in focus in that workspace.

## Data

Sonar reads the agent's timeline, its state, its background work, its subagents' updates and the agent list through the connection the Paseo app already has to the daemon. It makes no network requests of its own, runs no commands, reads no files and has no daemon-side code. It keeps the length of the tool calls it watched and the agent it followed last in the Sonar tab's state, and writes one random key into each agent's metadata (`paseo-sonar`) so the panel can tell which agent's composer has focus. It stops a background task only when you press Stop.

## Limits

A tool call's duration is shown when Sonar watched it run; calls that ran while no Sonar tab was open show none. Paseo does not give plugins the list of provider subagents already running, so a background subagent started before the panel opened shows its steps from its next one on. The sidebar line sees a failure only when the app watched it happen. Claude Code hooks do not reach Paseo's timeline.

Requires Paseo 0.16 or later.

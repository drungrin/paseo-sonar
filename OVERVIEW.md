Sonar docks a live trace of an agent's work beside the chat. Each tool call, message and reply becomes a row on the station it belongs to (You, Model, Memory, Files, Shell, Network, Browser, Agents, Skills), so you see where the work goes and what runs right now without reading the transcript.

## What it shows

- **Now**: how long the turn has run, what runs right now as a headline, a second call in parallel, what still runs in the background, and the context window in use.
- **Background work**: background commands, monitors and background agents stay live until their notice of the end, which closes them with their real length and exit code.
- **Route**: the last nine stations the work went through, old to new, the live one lit and a failed one red.
- **Turns**: the newest turn whole and earlier ones folded; commands named by what they do (`dispatch_driver.py finish T002`), with `python3 · exit 0` and their time. Open a row for the full command, its output, an edit's diff or a subagent's last steps.
- **Counts**: rows per station in the session.
- **GSD Path**: helper calls read by what they do (`Land T004`, `Transition plan → build`), with their outcome taken from the helper's receipt rather than the exit code (a blocked landing or a failed handoff check turns red), and subagents shown by their task (`Build T003 · builder`).

It reads Paseo's own timeline, so it works with Claude, Codex and every other provider Paseo runs.

## Open it

Press **Sonar** above an agent's composer, type `/sonar`, or choose **Open Sonar** in the Command Center. It opens in the Explorer and follows the agent it was opened from; each agent has its own tab.

## Data

Sonar reads the agent's timeline, its state and its subagents' updates through the connection the Paseo app already has to the daemon. It makes no network requests of its own, runs no commands, reads no files and has no daemon-side code. The only thing it keeps is the length of the tool calls it watched, saved in the Sonar tab's state so they survive a reload.

## Limits

Paseo 0.15 does not tell plugins which agent tab has focus, so a Sonar panel stays with its agent and does not open by itself. A tool call's duration is shown when Sonar watched it run; calls that ran while no Sonar tab was open show none. Paseo 0.15 does not give plugins the list of subagents already running, so a background subagent started before the panel opened shows its steps from its next one on. Claude Code hooks do not reach Paseo's timeline.

Requires Paseo 0.15 or later.

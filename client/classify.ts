// Which station a tool call belongs to and how to name it. Shell command lines are read in ./shell.
import { gsdAgent, gsdCalls, gsdTitle, primaryCall, readOutcome } from "./gsd";
import { isMemoryPath, shellStation, shellTitle, shellVerb } from "./shell";
import type { StationId } from "./stations";

/** The fields of a Paseo `tool_call` timeline item this module reads. */
export interface ToolCallLike {
  name: string;
  status: "running" | "completed" | "failed" | "canceled";
  detail: { type: string; [key: string]: unknown };
  error?: unknown;
  metadata?: Record<string, unknown>;
}

export interface Classified {
  station: StationId;
  /** The row's title: "Edit vitest.config.ts". */
  title: string;
  /** The headline while it runs: "Editing vitest.config.ts". */
  doing: string;
  /** The tool's own name, shown beside the facts. */
  tool: string;
  /** Short facts: "+18 −4", "200 · 48 KB". */
  facts: string[];
  /** What the failure says, first line only, when the call failed. */
  failure?: string;
  /** The exit code the command reported, when there is one. */
  exitCode?: number;
  /** The whole command line of a shell call, for its expanded row. */
  command?: string;
  /** What a receipt in the output makes of a call that otherwise looks fine. */
  verdict?: "err" | "warn";
  /** The receipt's word for how it went ("landed", "blocked"), shown in place of the exit code. */
  outcome?: string;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const slashes = (path: string): string => path.replace(/\\/g, "/");

export function baseName(path: string): string {
  return slashes(path).split("/").filter(Boolean).pop() ?? path;
}

/** The last two parts of a path: `src/vitest.config.ts`. */
export function lastTwo(path: string): string {
  return slashes(path).split("/").filter(Boolean).slice(-2).join("/");
}

/** Characters a single line must not carry: controls, and marks that flip the direction of text. */
function isHidden(code: number): boolean {
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  return code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

/** Text fit for one line: hidden characters become spaces, spaces fold, and a long line ends in `…`. */
export function oneLine(text: string, max = 120): string {
  let line = "";
  for (const char of text) {
    const next = isHidden(char.codePointAt(0) ?? 0) ? " " : char;
    if (next === " " && line.endsWith(" ")) continue;
    line += next;
  }
  line = line.trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function firstLine(text: string, max = 80): string {
  return oneLine(text.split("\n").find((line) => line.trim() !== "") ?? "", max);
}

/** Host and path of a URL without login, query or fragment: `vitest.dev/config`. */
export function shortUrl(url: string): string {
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/?#]*@)?([^/?#]+)([^?#]*)/i.exec(url.trim());
  if (!match) return oneLine(url, 60);
  const path = (match[2] ?? "").replace(/\/+$/, "");
  return oneLine(`${match[1]}${path}`, 60);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function textBytes(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

const splitLines = (text: string): string[] => {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
};

/** Lines added and removed between two texts, by their longest common run of lines. */
export function lineDiff(before: string, after: string): { added: number; removed: number } {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length * b.length > 250_000) return { added: b.length, removed: a.length };
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1] === b[j - 1] ? (previous[j - 1] ?? 0) + 1 : Math.max(previous[j] ?? 0, row[j - 1] ?? 0);
    }
    previous = row;
  }
  const common = previous[b.length] ?? 0;
  return { added: b.length - common, removed: a.length - common };
}

/** Lines added and removed in a unified diff. */
export function unifiedDiffStat(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

const diffFacts = ({ added, removed }: { added: number; removed: number }): string[] =>
  added === 0 && removed === 0 ? [] : [`+${added} −${removed}`];

// ---- Failures ---------------------------------------------------------------------------------

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "content", "output", "text"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return "";
}

/** "2 failing", "3 failed": what a test runner says went wrong, when it says it. */
function testFailures(output: string): string | undefined {
  const match = /(\d+)\s+(failing|failed|failures?|errors?)\b/i.exec(output);
  return match ? `${match[1]} ${match[2]!.toLowerCase()}` : undefined;
}

/** "1 failed, 41 passed", "12 passed": a test runner's tally, read from its last lines. */
export function testSummary(output: string): string | undefined {
  const tail = output.split("\n").slice(-40).join("\n");
  const passed = /(\d+)\s+passed\b/i.exec(tail)?.[1];
  const failed = /(\d+)\s+(?:failed|failing)\b/i.exec(tail)?.[1];
  if (!passed && !failed) return undefined;
  return [failed && failed !== "0" ? `${failed} failed` : "", passed ? `${passed} passed` : ""].filter(Boolean).join(", ") || undefined;
}

/** The output text of a call, wherever the provider put it. */
export function outputText(detail: { [key: string]: unknown }): string {
  const output = detail.output;
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const inner = (output as Record<string, unknown>).output;
    if (typeof inner === "string") return inner;
  }
  return "";
}

/** The id of the task a call left running in the background, from what the call returned. */
export function backgroundTaskId(call: ToolCallLike): string | undefined {
  const text = outputText(call.detail);
  return (
    /running in background with ID:\s*([\w-]+)/i.exec(text)?.[1] ??
    /Monitor started \(task ([\w-]+)/.exec(text)?.[1] ??
    /launched in (?:the )?background[^\n]*?\b(?:id|ID|agentId)[:=\s]+([\w-]+)/.exec(text)?.[1]
  );
}

/** When a monitor gives up by itself, in ms after it started. */
export function monitorLifetime(call: ToolCallLike): number | undefined {
  const match = /expires in (\d+)\s*(s|m|h)\b/.exec(outputText(call.detail));
  if (match) return Number(match[1]) * (match[2] === "h" ? 3_600_000 : match[2] === "m" ? 60_000 : 1000);
  const input = call.detail.input as Record<string, unknown> | undefined;
  return typeof input?.timeout_ms === "number" ? input.timeout_ms : undefined;
}

export { errorText };

// ---- MCP tools --------------------------------------------------------------------------------

const BROWSER_SERVERS = /^(?:playwright|puppeteer|chrome-devtools|claude-in-chrome|claude_browser|browser.*|.*-browser)$/i;

function mcpParts(name: string): { server: string; tool: string } | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  return match ? { server: match[1]!, tool: match[2]! } : null;
}

const words = (name: string): string => name.replace(/_+/g, " ").trim();

// ---- Classification ---------------------------------------------------------------------------

export function classify(call: ToolCallLike): Classified {
  const result = classifyDetail(call);
  if (call.status === "failed") {
    const detail = call.detail;
    // "Tool call failed" says nothing the red row does not; the output may say more.
    const said = errorText(call.error);
    const text = (/^tool call failed\.?$/i.test(said.trim()) ? "" : said) || outputText(detail);
    const exit = num(detail.exitCode) ?? numberFrom(/exit(?:ed with)?(?: code)?[:\s]+(\d+)/i.exec(text));
    const tests = testFailures(`${str(detail.output)}\n${text}`);
    result.failure = tests ?? (firstLine(text, 72) || undefined);
    if (exit !== undefined) result.exitCode = exit;
  }
  return result;
}

const numberFrom = (match: RegExpExecArray | null): number | undefined =>
  match ? Number(match[1]) : undefined;

function classifyDetail(call: ToolCallLike): Classified {
  const { detail, name } = call;
  const tool = name || detail.type;
  switch (detail.type) {
    case "read": {
      const path = str(detail.filePath);
      const content = str(detail.content);
      return {
        station: isMemoryPath(path) ? "memory" : "files",
        title: `Read ${baseName(path) || "a file"}`,
        doing: `Reading ${baseName(path) || "a file"}`,
        tool,
        facts: content ? [formatBytes(textBytes(content))] : [],
      };
    }
    case "edit": {
      const path = str(detail.filePath);
      const diff = str(detail.unifiedDiff);
      const stat = diff
        ? unifiedDiffStat(diff)
        : detail.oldString !== undefined || detail.newString !== undefined
          ? lineDiff(str(detail.oldString), str(detail.newString))
          : { added: 0, removed: 0 };
      return {
        station: isMemoryPath(path) ? "memory" : "files",
        title: `Edit ${baseName(path) || "a file"}`,
        doing: `Editing ${baseName(path) || "a file"}`,
        tool,
        facts: diffFacts(stat),
      };
    }
    case "write": {
      const path = str(detail.filePath);
      const content = str(detail.content);
      return {
        station: isMemoryPath(path) ? "memory" : "files",
        title: `Write ${baseName(path) || "a file"}`,
        doing: `Writing ${baseName(path) || "a file"}`,
        tool,
        facts: content ? diffFacts({ added: splitLines(content).length, removed: 0 }) : [],
      };
    }
    case "search": {
      const query = oneLine(str(detail.query), 48);
      const web = detail.toolName === "web_search" || /web.?search/i.test(name);
      const facts: string[] = [];
      const files = num(detail.numFiles);
      const matches = num(detail.numMatches);
      if (matches !== undefined) facts.push(`${matches} ${matches === 1 ? "match" : "matches"}`);
      else if (files !== undefined) facts.push(`${files} ${files === 1 ? "file" : "files"}`);
      else if (Array.isArray(detail.webResults)) facts.push(`${detail.webResults.length} results`);
      return {
        station: web ? "network" : "files",
        title: web ? `Search the web “${query}”` : `Search “${query}”`,
        doing: web ? "Searching the web" : `Searching for “${query}”`,
        tool,
        facts,
      };
    }
    case "fetch": {
      const url = shortUrl(str(detail.url));
      const facts: string[] = [];
      const code = num(detail.code);
      const bytes = num(detail.bytes);
      if (code !== undefined) facts.push(String(code));
      if (bytes !== undefined) facts.push(formatBytes(bytes));
      return { station: "network", title: `Fetch ${url}`, doing: `Fetching ${url}`, tool, facts };
    }
    case "shell": {
      const command = str(detail.command);
      const output = str(detail.output);
      const exit = num(detail.exitCode) ?? (typeof detail.exitCode === "string" && /^\d+$/.test(detail.exitCode) ? Number(detail.exitCode) : undefined);
      const helper = primaryCall(gsdCalls(command));
      if (helper) {
        const title = gsdTitle(helper);
        const read = call.status === "running" ? null : readOutcome(outputText(detail), helper);
        return {
          station: shellStation(command),
          title,
          doing: `GSD Path: ${title}`,
          tool: "gsd-path",
          facts: read?.facts ?? [],
          command,
          ...(exit !== undefined ? { exitCode: exit } : {}),
          ...(read?.verdict ? { verdict: read.verdict } : {}),
          ...(read?.word || read?.verdict ? { outcome: read.word ?? (read.verdict === "err" ? "failed" : "attention") } : {}),
          ...(read?.failure ? { failure: read.failure } : {}),
        };
      }
      const { title, family } = shellTitle(command);
      const tally = call.status === "running" ? undefined : testSummary(output);
      return {
        station: shellStation(command),
        title: title || "Shell command",
        doing: `Running ${shellVerb(command)}`,
        tool: family,
        facts: tally ? [tally] : [],
        command,
        ...(exit !== undefined ? { exitCode: exit } : {}),
      };
    }
    case "sub_agent": {
      const description = oneLine(str(detail.description), 60);
      const kind = str(detail.subAgentType);
      const actions = Array.isArray(detail.actions) ? detail.actions.length : 0;
      const gsd = gsdAgent(description);
      const title = gsd?.title ?? (description ? `Agent: ${description}` : "Subagent");
      return {
        station: "agents",
        title,
        doing: gsd ? `Delegating: ${gsd.title}` : description ? `Delegating: ${description}` : "Delegating to a subagent",
        tool,
        facts: [...(gsd?.facts ?? []), kind, actions ? `${actions} ${actions === 1 ? "action" : "actions"}` : ""].filter(Boolean),
      };
    }
    case "plan":
      return { station: "you", title: "Plan for you", doing: "Proposing a plan", tool, facts: [] };
    case "worktree_setup":
      return { station: "shell", title: "Set up the worktree", doing: "Setting up the worktree", tool, facts: [] };
    case "plain_text": {
      const label = oneLine(str(detail.label) || str(detail.text) || words(name), 80);
      return { ...byName(call), title: label || words(name), tool };
    }
    default:
      return byName(call);
  }
}

/** Tools known by name, as station, title and headline; `input` is the call's raw input. */
type Naming = (input: Record<string, unknown>, name: string) => [StationId, string, string];
const agentTitle = (input: Record<string, unknown>) => {
  const description = oneLine(str(input.description), 60);
  return gsdAgent(description)?.title ?? (description ? `Agent: ${description}` : "Subagent");
};
const BY_NAME: Record<string, Naming> = {
  Skill: (input) => ["skills", `Skill ${str(input.skill) || str(input.command)}`.trim(), "Loading a skill"],
  ToolSearch: () => ["skills", "Load tools", "Loading tools"],
  Agent: (input) => ["agents", agentTitle(input), "Delegating to a subagent"],
  Task: (input) => ["agents", agentTitle(input), "Delegating to a subagent"],
  AskUserQuestion: () => ["you", "Question for you", "Asking you"],
  request_user_input: () => ["you", "Question for you", "Asking you"],
  EnterPlanMode: () => ["you", "Plan for you", "Proposing a plan"],
  ExitPlanMode: () => ["you", "Plan for you", "Proposing a plan"],
  plan_approval: () => ["you", "Plan for you", "Proposing a plan"],
  WebSearch: (input) => ["network", `Search the web${str(input.query) ? ` “${oneLine(str(input.query), 48)}”` : ""}`, "Searching the web"],
  web_search: (input) => ["network", `Search the web${str(input.query) ? ` “${oneLine(str(input.query), 48)}”` : ""}`, "Searching the web"],
  WebFetch: (input) => ["network", `Fetch ${shortUrl(str(input.url))}`, "Fetching a page"],
  web_fetch: (input) => ["network", `Fetch ${shortUrl(str(input.url))}`, "Fetching a page"],
};
/** The task list and plan tools all read as the task list. */
for (const name of ["TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "update_plan"]) {
  BY_NAME[name] = () => ["you", "Task list", "Updating the task list"];
}
/** Tools that steer other agents or schedule later work. */
for (const name of ["Workflow", "SendMessage", "TaskStop", "TaskOutput", "CronCreate", "CronDelete", "CronList", "ScheduleWakeup"]) {
  BY_NAME[name] = (_input, toolName) => ["agents", words(toolName), words(toolName)];
}

/** A tool known only by its name and raw input: Skill, ToolSearch, MCP tools and the like. */
function byName(call: ToolCallLike): Classified {
  const name = call.name;
  const input = (call.detail.input ?? {}) as Record<string, unknown>;
  const same = (title: string, station: StationId, doing = title): Classified => ({ station, title, doing, tool: name, facts: [] });
  if (name === "Monitor") {
    const command = str(input.command);
    const description = oneLine(str(input.description), 60);
    const title = description || shellTitle(command).title || "Monitor";
    return { station: "shell", title, doing: `Watching: ${title}`, tool: "monitor", facts: [], command };
  }
  const naming = BY_NAME[name];
  if (naming) {
    const [station, title, doing] = naming(input, name);
    return same(title, station, doing);
  }
  const mcp = mcpParts(name);
  if (mcp) {
    const tool = words(mcp.tool);
    if ((mcp.server === "paseo" && mcp.tool.startsWith("browser_")) || BROWSER_SERVERS.test(mcp.server)) {
      const url = str(input.url);
      return same(url ? `${tool} ${shortUrl(url)}` : tool, "browser", `Browser: ${tool}`);
    }
    if (/memory/i.test(mcp.server) || /^memory/i.test(mcp.tool)) {
      return same(`${mcp.server}: ${tool}`, "memory", `Memory: ${tool}`);
    }
    if (mcp.server === "terminal") return same(tool, "shell");
    return same(`${mcp.server}: ${tool}`, "network", `${mcp.server}: ${tool}`);
  }
  return same(words(name) || "Tool call", "shell", words(name) || "Working");
}

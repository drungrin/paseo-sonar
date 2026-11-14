// Shell command lines, read once into commands and used two ways: what a row calls the command
// (`python3 -B ~/…/dispatch_driver.py finish T002` reads `dispatch_driver.py finish T002`) and
// which station it belongs to (Files, Network, Memory or Shell).
import type { StationId } from "./stations";

// ---- Reading a line ---------------------------------------------------------------------------

interface Word {
  /** The word without its quotes: `"a b"` reads `a b`. */
  text: string;
  /** The word as written, quotes included. */
  raw: string;
}

/** One simple command of a line, and the commands written inside it as `$(…)` or backticks. */
export interface Command {
  words: Word[];
  inner: string[];
}

const OPERATORS = ["&&", "||", ";", "|", "&", "\n"];

/**
 * The simple commands of a line, in order. Quotes keep their contents in one word; operators
 * outside quotes end a command; `$(…)` and backtick bodies are kept for a second reading.
 */
export function readCommands(line: string): Command[] {
  const commands: Command[] = [];
  let words: Word[] = [];
  let inner: string[] = [];
  let text = "";
  let raw = "";
  let inWord = false;
  const endWord = () => {
    if (inWord) words.push({ text, raw });
    text = "";
    raw = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0 || inner.length > 0) commands.push({ words, inner });
    words = [];
    inner = [];
  };

  let i = 0;
  while (i < line.length) {
    const char = line[i]!;
    if (char === "'" || char === '"') {
      const close = findClosingQuote(line, i);
      const body = line.slice(i + 1, close);
      if (char === '"') inner.push(...substitutions(body));
      text += char === '"' ? body.replace(/\\(["\\$`])/g, "$1") : body;
      raw += line.slice(i, close + 1);
      inWord = true;
      i = close + 1;
      continue;
    }
    if (char === "$" && line[i + 1] === "(") {
      const close = findClosingParen(line, i + 1);
      inner.push(line.slice(i + 2, close));
      raw += line.slice(i, close + 1);
      text += line.slice(i, close + 1);
      inWord = true;
      i = close + 1;
      continue;
    }
    if (char === "`") {
      const close = line.indexOf("`", i + 1);
      const end = close < 0 ? line.length : close;
      inner.push(line.slice(i + 1, end));
      raw += line.slice(i, end + 1);
      text += line.slice(i, end + 1);
      inWord = true;
      i = end + 1;
      continue;
    }
    if (char === "\\" && i + 1 < line.length) {
      text += line[i + 1];
      raw += line.slice(i, i + 2);
      inWord = true;
      i += 2;
      continue;
    }
    // `&` in a redirection such as `2>&1` or `&>file` belongs to the word.
    const redirect = char === "&" && (line[i - 1] === ">" || line[i - 1] === "<" || line[i + 1] === ">");
    const operator = redirect ? undefined : OPERATORS.find((candidate) => line.startsWith(candidate, i));
    if (operator) {
      endCommand();
      i += operator.length;
      continue;
    }
    if (char === " " || char === "\t") {
      endWord();
      i++;
      continue;
    }
    text += char;
    raw += char;
    inWord = true;
    i++;
  }
  endCommand();
  return commands;
}

function findClosingQuote(line: string, open: number): number {
  const quote = line[open];
  for (let i = open + 1; i < line.length; i++) {
    if (quote === '"' && line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === quote) return i;
  }
  return line.length;
}

function findClosingParen(line: string, open: number): number {
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    if (line[i] === "(") depth++;
    else if (line[i] === ")" && --depth === 0) return i;
  }
  return line.length;
}

/** `$(…)` and backtick bodies inside a double-quoted string. */
function substitutions(body: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "$" && body[i + 1] === "(") {
      const close = findClosingParen(body, i + 1);
      found.push(body.slice(i + 2, close));
      i = close;
    } else if (body[i] === "`") {
      const close = body.indexOf("`", i + 1);
      found.push(body.slice(i + 1, close < 0 ? body.length : close));
      i = close < 0 ? body.length : close;
    }
  }
  return found;
}

// ---- The program a command runs ---------------------------------------------------------------

/**
 * Programs that start another program: the one they start is what the command does. `values`
 * names the options followed by a value; `positional` counts the words of their own after them.
 */
const LAUNCHERS: Record<string, { values?: string; positional?: number }> = {
  sudo: { values: "-u -g -p -h -C -D -R -T -U -r -t --user --group --chdir" },
  doas: { values: "-u -C" },
  env: { values: "-u -C -S --unset --chdir" },
  nice: { values: "-n --adjustment" },
  ionice: { values: "-c -n -p" },
  nohup: {},
  time: {},
  timeout: { values: "-s -k --signal --kill-after", positional: 1 },
  stdbuf: { values: "-i -o -e" },
  chrt: { positional: 1 },
  taskset: { positional: 1 },
  exec: { values: "-a" },
  command: {},
  xargs: { values: "-n -I -P -L -d -E -s -a --max-args --max-procs --delimiter" },
};

const isAssignment = (text: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/.test(text);

/** A program's name as a command calls it: no folder, no Windows ending. */
export function programName(text: string): string {
  const name = text.replace(/\\/g, "/").split("/").pop() ?? text;
  return name.replace(/\.(?:exe|cmd|bat)$/i, "");
}

/** The words of the program a command really runs: assignments and launchers taken off. */
export function programWords(command: Command): Word[] {
  let rest = command.words;
  for (let guard = 0; guard < 8; guard++) {
    while (rest.length > 0 && isAssignment(rest[0]!.text)) rest = rest.slice(1);
    const launcher = LAUNCHERS[programName(rest[0]?.text ?? "")];
    if (!launcher) return rest;
    const values = new Set((launcher.values ?? "").split(" ").filter(Boolean));
    let i = 1;
    while (i < rest.length && rest[i]!.text.startsWith("-") && rest[i]!.text !== "-") {
      i += values.has(rest[i]!.text) ? 2 : 1;
    }
    while (i < rest.length && isAssignment(rest[i]!.text)) i++;
    rest = rest.slice(i + (launcher.positional ?? 0));
  }
  return rest;
}

// ---- Which station a line belongs to ----------------------------------------------------------

type Kind = "file" | "inert" | "net";

const KINDS = new Map<string, Kind>();
const kind = (value: Kind, names: string) => names.split(" ").forEach((name) => KINDS.set(name, value));
// Commands that only read, search, list, move or change files.
kind("file", "cat less more head tail nl wc ls tree find fd stat file du grep egrep fgrep rg ag ack sed awk gawk cut sort uniq tr diff cmp comm jq yq cp mv rm rmdir mkdir touch ln chmod chown tee realpath readlink basename dirname");
// Commands that say nothing about where the work goes.
kind("inert", "cd pushd popd echo printf export unset set true false : pwd sleep which type test [ source . wait");
// Commands that reach the network by what they are.
kind("net", "curl wget ssh scp sftp rsync gh glab nc ncat telnet ping dig nslookup host http https xh aria2c");

/** `tool action` pairs that reach the network, where the tool alone does not. */
const NET_ACTIONS = new Set(
  [
    "git push", "git pull", "git fetch", "git clone", "git ls-remote", "git submodule",
    "npm install", "npm i", "npm ci", "npm add", "npm update", "npm publish", "npm view", "npm audit",
    "pnpm install", "pnpm i", "pnpm add", "pnpm update", "pnpm publish", "pnpm dlx",
    "yarn install", "yarn add", "yarn upgrade", "yarn publish", "yarn dlx",
    "bun install", "bun add", "bun update", "bun publish",
    "pip install", "pip3 install", "pip download", "pipx install", "pipx run", "uv add", "uv sync", "uv lock", "uv pip",
    "poetry install", "poetry add", "poetry update", "poetry lock", "poetry publish",
    "docker pull", "docker push", "docker login", "podman pull", "podman push",
    "brew install", "brew update", "brew upgrade", "cargo install", "cargo fetch", "cargo publish", "cargo update",
    "go get", "go install", "apt install", "apt update", "apt-get install", "apt-get update",
  ],
);

/** Options of a tool, before its action, that are followed by a value. */
const TOOL_VALUES: Record<string, Set<string>> = {
  git: new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]),
  docker: new Set(["-H", "--host", "--context", "-c", "--config", "-l", "--log-level"]),
};

/** The first word after a tool's own options: `push` in `git -C repo push`. */
function actionOf(words: Word[]): string {
  const values = TOOL_VALUES[programName(words[0]?.text ?? "")];
  let i = 1;
  while (i < words.length && words[i]!.text.startsWith("-")) i += values?.has(words[i]!.text) ? 2 : 1;
  return words[i]?.text ?? "";
}

function reachesNetwork(words: Word[]): boolean {
  const name = programName(words[0]?.text ?? "");
  if (KINDS.get(name) === "net") return true;
  if (name === "npx") return words.some((word) => word.text === "-y" || word.text === "--yes");
  // `python -m pip install` is pip.
  if (/^python[\d.]*$/.test(name) && words[1]?.text === "-m") return reachesNetwork(words.slice(2));
  return NET_ACTIONS.has(`${name} ${actionOf(words)}`);
}

/** Every command of a line, those written inside `$(…)` and backticks included. */
function allCommands(line: string, depth = 0): Command[] {
  const commands = readCommands(line);
  if (depth > 3) return commands;
  return commands.flatMap((command) => [command, ...command.inner.flatMap((body) => allCommands(body, depth + 1))]);
}

/** Claude Code's memory folder. */
export const isMemoryPath = (path: string): boolean => /\/\.claude\/projects\/[^/]+\/memory\//.test(path.replace(/\\/g, "/"));

/** The station of a shell command line. */
export function shellStation(line: string): StationId {
  const programs = allCommands(line).map(programWords).filter((words) => words.length > 0);
  if (programs.some(reachesNetwork)) return "network";
  const working = readCommands(line)
    .map(programWords)
    .filter((words) => words.length > 0 && KINDS.get(programName(words[0]!.text)) !== "inert");
  if (working.length > 0 && working.every((words) => KINDS.get(programName(words[0]!.text)) === "file")) {
    return isMemoryPath(line) ? "memory" : "files";
  }
  return "shell";
}

// ---- What a row calls a line ------------------------------------------------------------------

/** Programs that run a script named after their options. */
const INTERPRETERS = /^(?:python[\d.]*|py|node|nodejs|deno|bun|tsx|ts-node|bash|sh|zsh|dash|fish|ruby|perl|php|lua|Rscript)$/;
/** Interpreter options followed by a value. */
const INTERPRETER_VALUES = new Set(["-W", "-X", "--require", "-r", "--import", "--loader", "--env-file", "-o"]);

export interface ShellTitle {
  /** What the command does: `dispatch_driver.py finish T002`, `npm test -- unit`. */
  title: string;
  /** What runs it: `python3`, `git -C ~/.gsd-path/projects/9f2e…`, `npm`. */
  family: string;
}

/** A path as short as it can be read: `~` for home, `…` for folders named by hashes. */
export function shortPath(path: string): string {
  const parts = path.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, "~").replace(/^\/root(?=\/|$)/, "~").split("/");
  const out: string[] = [];
  for (const part of parts) {
    const hashed = /^[0-9a-f]{12,}$/i.test(part) || (part.length > 28 && /\d/.test(part) && !part.includes("."));
    if (!hashed) out.push(part);
    else if (!out[out.length - 1]?.endsWith("…")) out.push(`${part.slice(0, 4)}…`);
  }
  return out.join("/");
}

const looksLikePath = (text: string): boolean => /^(?:~|\.{1,2})?\/|^[\w.-]+\/[\w./-]+$/.test(text);

/** Cut a title in the middle, where it says least. */
export function middleCut(text: string, max = 64): string {
  if (text.length <= max) return text;
  const head = Math.ceil((max - 1) * 0.62);
  const tail = max - 1 - head;
  return `${text.slice(0, head).trimEnd()}…${text.slice(text.length - tail).trimStart()}`;
}

/** Arguments as written, with paths shortened. */
const shownArgs = (words: Word[]): string => words.map((word) => (looksLikePath(word.text) ? shortPath(word.text) : word.raw)).join(" ");

/** The command of a line that does the work: the first that is not `cd`, `echo` and the like. */
function mainProgram(line: string): Word[] {
  const programs = readCommands(line).map(programWords).filter((words) => words.length > 0);
  return programs.find((words) => KINDS.get(programName(words[0]!.text)) !== "inert") ?? programs[0] ?? [];
}

export function shellTitle(line: string): ShellTitle {
  const words = mainProgram(line.trim());
  const name = programName(words[0]?.text ?? "");
  if (!name) return { title: middleCut(line.trim()) || "Shell command", family: "shell" };

  if (INTERPRETERS.test(name)) {
    let i = 1;
    while (i < words.length && words[i]!.text.startsWith("-") && !["-m", "-c", "-e"].includes(words[i]!.text)) {
      i += INTERPRETER_VALUES.has(words[i]!.text) ? 2 : 1;
    }
    const first = words[i]?.text;
    if (first === "-m" && words[i + 1]) return { title: middleCut(`${words[i + 1]!.text} ${shownArgs(words.slice(i + 2))}`.trim()), family: `${name} -m` };
    if (first === "-c" || first === "-e") return { title: middleCut(`${name} ${first} ${words.slice(i + 1).map((word) => word.raw).join(" ")}`), family: name };
    if (first) return { title: middleCut(`${programName(first)} ${shownArgs(words.slice(i + 1))}`.trim()), family: name };
    return { title: name, family: name };
  }

  if (name === "git") {
    const options: string[] = [];
    let i = 1;
    while (i < words.length && words[i]!.text.startsWith("-")) {
      if (TOOL_VALUES.git!.has(words[i]!.text)) {
        options.push(words[i]!.text, shortPath(words[i + 1]?.text ?? ""));
        i += 2;
      } else options.push(words[i++]!.text);
    }
    return { title: middleCut(`git ${shownArgs(words.slice(i))}`.trim()), family: middleCut(["git", ...options].join(" "), 40) };
  }

  return { title: middleCut(`${name} ${shownArgs(words.slice(1))}`.trim()), family: name };
}

/** What the headline says a line is doing: `npm test`, `git commit`. */
export function shellVerb(line: string): string {
  const words = mainProgram(line.trim());
  const name = programName(words[0]?.text ?? "");
  if (!name) return "a command";
  const action = words[1]?.text ?? "";
  return /^[a-z][\w:-]*$/.test(action) ? `${name} ${action}` : name;
}

// GSD Path, read from what the timeline already shows: the helper scripts an orchestrator runs
// (`python3 -B …/dispatch_driver.py finish --task-id T004`) and the subagents it names after its
// tasks (`build_T004`, `review_plan_panel_gpt`). Nothing here asks Paseo or the disk for more.
//
// A helper's title comes from its command line, which the timeline always keeps. Its outcome
// comes from the output, and only from receipts that say what they are: a `GSD-RECEIPT v1` line
// when the installed GSD Path writes one, otherwise JSON shapes and messages the helpers are known
// to print. Orchestrators often send a helper's output to a file or through a filter, so a missing
// receipt is common and leaves the row as any shell row: never an error.
import { allCommands, INTERPRETER_VALUES, programName, programWords, type Word } from "./shell";

/** The helper scripts GSD Path ships, by file name. */
const HELPERS = new Set(
  (
    "archive_milestone build_recovery build_state check_docs_audit check_handoffs check_lock_usage check_task_briefs " +
    "check_trust_evidence check_update coordinator_migration core_hook_gate core_hook_settings detect_project " +
    "discussion_records discussion_validate dispatch_driver git_guard guard_hook integration isolation jev_review " +
    "lean_verification loop_run members migrate_core model_policy path_config pipeline_diagnose pipeline_git " +
    "pipeline_state pipeline_undo promote_lookahead review_findings review_panel roadmap runtime_store " +
    "state_checkpoint state_promote status_runtime task_context token_budget upgrade_window workflow_run worktree_paths"
  )
    .split(" ")
    .map((name) => `${name}.py`),
);

export interface GsdCall {
  /** `dispatch_driver.py`. */
  script: string;
  /** The subcommand, `finish`, or "" for helpers without one. */
  cmd: string;
  /** The words after the subcommand, unquoted. */
  args: string[];
}

const PYTHON = /^(?:python[\d.]*|py)$/;

/** The script a command runs and the words after it, when it runs a Python file. */
function pythonScript(words: Word[]): { path: string; rest: Word[] } | null {
  const name = programName(words[0]?.text ?? "");
  if (name.endsWith(".py")) return { path: words[0]!.text, rest: words.slice(1) };
  if (!PYTHON.test(name)) return null;
  let i = 1;
  while (i < words.length && words[i]!.text.startsWith("-")) {
    if (["-m", "-c"].includes(words[i]!.text)) return null;
    i += INTERPRETER_VALUES.has(words[i]!.text) ? 2 : 1;
  }
  const path = words[i]?.text;
  return path ? { path, rest: words.slice(i + 1) } : null;
}

/**
 * The GSD Path helpers a shell line runs, in order. A helper is known by its file name and by
 * where it lives: a path or a line naming `gsd-path`, a skill's `scripts/` folder, or the
 * `--repo` every repository helper takes. A project script that only shares a name stays a
 * plain command.
 */
export function gsdCalls(line: string): GsdCall[] {
  const calls: GsdCall[] = [];
  const named = /gsd-path/i.test(line);
  // `S=…/scripts; python3 $S/review_panel.py merge`: a folder set earlier in the line.
  const folders = new Map<string, string>();
  for (const command of allCommands(line)) {
    for (const word of command.words) {
      const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(word.text);
      if (!assignment) break;
      folders.set(assignment[1]!, assignment[2]!);
    }
    const found = pythonScript(programWords(command));
    if (!found) continue;
    const script = programName(found.path);
    if (!HELPERS.has(script)) continue;
    const rest = found.rest.map((word) => word.text);
    const path = found.path.replace(/\\/g, "/").replace(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?(?=\/)/, (whole, name: string) => folders.get(name) ?? whole);
    const placed = named || /\/skills\/[^/]+\/scripts\/[^/]+$/.test(path) || rest.includes("--repo");
    if (!placed) continue;
    const cmd = /^[a-z][a-z0-9-]*$/.test(rest[0] ?? "") ? rest[0]! : "";
    calls.push({ script, cmd, args: cmd ? rest.slice(1) : rest });
  }
  return calls;
}

/** The value of `--name value` or `--name=value`. */
function flag(args: string[], name: string): string {
  const at = args.indexOf(name);
  const joined = args.find((arg) => arg.startsWith(`${name}=`));
  const value = at >= 0 ? (args[at + 1]?.startsWith("--") ? "" : (args[at + 1] ?? "")) : joined ? joined.slice(name.length + 1) : "";
  // A shell variable (`$ID`, `${TASK}`) is not known until the shell runs; a title leaves it out.
  return value.replace(/\$\{?\w+\}?/g, "…").replace(/^(?:\/?…)+$/, "");
}

const fileName = (path: string): string => path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
const words = (text: string): string => text.replace(/[_-]+/g, " ").trim();
const quoteCut = (text: string, max = 40): string => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
const join = (...parts: string[]): string => parts.filter(Boolean).join(" ");

/** How much a helper says about where the pipeline is: the row is named after the highest. */
function weight(call: GsdCall): number {
  switch (call.script) {
    case "dispatch_driver.py":
      return call.cmd === "status" ? 2 : 4;
    case "pipeline_state.py":
      return ["route", "status", "validate"].includes(call.cmd) ? 2 : 4;
    case "workflow_run.py":
      return call.cmd === "route" ? 2 : 4;
    case "isolation.py":
      return call.cmd === "checkpoint" ? 4 : 3;
    case "review_panel.py":
    case "pipeline_git.py":
    case "archive_milestone.py":
      return 3;
    case "model_policy.py":
    case "check_update.py":
    case "upgrade_window.py":
    case "status_runtime.py":
      return 1;
    default:
      return 2;
  }
}

/** The helper that names a row of several. */
export function primaryCall(calls: readonly GsdCall[]): GsdCall | undefined {
  let best: GsdCall | undefined;
  for (const call of calls) if (!best || weight(call) > weight(best)) best = call;
  return best;
}

/** `T004` for `build_T004`; other assignments in words: `review plan panel gpt`. */
function assignmentLabel(assignment: string): string {
  const build = /^build_(.+)$/i.exec(assignment);
  return build ? build[1]!.toUpperCase() : words(assignment);
}

/** What a row calls a helper call: "Land T004", "Transition plan → build". */
export function gsdTitle(call: GsdCall): string {
  const { cmd, args } = call;
  const task = flag(args, "--task-id").toUpperCase();
  const wave = flag(args, "--wave");
  const cycle = flag(args, "--cycle");
  const waveCycle = join(wave ? `wave ${wave}` : "", cycle ? `· cycle ${cycle}` : "");
  switch (call.script) {
    case "pipeline_state.py": {
      if (cmd === "transition") {
        const from = flag(args, "--expect-phase");
        const to = flag(args, "--set-phase");
        const status = flag(args, "--set-status");
        if (to && to !== from) return `Transition ${from ? `${from} → ` : "→ "}${to}`;
        if (status) return join("Mark", to || from, status);
        if (to) return `Transition → ${to}`;
        return "Transition the state";
      }
      if (cmd === "route") return "Route the pipeline";
      if (cmd === "status") return "Pipeline status";
      if (cmd === "validate") return "Validate the state";
      if (cmd === "approve") return join("Approve", words(flag(args, "--kind")) || "the phase");
      break;
    }
    case "dispatch_driver.py":
      if (cmd === "finish") return join("Land", task || "a task");
      if (cmd === "round") return join("Dispatch", wave ? `wave ${wave}` : "a round");
      if (cmd === "review") return join("Review", waveCycle || "a wave");
      if (cmd === "panel") return join("Review panel", waveCycle);
      if (cmd === "skeptics") return join("Skeptics", waveCycle);
      if (cmd === "fix-tasks") return join("Fix tasks", waveCycle);
      if (cmd === "complete") return "Complete the build";
      if (cmd === "answer") return join("Answer", task || "a task");
      if (cmd === "status") return "Dispatch status";
      break;
    case "isolation.py": {
      if (cmd === "checkpoint") {
        const subject = flag(args, "--subject");
        return subject ? `Checkpoint “${quoteCut(subject)}”` : "Checkpoint";
      }
      if (cmd === "stage-review") return join("Stage review", fileName(flag(args, "--source-path")).replace(/\.md$/, ""));
      if (cmd === "collect-artifact") return join("Collect", fileName(flag(args, "--destination-path") || flag(args, "--source-path")));
      if (cmd === "isolate-verify") return join("Isolate", flag(args, "--name") || "a verify sidecar");
      if (cmd === "retire") return join("Retire", fileName(flag(args, "--worktree")) || "a worktree");
      if (/^activate(?:-member)?-task$/.test(cmd)) return join("Activate", task || "a task");
      if (/^retire(?:-member)?-task$/.test(cmd)) return join("Retire", task || "a task");
      if (cmd === "recover") return "Recover isolates";
      break;
    }
    case "workflow_run.py":
      if (cmd === "gate-plan") return "Gate the plan";
      if (cmd === "approve-plan") return "Approve the plan";
      if (cmd === "prepare-task") return join("Prepare", task || "a task");
      if (cmd === "build-evidence") return "Write build evidence";
      if (cmd === "lint-round") return "Lint the round";
      if (cmd === "route") return "Route the pipeline";
      if (/^(?:prepare|advance|finish)-inspect$/.test(cmd)) return `${words(cmd.replace(/-inspect$/, "")).replace(/^./, (c) => c.toUpperCase())} inspection`;
      break;
    case "model_policy.py": {
      const assignment = flag(args, "--assignment");
      if (cmd === "resolve") return join("Model for", assignment ? assignmentLabel(assignment) : "a task");
      if (cmd === "release") return join("Release model", assignment ? `· ${assignmentLabel(assignment)}` : "");
      break;
    }
    case "check_handoffs.py":
      return cmd ? `Check the ${words(cmd)} handoff` : "Check handoffs";
    case "check_task_briefs.py":
      return "Check task briefs";
    case "review_panel.py":
      if (cmd === "resolve") return "Resolve the review panel";
      if (cmd === "merge") return join("Merge the", words(flag(args, "--kind")), "panel");
      break;
    case "build_state.py":
      if (cmd === "ready") return "Ready tasks";
      break;
    case "discussion_records.py":
      if (cmd === "pending") return "Pending discussions";
      break;
    case "task_context.py":
      return join("Task context", task);
    case "pipeline_git.py":
      if (cmd === "bind-next") return join("Bind", flag(args, "--branch") || "the next milestone");
      break;
  }
  return join(call.script, cmd);
}

// ---- Subagents --------------------------------------------------------------------------------

/**
 * A subagent named by GSD Path's logical task names (`build_<task>`, `review_wave_<w>_cycle_<c>`,
 * `review_plan_panel_<family>`…): its title and role. Other names return null.
 */
export function gsdAgent(name: string): { title: string; facts: string[] } | null {
  const text = name.trim();
  let match: RegExpExecArray | null;
  const is = (pattern: RegExp) => (match = pattern.exec(text)) !== null;
  const at = (index: number) => match?.[index] ?? "";
  if (is(/^build_([a-z0-9_]+)$/i)) return { title: `Build ${at(1).toUpperCase()}`, facts: ["builder"] };
  if (is(/^review_wave_(\d+)_cycle_(\d+)_panel_([a-z0-9_]+)$/i)) return { title: `Review wave ${at(1)} · panel ${at(3)}`, facts: ["panelist", `cycle ${at(2)}`] };
  if (is(/^review_wave_(\d+)_cycle_(\d+)_skeptic_([a-z0-9_]+)$/i)) return { title: `Skeptic wave ${at(1)} · ${at(3)}`, facts: ["skeptic", `cycle ${at(2)}`] };
  if (is(/^review_wave_(\d+)_cycle_(\d+)(?:_(contract|adversarial))?$/i)) return { title: join(`Review wave ${at(1)}`, at(3) ? `· ${at(3)}` : ""), facts: ["reviewer", `cycle ${at(2)}`] };
  if (is(/^review_plan_panel_([a-z0-9_]+)$/i)) return { title: `Review the plan · panel ${at(1)}`, facts: ["panelist"] };
  if (is(/^review_final$/i)) return { title: "Final review", facts: ["reviewer"] };
  if (is(/^review_gap_(\d+)$/i)) return { title: `Gap review ${at(1)}`, facts: ["reviewer"] };
  if (is(/^inspect_codebase(?:_([a-z0-9_]+))?$/i)) return { title: join("Map the codebase", at(1) ? `· ${at(1)}` : ""), facts: ["mapper"] };
  if (is(/^inspect_docs(?:_([a-z0-9_]+))?$/i)) return { title: join("Inspect the docs", at(1) ? `· ${at(1)}` : ""), facts: ["docs auditor"] };
  if (is(/^docs_audit$/i)) return { title: "Audit the docs", facts: ["docs auditor"] };
  if (is(/^research_([a-z0-9_]+)$/i)) return { title: `Research ${words(at(1))}`, facts: ["researcher"] };
  if (is(/^plan_patch$/i)) return { title: "Patch the plan", facts: ["planner"] };
  const single: Record<string, [string, string]> = { plan: ["Plan", "planner"], decide: ["Decide", "decider"], roadmap: ["Roadmap", "roadmapper"] };
  const one = single[text.toLowerCase()];
  return one ? { title: one[0], facts: [one[1]] } : null;
}

// ---- Receipts ---------------------------------------------------------------------------------

export interface GsdOutcome {
  /** What the receipts make of the call: a failure, something to look at, or nothing to say. */
  verdict?: "err" | "warn";
  /** The receipt's word for it: "landed", "blocked", "question". */
  word?: string;
  facts: string[];
  /** What a failed receipt says, first line. */
  failure?: string;
  /** Whether a `GSD-RECEIPT v1` line said it. */
  stamped: boolean;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const short = (sha: string): string => (/^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : sha);
const firstLine = (value: string, max = 72): string => quoteCut(value.split("\n").find((line) => line.trim()) ?? "", max);

/** The `GSD-RECEIPT v1 {…}` lines of an output, parsed; lines that do not parse are left out. */
export function stampedReceipts(output: string): Json[] {
  const found: Json[] = [];
  for (const match of output.matchAll(/^[ \t]*GSD-RECEIPT v1 (\{.*\})[ \t]*$/gm)) {
    try {
      const value: unknown = JSON.parse(match[1]!);
      if (isObject(value) && typeof value.script === "string") found.push(value);
    } catch {
      // Not a receipt after all.
    }
  }
  return found;
}

/** JSON objects an output prints: one per line, or pretty-printed from a `{` line to a `}` line. */
function jsonObjects(output: string): Json[] {
  const found: Json[] = [];
  const lines = output.split("\n");
  const take = (source: string) => {
    try {
      const value: unknown = JSON.parse(source);
      if (isObject(value)) found.push(value);
    } catch {
      // Not JSON.
    }
  };
  for (let i = 0; i < lines.length && found.length < 40; i++) {
    const line = lines[i]!.trim();
    if (line.startsWith("{") && line.endsWith("}")) take(line);
    else if (line === "{") {
      const end = lines.findIndex((candidate, index) => index > i && candidate.trimEnd() === "}");
      if (end > i && end - i < 4000) {
        take(lines.slice(i, end + 1).join("\n"));
        i = end;
      }
    }
  }
  return found;
}

class Reading {
  verdict?: "err" | "warn";
  word?: string;
  failure?: string;
  facts: string[] = [];

  fail(word: string, failure: string): void {
    if (this.verdict !== "err") {
      this.verdict = "err";
      this.word = word;
      this.failure = firstLine(failure) || word;
    }
  }

  warn(word: string, fact = ""): void {
    if (!this.verdict) {
      this.verdict = "warn";
      this.word = word;
    }
    this.fact(fact);
  }

  fact(value: string): void {
    if (value && !this.facts.includes(value)) this.facts.push(value);
  }
}

/** What a stamped receipt says. Its `outcome` is the helper's own verdict: `ok`, `warn` or `fail`. */
const PLAIN = new Set(["ok", "done", "complete", "completed"]);

function readStamped(receipt: Json, into: Reading, primary: boolean): void {
  const status = text(receipt.status);
  const reason = text(receipt.reason);
  const word = PLAIN.has(status) ? "" : status;
  if (receipt.outcome === "fail") into.fail(word || "failed", reason || word || "failed");
  else if (receipt.outcome === "warn") into.warn(word || "attention", primary ? reason : "");
  if (!primary || receipt.outcome !== "ok") return;
  if (word) into.word ??= word;
  if (text(receipt.commit)) into.fact(short(text(receipt.commit)));
}

const BLOCKED = new Set(["blocked", "error", "failed", "refused"]);

/** Which helper prints a receipt shape: only the row's own helper gives it facts. */
function shapeOwner(receipt: Json): (call: GsdCall) => boolean {
  const is = (script: string, ...cmds: string[]) => (call: GsdCall) => call.script === script && (cmds.length === 0 || cmds.includes(call.cmd));
  if (Array.isArray(receipt.landed) && Array.isArray(receipt.blocked)) return is("dispatch_driver.py");
  if (Array.isArray(receipt.steps)) return is("workflow_run.py");
  if (receipt.schema === "gsd-path/route/v1") return (call) => call.cmd === "route";
  if (receipt.status === "committed") return is("isolation.py", "checkpoint");
  if (isObject(receipt.selection)) return is("model_policy.py");
  if (Array.isArray(receipt.families)) return is("review_panel.py", "merge");
  if (Array.isArray(receipt.selected)) return is("review_panel.py", "resolve");
  if (Array.isArray(receipt.ready)) return is("build_state.py", "ready");
  return () => false;
}

/** A failure any helper of the line reports: the line failed, whichever helper names it. */
function readFailure(receipt: Json, into: Reading): void {
  const status = text(receipt.status);
  if (Array.isArray(receipt.blocked)) {
    for (const entry of receipt.blocked) {
      const task = isObject(entry) ? text(entry.task) : text(entry);
      const reason = isObject(entry) ? text(entry.reason) : "";
      into.fail("blocked", join(task, reason ? `· ${reason}` : "blocked"));
    }
  }
  if (BLOCKED.has(status)) {
    const errors = Array.isArray(receipt.errors) ? text(receipt.errors[0]) : "";
    into.fail(status === "error" ? "failed" : status, text(receipt.reason) || text(receipt.error) || errors || status);
  }
  if (Array.isArray(receipt.steps)) {
    const failed = receipt.steps.find((step) => isObject(step) && typeof step.exit_code === "number" && step.exit_code !== 0);
    if (isObject(failed)) into.fail("failed", `${text(failed.script) || "a step"} exit ${text(failed.exit_code)}`);
  }
}

/** The facts of the row's own helper receipt, by the shapes GSD Path's helpers print. */
function readFacts(receipt: Json, into: Reading): void {
  const status = text(receipt.status);
  if (status === "question") into.warn("question", firstLine(text(receipt.reason), 60));
  if (Array.isArray(receipt.landed)) {
    for (const entry of receipt.landed) {
      if (!isObject(entry)) continue;
      into.word ??= "landed";
      into.fact(join(text(entry.task), short(text(entry.commit) || text(entry.member_commit))));
    }
  }
  if (Array.isArray(receipt.steps) && status === "complete") into.fact(`${receipt.steps.length}/${receipt.steps.length} checks`);
  if (receipt.schema === "gsd-path/route/v1" && isObject(receipt.route)) {
    const action = text(receipt.route.action);
    if (action === "block") into.warn("blocked", firstLine(text(receipt.route.reason), 60));
    else into.fact(action === "run-phase" ? join("next", text(receipt.route.phase)) : words(action));
  }
  if (status === "committed" && text(receipt.commit)) {
    into.word ??= "committed";
    into.fact(short(text(receipt.commit)));
  }
  if (isObject(receipt.selection) && isObject(receipt.selection.selected)) into.fact(text(receipt.selection.selected.model));
  if (typeof receipt.actionable === "number") {
    into.fact(`${receipt.actionable} actionable`);
    if (typeof receipt.conflicts === "number" && receipt.conflicts > 0) into.fact(`${receipt.conflicts} ${receipt.conflicts === 1 ? "conflict" : "conflicts"}`);
  }
  if (status === "ready" && Array.isArray(receipt.selected)) {
    const families = receipt.selected.map((entry) => (isObject(entry) ? text(entry.family) : "")).filter(Boolean);
    if (families.length > 0) into.fact(`panel ${families.join(" + ")}`);
  }
  if (Array.isArray(receipt.ready) && typeof receipt.current_wave === "number") {
    const ids = receipt.ready.map((entry) => (isObject(entry) ? text(entry.id) : "")).filter(Boolean);
    into.fact(`wave ${receipt.current_wave}`);
    into.fact(ids.length > 0 ? `${ids.join(", ")} ready` : "none ready");
  }
}

/**
 * What a helper call's output says about how it went. Stamped lines decide the outcome when
 * there are any; otherwise failures come from any receipt of the line. Facts come from the row's
 * own helper (`primary`). Returns null when the output says nothing.
 */
export function readOutcome(output: string, primary?: GsdCall): GsdOutcome | null {
  if (!output.trim()) return null;
  const reading = new Reading();
  const stamped = stampedReceipts(output);
  // The first receipt the row's own helper printed gives the facts; a chained helper's do not.
  const objects = jsonObjects(output);
  const own = new Reading();
  const owned = primary ? objects.find((receipt) => shapeOwner(receipt)(primary)) : undefined;
  if (owned) readFacts(owned, own);
  if (stamped.length > 0) {
    // Stamped lines decide how it went; the helper's own JSON, when shown, still says the most.
    const mine = stamped.findIndex((receipt) => receipt.script === primary?.script && text(receipt.cmd) === (primary?.cmd ?? ""));
    stamped.forEach((receipt, index) => readStamped(receipt, reading, index === (mine >= 0 ? mine : stamped.length - 1)));
    if (own.facts.length > 0) reading.facts = own.facts;
    if (reading.verdict !== "err" && own.word) reading.word ??= own.word;
  } else {
    for (const receipt of objects) readFailure(receipt, reading);
    const handoff = /^handoff validation failed: (.+)$/m.exec(output);
    if (handoff) reading.fail("failed", handoff[1]!);
    if (!reading.verdict && own.verdict) reading.verdict = own.verdict;
    reading.word ??= own.word;
    reading.facts = own.facts;
  }
  if (!reading.verdict && !reading.word && reading.facts.length === 0) return null;
  return {
    ...(reading.verdict ? { verdict: reading.verdict } : {}),
    ...(reading.word ? { word: reading.word } : {}),
    ...(reading.failure ? { failure: reading.failure } : {}),
    facts: reading.facts.slice(0, 3),
    stamped: stamped.length > 0,
  };
}

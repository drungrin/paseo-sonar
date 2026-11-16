import { describe, expect, it } from "vitest";
import { diffLines, formatDuration, SonarModel, shortModel, type EntryLike } from "../client/model";

const T0 = Date.parse("2026-11-14T03:34:36.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();
const idle = { status: "idle", model: "claude-opus-5-5", thinking: "high" };
const running = { ...idle, status: "running" };

const tool = (callId: string, name: string, detail: Record<string, unknown> & { type: string }, status = "completed", error: unknown = null) => ({
  type: "tool_call",
  callId,
  name,
  status,
  error,
  detail,
});

const history: EntryLike[] = [
  { turnId: "foreground-turn-1", provider: "claude", timestamp: at(0), item: { type: "user_message", text: "roda os testes" } },
  { turnId: "foreground-turn-1", provider: "claude", timestamp: at(6), item: tool("a", "Read", { type: "read", filePath: "/w/README.md" }) },
  { turnId: "foreground-turn-1", provider: "claude", timestamp: at(7), item: tool("b", "Bash", { type: "shell", command: "ls -la", output: "a\nb" }) },
  { turnId: "foreground-turn-1", provider: "claude", timestamp: at(9), item: tool("c", "Bash", { type: "shell", command: "npm test", output: "" }, "failed", "Exit code 1\nTests  2 failed | 10 passed") },
  { turnId: "foreground-turn-1", provider: "claude", timestamp: at(12), item: { type: "reasoning", text: "hmm" } },
  { turnId: "foreground-turn-1", provider: "claude", timestamp: at(12.1), item: { type: "assistant_message", text: "" } },
  { turnId: "foreground-turn-1", provider: "claude", timestamp: at(17), item: { type: "assistant_message", text: "Steps are done." } },
];

describe("formatting", () => {
  it("formats durations the way the panel prints them", () => {
    expect(formatDuration(400)).toBe("0.4s");
    expect(formatDuration(112_000)).toBe("1m 52s");
    expect(shortModel("claude-opus-5-5")).toBe("opus-5.5");
  });

  it("diffs two texts with two lines of context", () => {
    expect(diffLines("a\nb\nc\nd\ne\nf\n", "a\nb\nc\nX\ne\nf\n")).toEqual([
      { sign: " ", text: "b" },
      { sign: " ", text: "c" },
      { sign: "+", text: "X" },
      { sign: "-", text: "d" },
      { sign: " ", text: "e" },
      { sign: " ", text: "f" },
    ]);
  });
});

describe("SonarModel from history", () => {
  const model = new SonarModel();
  model.load(history, { hasOlder: false, maxSeq: 33 });
  const view = model.view(T0 + 60_000, idle);
  const rows = view.turns[0]!.rows;

  it("groups rows by turn, newest first, and leaves out short thinking and empty replies", () => {
    expect(view.turns[0]!.label).toBe("TURN 1");
    expect(rows.map((row) => row.title)).toEqual(["Reply", "npm test", "ls -la", "Read README.md", "New message"]);
  });

  it("puts what ran it and how it ended under a command, not the tool's name", () => {
    expect(rows[2]).toMatchObject({ meta: "ls · exit 0", trailing: "", status: "ok" });
    expect(rows[1]).toMatchObject({ status: "err", trailing: "exit 1", meta: "npm · 2 failed", metaTone: "err", pinned: true });
  });

  it("keeps a failure's output for the expanded row", () => {
    expect(model.details(rows[1]!.key, T0)).toMatchObject({ kind: "shell", command: "npm test", failed: true, note: null, output: "Exit code 1\nTests  2 failed | 10 passed" });
  });

  it("says it is waiting, with nothing on the right, when nothing runs", () => {
    expect(view.headline).toMatchObject({ title: "Waiting for you", running: false });
    expect(view.headline.sub).toMatch(/^turn 1 · took 17\.0s · ended \d\d:\d\d$/);
    expect(view.activity).toBeNull();
    expect(view.clock).toBe("IDLE · JUST NOW");
    expect(view.scope).toBe("SESSION");
  });

  it("counts every row on its station; the route marks a failure red", () => {
    expect(view.counts).toMatchObject({ you: 1, files: 2, shell: 1, model: 3 });
    expect(view.route.map((stop) => `${stop.station}:${stop.state}`)).toEqual(["you:normal", "files:normal", "shell:err"]);
  });
});

describe("SonarModel live", () => {
  it("times a call from its first event to its last and remembers it across a reload", () => {
    const model = new SonarModel();
    model.load(history, { hasOlder: false, maxSeq: 33 });
    model.applyStream({ type: "turn_started", turnId: "foreground-turn-2" }, at(50));
    model.applyStream({ type: "timeline", turnId: "foreground-turn-2", item: { type: "user_message", text: "next" } }, at(50), 46);
    model.applyStream({ type: "timeline", turnId: "foreground-turn-2", item: { type: "user_message", text: "old" } }, at(50), 30);
    model.applyStream({ type: "timeline", turnId: "foreground-turn-2", provider: "claude", item: tool("e", "Edit", { type: "edit", filePath: "/w/vitest.config.ts" }, "running") }, at(52), 47);
    model.applyStream({ type: "timeline", turnId: "foreground-turn-2", provider: "claude", item: tool("f", "Bash", { type: "shell", command: "sleep 3" }, "running") }, at(53), 48);

    let view = model.view(T0 + 55_200, running);
    expect(view.clock).toBe("NOW · 5S");
    expect(view.activity).toBe("2 running");
    expect(view.headline).toMatchObject({ title: "Running sleep", sub: "shell · sleep · 2.2s" });
    expect(view.parallel?.text).toBe("Editing vitest.config.ts in parallel");
    expect(view.turns[0]!.rows.filter((row) => row.live && row.pinned)).toHaveLength(2);

    model.applyStream({ type: "timeline", turnId: "foreground-turn-2", provider: "claude", item: tool("e", "Edit", { type: "edit", filePath: "/w/vitest.config.ts", oldString: "a\n", newString: "b\n" }) }, at(55.5), 49);
    model.applyStream({ type: "timeline", turnId: "foreground-turn-2", item: { type: "assistant_message", text: "All " } }, at(56), 50);
    model.applyStream({ type: "timeline", turnId: "foreground-turn-2", item: { type: "assistant_message", text: "done." } }, at(56.2), 51);
    view = model.view(T0 + 57_000, running);
    expect(view.turns[0]!.rows[0]).toMatchObject({ title: "Reply", meta: "All done.", live: true });
    expect(view.turns[0]!.rows.find((row) => row.title === "Edit vitest.config.ts")).toMatchObject({ trailing: "3.5s", meta: "Edit · +1 −1" });

    model.applyStream({ type: "turn_completed", turnId: "foreground-turn-2", usage: { contextWindowUsedTokens: 30_000, contextWindowMaxTokens: 200_000 } }, at(58));
    expect(model.view(T0 + 60_000, idle).context).toEqual({ percent: 15 });

    const saved = model.measuredDurations();
    expect(saved).toEqual({ e: 3500, f: 5000 });
    const reloaded = new SonarModel();
    reloaded.remember(saved);
    reloaded.load([{ turnId: "foreground-turn-2", provider: "claude", timestamp: at(52), item: tool("e", "Edit", { type: "edit", filePath: "/w/vitest.config.ts" }) }], { hasOlder: false, maxSeq: 60 });
    expect(reloaded.view(T0 + 60_000, idle).turns[0]!.rows[0]!.trailing).toBe("3.5s");
  });
});

describe("SonarModel background work from the timeline", () => {
  // A background Bash and a Monitor return at once; task notifications close them later.
  const launched: EntryLike[] = [
    { turnId: "foreground-turn-1", provider: "claude", timestamp: at(0), item: { type: "user_message", text: "go" } },
    { turnId: "foreground-turn-1", provider: "claude", timestamp: at(5), item: tool("toolu_bash", "Bash", { type: "shell", command: "cd /w && npm test", output: "Command running in background with ID: b5an63x4y. Output is being written to: /tmp/x" }) },
    {
      turnId: "foreground-turn-1",
      provider: "claude",
      timestamp: at(7),
      item: tool("toolu_mon", "Monitor", {
        type: "unknown",
        input: { command: "until grep -q DONE /tmp/v.txt; do sleep 10; done", description: "Wait for Verify end", timeout_ms: 1_800_000 },
        output: { type: "command", output: "Monitor started (task b0k61978y, expires in 30m unless the source ends first)" },
      }),
    },
    { turnId: "foreground-turn-1", provider: "claude", timestamp: at(9), item: { type: "assistant_message", text: "Waiting on the Verify run." } },
  ];
  const notification = (toolUseId: string, taskId: string, label: string, seconds: number): EntryLike => ({
    timestamp: at(seconds),
    item: {
      ...tool(`task_notification_${taskId}`, "task_notification", { type: "plain_text", label, text: label }),
      metadata: { synthetic: true, source: "claude_task_notification", taskId, toolUseId, status: "completed" },
    } as EntryLike["item"],
  });

  it("keeps a background command and a monitor running until their notices arrive", () => {
    const model = new SonarModel();
    model.load(launched, { hasOlder: true, maxSeq: 5 });
    const view = model.view(T0 + 125_000, idle);
    expect(view.headline.title).toBe("Waiting for you");
    expect(view.activity).toBe("2 in background");
    expect(view.backgroundCount).toBe(2);
    const rows = view.turns[0]!.rows;
    expect(rows.find((row) => row.title === "npm test")).toMatchObject({ live: true, pinned: true, background: true, trailing: "2m 00s", meta: "npm · background" });
    expect(rows.find((row) => row.title === "Wait for Verify end")).toMatchObject({ live: true, meta: "monitor · background" });
    expect(view.liveStations.has("shell")).toBe(true);
    const bash = rows.find((row) => row.title === "npm test")!;
    expect(model.details(bash.key, T0 + 125_000)).toMatchObject({ kind: "shell", output: "", note: expect.stringMatching(/^background task b5an63x4y · running since \d\d:\d\d:\d\d$/) });
    const monitor = rows.find((row) => row.title === "Wait for Verify end")!;
    expect(model.details(monitor.key, T0)).toMatchObject({ note: expect.stringMatching(/gives up at \d\d:\d\d$/) });
  });

  it("closes them with the notice's time and exit code", () => {
    const model = new SonarModel();
    model.load(
      [
        ...launched,
        notification("toolu_bash", "b5an63x4y", 'Background command "npm test" completed (exit code 1)', 65),
        notification("toolu_mon", "b0k61978y", 'Monitor "Wait for Verify end" stream ended', 90),
      ],
      { hasOlder: true, maxSeq: 7 },
    );
    const view = model.view(T0 + 125_000, idle);
    expect(view.backgroundCount).toBe(0);
    expect(view.activity).toBeNull();
    const rows = view.turns[0]!.rows;
    expect(rows.find((row) => row.title === "npm test")).toMatchObject({ status: "err", trailing: "exit 1", meta: "npm", metaTone: "err", live: false });
    expect(rows.find((row) => row.title === "Wait for Verify end")).toMatchObject({ status: "ok", trailing: "1m 23s" });
  });

  it("gives a monitor up once it has expired without a notice", () => {
    const model = new SonarModel();
    model.load(launched, { hasOlder: true, maxSeq: 5 });
    const view = model.view(T0 + 40 * 60_000, idle);
    expect(view.turns[0]!.rows.find((row) => row.title === "Wait for Verify end")!.live).toBe(false);
    expect(view.turns[0]!.rows.find((row) => row.title === "npm test")!.live).toBe(true);
  });
});

describe("SonarModel background subagents", () => {
  const launched: EntryLike[] = [
    { turnId: "autonomous-turn-28", timestamp: at(0), item: { type: "user_message", text: "go" } },
    { turnId: "autonomous-turn-28", timestamp: at(10), item: tool("toolu_T003", "Agent", { type: "sub_agent", description: "build_T003", subAgentType: "general-purpose" }) },
    { turnId: "autonomous-turn-29", timestamp: at(30), item: { type: "assistant_message", text: "T002 landed; T003 still runs." } },
  ];
  const subagent = (status: "running" | "completed", updatedAt: number) => ({
    kind: "upsert" as const,
    subagent: { id: "sub-1", parentAgentId: "a", title: "Segment-A operator script", description: "build_T003", status, createdAt: at(10), updatedAt: at(updatedAt), toolCallId: "toolu_T003" },
  });

  it("draws the subagent live at the top of the newest turn, with its last steps", () => {
    const model = new SonarModel();
    model.load(launched, { hasOlder: true, maxSeq: 3 });
    model.applySubagent(subagent("running", 10));
    model.applySubagent({ kind: "timeline", parentAgentId: "a", subagentId: "sub-1", timestamp: at(60), item: tool("x1", "Edit", { type: "edit", filePath: "/w/scripts/segmento_a.py" }) });
    model.applySubagent({ kind: "timeline", parentAgentId: "a", subagentId: "sub-1", timestamp: at(80), item: tool("x2", "Bash", { type: "shell", command: "pytest tests/offline -q", output: "12 passed in 3s" }) });
    model.applySubagent({ kind: "timeline", parentAgentId: "a", subagentId: "sub-1", timestamp: at(95), item: { type: "reasoning", text: "…" } });

    const view = model.view(T0 + 100_000, idle);
    expect(view.headline.title).toBe("Waiting for you");
    expect(view.activity).toBe("1 in background");
    const [first] = view.turns[0]!.rows;
    expect(view.turns[0]!.label).toBe("TURN 29");
    expect(first).toMatchObject({ title: "Build T003", live: true, pinned: true, background: true, trailing: "1m 30s", meta: "builder · general-purpose · background · from turn 28" });
    expect(model.details(first!.key, T0 + 100_000)).toEqual({
      kind: "agent",
      task: "Segment-A operator script",
      steps: [
        { text: "Edit segmento_a.py", when: "40s", tone: "normal" },
        { text: "pytest tests/offline -q · 12 passed", when: "20s", tone: "normal" },
        { text: "Thinking…", when: "now", tone: "normal" },
      ],
      log: "",
    });
  });

  it("leaves out a task that only repeats the subagent's type", () => {
    const model = new SonarModel();
    model.load(launched, { hasOlder: true, maxSeq: 3 });
    model.applySubagent({ kind: "upsert", subagent: { ...subagent("running", 10).subagent, title: "general-purpose" } });
    const [first] = model.view(T0 + 20_000, idle).turns[0]!.rows;
    expect(model.details(first!.key, T0 + 20_000)).toMatchObject({ kind: "agent", task: null });
  });

  it("goes back to idle and times the launch when the subagent ends", () => {
    const model = new SonarModel();
    model.load(launched, { hasOlder: true, maxSeq: 3 });
    model.applySubagent(subagent("running", 10));
    model.applySubagent(subagent("completed", 130));
    const view = model.view(T0 + 140_000, idle);
    expect(view.backgroundCount).toBe(0);
    const row = view.turns.flatMap((turn) => turn.rows).find((candidate) => candidate.title === "Build T003");
    expect(row).toMatchObject({ status: "ok", trailing: "2m 00s", live: false });
  });

  it("leaves a foreground subagent on its own running row", () => {
    const model = new SonarModel();
    model.load([], { hasOlder: false, maxSeq: 0 });
    model.applyStream({ type: "turn_started", turnId: "t-1" }, at(0));
    model.applyStream({ type: "timeline", turnId: "t-1", item: tool("toolu_fg", "Agent", { type: "sub_agent", description: "Explore the repo" }, "running") }, at(1), 1);
    model.applySubagent({ kind: "upsert", subagent: { id: "sub-2", parentAgentId: "a", title: null, description: "Explore the repo", status: "running", createdAt: at(1), updatedAt: at(2), toolCallId: "toolu_fg" } });
    const view = model.view(T0 + 5_000, running);
    expect(view.backgroundCount).toBe(0);
    expect(view.activity).toBe("1 running");
    expect(view.headline.title).toBe("Delegating: Explore the repo");
  });
});

describe("turn numbers", () => {
  it("numbers Codex turns from 1 and reads ids when older turns are missing", () => {
    const codex: EntryLike[] = [
      { turnId: "codex-turn-0", timestamp: at(0), item: { type: "user_message", text: "hi" } },
      { turnId: "codex-turn-0", timestamp: at(2), item: tool("x", "shell", { type: "shell", command: 'node -e "process.exit(2)"', exitCode: 2 }, "failed", { message: "Tool call failed" }) },
      { turnId: "codex-turn-0", timestamp: at(4), item: { type: "assistant_message", text: "\n\n---\n\ndone" } },
    ];
    const model = new SonarModel();
    model.load(codex, { hasOlder: false, maxSeq: 3 });
    const [turn] = model.view(T0 + 10_000, idle).turns;
    expect(turn!.label).toBe("TURN 1");
    expect(turn!.rows[0]!.meta).toBe("done");
    expect(turn!.rows[1]).toMatchObject({ status: "err", trailing: "exit 2", meta: "node" });
    expect(model.details(turn!.rows[1]!.key, T0)).toMatchObject({ kind: "shell", output: "" });
    model.load(codex, { hasOlder: true, maxSeq: 3 });
    expect(model.view(T0, idle).turns[0]!.label).toBe("TURN 1");
  });
});

describe("a restarted provider process", () => {
  // Claude numbers turns from 1 again after its process restarts; the old turns stay in the history.
  const restarted: EntryLike[] = [
    { turnId: "foreground-turn-1", provider: "claude", timestamp: at(0), item: { type: "user_message", text: "first" } },
    { turnId: "foreground-turn-1", provider: "claude", timestamp: at(5), item: tool("old-ls", "Bash", { type: "shell", command: "ls" }, "running") },
    { turnId: "foreground-turn-2", provider: "claude", timestamp: at(60), item: { type: "user_message", text: "second" } },
    { turnId: "foreground-turn-2", provider: "claude", timestamp: at(65), item: { type: "assistant_message", text: "Done before the restart." } },
    { turnId: "foreground-turn-1", provider: "claude", timestamp: at(3600), item: { type: "user_message", text: "after the restart" } },
    { turnId: "foreground-turn-1", provider: "claude", timestamp: at(3605), item: tool("new-cat", "Bash", { type: "shell", command: "cat notes.md" }, "running") },
  ];

  it("opens a new turn when an old turn id comes back, and keeps its work at the top", () => {
    const model = new SonarModel();
    model.load(restarted, { hasOlder: false, maxSeq: 6 });
    const view = model.view(T0 + 3_610_000, running);
    expect(view.turns.map((turn) => turn.label)).toEqual(["TURN 3", "TURN 2", "TURN 1"]);
    expect(new Set(view.turns.map((turn) => turn.key)).size).toBe(3);
    expect(view.turns[0]!.rows[0]).toMatchObject({ title: "cat notes.md", live: true });
    expect(view.clock).toBe("NOW · 10S");
    expect(view.headline.title).toBe("Running cat");
    expect(view.parallel).toBeNull();
  });

  it("stops counting a call as running once a later turn began", () => {
    const model = new SonarModel();
    model.load(restarted, { hasOlder: false, maxSeq: 6 });
    const view = model.view(T0 + 3_610_000, running);
    expect(view.runningCount).toBe(1);
    expect(view.turns[2]!.rows.find((row) => row.title === "ls")).toMatchObject({ status: "canceled", live: false });
  });

  it("closes the newest turn with an id and never opens one at its end", () => {
    const model = new SonarModel();
    model.load(restarted, { hasOlder: false, maxSeq: 6 });
    model.applyStream({ type: "turn_completed", turnId: "foreground-turn-1" }, at(3700));
    model.applyStream({ type: "turn_completed", turnId: "foreground-turn-9" }, at(3701));
    const view = model.view(T0 + 3_710_000, idle);
    expect(view.turns).toHaveLength(3);
    expect(view.turns[0]!.rows[0]).toMatchObject({ title: "cat notes.md", status: "ok" });
  });
});

describe("row order", () => {
  it("puts background work at the top of the newest turn", () => {
    const model = new SonarModel();
    model.load(
      [
        { turnId: "t-1", provider: "claude", timestamp: at(0), item: { type: "user_message", text: "go" } },
        { turnId: "t-1", provider: "claude", timestamp: at(1), item: tool("bg", "Bash", { type: "shell", command: "make build", output: "Command running in background with ID: b1" }) },
        { turnId: "t-1", provider: "claude", timestamp: at(2), item: { type: "assistant_message", text: "ok" } },
      ],
      { hasOlder: false, maxSeq: 3 },
    );
    expect(model.view(T0 + 30_000, idle).turns[0]!.rows.map((row) => row.title)).toEqual(["make build", "Reply", "New message"]);
  });
});

describe("Paseo 0.16 lists", () => {
  const launched: EntryLike[] = [
    { turnId: "foreground-turn-1", provider: "claude", timestamp: at(0), item: { type: "user_message", text: "go" } },
    {
      turnId: "foreground-turn-1",
      provider: "claude",
      timestamp: at(2),
      item: tool("bg", "Bash", { type: "shell", command: "sleep 900", output: "Command running in background with ID: bavjj7hgz. Output is being written to: /tmp/x" }),
    },
    { turnId: "foreground-turn-1", provider: "claude", timestamp: at(4), item: { type: "assistant_message", text: "launched" } },
  ];
  const item = (id: string, command = "sleep 900") => ({ id, kind: "shell", description: `Run ${command}`, command, startedAt: at(2), canStop: true });

  it("keeps a background row live while Paseo lists it, and offers to stop it", () => {
    const model = new SonarModel();
    model.load(launched, { hasOlder: false, maxSeq: 3 });
    model.setBackgroundWork([item("bavjj7hgz")], T0 + 60_000);
    const view = model.view(T0 + 60_000, idle);
    expect(view.backgroundCount).toBe(1);
    const row = view.turns[0]!.rows[0]!;
    expect(row).toMatchObject({ title: "sleep 900", live: true, background: true });
    expect(model.details(row.key, T0 + 60_000)).toMatchObject({ kind: "shell", stop: "bavjj7hgz" });
  });

  it("ends a background row Paseo no longer lists, even without a notice", () => {
    const model = new SonarModel();
    model.load(launched, { hasOlder: false, maxSeq: 3 });
    model.setBackgroundWork([], T0 + 60_000);
    const view = model.view(T0 + 60_000, idle);
    expect(view.backgroundCount).toBe(0);
    const row = view.turns[0]!.rows.find((candidate) => candidate.title === "sleep 900")!;
    expect(row).toMatchObject({ live: false, status: "ok" });
    expect(model.details(row.key, T0 + 60_000)).toMatchObject({ note: "background task bavjj7hgz · ended without a notice", stop: null });
  });

  it("does not end a task the list has not caught up with yet", () => {
    const model = new SonarModel();
    model.load(launched, { hasOlder: false, maxSeq: 3 });
    model.setBackgroundWork([], T0 + 3_000);
    expect(model.view(T0 + 3_000, idle).backgroundCount).toBe(1);
  });

  it("shows listed work no row stands for at the top of the newest turn", () => {
    const model = new SonarModel();
    model.load(launched, { hasOlder: false, maxSeq: 3 });
    model.setBackgroundWork([item("bavjj7hgz"), item("older1", "npm run dev")], T0 + 60_000);
    const view = model.view(T0 + 60_000, idle);
    expect(view.backgroundCount).toBe(2);
    // Linked rows first, then older work no row stands for.
    expect(view.turns[0]!.rows.slice(0, 2).map((row) => row.key)).toEqual([view.turns[0]!.rows[0]!.key, "bg:older1"]);
    expect(view.turns[0]!.rows[1]).toMatchObject({ title: "Run npm run dev", meta: "shell · background", live: true });
    expect(model.details("bg:older1", T0 + 60_000)).toMatchObject({ kind: "shell", command: "npm run dev", stop: "older1" });
  });

  it("ties a Paseo agent to the create_agent call that started it", () => {
    const child = "0f3a9c2b-7d1e-4f5a-8b6c-9d0e1f2a3b4c";
    const created: EntryLike[] = [
      { turnId: "foreground-turn-1", provider: "claude", timestamp: at(0), item: { type: "user_message", text: "split the work" } },
      {
        turnId: "foreground-turn-1",
        provider: "claude",
        timestamp: at(2),
        item: tool("mk", "mcp__paseo__create_agent", { type: "unknown", input: { title: "Review T004", provider: "claude" }, output: `{"agentId":"${child}","type":"claude","status":"running"}` }),
      },
    ];
    const model = new SonarModel();
    model.load(created, { hasOlder: false, maxSeq: 2 });
    const base = { id: child, title: "Review T004", createdAt: at(2), updatedAt: at(30) };
    model.setChildAgent({ ...base, status: "running" });
    let view = model.view(T0 + 40_000, idle);
    expect(view.backgroundCount).toBe(1);
    expect(view.turns[0]!.rows[0]).toMatchObject({ title: "Paseo agent: Review T004", meta: "paseo agent · running · claude", live: true, background: true });
    expect(model.details(view.turns[0]!.rows[0]!.key, T0)).toEqual({ kind: "child", agentId: child, title: "Review T004", state: "running", tone: "normal" });

    model.setChildAgent({ ...base, status: "idle", requiresAttention: true, attentionReason: "permission" });
    view = model.view(T0 + 40_000, idle);
    expect(view.turns[0]!.rows.find((row) => row.title === "Paseo agent: Review T004")).toMatchObject({ meta: "paseo agent · needs you · claude", metaTone: "warn", live: false });

    model.setChildAgent({ id: "other", title: "Docs pass", status: "running", createdAt: at(1), updatedAt: at(5) });
    view = model.view(T0 + 40_000, idle);
    expect(view.turns[0]!.rows.find((row) => row.key === "child:other")).toMatchObject({ title: "Docs pass", meta: "paseo agent · running", live: true });
  });
});

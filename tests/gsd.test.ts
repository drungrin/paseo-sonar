import { describe, expect, it } from "vitest";
import { classify } from "../client/classify";
import { gsdAgent, gsdCalls, gsdTitle, primaryCall, readOutcome } from "../client/gsd";
import { SonarModel } from "../client/model";

const SKILL = "/home/dev/acme-orchestrator/.claude/skills/path/scripts";
const RUNTIME = "R=/home/dev/.gsd-path/runtimes/0f3a9c2b7d1e4f5a6b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a";
const REPO = "--repo /home/dev/acme-orchestrator";

const titleOf = (line: string) => {
  const call = primaryCall(gsdCalls(line));
  return call ? gsdTitle(call) : null;
};

describe("gsdCalls", () => {
  it("finds helpers in a skill's scripts folder, a runtime folder or by --repo", () => {
    expect(gsdCalls(`python3 -B ${SKILL}/dispatch_driver.py finish ${REPO} --task-id T004`)).toEqual([
      { script: "dispatch_driver.py", cmd: "finish", args: ["--repo", "/home/dev/acme-orchestrator", "--task-id", "T004"] },
    ]);
    expect(gsdCalls(`${RUNTIME}; python3 -B $R/pipeline_state.py route ${REPO}`)[0]).toMatchObject({ script: "pipeline_state.py", cmd: "route" });
    expect(gsdCalls(`python3 scripts/check_task_briefs.py ${REPO} --base 1a2b3c4`)[0]).toMatchObject({ script: "check_task_briefs.py", cmd: "" });
  });

  it("follows a scripts folder set earlier in the line", () => {
    expect(gsdCalls("S=.claude/skills/path/scripts; python3 -B $S/review_panel.py merge --kind wave --mode named")[0]).toMatchObject({ script: "review_panel.py", cmd: "merge" });
    expect(gsdCalls("S=tools/bin; python3 -B ${S}/review_panel.py merge")).toEqual([]);
  });

  it("leaves project scripts that only share a name", () => {
    expect(gsdCalls("python3 tools/isolation.py checkpoint")).toEqual([]);
    expect(gsdCalls("python3 -m isolation")).toEqual([]);
    expect(gsdCalls("node isolation.py --repo x")).toEqual([]);
  });

  it("names a line of several helpers after the one that moves the pipeline", () => {
    const line = [
      `python3 -B ${SKILL}/model_policy.py resolve ${REPO} --assignment build_T004`,
      `python3 -B ${SKILL}/check_handoffs.py plan ${REPO} > /dev/null`,
      `python3 -B ${SKILL}/workflow_run.py prepare-task ${REPO} --task-id T004 --round-size 2 > /tmp/prep.json; echo rc=$?`,
    ].join(" && ");
    expect(titleOf(line)).toBe("Prepare T004");
  });
});

describe("gsdTitle", () => {
  const cases: [string, string][] = [
    [`dispatch_driver.py finish ${REPO} --task-id t002`, "Land T002"],
    [`dispatch_driver.py round ${REPO} --wave 2 --child-command 'claude -p'`, "Dispatch wave 2"],
    [`dispatch_driver.py review ${REPO} --wave 1 --cycle 2`, "Review wave 1 · cycle 2"],
    [`pipeline_state.py transition ${REPO} --expect-phase plan --expect-status done --set-phase build --set-status active`, "Transition plan → build"],
    [`pipeline_state.py transition ${REPO} --expect-phase define --set-phase define --set-status done`, "Mark define done"],
    [`pipeline_state.py approve ${REPO} --kind roadmap-reslice`, "Approve roadmap reslice"],
    [`isolation.py checkpoint ${REPO} --subject 'build: record T004 verify ledger'`, "Checkpoint “build: record T004 verify ledger”"],
    [`isolation.py stage-review ${REPO} --source-path .project/review/plan-panel-gpt.md`, "Stage review plan-panel-gpt"],
    [`isolation.py activate-member-task ${REPO} --member api --task-id $ID`, "Activate a task"],
    [`isolation.py isolate-verify ${REPO} --name wave-1-panel-$f`, "Isolate wave-1-panel-…"],
    [`model_policy.py resolve ${REPO} --assignment build_T003`, "Model for T003"],
    [`model_policy.py release ${REPO} --assignment review_plan_panel_gpt`, "Release model · review plan panel gpt"],
    [`check_handoffs.py intent ${REPO}`, "Check the intent handoff"],
    [`workflow_run.py gate-plan ${REPO}`, "Gate the plan"],
    [`workflow_run.py finish-inspect ${REPO}`, "Finish inspection"],
    [`review_panel.py merge --kind plan --mode named ${REPO}`, "Merge the plan panel"],
    [`pipeline_diagnose.py run ${REPO}`, "pipeline_diagnose.py run"],
  ];
  it.each(cases)("%s → %s", (args, title) => {
    expect(titleOf(`python3 -B ${SKILL}/${args}`)).toBe(title);
  });
});

describe("gsdAgent", () => {
  it("reads GSD Path's logical task names as title and role", () => {
    expect(gsdAgent("build_T003")).toEqual({ title: "Build T003", facts: ["builder"] });
    expect(gsdAgent("review_plan_panel_gpt")).toEqual({ title: "Review the plan · panel gpt", facts: ["panelist"] });
    expect(gsdAgent("review_wave_1_cycle_2_panel_muse")).toEqual({ title: "Review wave 1 · panel muse", facts: ["panelist", "cycle 2"] });
    expect(gsdAgent("review_wave_3_cycle_1_adversarial")).toEqual({ title: "Review wave 3 · adversarial", facts: ["reviewer", "cycle 1"] });
    expect(gsdAgent("inspect_codebase_api")).toEqual({ title: "Map the codebase · api", facts: ["mapper"] });
    expect(gsdAgent("research_stack")).toEqual({ title: "Research stack", facts: ["researcher"] });
    expect(gsdAgent("decide")).toEqual({ title: "Decide", facts: ["decider"] });
  });

  it("leaves other names alone", () => {
    expect(gsdAgent("Find the flaky test")).toBeNull();
    expect(gsdAgent("build the docs site")).toBeNull();
    expect(gsdAgent("")).toBeNull();
  });
});

describe("readOutcome", () => {
  const finish = { script: "dispatch_driver.py", cmd: "finish", args: [] };

  it("reads a landing, a blocked task and a question from the dispatch receipt", () => {
    const landed = JSON.stringify({ blocked: [], dispatched: [], in_flight: [], landed: [{ commit: "9aea29d905570e4e92bde1a977b64352a72c344f", task: "T004" }], status: "landed" });
    expect(readOutcome(`${landed}\n`, finish)).toEqual({ word: "landed", facts: ["T004 9aea29d"], stamped: false });

    const blocked = JSON.stringify({ blocked: [{ task: "T002", reason: "Verify failed: exit 1" }], landed: [], status: "blocked" });
    expect(readOutcome(blocked, finish)).toMatchObject({ verdict: "err", word: "blocked", failure: "T002 · Verify failed: exit 1" });

    const question = JSON.stringify({ blocked: [], landed: [], status: "question" });
    expect(readOutcome(question, finish)).toMatchObject({ verdict: "warn", word: "question" });
  });

  it("reads a failed handoff gate behind exit 0", () => {
    const output = "handoff validation failed: INTENT.md Prohibitions does not walk SC1, SC5\ngate exit 1\n";
    expect(readOutcome(output, { script: "check_handoffs.py", cmd: "intent", args: [] })).toMatchObject({
      verdict: "err",
      word: "failed",
      failure: "INTENT.md Prohibitions does not walk SC1, SC5",
    });
  });

  it("takes facts from the row's own helper only, and failures from any", () => {
    const gate = { script: "workflow_run.py", cmd: "gate-plan", args: [] };
    const model = JSON.stringify({ active: false, selection: { selected: { model: "sonnet" } } });
    expect(readOutcome(`complete\n${model}`, gate)).toBeNull();
    const blocked = JSON.stringify({ status: "blocked", reason: "review_panel: task requests model='gpt-x', unavailable" });
    expect(readOutcome(`${blocked}`, gate)).toMatchObject({ verdict: "err", failure: "review_panel: task requests model='gpt-x', unavailable" });
  });

  it("reads pretty-printed receipts and route blocks", () => {
    const merge = { script: "review_panel.py", cmd: "merge", args: [] };
    const pretty = '{\n  "actionable": 8,\n  "conflicts": 0,\n  "families": [\n    "gpt",\n    "muse"\n  ]\n}\nretired-2';
    expect(readOutcome(pretty, merge)).toEqual({ facts: ["8 actionable"], stamped: false });
    const route = { script: "pipeline_state.py", cmd: "route", args: [] };
    const blocked = JSON.stringify({ schema: "gsd-path/route/v1", route: { action: "block", reason: "STATE.md is at build/blocked" } });
    expect(readOutcome(blocked, route)).toMatchObject({ verdict: "warn", word: "blocked", facts: ["STATE.md is at build/blocked"] });
  });

  it("prefers a GSD-RECEIPT v1 line over everything else", () => {
    const output = [
      '{"blocked": [{"task": "T009", "reason": "old"}], "landed": []}',
      'GSD-RECEIPT v1 {"script": "dispatch_driver.py", "cmd": "finish", "outcome": "ok", "status": "landed", "task": "T002", "commit": "9aea29d905570e4e92bde1a977b64352a72c344f", "exit": 0}',
    ].join("\n");
    expect(readOutcome(output, finish)).toEqual({ word: "landed", facts: ["9aea29d"], stamped: true });
    const failed = 'GSD-RECEIPT v1 {"script": "check_handoffs.py", "cmd": "plan", "outcome": "fail", "status": "failed", "reason": "PLAN.md misses SC3", "exit": 1}';
    expect(readOutcome(failed, finish)).toMatchObject({ verdict: "err", word: "failed", failure: "PLAN.md misses SC3", stamped: true });
  });

  it("never labels a stamped warning or failure with a plain word", () => {
    const route = { script: "pipeline_state.py", cmd: "route", args: [] };
    const warn = 'GSD-RECEIPT v1 {"cmd": "route", "exit": 0, "outcome": "warn", "reason": "build is blocked", "script": "pipeline_state.py", "status": "ok"}';
    expect(readOutcome(warn, route)).toMatchObject({ verdict: "warn", word: "attention", facts: ["build is blocked"] });
    const fail = 'GSD-RECEIPT v1 {"cmd": "route", "exit": 3, "outcome": "fail", "script": "pipeline_state.py", "status": "ok"}';
    expect(readOutcome(fail, route)).toMatchObject({ verdict: "err", word: "failed", failure: "failed" });
  });

  it("says committed once, from either receipt", () => {
    const checkpoint = { script: "isolation.py", cmd: "checkpoint", args: [] };
    const json = '{"commit": "b7f0c2d91e8a4b3c5d6e7f8091a2b3c4d5e6f708", "status": "committed"}';
    const stamp = 'GSD-RECEIPT v1 {"cmd": "checkpoint", "commit": "b7f0c2d91e8a4b3c5d6e7f8091a2b3c4d5e6f708", "exit": 0, "outcome": "ok", "script": "isolation.py", "status": "committed"}';
    expect(readOutcome(json, checkpoint)).toEqual({ word: "committed", facts: ["b7f0c2d"], stamped: false });
    expect(readOutcome(`${stamp}\n${json}`, checkpoint)).toEqual({ word: "committed", facts: ["b7f0c2d"], stamped: true });
  });

  it("keeps the helper's own facts beside a stamped line", () => {
    const merge = { script: "review_panel.py", cmd: "merge", args: [] };
    const output = [
      '{"actionable": 3, "conflicts": 1, "families": ["gpt", "muse"]}',
      'GSD-RECEIPT v1 {"cmd": "merge", "exit": 0, "outcome": "ok", "script": "review_panel.py", "status": "ok"}',
    ].join("\n");
    expect(readOutcome(output, merge)).toEqual({ facts: ["3 actionable", "1 conflict"], stamped: true });
  });

  it("says nothing about outputs it cannot read", () => {
    expect(readOutcome("", finish)).toBeNull();
    expect(readOutcome("exit 0\n[('T005', 'e6aa65b', 0, [])]\n", finish)).toBeNull();
    expect(readOutcome('GSD-RECEIPT v1 {"script": "x.py", "outcome": "maybe"}', finish)).toBeNull();
    expect(readOutcome("GSD-RECEIPT v1 {not json", finish)).toBeNull();
    expect(readOutcome('{"status": "ok"', finish)).toBeNull();
  });
});

describe("GSD Path rows", () => {
  const T0 = Date.parse("2026-11-14T12:00:00Z");
  const shell = (callId: string, command: string, output: string) => ({
    item: { type: "tool_call", callId, name: "Bash", status: "completed", detail: { type: "shell", command, output, exitCode: 0 } },
    timestamp: T0,
    turnId: "turn-1",
    provider: "claude",
  });
  const rows = (entries: ReturnType<typeof shell>[]) => {
    const model = new SonarModel();
    model.load(entries, { hasOlder: false, maxSeq: 0 });
    return model.view(T0 + 1000, { status: "idle", model: null, thinking: null }).turns.flatMap((turn) => turn.rows);
  };

  it("shows the receipt's word instead of the exit code, and fails a blocked landing", () => {
    const landed = JSON.stringify({ blocked: [], landed: [{ commit: "9aea29d905570e4e92bde1a977b64352a72c344f", task: "T002" }] });
    const blocked = JSON.stringify({ blocked: [{ task: "T003", reason: "Verify failed" }], landed: [] });
    const [second, first] = rows([
      shell("a", `python3 -B ${SKILL}/dispatch_driver.py finish ${REPO} --task-id T002`, landed),
      shell("b", `python3 -B ${SKILL}/dispatch_driver.py finish ${REPO} --task-id T003`, blocked),
    ]);
    expect(first).toMatchObject({ title: "Land T002", meta: "gsd-path · landed · T002 9aea29d", status: "ok", metaTone: "normal" });
    expect(second).toMatchObject({ title: "Land T003", meta: "gsd-path · T003 · Verify failed", status: "err", trailing: "blocked", pinned: true });
  });

  it("keeps the exit code when the output says nothing, and tints a question", () => {
    const [question, silent] = rows([
      shell("a", `python3 -B ${SKILL}/dispatch_driver.py finish ${REPO} --task-id T002 > /tmp/finish.json; echo "exit $?"`, "exit 0\n"),
      shell("b", `python3 -B ${SKILL}/dispatch_driver.py finish ${REPO} --task-id T005`, '{"blocked": [], "landed": [], "status": "question"}'),
    ]);
    expect(silent).toMatchObject({ title: "Land T002", meta: "gsd-path · exit 0", status: "ok" });
    expect(question).toMatchObject({ meta: "gsd-path · question", metaTone: "warn", status: "ok" });
  });

  it("drops the exit code once a receipt has been read", () => {
    const [merged] = rows([
      shell("a", `S=${SKILL}; python3 -B $S/review_panel.py merge --kind wave --mode named`, '{"actionable": 3, "conflicts": 0, "families": ["gpt", "muse"]}'),
    ]);
    expect(merged).toMatchObject({ title: "Merge the wave panel", meta: "gsd-path · 3 actionable", status: "ok" });
  });

  it("leaves other Python scripts as they were", () => {
    const result = classify({ name: "Bash", status: "completed", detail: { type: "shell", command: "python3 -B ~/tools/dispatch_driver.py finish T002", output: '{"blocked": [{"task": "T1"}], "landed": []}' } });
    expect(result).toMatchObject({ title: "dispatch_driver.py finish T002", tool: "python3" });
    expect(result.verdict).toBeUndefined();
  });
});

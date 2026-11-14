import { describe, expect, it } from "vitest";
import { classify, lineDiff, shortUrl, unifiedDiffStat } from "../client/classify";
import { shellStation } from "../client/shell";

const call = (name: string, detail: Record<string, unknown> & { type: string }, status: "running" | "completed" | "failed" = "completed", error: unknown = null) => ({
  name,
  status,
  detail,
  error,
});

describe("shellStation", () => {
  it("reads file-only commands as Files", () => {
    expect(shellStation("ls -la")).toBe("files");
    expect(shellStation("cd src && grep -rn add . | head -5")).toBe("files");
    expect(shellStation('find . -path ./.git -prune -o -type f -print')).toBe("files");
  });

  it("reads commands that reach the network as Network, also behind wrappers and inside $(…)", () => {
    expect(shellStation("curl -s https://example.com")).toBe("network");
    expect(shellStation("git -C repo push origin main")).toBe("network");
    expect(shellStation("sudo npm install")).toBe("network");
    expect(shellStation('echo "$(gh pr view 3)"')).toBe("network");
    expect(shellStation("npx vitest")).toBe("shell");
    expect(shellStation("npx -y create-thing")).toBe("network");
  });

  it("reads quotes, redirections and nested commands as a shell does", () => {
    expect(shellStation('grep -E "VERIFY_EXIT|^Tests:|FAIL" /tmp/v.txt | head -60')).toBe("files");
    expect(shellStation("grep -rn todo src 2>&1 | wc -l")).toBe("files");
    expect(shellStation("python3 -m pip install requests")).toBe("network");
    expect(shellStation("echo `curl -s ifconfig.me`")).toBe("network");
    expect(shellStation("env FOO=1 timeout 30 git fetch origin")).toBe("network");
  });

  it("leaves everything else on Shell", () => {
    expect(shellStation("npm test -- unit")).toBe("shell");
    expect(shellStation("node -e 'process.exit(1)'")).toBe("shell");
    expect(shellStation("git commit -q -m 'chore: record'")).toBe("shell");
  });

  it("puts file commands on Claude Code's memory folder on Memory", () => {
    expect(shellStation("cat ~/.claude/projects/-home-x/memory/MEMORY.md")).toBe("memory");
  });
});

describe("diff counts", () => {
  it("counts lines added and removed between two strings", () => {
    expect(lineDiff("a\nb\n", "a\nb\nc\n")).toEqual({ added: 1, removed: 0 });
    expect(lineDiff("a\nb\nc\n", "a\nx\nc\n")).toEqual({ added: 1, removed: 1 });
  });

  it("counts a unified diff without its file headers", () => {
    expect(unifiedDiffStat("--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n a\n-b\n+c\n+d\n")).toEqual({ added: 2, removed: 1 });
  });
});

describe("shortUrl", () => {
  it("keeps host and path, never a login or a query", () => {
    expect(shortUrl("https://vitest.dev/config/?q=1#x")).toBe("vitest.dev/config");
    expect(shortUrl("https://user:secret@example.com/a")).toBe("example.com/a");
  });
});

describe("classify", () => {
  it("names a Claude Edit with its line counts", () => {
    const result = classify(
      call("Edit", { type: "edit", filePath: "/w/src/vitest.config.ts", oldString: "a\n", newString: "a\nb\nc\n" }),
    );
    expect(result).toMatchObject({ station: "files", title: "Edit vitest.config.ts", doing: "Editing vitest.config.ts", tool: "Edit", facts: ["+2 −0"] });
  });

  it("names a Codex apply_patch from its unified diff", () => {
    const result = classify(call("apply_patch", { type: "edit", filePath: "a.ts", unifiedDiff: "@@\n+x\n-y\n" }));
    expect(result.facts).toEqual(["+1 −1"]);
  });

  it("sizes a read by its content", () => {
    expect(classify(call("Read", { type: "read", filePath: "/w/STATE.md", content: "x".repeat(2150) })).facts).toEqual(["2.1 KB"]);
  });

  it("puts a fetch on Network with its status and size when the provider gives them", () => {
    const result = classify(call("WebFetch", { type: "fetch", url: "https://vitest.dev/config", code: 200, bytes: 49_152 }));
    expect(result).toMatchObject({ station: "network", title: "Fetch vitest.dev/config", facts: ["200", "48 KB"] });
  });

  it("reports a failed command's exit code and test failures", () => {
    const result = classify(
      call("Bash", { type: "shell", command: "npm test -- unit", output: "Tests  2 failed | 10 passed" }, "failed", "Exit code 1\nTests  2 failed | 10 passed"),
    );
    expect(result).toMatchObject({ station: "shell", exitCode: 1, failure: "2 failed", doing: "Running npm test" });
  });

  it("reads tools known only by name", () => {
    expect(classify(call("Skill", { type: "unknown", input: { skill: "review" }, output: null })).station).toBe("skills");
    expect(classify(call("ToolSearch", { type: "unknown", input: { query: "select:Glob" }, output: null })).title).toBe("Load tools");
    expect(classify(call("TodoWrite", { type: "unknown", input: {}, output: null })).station).toBe("you");
    expect(classify(call("mcp__paseo__browser_click", { type: "unknown", input: {}, output: null })).station).toBe("browser");
    expect(classify(call("mcp__playwright__browser_navigate", { type: "unknown", input: { url: "https://a.dev/x" }, output: null })).title).toBe("browser navigate a.dev/x");
    expect(classify(call("mcp__memory__read_graph", { type: "unknown", input: {}, output: null })).station).toBe("memory");
    expect(classify(call("mcp__context7__query-docs", { type: "unknown", input: {}, output: null })).station).toBe("network");
  });

  it("puts subagents on Agents", () => {
    const result = classify(call("Agent", { type: "sub_agent", description: "Find the bug", subAgentType: "Explore", actions: [{ index: 0, toolName: "Read" }] }));
    expect(result).toMatchObject({ station: "agents", title: "Agent: Find the bug", facts: ["Explore", "1 action"] });
  });
});

describe("oneLine", () => {
  it("turns hidden characters into single spaces and cuts long text", async () => {
    const { oneLine } = await import("../client/classify");
    expect(oneLine("a\u0007b\n\n c‮d")).toBe("a b c d");
    expect(oneLine("abcdefghij", 5)).toBe("abcd…");
  });
});

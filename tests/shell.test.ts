import { describe, expect, it } from "vitest";
import { middleCut, shellTitle, shortPath } from "../client/shell";

describe("shellTitle", () => {
  it("names a script run by an interpreter by the script and its arguments", () => {
    expect(shellTitle("python3 -B /home/dev/projects/acme-orchestrator/.claude/skills/path/scripts/dispatch_driver.py finish T002")).toEqual({
      title: "dispatch_driver.py finish T002",
      family: "python3",
    });
    expect(shellTitle("python3 -B /home/agent/.gsd-path/runtimes/7d1a3e90b4c28f5e61a0d7b3c9e4f2a8b5d6c1e0/verify.py --suite unidade").title).toBe(
      "verify.py --suite unidade",
    );
    expect(shellTitle("python3 -m pytest tests/offline -q")).toEqual({ title: "pytest tests/offline -q", family: "python3 -m" });
  });

  it("moves git's -C folder to the family, shortened", () => {
    expect(shellTitle("git -C /home/dev/.gsd-path/projects/9f2e41a07c3b55d8e6a1f0b4c7d29e83a5b6c1d0f4e7a2b9c8d3e6f1a0b5c4d7 log --oneline -5")).toEqual({
      title: "git log --oneline -5",
      family: "git -C ~/.gsd-path/projects/9f2e…",
    });
  });

  it("skips cd, wrappers and assignments to reach the command that does the work", () => {
    expect(shellTitle("cd /home/dev/repo && FOO=1 timeout 60 npm test -- unit")).toEqual({ title: "npm test -- unit", family: "npm" });
    expect(shellTitle("sudo -u web node /srv/app/scripts/migrate.js --dry-run").title).toBe("migrate.js --dry-run");
  });

  it("shortens path arguments and cuts long titles in the middle", () => {
    expect(shellTitle("cat /home/dev/projects/a/b/README.md").title).toBe("cat ~/projects/a/b/README.md");
    const long = shellTitle(`grep -E "VERIFY_EXIT|^Tests:|^Test Suites:|FAIL|PASS|ERROR|WARN|SKIP" /tmp/m012-verify.txt`).title;
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long).toMatch(/^grep -E .*….*m012-verify\.txt$/);
  });
});

describe("shortPath and middleCut", () => {
  it("writes home as ~ and folds folders named by hashes", () => {
    expect(shortPath("/home/agent/.gsd-path/runtimes/7d1a3e90b4c28f5e61a0d7b3c9e4f2a8/verify.py")).toBe("~/.gsd-path/runtimes/7d1a…/verify.py");
    expect(shortPath("/Users/ana/x")).toBe("~/x");
  });

  it("keeps both ends of a long text", () => {
    expect(middleCut("abcdefghijklmnopqrstuvwxyz", 11)).toBe("abcdefg…xyz");
  });
});

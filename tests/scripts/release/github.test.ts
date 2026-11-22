import { describe, expect, it, vi } from "vitest";
import { githubRelease, repository } from "../../../scripts/release/github.js";

const sha = "a".repeat(40);
const base = "b".repeat(40);
const merged = "c".repeat(40);
const api = `repos/${repository}`;
const prRoute = `${api}/pulls/42`;
const branch = (ref: string, commit: string) => ({ ref, sha: commit, repo: { full_name: repository } });
const pull = { head: branch("staging", sha), base: branch("main", base), state: "open", draft: false,
  merged: false, merge_commit_sha: null, mergeable_state: "clean" };

describe("GitHub promotion", () => {
  it("refuses a staging promotion without a passing production check", () => {
    const run = vi.fn((program: string, [command, route]: string[]) => {
      if (program === "gh" && command === "api" && route === prRoute) return JSON.stringify(pull);
      if (program === "gh" && command === "pr" && route === "checks") return JSON.stringify([{ name: "other", bucket: "pass" }]);
      throw new Error("Unexpected command.");
    });
    const release = githubRelease("42", run, vi.fn());
    expect(() => release.verifyPromotion()).toThrow("The production check");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("refuses to merge if staging changed after the preflight", () => {
    const run = vi.fn((program: string, [command, route]: string[]) => {
      if (program === "gh" && command === "api" && route === prRoute) return JSON.stringify(pull);
      if (program === "gh" && command === "pr" && route === "checks") return JSON.stringify([{ name: "production", bucket: "pass" }]);
      if (program === "gh" && command === "api" && route === `${api}/releases`) return "";
      if (program === "git" && command === "ls-remote") return "";
      throw new Error("Unexpected command.");
    });
    const release = githubRelease("42", run, vi.fn());
    release.verifyPromotion();
    run.mockReturnValueOnce(JSON.stringify({ ...pull, head: branch("staging", base) }));
    expect(() => release.publish()).toThrow("The staging head changed");
    expect(run).toHaveBeenCalledTimes(5);
  });

  it("merges through GitHub at the approved head and publishes at the merge commit", () => {
    let promoted = false;
    let publishedTag: string | undefined;
    const run = vi.fn((program: string, args: string[]) => {
      const [command, route] = args;
      if (program === "gh" && command === "api" && route === prRoute) {
        return JSON.stringify(promoted ? { ...pull, state: "closed", merged: true, merge_commit_sha: merged } : pull);
      }
      if (program === "gh" && command === "pr" && route === "checks") return JSON.stringify([{ name: "production", bucket: "pass" }]);
      if (program === "gh" && command === "api" && route === "--method") {
        expect(args).toEqual(["api", "--method", "PUT", `${prRoute}/merge`, "-f", `sha=${sha}`, "-f", "merge_method=merge"]);
        promoted = true;
        return JSON.stringify({ merged: true, sha: merged });
      }
      if (program === "gh" && command === "api" && route === `${api}/branches/main`) return JSON.stringify({ commit: { sha: merged } });
      if (program === "gh" && command === "api" && route === `${api}/commits/${merged}`) {
        return JSON.stringify({ parents: [{ sha: base }, { sha }] });
      }
      if (program === "gh" && command === "api" && route === `${api}/releases`) return "";
      if (program === "git" && command === "ls-remote") return publishedTag === undefined ? "" : `${merged}\trefs/tags/${publishedTag}`;
      if (program === "gh" && command === "release" && route === "create") {
        expect(args[2]).toMatch(/^v\d{4}\.\d{2}\.\d{2}$/u);
        expect(args.slice(3)).toEqual(["--repo", repository, "--generate-notes", "--target", merged]);
        publishedTag = args[2];
        return "https://example.test/release";
      }
      throw new Error("Unexpected command.");
    });
    const release = githubRelease("42", run, vi.fn());
    release.verifyPromotion();
    release.publish();
    expect(publishedTag).toBeDefined();
    expect(release.target()).toEqual({ tag: publishedTag, commit: merged });
  });
});

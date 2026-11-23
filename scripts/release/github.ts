import { z } from "zod";
import { systemClock } from "../../src/rules/time/clock.js";
import { nextReleaseTag } from "./release.js";

export const repository = "julianthant/hr-relay";
export const remote = `https://github.com/${repository}.git`;
const api = `repos/${repository}`;
const shaSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const tagPattern = /^v\d{4}\.\d{2}\.\d{2}(?:\.[1-9]\d*)?$/u;
const branchSchema = z.object({ ref: z.string(), sha: shaSchema, repo: z.object({ full_name: z.string() }).nullable() });
const pullSchema = z.object({
  head: branchSchema, base: branchSchema, state: z.enum(["open", "closed"]), draft: z.boolean(),
  merged: z.boolean(), merge_commit_sha: shaSchema.nullable(), mergeable_state: z.string(),
});
type Run = (program: string, args: string[]) => string;

export function githubRelease(number: string, run: Run, report: (message: string) => void) {
  const gh = (...args: string[]) => run("gh", args);
  const read = <T>(route: string, schema: z.ZodType<T>): T => schema.parse(JSON.parse(gh("api", `${api}/${route}`)));
  const pull = () => read(`pulls/${number}`, pullSchema);
  const main = () => read("branches/main", z.object({ commit: z.object({ sha: shaSchema }) })).commit.sha;
  const tags = () => {
    const entries = new Map<string, string>();
    const output = run("git", ["ls-remote", "--tags", remote]);
    for (const line of output.split("\n").filter(Boolean)) {
      const match = /^([0-9a-f]{40})\trefs\/tags\/(.+?)(\^\{\})?$/u.exec(line);
      if (match === null) throw new Error("Could not read remote release tags.");
      if (match[3] !== undefined || !entries.has(match[2])) entries.set(match[2], match[1]);
    }
    return entries;
  };
  const releases = () => gh("api", `${api}/releases`, "--paginate", "--jq", ".[] | [.tag_name, .draft] | @tsv")
    .split("\n").filter(Boolean).map(line => {
      const [tag, draft] = line.split("\t");
      if (!tag || (draft !== "true" && draft !== "false")) throw new Error("Could not read GitHub Releases.");
      return { tag, draft: draft === "true" };
    });
  const validateBranches = ({ head, base }: z.infer<typeof pullSchema>) => {
    if (head.ref !== "staging" || base.ref !== "main" || head.repo?.full_name !== repository || base.repo?.full_name !== repository) {
      throw new Error("Release requires a staging-to-main pull request in HR Relay.");
    }
  };
  const verify = (pr: z.infer<typeof pullSchema>) => {
    validateBranches(pr);
    if (pr.merged) {
      if (pr.merge_commit_sha !== main()) throw new Error("This promotion is no longer the main tip.");
    } else if (pr.state !== "open" || pr.draft || pr.mergeable_state !== "clean") {
      throw new Error("The staging promotion must be open, ready, and clear of GitHub merge requirements.");
    }
    const checks = z.array(z.object({ name: z.string(), bucket: z.string() })).parse(JSON.parse(
      gh("pr", "checks", number, "--repo", repository, "--required", "--json", "name,bucket"),
    ));
    if (!checks.some(check => check.name === "production" && check.bucket === "pass")
      || checks.some(check => check.bucket !== "pass" && check.bucket !== "skipping")) {
      throw new Error("The production check and all other required checks must pass.");
    }
  };
  let approvedHead: string | undefined;
  let tag: string | undefined;
  let commit: string | undefined;
  const pickTag = (target: string | null) => {
    const currentTags = tags();
    const existing = releases();
    const matching = [...currentTags].filter(([name, sha]) => tagPattern.test(name) && sha === target);
    if (matching.length > 1) throw new Error("More than one release tag names this promotion.");
    return { currentTags, existing, tag: matching[0]?.[0] ?? nextReleaseTag(systemClock.todayLocal(), [
      ...currentTags.keys(), ...existing.map(release => release.tag),
    ]) };
  };
  return {
    verifyPromotion() {
      const pr = pull();
      verify(pr);
      approvedHead = pr.head.sha;
      report(`Release tag ${pickTag(pr.merged ? pr.merge_commit_sha : null).tag}`);
    },
    publish() {
      const pr = pull();
      if (pr.head.sha !== approvedHead) throw new Error("The staging head changed after approval. Review the updated promotion.");
      verify(pr);
      if (pr.merged) commit = shaSchema.parse(pr.merge_commit_sha);
      else {
        const result = z.object({ merged: z.literal(true), sha: shaSchema }).parse(JSON.parse(
          gh("api", "--method", "PUT", `${api}/pulls/${number}/merge`, "-f", `sha=${pr.head.sha}`, "-f", "merge_method=merge"),
        ));
        commit = result.sha;
      }
      const merged = pull();
      if (!merged.merged || merged.merge_commit_sha !== commit || commit !== main()) {
        throw new Error("GitHub did not confirm the promotion as the main tip.");
      }
      const parents = read(`commits/${commit}`, z.object({ parents: z.array(z.object({ sha: shaSchema })) })).parents;
      if (parents.length !== 2 || parents[1].sha !== approvedHead) throw new Error("The merge commit does not contain the approved staging head as its second parent.");
      const plan = pickTag(commit);
      tag = plan.tag;
      const existing = plan.existing.find(release => release.tag === tag);
      if (existing?.draft) throw new Error("The promotion tag has a draft release. Resolve it before continuing.");
      if (existing === undefined) {
        const target = plan.currentTags.has(tag) ? ["--verify-tag"] : ["--target", commit];
        report(gh("release", "create", tag, "--repo", repository, "--generate-notes", ...target));
      }
      if (tags().get(tag) !== commit) throw new Error("The published tag does not point to the promotion merge commit.");
      report(`Published ${tag} at ${commit}.`);
    },
    syncStaging() {
      if (commit === undefined || commit !== main()) throw new Error("Main changed before the staging sync.");
      const comparison = read(`compare/staging...${commit}`, z.object({ ahead_by: z.number().int().nonnegative() }));
      if (comparison.ahead_by === 0) return;
      const existing = read("pulls?state=open&base=staging&head=julianthant%3Amain", z.array(z.object({ html_url: z.url() })));
      report(existing[0]?.html_url ?? gh("pr", "create", "--repo", repository, "--base", "staging", "--head", "main",
        "--title", `Release: Sync main into staging after ${tag}`, "--body", `Sync the merge commit for release ${tag} back into staging.`));
    },
    target() {
      if (tag === undefined || commit === undefined) throw new Error("Publish the release before deploying.");
      return { tag, commit };
    },
  };
}

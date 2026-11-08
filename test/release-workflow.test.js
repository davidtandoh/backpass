// .github/workflows/release-please.yml must create releases and publish to npm
// only in the upstream repository, never in a fork. Each job's `if:` expression is
// evaluated against upstream and fork event contexts to decide which jobs run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const workflow = readFileSync(new URL(".github/workflows/release-please.yml", root), "utf8");
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

/** Upstream owner/name, from package.json's repository URL. */
const UPSTREAM = /github\.com\/([^/]+\/[^/.]+)/.exec(pkg.repository.url)?.[1];
const FORK = "davidtandoh/backpass";

/** Top-level jobs as { name, if }: `if` is the job-level expression, unwrapped from ${{ }}. */
function parseJobs(text) {
  const lines = text.split("\n");
  const start = lines.indexOf("jobs:");
  assert.ok(start >= 0, "workflow has a jobs: block");
  const jobs = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const head = /^ {2}([\w-]+):\s*$/.exec(line);
    if (head) {
      jobs.push({ name: head[1], if: undefined });
      continue;
    }
    const job = jobs.at(-1);
    if (!job) continue;
    const cond = /^ {4}if:\s*(.+?)\s*$/.exec(line);
    if (cond) job.if = cond[1].replace(/^\$\{\{\s*(.*?)\s*\}\}$/, "$1");
  }
  return jobs;
}

/**
 * Evaluate the GitHub Actions expression subset this workflow uses:
 * `a == b`, `&&`, string literals, and dotted context paths.
 * Anything else throws, so an unsupported guard cannot silently pass.
 */
function evaluate(expr, ctx) {
  const operand = (s) => {
    s = s.trim();
    const lit = /^'([^']*)'$/.exec(s);
    if (lit) return lit[1];
    if (!/^[\w.]+$/.test(s)) throw new Error(`unsupported operand: ${s}`);
    return s.split(".").reduce((o, k) => o?.[k], ctx);
  };
  const compare = (s) => {
    const m = /^(.+?)\s*==\s*(.+)$/.exec(s.trim());
    if (!m) throw new Error(`unsupported condition: ${s}`);
    return operand(m[1]) === operand(m[2]);
  };
  return expr.split("&&").every(compare);
}

/** Names of jobs that would run for the given repository and event. */
function runs(repository, eventName) {
  const ctx = { github: { repository, event_name: eventName } };
  return parseJobs(workflow)
    .filter((job) => job.if === undefined || evaluate(job.if, ctx))
    .map((job) => job.name);
}

test("upstream identity comes from package.json", () => {
  assert.equal(UPSTREAM, "kunchenguid/backpass");
});

test("upstream keeps release creation on push and republish on dispatch", () => {
  assert.deepEqual(runs(UPSTREAM, "push"), ["release-please"]);
  assert.deepEqual(runs(UPSTREAM, "workflow_dispatch"), ["npm-republish"]);
});

test("a fork runs no job on any trigger", () => {
  for (const event of ["push", "workflow_dispatch"]) {
    assert.deepEqual(runs(FORK, event), [], `fork ${event}`);
  }
});

test("the evaluator rejects expressions it does not understand", () => {
  assert.throws(() => evaluate("contains(github.repository, 'x')", {}), /unsupported/);
});

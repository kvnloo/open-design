import assert from "node:assert/strict";
import { test } from "vitest";

import {
  formatForkApprovalSkipComment,
  getBlockedChangedPaths,
  hasPullApprovalStateDrift,
  isAllowedChangedPath,
  isDeniedChangedPath,
  isPendingApprovalRun,
  listPendingApprovalRuns,
  planForkApprovalSkipComment,
  runTargetsPullRequest,
  waitForPendingApprovalRuns,
} from "../../../scripts/approve-fork-pr-workflows.ts";

test("isPendingApprovalRun matches approval-gated fork PR runs from GitHub's captured payload shape", () => {
  const pull = {
    number: 2683,
    state: "open",
    changed_files: 1,
    head: {
      ref: "fix/workflow-linkage",
      sha: "734076155c44e569304856590019cea54506fdab",
      repo: { full_name: "someone/open-design" },
    },
    base: {
      ref: "main",
      sha: "4cd93a5c7a7b0db1961c854e55f8e0e6b1b45542",
      repo: { full_name: "nexu-io/open-design" },
    },
  };

  const run = {
    id: 26273463769,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: "734076155c44e569304856590019cea54506fdab",
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };

  assert.equal(isPendingApprovalRun(run, pull), true);
});

test("isPendingApprovalRun also accepts action_required runs reported only in status", () => {
  const pull = {
    number: 2683,
    state: "open",
    changed_files: 1,
    head: {
      ref: "fix/workflow-linkage",
      sha: "734076155c44e569304856590019cea54506fdab",
      repo: { full_name: "someone/open-design" },
    },
    base: {
      ref: "main",
      sha: "4cd93a5c7a7b0db1961c854e55f8e0e6b1b45542",
      repo: { full_name: "nexu-io/open-design" },
    },
  };

  const run = {
    id: 26273463770,
    name: "CI",
    event: "pull_request",
    status: "action_required",
    conclusion: null,
    head_sha: "734076155c44e569304856590019cea54506fdab",
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };

  assert.equal(isPendingApprovalRun(run, pull), true);
});

test("isPendingApprovalRun rejects runs outside the allowlist or without action_required state", () => {
  const pull = {
    number: 2683,
    state: "open",
    changed_files: 1,
    head: {
      ref: "fix/workflow-linkage",
      sha: "734076155c44e569304856590019cea54506fdab",
      repo: { full_name: "someone/open-design" },
    },
    base: {
      ref: "main",
      sha: "4cd93a5c7a7b0db1961c854e55f8e0e6b1b45542",
      repo: { full_name: "nexu-io/open-design" },
    },
  };

  assert.equal(
    isPendingApprovalRun(
      {
        id: 26273463769,
        name: "CI",
        event: "pull_request",
        status: "completed",
        conclusion: "success",
        head_sha: "734076155c44e569304856590019cea54506fdab",
        path: ".github/workflows/ci.yml@main",
        pull_requests: [],
      },
      pull,
    ),
    false,
  );

  assert.equal(
    isPendingApprovalRun(
      {
        id: 26273463770,
        name: "Visual PR Comment",
        event: "pull_request",
        status: "completed",
        conclusion: "action_required",
        head_sha: "734076155c44e569304856590019cea54506fdab",
        path: ".github/workflows/comment.atom.yml@main",
        pull_requests: [],
      },
      pull,
    ),
    false,
  );
});

test("runTargetsPullRequest accepts empty run.pull_requests only when the head SHA maps to this one open PR", () => {
  const pull = {
    number: 2683,
    state: "open",
    changed_files: 1,
    head: {
      ref: "fix/workflow-linkage",
      sha: "734076155c44e569304856590019cea54506fdab",
      repo: { full_name: "someone/open-design" },
    },
    base: {
      ref: "main",
      sha: "4cd93a5c7a7b0db1961c854e55f8e0e6b1b45542",
      repo: { full_name: "nexu-io/open-design" },
    },
  };

  const run = {
    id: 26273463769,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: "734076155c44e569304856590019cea54506fdab",
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };

  assert.equal(runTargetsPullRequest(run, pull, [pull], []), true);
});

test("runTargetsPullRequest accepts fork PR runs with no GitHub PR association when head identity matches", () => {
  const pull = {
    number: 2683,
    state: "open",
    changed_files: 1,
    head: {
      ref: "fix/workflow-linkage",
      sha: "734076155c44e569304856590019cea54506fdab",
      repo: { full_name: "someone/open-design" },
    },
    base: {
      ref: "main",
      sha: "4cd93a5c7a7b0db1961c854e55f8e0e6b1b45542",
      repo: { full_name: "nexu-io/open-design" },
    },
  };

  const run = {
    id: 26273463769,
    name: "CI",
    event: "pull_request",
    head_branch: "fix/workflow-linkage",
    head_repository: { full_name: "someone/open-design" },
    status: "completed",
    conclusion: "action_required",
    head_sha: pull.head.sha,
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };

  assert.equal(runTargetsPullRequest(run, pull, [], [pull]), true);
});

test("runTargetsPullRequest rejects ambiguous empty run.pull_requests associations", () => {
  const pull = {
    number: 2683,
    state: "open",
    changed_files: 1,
    head: {
      ref: "fix/workflow-linkage",
      sha: "734076155c44e569304856590019cea54506fdab",
      repo: { full_name: "someone/open-design" },
    },
    base: {
      ref: "main",
      sha: "4cd93a5c7a7b0db1961c854e55f8e0e6b1b45542",
      repo: { full_name: "nexu-io/open-design" },
    },
  };

  const otherPull = {
    ...pull,
    number: 3001,
    base: {
      ref: "release",
      sha: "8db117d728f967d108f6fdd64cb8d921d057f7f6",
      repo: { full_name: "nexu-io/open-design" },
    },
  };

  const run = {
    id: 26273463769,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: "734076155c44e569304856590019cea54506fdab",
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };

  assert.equal(runTargetsPullRequest(run, pull, [pull, otherPull], []), false);
});

test("runTargetsPullRequest rejects fork PR runs when multiple open PRs share the same head identity", () => {
  const pull = {
    number: 2683,
    state: "open",
    changed_files: 1,
    head: {
      ref: "fix/workflow-linkage",
      sha: "734076155c44e569304856590019cea54506fdab",
      repo: { full_name: "someone/open-design" },
    },
    base: {
      ref: "main",
      sha: "4cd93a5c7a7b0db1961c854e55f8e0e6b1b45542",
      repo: { full_name: "nexu-io/open-design" },
    },
  };

  const otherPull = {
    ...pull,
    number: 3001,
    base: {
      ref: "release",
      sha: "8db117d728f967d108f6fdd64cb8d921d057f7f6",
      repo: { full_name: "nexu-io/open-design" },
    },
  };

  const run = {
    id: 26273463769,
    name: "CI",
    event: "pull_request",
    head_branch: pull.head.ref,
    head_repository: pull.head.repo,
    status: "completed",
    conclusion: "action_required",
    head_sha: pull.head.sha,
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };

  assert.equal(runTargetsPullRequest(run, pull, [], [pull, otherPull]), false);
});

test("runTargetsPullRequest rejects empty associations when fork head identity does not match", () => {
  const pull = {
    number: 2683,
    state: "open",
    changed_files: 1,
    head: {
      ref: "fix/workflow-linkage",
      sha: "734076155c44e569304856590019cea54506fdab",
      repo: { full_name: "someone/open-design" },
    },
    base: {
      ref: "main",
      sha: "4cd93a5c7a7b0db1961c854e55f8e0e6b1b45542",
      repo: { full_name: "nexu-io/open-design" },
    },
  };

  const run = {
    id: 26273463769,
    name: "CI",
    event: "pull_request",
    head_branch: "different-branch",
    head_repository: { full_name: "someone/open-design" },
    status: "completed",
    conclusion: "action_required",
    head_sha: pull.head.sha,
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };

  assert.equal(runTargetsPullRequest(run, pull, [], [pull]), false);
});

test("runTargetsPullRequest rejects runs that GitHub already associates to a different PR", () => {
  const pull = {
    number: 2683,
    state: "open",
    changed_files: 1,
    head: {
      ref: "fix/workflow-linkage",
      sha: "734076155c44e569304856590019cea54506fdab",
      repo: { full_name: "someone/open-design" },
    },
    base: {
      ref: "main",
      sha: "4cd93a5c7a7b0db1961c854e55f8e0e6b1b45542",
      repo: { full_name: "nexu-io/open-design" },
    },
  };

  const run = {
    id: 26273463769,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: "734076155c44e569304856590019cea54506fdab",
    path: ".github/workflows/ci.yml@main",
    pull_requests: [
      {
        number: 3001,
        head: pull.head,
        base: {
          ref: "release",
          sha: "8db117d728f967d108f6fdd64cb8d921d057f7f6",
          repo: { full_name: "nexu-io/open-design" },
        },
      },
    ],
  };

  assert.equal(runTargetsPullRequest(run, pull, [pull], []), false);
});

test("runTargetsPullRequest approves only the run that GitHub associates to the current PR when two PRs share a head SHA", () => {
  const pull = {
    number: 2683,
    state: "open",
    changed_files: 1,
    head: {
      ref: "fix/workflow-linkage",
      sha: "734076155c44e569304856590019cea54506fdab",
      repo: { full_name: "someone/open-design" },
    },
    base: {
      ref: "main",
      sha: "4cd93a5c7a7b0db1961c854e55f8e0e6b1b45542",
      repo: { full_name: "nexu-io/open-design" },
    },
  };

  const otherPull = {
    ...pull,
    number: 3001,
    base: {
      ref: "release",
      sha: "8db117d728f967d108f6fdd64cb8d921d057f7f6",
      repo: { full_name: "nexu-io/open-design" },
    },
  };

  const currentPrRun = {
    id: 26273463769,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: pull.head.sha,
    path: ".github/workflows/ci.yml@main",
    pull_requests: [pull],
  };

  const otherPrRun = {
    ...currentPrRun,
    id: 26273463770,
    pull_requests: [otherPull],
  };

  assert.equal(runTargetsPullRequest(currentPrRun, pull, [pull, otherPull], []), true);
  assert.equal(runTargetsPullRequest(otherPrRun, pull, [pull, otherPull], []), false);
});

test("runTargetsPullRequest ignores base tip churn for the same PR association", () => {
  const pull = {
    number: 2683,
    state: "open",
    changed_files: 1,
    head: {
      ref: "fix/workflow-linkage",
      sha: "734076155c44e569304856590019cea54506fdab",
      repo: { full_name: "someone/open-design" },
    },
    base: {
      ref: "main",
      sha: "4cd93a5c7a7b0db1961c854e55f8e0e6b1b45542",
      repo: { full_name: "nexu-io/open-design" },
    },
  };

  const run = {
    id: 26273463769,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: pull.head.sha,
    path: ".github/workflows/ci.yml@main",
    pull_requests: [
      {
        number: pull.number,
        head: pull.head,
        base: {
          ...pull.base,
          sha: "08a88a65482123629ebda5a090c71533bd6b8a88",
        },
      },
    ],
  };

  assert.equal(runTargetsPullRequest(run, pull, [pull], []), true);
});

test("listPendingApprovalRuns paginates all pull_request runs for the head SHA and filters action_required client-side", async () => {
  const pull = {
    number: 2683,
    state: "open",
    changed_files: 1,
    head: {
      ref: "fix/workflow-linkage",
      sha: "734076155c44e569304856590019cea54506fdab",
      repo: { full_name: "someone/open-design" },
    },
    base: {
      ref: "main",
      sha: "4cd93a5c7a7b0db1961c854e55f8e0e6b1b45542",
      repo: { full_name: "nexu-io/open-design" },
    },
  };

  const requestedPaths: string[] = [];
  const pendingRuns = await listPendingApprovalRuns("nexu-io/open-design", pull, {
    loadWorkflowRunsResponsePage: async (path) => {
      requestedPaths.push(path);
      if (path.endsWith("page=1")) {
        return {
          workflow_runs: Array.from({ length: 100 }, (_, index) => ({
            id: 26273463600 + index,
            name: "CI",
            event: "pull_request",
            head_branch: pull.head.ref,
            head_repository: pull.head.repo,
            status: "completed",
            conclusion: "success",
            head_sha: pull.head.sha,
            path: ".github/workflows/ci.yml@main",
            pull_requests: [],
          })),
        };
      }

      return {
        workflow_runs: [
          {
            id: 26273463769,
            name: "CI",
            event: "pull_request",
            head_branch: pull.head.ref,
            head_repository: pull.head.repo,
            status: "completed",
            conclusion: "action_required",
            head_sha: pull.head.sha,
            path: ".github/workflows/ci.yml@main",
            pull_requests: [],
          },
          {
            id: 26273463770,
            name: "CI",
            event: "pull_request",
            head_branch: pull.head.ref,
            head_repository: pull.head.repo,
            status: "completed",
            conclusion: "success",
            head_sha: pull.head.sha,
            path: ".github/workflows/ci.yml@main",
            pull_requests: [],
          },
        ],
      };
    },
    loadPullRequestsForHeadSha: async () => [],
    loadPullRequestsForHeadRef: async () => [pull],
  });

  assert.deepEqual(requestedPaths, [
    "/repos/nexu-io/open-design/actions/runs?event=pull_request&head_sha=734076155c44e569304856590019cea54506fdab&per_page=100&page=1",
    "/repos/nexu-io/open-design/actions/runs?event=pull_request&head_sha=734076155c44e569304856590019cea54506fdab&per_page=100&page=2",
  ]);
  assert.equal(requestedPaths.some((path) => path.includes("status=action_required")), false);
  assert.deepEqual(
    pendingRuns.map((run) => run.id),
    [26273463769],
  );
});

test("listPendingApprovalRuns only approves the unified CI workflow", async () => {
  const pull = {
    number: 2683,
    state: "open",
    changed_files: 1,
    head: {
      ref: "fix/readme-copy",
      sha: "734076155c44e569304856590019cea54506fdab",
      repo: { full_name: "someone/open-design" },
    },
    base: {
      ref: "main",
      sha: "4cd93a5c7a7b0db1961c854e55f8e0e6b1b45542",
      repo: { full_name: "nexu-io/open-design" },
    },
  };
  const workflowRuns = [
    {
      id: 26273463769,
      name: "CI",
      event: "pull_request",
      head_branch: pull.head.ref,
      head_repository: pull.head.repo,
      status: "completed",
      conclusion: "action_required",
      head_sha: pull.head.sha,
      path: ".github/workflows/ci.yml@main",
      pull_requests: [],
    },
  ];
  const deps = {
    loadWorkflowRunsResponsePage: async () => ({ workflow_runs: workflowRuns }),
    loadPullRequestsForHeadSha: async () => [pull],
  };

  assert.deepEqual(
    (await listPendingApprovalRuns("nexu-io/open-design", pull, [{ filename: "README.md", status: "modified" }], deps)).map((run) => run.id),
    [26273463769],
  );
  assert.deepEqual(
    (await listPendingApprovalRuns(
      "nexu-io/open-design",
      pull,
      [{ filename: "apps/web/src/components/Button.tsx", status: "modified" }],
      deps,
    )).map((run) => run.id),
    [26273463769],
  );
});

test("hasPullApprovalStateDrift ignores base tip churn but still rejects base retargeting and head drift", () => {
  const pull = {
    number: 2683,
    state: "open",
    changed_files: 1,
    head: {
      ref: "fix/workflow-linkage",
      sha: "734076155c44e569304856590019cea54506fdab",
      repo: { full_name: "someone/open-design" },
    },
    base: {
      ref: "main",
      sha: "4cd93a5c7a7b0db1961c854e55f8e0e6b1b45542",
      repo: { full_name: "nexu-io/open-design" },
    },
  };

  assert.equal(hasPullApprovalStateDrift(pull, pull), false);
  assert.equal(
    hasPullApprovalStateDrift(pull, {
      ...pull,
      base: { ...pull.base, sha: "08a88a65482123629ebda5a090c71533bd6b8a88" },
    }),
    false,
  );
  assert.equal(hasPullApprovalStateDrift(pull, { ...pull, draft: true }), true);
  assert.equal(hasPullApprovalStateDrift(pull, { ...pull, state: "closed" }), true);
  assert.equal(
    hasPullApprovalStateDrift(pull, {
      ...pull,
      head: { ...pull.head, sha: "08a88a65482123629ebda5a090c71533bd6b8a88" },
    }),
    true,
  );
  assert.equal(
    hasPullApprovalStateDrift(pull, {
      ...pull,
      base: { ...pull.base, ref: "release" },
    }),
    true,
  );
});

test("isDeniedChangedPath blocks common tool config files under allowlisted source trees", () => {
  assert.equal(isDeniedChangedPath("apps/web/vitest.config.ts"), true);
  assert.equal(isDeniedChangedPath("apps/web/vite.config.ts"), true);
  assert.equal(isDeniedChangedPath("apps/web/playwright.config.ts"), true);
  assert.equal(isDeniedChangedPath("apps/web/tsconfig.sidecar.json"), true);
  assert.equal(isDeniedChangedPath("apps/daemon/tsconfig.tests.json"), true);
  assert.equal(isDeniedChangedPath("packages/contracts/tsconfig.tests.json"), true);
  assert.equal(isDeniedChangedPath("apps/packaged/tsconfig.json"), true);
  assert.equal(isDeniedChangedPath("apps/packaged/vitest.config.ts"), true);
  assert.equal(isDeniedChangedPath("apps/web/src/app/page.tsx"), false);
});

test("isAllowedChangedPath allows ordinary app and package source/test paths while keeping denied surfaces blocked", () => {
  assert.equal(isAllowedChangedPath("apps/packaged/src/main.ts"), true);
  assert.equal(isAllowedChangedPath("apps/packaged/tests/main.test.ts"), true);
  assert.equal(isAllowedChangedPath("apps/desktop/src/main.ts"), true);
  assert.equal(isAllowedChangedPath("packages/sidecar/src/index.ts"), true);
  assert.equal(isAllowedChangedPath("tools/pack/src/index.ts"), false);
  assert.equal(isAllowedChangedPath("apps/packaged/tsconfig.json"), false);
  assert.equal(isAllowedChangedPath("apps/packaged/vitest.config.ts"), false);
});

test("isAllowedChangedPath admits Markdown-only content roots without expanding executable paths", () => {
  for (const path of [
    "craft/accessibility-baseline.md",
    "design-systems/default/DESIGN.md",
    "design-systems/apple/USAGE.md",
    "specs/current/ci.md",
  ]) assert.equal(isAllowedChangedPath(path), true, path);

  for (const path of [
    "craft/accessibility-baseline.ts",
    "design-systems/_schema/manifest.schema.ts",
    "design-systems/default/components.html",
    "design-systems/default/manifest.json",
    "design-systems/default/tokens.css",
    "design-systems/_schema/AGENTS.md",
    "specs/current/SKILL.md",
    "specs/current/__tests__/scenario.md",
    "specs/current/tests/scenario.md",
    "specs/current/test/seed.md",
    "specs/current/fixtures/seed.md",
    "specs/current/snapshot-report.md",
    "craft/accessibility-fixture.md",
    "skills/my-skill/SKILL.md",
    "plugins/my-plugin/README.md",
    ".github/workflows/ci.yml",
    "scripts/approve-fork-pr-workflows.ts",
  ]) assert.equal(isAllowedChangedPath(path), false, path);

  // Keep the pre-existing broad docs and application-source decisions unchanged.
  assert.equal(isAllowedChangedPath("docs/guides/readme.md"), true);
  assert.equal(isAllowedChangedPath("docs/example.json"), true);
  assert.equal(isAllowedChangedPath("apps/web/src/app/page.tsx"), true);
});

test("getBlockedChangedPaths evaluates both sides of a rename and blocks mixed changes", () => {
  assert.deepEqual(getBlockedChangedPaths([
    { filename: "craft/accessibility-baseline.md", status: "modified" },
    {
      filename: "design-systems/default/DESIGN.md",
      previous_filename: "scripts/unsafe.ts",
      status: "renamed",
    },
    { filename: "specs/current/e2e-snapshot.md", status: "modified" },
  ]), ["scripts/unsafe.ts", "specs/current/e2e-snapshot.md"]);
});

test("fork approval skip comment is visible, bounded, and escapes untrusted file names", () => {
  const body = formatForkApprovalSkipComment(["craft/<script>alert(1)</script>&notes.md", "other/mixed.ts"]);
  assert.match(body, /maintainer action needed/);
  assert.match(body, /Another push is not required/);
  assert.match(body, /2 changed path/);
  assert.match(body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&amp;notes.md/);
  assert.equal(body.includes("<script>"), false);

  const long = formatForkApprovalSkipComment(Array.from({ length: 14 }, (_, index) => `other/path-${index}.ts`));
  assert.match(long, /and 4 more/);
  assert.equal(long.includes("path-10.ts"), false);
});

test("fork approval comments are bot-owned, idempotent, and removed when paths become eligible", () => {
  const blocked = ["craft/not-markdown.json"];
  const body = formatForkApprovalSkipComment(blocked);
  const author = { id: 1, body, user: { login: "contributor" } };
  const bot = { id: 2, body, user: { login: "github-actions[bot]" } };
  assert.equal(planForkApprovalSkipComment(blocked, []).kind, "create");
  assert.equal(planForkApprovalSkipComment(blocked, [author]).kind, "create");
  assert.deepEqual(planForkApprovalSkipComment(blocked, [bot]), { kind: "noop" });
  assert.deepEqual(planForkApprovalSkipComment([], [bot]), { kind: "delete", id: 2 });

  const modified = planForkApprovalSkipComment(["specs/current/fixture.md"], [bot]);
  assert.equal(modified.kind, "update");
  if (modified.kind === "update") assert.equal(modified.id, 2);
  assert.deepEqual(planForkApprovalSkipComment([], []), { kind: "noop" });
});

test("waitForPendingApprovalRuns retries until action_required runs appear and keeps polling through the retry window", async () => {
  const run = {
    id: 26273463769,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: "734076155c44e569304856590019cea54506fdab",
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };

  const batches = [[], [], [run]];
  const sleeps: number[] = [];
  let now = 0;

  const pendingRuns = await waitForPendingApprovalRuns(
    async () => batches.shift() ?? [run],
    async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    () => now,
    { settlingWindowMs: 9_000 },
  );

  assert.deepEqual(pendingRuns, [run]);
  assert.deepEqual(sleeps, [3000, 3000, 3000, 3000, 3000]);
});

test("waitForPendingApprovalRuns keeps polling and returns the latest eligible run snapshot across the retry window", async () => {
  const ciRun = {
    id: 26273463769,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: "734076155c44e569304856590019cea54506fdab",
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };
  const laterCiRun = {
    id: 26273463770,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: "734076155c44e569304856590019cea54506fdab",
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };

  const batches = [[ciRun], [ciRun], [ciRun, laterCiRun], [ciRun, laterCiRun]];
  const sleeps: number[] = [];
  let now = 0;

  const pendingRuns = await waitForPendingApprovalRuns(
    async () => batches.shift() ?? [ciRun, laterCiRun],
    async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    () => now,
    { settlingWindowMs: 9_000 },
  );

  assert.deepEqual(pendingRuns, [ciRun, laterCiRun]);
  assert.deepEqual(sleeps, [3000, 3000, 3000, 3000, 3000]);
});

test("waitForPendingApprovalRuns drops runs that disappear in later polls", async () => {
  const staleRun = {
    id: 26273463769,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: "734076155c44e569304856590019cea54506fdab",
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };
  const survivingRun = {
    ...staleRun,
    id: 26273463770,
    name: "CI",
    path: ".github/workflows/ci.yml@main",
  };

  const batches = [[staleRun], [staleRun, survivingRun], [survivingRun], [survivingRun]];
  let now = 0;

  const pendingRuns = await waitForPendingApprovalRuns(
    async () => batches.shift() ?? [survivingRun],
    async (ms) => {
      now += ms;
    },
    () => now,
    { settlingWindowMs: 6_000 },
  );

  assert.deepEqual(pendingRuns, [survivingRun]);
});

test("waitForPendingApprovalRuns keeps polling until the run set is stable, even when another eligible run appears after the old three-poll budget", async () => {
  const ciRun = {
    id: 26273463769,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: "734076155c44e569304856590019cea54506fdab",
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };
  const laterCiRun = {
    id: 26273463770,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: "734076155c44e569304856590019cea54506fdab",
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };

  const batches = [[ciRun], [ciRun], [ciRun], [ciRun], [ciRun], [ciRun, laterCiRun], [ciRun, laterCiRun]];
  const sleeps: number[] = [];
  let now = 0;

  const pendingRuns = await waitForPendingApprovalRuns(
    async () => batches.shift() ?? [ciRun, laterCiRun],
    async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    () => now,
    {
      firstAppearanceTimeoutMs: 30_000,
      settlingWindowMs: 15_000,
    },
  );

  assert.deepEqual(pendingRuns, [ciRun, laterCiRun]);
  assert.equal(sleeps.length, 10);
});

test("waitForPendingApprovalRuns gives late first appearances their own full settling window", async () => {
  const ciRun = {
    id: 26273463769,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: "734076155c44e569304856590019cea54506fdab",
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };
  const laterCiRun = {
    id: 26273463770,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: "734076155c44e569304856590019cea54506fdab",
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };

  const batches = [[], [], [], [ciRun], [ciRun], [ciRun, laterCiRun], [ciRun, laterCiRun], [ciRun, laterCiRun]];
  const sleeps: number[] = [];
  let now = 0;

  const pendingRuns = await waitForPendingApprovalRuns(
    async () => batches.shift() ?? [ciRun, laterCiRun],
    async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    () => now,
    {
      firstAppearanceTimeoutMs: 12_000,
      settlingWindowMs: 9_000,
    },
  );

  assert.deepEqual(pendingRuns, [ciRun, laterCiRun]);
  assert.deepEqual(sleeps, [3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000]);
});

test("waitForPendingApprovalRuns keeps polling until the first run appears, even after the old short retry budget", async () => {
  const run = {
    id: 26273463769,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: "734076155c44e569304856590019cea54506fdab",
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };

  const batches = [[], [], [], [], [run]];
  const sleeps: number[] = [];
  let now = 0;

  const pendingRuns = await waitForPendingApprovalRuns(
    async () => batches.shift() ?? [run],
    async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    () => now,
    {
      firstAppearanceTimeoutMs: 15_000,
      settlingWindowMs: 6_000,
    },
  );

  assert.deepEqual(pendingRuns, [run]);
  assert.deepEqual(sleeps, [3000, 3000, 3000, 3000, 3000, 3000]);
});

test("waitForPendingApprovalRuns accepts a configurable longer polling budget before the first run appears", async () => {
  const run = {
    id: 26273463769,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: "734076155c44e569304856590019cea54506fdab",
    path: ".github/workflows/ci.yml@main",
    pull_requests: [],
  };

  const batches = [[], [], [], [], [], [run]];
  const sleeps: number[] = [];
  let now = 0;

  const pendingRuns = await waitForPendingApprovalRuns(
    async () => batches.shift() ?? [run],
    async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    () => now,
    {
      firstAppearanceTimeoutMs: 18_000,
      settlingWindowMs: 3_000,
    },
  );

  assert.deepEqual(pendingRuns, [run]);
  assert.deepEqual(sleeps, [3000, 3000, 3000, 3000, 3000, 3000]);
});

test("waitForPendingApprovalRuns stops after the first-appearance timeout when no runs arrive", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  let now = 0;

  const pendingRuns = await waitForPendingApprovalRuns(
    async () => {
      calls += 1;
      return [];
    },
    async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    () => now,
    {
      firstAppearanceTimeoutMs: 9_000,
    },
  );

  assert.deepEqual(pendingRuns, []);
  assert.equal(calls, 4);
  assert.equal(sleeps.length, 3);
  assert.equal(now, 9_000);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TARGET,
  PublicationError,
  assertInvocation,
  assertPrivateConfig,
  validateSource,
  publishPrivate,
} from "../scripts/publish-hml.mjs";

// Synthetic configuration only. Every Cloudflare request and deploy is mocked.
const account = "a".repeat(32),
  token = "synthetic-cloudflare-token-for-tests-only";
const environment = () => ({
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: TARGET.control,
  GITHUB_REF: "refs/heads/main",
  HML_CONFIRMATION: TARGET.confirmation,
  HML_ACKNOWLEDGED: "true",
  CLOUDFLARE_ACCOUNT_ID: account,
  CLOUDFLARE_API_TOKEN: token,
});
const actualSource =
  process.env.HML_TEST_SOURCE ??
  fileURLToPath(new URL("../../black-sales-ai/", import.meta.url));
const approvedConfig = JSON.parse(
  await readFile(join(actualSource, "wrangler.homolog.json"), "utf8"),
);
const validBindings = () => [
  { name: "ASSETS", type: "assets" },
  { name: "STUDIO_AI_PROVIDER", type: "plain_text", text: "disabled" },
  { name: "STUDIO_SITE_EXPORT_ENABLED", type: "plain_text", text: "false" },
];
function harness(overrides = {}) {
  const state = {
    requests: [],
    deploys: 0,
    validations: 0,
    subdomain: { enabled: false, previews_enabled: false },
    scripts: [],
    domains: [],
    bindings: validBindings(),
    ...overrides,
  };
  return {
    state,
    arguments: {
      directory: "/synthetic/source",
      env: environment(),
      validator: async () => {
        state.validations++;
        if (state.failValidation === state.validations)
          throw new PublicationError("Source blocked");
        return "/synthetic/source";
      },
      deployer: async () => {
        state.deploys++;
        if (state.failDeploy) throw new Error(token);
      },
      fetcher: async (url, options) => {
        assert.equal(options.method, "GET");
        assert.equal(options.redirect, "error");
        assert.equal(options.headers.Authorization, "Bearer " + token);
        const base = "https://api.cloudflare.com/client/v4/accounts/" + account;
        assert.ok(url.startsWith(base));
        const path = url.slice(base.length);
        state.requests.push(path);
        if (state.networkFailure) throw new Error(token);
        if (state.status)
          return new Response(
            JSON.stringify({ errors: [{ message: token }] }),
            { status: state.status },
          );
        if (state.invalidJSON) return new Response(token);
        if (state.unsuccessful)
          return Response.json({ success: false, result: token });
        let result;
        if (path === "")
          result = { id: state.wrongAccount ? "b".repeat(32) : account };
        else if (path === "/workers/scripts") result = state.scripts;
        else if (path === "/workers/domains")
          result = state.deploys
            ? (state.finalDomains ?? state.domains)
            : state.domains;
        else if (path.endsWith("/subdomain")) result = state.subdomain;
        else if (path.endsWith("/settings"))
          result = { bindings: state.bindings };
        else throw new Error("Unexpected API path");
        return Response.json({ success: true, result });
      },
    },
  };
}

test("manual, explicit confirmations and server credentials are required", () => {
  assert.doesNotThrow(() => assertInvocation(environment()));
  for (const values of [
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_EVENT_NAME: "workflow_run" },
    { GITHUB_REF: "refs/heads/other" },
    { GITHUB_REPOSITORY: TARGET.repository },
    { HML_CONFIRMATION: "" },
    { HML_CONFIRMATION: "$(untrusted)" },
    { HML_ACKNOWLEDGED: "false" },
    { CLOUDFLARE_API_TOKEN: "" },
    { CLOUDFLARE_API_TOKEN: token + "\n" },
    { CLOUDFLARE_ACCOUNT_ID: "" },
    { CLOUDFLARE_ACCOUNT_ID: "../other" },
    { CLOUDFLARE_ACCOUNT_ID: account + "\n" },
    { WRANGLER_CI_OVERRIDE_NAME: "production" },
    { CLOUDFLARE_ENV: "production" },
  ])
    assert.throws(
      () => assertInvocation({ ...environment(), ...values }),
      PublicationError,
    );
});
test("does not start validation, network or deploy if credentials are missing", async () => {
  const h = harness();
  h.arguments.env.CLOUDFLARE_API_TOKEN = "";
  await assert.rejects(publishPrivate(h.arguments), PublicationError);
  assert.equal(h.state.validations, 0);
  assert.equal(h.state.deploys, 0);
  assert.deepEqual(h.state.requests, []);
});
test("private config is mandatory; routes, previews, production and paid integrations are rejected", () => {
  assert.doesNotThrow(() => assertPrivateConfig(approvedConfig));
  for (const change of [
    { workers_dev: true },
    { preview_urls: true },
    { name: "black-sales-ai" },
    { main: "server/index.ts" },
    { routes: [] },
    { route: "example.test/*" },
    { migrations: [] },
    { durable_objects: {} },
    { env: {} },
    { assets: { ...approvedConfig.assets, run_worker_first: false } },
    {
      vars: { ...approvedConfig.vars, STUDIO_AI_PROVIDER: "openai-compatible" },
    },
    { vars: { ...approvedConfig.vars, HOMOLOG_BASIC_AUTH: token } },
    { vars: { ...approvedConfig.vars, STUDIO_SITE_EXPORT_ENABLED: "true" } },
  ])
    assert.throws(
      () => assertPrivateConfig({ ...approvedConfig, ...change }),
      PublicationError,
    );
});

async function sourceFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "hml-publication-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "server"));
  for (const file of [
    "wrangler.homolog.json",
    "server/homolog.ts",
    "server/homolog-access.ts",
  ])
    await writeFile(join(root, file), await readFile(join(actualSource, file)));
  const git = (args) => {
    if (args[0] === "rev-parse") return TARGET.commit;
    if (args[0] === "remote")
      return "https://github.com/" + TARGET.repository + ".git";
    if (args[0] === "ls-remote")
      return TARGET.commit + "\trefs/heads/" + TARGET.branch;
    if (args[0] === "status") return "";
    throw new Error("Unexpected git command");
  };
  return { root, git };
}
test("validates exact hashes of config, entry and fail-closed Basic gate", async (t) => {
  const { root, git } = await sourceFixture(t);
  assert.equal(await validateSource(root, git), root);
  await writeFile(join(root, "server/homolog-access.ts"), "// security bypass");
  await assert.rejects(validateSource(root, git), /codigo aprovado/);
});
test("rejects another commit, branch, origin or changed worktree", async (t) => {
  const { root, git } = await sourceFixture(t);
  for (const [command, value] of [
    ["rev-parse", "0".repeat(40)],
    ["remote", "https://untrusted.example/repo"],
    ["ls-remote", TARGET.commit + "\trefs/heads/main"],
    ["status", " M server/homolog.ts"],
  ]) {
    await assert.rejects(
      validateSource(root, (args) => (args[0] === command ? value : git(args))),
      PublicationError,
    );
  }
});
test("rejects private environment files and Wrangler config redirection", async (t) => {
  const { root, git } = await sourceFixture(t);
  await writeFile(join(root, ".env.local"), "SYNTHETIC_ONLY=true");
  await assert.rejects(validateSource(root, git), /credenciais/);
  await rm(join(root, ".env.local"));
  await mkdir(join(root, ".wrangler/deploy"), { recursive: true });
  await writeFile(join(root, ".wrangler/deploy/config.json"), "{}");
  await assert.rejects(validateSource(root, git), /Redirecionamento/);
});
test("source read/git errors are sanitized", async (t) => {
  const { root } = await sourceFixture(t);
  await assert.rejects(
    validateSource(root, () => {
      throw new Error(token);
    }),
    (error) => !error.message.includes(token),
  );
});

test("success makes exactly one deployment and only GET metadata queries", async () => {
  const h = harness();
  const report = await publishPrivate(h.arguments);
  assert.equal(h.state.deploys, 1);
  assert.equal(h.state.validations, 2);
  assert.equal(report.worker, TARGET.worker);
  assert.equal(report.commit, TARGET.commit);
  assert.equal(report.workersDev, false);
  assert.equal(report.previews, false);
  assert.equal(report.customDomains, 0);
  assert.equal(report.ai, "disabled");
  assert.ok(!JSON.stringify(report).includes(token));
  assert.ok(!JSON.stringify(report).includes(account));
});
for (const [name, values] of [
  ["existing Worker", { scripts: [{ id: TARGET.worker }] }],
  ["unknown scripts response", { scripts: {} }],
  ["existing domain", { domains: [{ service: TARGET.worker }] }],
  ["unknown domains response", { domains: [{}] }],
  ["wrong account", { wrongAccount: true }],
  ["failed source check", { failValidation: 1 }],
  ["source changed during preflight", { failValidation: 2 }],
  ["authentication failure", { status: 403 }],
  ["rate limit", { status: 429 }],
  ["redirect", { status: 302 }],
  ["network failure", { networkFailure: true }],
  ["malformed JSON", { invalidJSON: true }],
  ["unsuccessful response", { unsuccessful: true }],
])
  test("does not publish after " + name, async () => {
    const h = harness(values);
    await assert.rejects(
      publishPrivate(h.arguments),
      (error) =>
        error instanceof PublicationError && !error.message.includes(token),
    );
    assert.equal(h.state.deploys, 0);
  });
for (const [name, values] of [
  [
    "workers.dev enabled",
    { subdomain: { enabled: true, previews_enabled: false } },
  ],
  [
    "previews enabled",
    { subdomain: { enabled: false, previews_enabled: true } },
  ],
  ["preview state missing", { subdomain: { enabled: false } }],
  ["custom domain", { finalDomains: [{ service: TARGET.worker }] }],
  ["unknown domain state", { finalDomains: {} }],
  [
    "unexpected credential binding",
    {
      bindings: [
        ...validBindings(),
        { name: "SUPABASE_URL", type: "plain_text", text: "synthetic" },
      ],
    },
  ],
  [
    "AI enabled",
    {
      bindings: validBindings().map((b) =>
        b.name === "STUDIO_AI_PROVIDER"
          ? { ...b, text: "openai-compatible" }
          : b,
      ),
    },
  ],
  [
    "duplicate binding",
    { bindings: [validBindings()[0], validBindings()[1], validBindings()[1]] },
  ],
])
  test(
    "does not report success or retry when final verification finds " + name,
    async () => {
      const h = harness(values);
      await assert.rejects(publishPrivate(h.arguments), PublicationError);
      assert.equal(h.state.deploys, 1);
    },
  );
test("ambiguous deployment failure is sanitized and never retried", async () => {
  const h = harness({ failDeploy: true });
  await assert.rejects(
    publishPrivate(h.arguments),
    (error) =>
      !error.message.includes(token) && /nao ha retry/.test(error.message),
  );
  assert.equal(h.state.deploys, 1);
  assert.equal(
    h.state.requests.filter((path) => path.endsWith("/settings")).length,
    0,
  );
});

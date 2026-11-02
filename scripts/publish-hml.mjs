import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TARGET = Object.freeze({
  control: "BlackTechDigital/black-sales-ai-hml-control",
  repository: "BlackTechDigital/black-sales-ai",
  branch: "codex/private-homologation",
  commit: "565d2eb8256d9b8399bb9bb628bf7171738587e4",
  worker: "black-sales-ai-hml",
  confirmation: "PUBLICAR-HML-SEM-URL",
});
const sourceHashes = {
  "wrangler.homolog.json":
    "1d7c788669f32c539b639207312010c9c2812bb26e075c6b57ad9ded398b2062",
  "server/homolog.ts":
    "50a77d3f862d4f6b36115fc9ded74c89a6d93e625fc98deca28f313f514867a4",
  "server/homolog-access.ts":
    "66696aa2eec156261fc9df80a37603ba2467ef3ebc029c582728ed389ad20630",
};
export class PublicationError extends Error {}
const requireState = (condition, message) => {
  if (!condition) throw new PublicationError(message);
};

export function assertManualInvocation(env) {
  requireState(
    env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REPOSITORY === TARGET.control &&
      env.GITHUB_REF === "refs/heads/main",
    "Publicacao permitida somente por execucao manual na main do repositorio de controle.",
  );
  requireState(
    env.HML_CONFIRMATION === TARGET.confirmation &&
      env.HML_ACKNOWLEDGED === "true",
    "As duas confirmacoes manuais sao obrigatorias.",
  );
}
export function assertInvocation(env) {
  assertManualInvocation(env);
  requireState(
    /^[a-f0-9]{32}(?![\s\S])/i.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") &&
      typeof env.CLOUDFLARE_API_TOKEN === "string" &&
      /^[\x21-\x7e]{16,4096}(?![\s\S])/.test(env.CLOUDFLARE_API_TOKEN),
    "Configure CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN em GitHub Secrets, sem aspas ou espacos.",
  );
  requireState(
    !env.WRANGLER_CI_OVERRIDE_NAME && !env.CLOUDFLARE_ENV && !env.WRANGLER_ENV,
    "Uma substituicao externa do destino Wrangler foi detectada; publicacao bloqueada.",
  );
}

export function assertPrivateConfig(config) {
  const allowed = [
    "$schema",
    "name",
    "main",
    "compatibility_date",
    "workers_dev",
    "preview_urls",
    "keep_vars",
    "assets",
    "vars",
    "observability",
  ];
  requireState(
    config &&
      typeof config === "object" &&
      Object.keys(config).every((key) => allowed.includes(key)) &&
      config.name === TARGET.worker &&
      config.main === "server/homolog.ts" &&
      config.workers_dev === false &&
      config.preview_urls === false &&
      config.keep_vars === true &&
      config.assets?.directory === "./dist" &&
      config.assets?.binding === "ASSETS" &&
      config.assets?.run_worker_first === true &&
      config.observability?.enabled === false,
    "Configuracao de homologacao divergente ou com possivel acesso publico.",
  );
  requireState(
    config.vars &&
      Object.keys(config.vars).length === 2 &&
      config.vars.STUDIO_AI_PROVIDER === "disabled" &&
      config.vars.STUDIO_SITE_EXPORT_ENABLED === "false",
    "A configuracao deve manter IA/exportacao desativadas e nao conter credenciais.",
  );
}

function git(args, directory) {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    timeout: 15_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
export async function validateSource(directory, runGit = git) {
  const root = resolve(directory);
  try {
    requireState(
      runGit(["rev-parse", "HEAD"], root) === TARGET.commit,
      "O commit da aplicacao nao e o aprovado.",
    );
    requireState(
      [
        "https://github.com/" + TARGET.repository,
        "https://github.com/" + TARGET.repository + ".git",
      ].includes(runGit(["remote", "get-url", "origin"], root)),
      "Repositorio de origem incorreto.",
    );
    const ref = "refs/heads/" + TARGET.branch;
    const remote = runGit(["ls-remote", "--exit-code", "origin", ref], root);
    requireState(
      remote === TARGET.commit + "\t" + ref,
      "A branch remota nao aponta para o commit aprovado.",
    );
    requireState(
      runGit(["status", "--porcelain", "--untracked-files=no"], root) === "",
      "A aplicacao possui alteracoes rastreadas apos o checkout.",
    );
    const files = await readdir(root);
    requireState(
      !files.some(
        (name) =>
          (/^\.env(?:\.|$)/.test(name) || /^\.dev\.vars(?:\.|$)/.test(name)) &&
          ![".env.example", ".dev.vars.example"].includes(name),
      ),
      "Arquivo local de credenciais detectado na origem.",
    );
    try {
      await readFile(join(root, ".wrangler/deploy/config.json"));
      throw new PublicationError(
        "Redirecionamento de configuracao Wrangler detectado.",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const [name, hash] of Object.entries(sourceHashes)) {
      const contents = await readFile(join(root, name));
      requireState(
        createHash("sha256").update(contents).digest("hex") === hash,
        "A configuracao ou a barreira Basic nao corresponde ao codigo aprovado.",
      );
    }
    assertPrivateConfig(
      JSON.parse(await readFile(join(root, "wrangler.homolog.json"), "utf8")),
    );
    return root;
  } catch (error) {
    if (error instanceof PublicationError) throw error;
    throw new PublicationError(
      "Nao foi possivel verificar a origem. Nenhuma publicacao foi autorizada.",
    );
  }
}

function noDomains(domains) {
  requireState(
    Array.isArray(domains) &&
      domains.every((domain) => typeof domain?.service === "string"),
    "Nao foi possivel conferir dominios personalizados.",
  );
  requireState(
    !domains.some((domain) => domain.service === TARGET.worker),
    "Ha dominio personalizado associado ao destino; publicacao bloqueada.",
  );
}
export function assertPrivateRuntime(subdomain, settings, domains) {
  requireState(
    subdomain?.enabled === false && subdomain?.previews_enabled === false,
    "A verificacao final nao confirmou workers.dev e previews desativados.",
  );
  noDomains(domains);
  const bindings = settings?.bindings;
  requireState(
    Array.isArray(bindings) &&
      bindings.length === 3 &&
      new Set(bindings.map((b) => b.name)).size === 3 &&
      bindings.some((b) => b.name === "ASSETS" && b.type === "assets") &&
      bindings.some(
        (b) =>
          b.name === "STUDIO_AI_PROVIDER" &&
          b.type === "plain_text" &&
          b.text === "disabled",
      ) &&
      bindings.some(
        (b) =>
          b.name === "STUDIO_SITE_EXPORT_ENABLED" &&
          b.type === "plain_text" &&
          b.text === "false",
      ),
    "Bindings inesperados no Worker; nao habilite acesso e confira o painel.",
  );
}

function cloudflare(env, fetcher) {
  const base =
    "https://api.cloudflare.com/client/v4/accounts/" +
    env.CLOUDFLARE_ACCOUNT_ID;
  return async (path) => {
    try {
      const response = await fetcher(base + path, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: "Bearer " + env.CLOUDFLARE_API_TOKEN,
          Accept: "application/json",
        },
      });
      requireState(
        response.ok,
        "Consulta Cloudflare recusada; confira conta, permissoes e disponibilidade.",
      );
      const body = await response.json();
      requireState(
        body?.success === true && "result" in body,
        "Resposta Cloudflare nao confirmada.",
      );
      return body.result;
    } catch (error) {
      if (error instanceof PublicationError) throw error;
      throw new PublicationError(
        "Nao foi possivel consultar Cloudflare com seguranca.",
      );
    }
  };
}
function runWrangler(root, env) {
  const childEnv = {
    ...env,
    CI: "true",
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_LOG: "warn",
  };
  try {
    execFileSync(
      process.execPath,
      [
        join(root, "node_modules/wrangler/bin/wrangler.js"),
        "deploy",
        "--config",
        join(root, "wrangler.homolog.json"),
      ],
      {
        cwd: root,
        env: childEnv,
        timeout: 300_000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch {
    // No raw Wrangler/API output: errors can contain credentials or headers.
    throw new PublicationError(
      "Publicacao nao confirmada. Confira o painel antes de tentar novamente; nao ha retry automatico.",
    );
  }
}
export async function publishPrivate({
  directory,
  env,
  fetcher = fetch,
  deployer = runWrangler,
  validator = validateSource,
}) {
  assertInvocation(env);
  const root = await validator(directory);
  const api = cloudflare(env, fetcher);
  const account = await api("");
  requireState(
    account?.id === env.CLOUDFLARE_ACCOUNT_ID,
    "A conta Cloudflare nao foi confirmada.",
  );
  const scripts = await api("/workers/scripts");
  requireState(
    Array.isArray(scripts) &&
      scripts.every((script) => typeof script?.id === "string"),
    "Nao foi possivel conferir os Workers existentes.",
  );
  requireState(
    !scripts.some((script) => script.id === TARGET.worker),
    "O Worker ja existe. Este fluxo permite somente a primeira publicacao e nao sobrescreve Workers.",
  );
  noDomains(await api("/workers/domains"));
  await validator(root);
  try {
    await deployer(root, env);
  } catch {
    throw new PublicationError(
      "Publicacao nao confirmada. Confira o painel antes de tentar novamente; nao ha retry automatico.",
    );
  }
  const [subdomain, settings, domains] = await Promise.all([
    api("/workers/scripts/" + TARGET.worker + "/subdomain"),
    api("/workers/scripts/" + TARGET.worker + "/settings"),
    api("/workers/domains"),
  ]);
  assertPrivateRuntime(subdomain, settings, domains);
  return {
    worker: TARGET.worker,
    repository: TARGET.repository,
    branch: TARGET.branch,
    commit: TARGET.commit,
    workersDev: false,
    previews: false,
    customDomains: 0,
    publicRoutesInConfig: false,
    ai: "disabled",
    exportEnabled: false,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [mode, directory, ...extra] = process.argv.slice(2);
    requireState(
      extra.length === 0 &&
        (mode === "confirm"
          ? !directory
          : directory && ["validate", "publish"].includes(mode)),
      "Use confirm, ou validate/publish com o diretorio de origem.",
    );
    if (mode === "confirm") {
      assertManualInvocation(process.env);
      console.log(
        "Contexto manual e confirmacoes conferidos. Nenhum deploy executado.",
      );
    } else if (mode === "validate") {
      await validateSource(directory);
      console.log(
        "Origem, commit, hashes e configuracao privada conferidos. Nenhum deploy executado.",
      );
    } else {
      const report = await publishPrivate({ directory, env: process.env });
      console.log(JSON.stringify(report, null, 2));
    }
  } catch (error) {
    console.error(
      error instanceof PublicationError
        ? error.message
        : "Operacao interrompida. Confira o painel; nenhum detalhe sensivel sera exibido.",
    );
    process.exitCode = 1;
  }
}

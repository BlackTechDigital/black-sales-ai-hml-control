# Primeira publicação privada da Black Sales AI

Esta automação é separada de `.github/workflows/validar-hml.yml`. Preparar/registrar seus arquivos não executa deploy. A publicação real somente ocorrerá quando um responsável disparar **Primeira publicacao privada HML** pelo GitHub Actions e fornecer as duas confirmações exigidas.

## Fonte e destino fixos

- Aplicação: `BlackTechDigital/black-sales-ai`.
- Branch de origem: `codex/private-homologation`.
- Commit imutável: `565d2eb8256d9b8399bb9bb628bf7171738587e4`.
- Configuração: `wrangler.homolog.json`.
- Worker: `black-sales-ai-hml`.
- Entrada: `server/homolog.ts`, com Basic Auth obrigatório antes da API e dos assets.

O workflow faz checkout do commit exato e confirma que a branch remota ainda aponta para ele. Outro commit, origem, arquivo alterado ou hash divergente bloqueia a operação. O código do controle também é obtido pelo SHA da execução; as ações checkout/setup-node estão fixadas por SHA. Nada modifica a main ou qualquer arquivo do repositório da aplicação.

## Arquivos novos no repositório de controle

| Arquivo                              | Responsabilidade                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `.github/workflows/publicar-hml.yml` | Execução somente manual, confirmação, compilação, dry-run e passo de publicação            |
| `scripts/publish-hml.mjs`            | Valida origem/configuração, consulta a conta, impede sobrescrita e verifica o estado final |
| `tests/publish-hml.test.mjs`         | Testes sem API, credenciais ou deploy reais                                                |
| `docs/PUBLICACAO_PRIVADA.md`         | Este procedimento pelo navegador                                                           |

`validar-hml.yml` e `README.md` existentes não são alterados. O workflow não tem gatilhos `push`, `pull_request`, `workflow_run` ou agenda. A concorrência é serializada e uma falha de upload nunca provoca retry automático.

Para o botão **Run workflow** ficar disponível, esses arquivos precisam ser revisados e integrados na branch padrão **main do repositório de controle**. Isso não envolve merge na main de `BlackTechDigital/black-sales-ai`. Não execute o workflow durante a preparação.

## O que a primeira publicação permite

A configuração exige `workers_dev: false`, `preview_urls: false`, nenhum campo de rotas/domínios, Worker antes dos assets, observabilidade desativada, IA desativada e exportação desativada. Hashes fixos cobrem a configuração, a entrada e a barreira Basic. Arquivos locais de credenciais e redirecionamentos de configuração Wrangler são recusados.

Apenas o último passo recebe os dois GitHub Secrets Cloudflare. Testes, checkout, dependências, build e dry-run não recebem esses valores. O script não imprime respostas brutas da API, tokens, account ID ou saída bruta do Wrangler. Não há artifacts de logs ou arquivos de credenciais enviados pelo workflow.

Antes de publicar, consultas GET confirmam a conta, a ausência de `black-sales-ai-hml` e a ausência de domínio personalizado associado ao nome. Se o Worker já existir, mesmo privado, o fluxo para: ele foi feito **somente para a primeira publicação**, não para atualizar, restaurar ou ativar um Worker existente. Evite operações concorrentes nesse destino fora deste workflow.

Depois da publicação, outras consultas GET exigem:

- `workers.dev` desativado;
- Preview URLs desativadas;
- nenhum domínio personalizado associado ao Worker;
- exatamente os bindings `ASSETS`, `STUDIO_AI_PROVIDER=disabled` e `STUDIO_SITE_EXPORT_ENABLED=false`.

O script não enumera as rotas de todas as zonas: o token não recebe permissões de zonas. A confirmação de **Domains & Routes** no painel continua necessária. A ausência inicial do Worker, a configuração sem rotas e o token sem permissão de edição de rotas evitam que este fluxo configure rotas de zona. Não interprete apenas o indicador verde como prova de privacidade; confira também as verificações finais e o painel.

O Secret Basic **não é configurado por essa primeira publicação**. Sem `HOMOLOG_BASIC_AUTH`, o código responde 503 antes de entregar API ou arquivos, mesmo se alguém habilitasse um endereço por engano. Não existe chave padrão ou fallback para abrir a aplicação.

## Criar o token Cloudflare pelo navegador

Execute estes passos somente quando a publicação manual for autorizada. Não envie valores de token ou chaves por chat, código, URL, issue ou screenshot.

1. Entre na conta Cloudflare destinada à homologação e confira que Workers está no plano Free. Não é necessário ativar Zero Trust, contratar plano ou cadastrar cartão para este método; elegibilidade da conta e cotas do Free continuam aplicáveis.
2. Em **My Profile → API Tokens** (ou **Account API Tokens**, conforme o painel), escolha **Create Token → Custom token**.
3. Use um nome identificável, como `black-sales-ai-hml-first-publication`.
4. Configure somente estas permissões de **Account**:
   - **Workers Scripts → Edit**: upload e consultas de scripts, bindings, subdomínio e domínios de Workers.
   - **Account Settings → Read**: conferência explícita do ID da conta antes do upload.
5. Em recursos de conta, selecione **Include → Specific account** e somente a conta de homologação. Não use todas as contas. Não adicione DNS, Workers Routes de zonas, R2, KV, D1 ou permissões de cobrança.
6. Defina expiração curta, compatível com a janela prevista para a primeira publicação. Guarde o token em um gerenciador de senhas. Se houver erro de permissão, interrompa e revise a permissão exata; não amplie automaticamente o token.

Essas permissões são limitadas à conta, não a um Worker individual: `Workers Scripts: Edit` pode editar outros Workers dessa conta. Prefira uma conta de homologação isolada. A automação acrescenta travas de nome e de ausência do Worker, mas não transforma o token em credencial restrita a um único script.

Localize o **Account ID** na visão geral da conta/Workers. O workflow espera os 32 caracteres hexadecimais, sem espaços ou aspas. Não é Zone ID, nome da conta ou endereço workers.dev.

## Cadastrar os dois GitHub Secrets

No repositório **BlackTechDigital/black-sales-ai-hml-control**:

1. Abra **Settings → Secrets and variables → Actions**.
2. Selecione **New repository secret**.
3. Cadastre `CLOUDFLARE_API_TOKEN` com o token limitado à conta.
4. Cadastre `CLOUDFLARE_ACCOUNT_ID` com o Account ID correspondente.
5. Confirme apenas que os nomes aparecem na lista. Não copie valores para workflows ou para o repositório da aplicação.

Nenhum Secret Supabase, chave de IA ou Secret Basic é exigido nesta etapa. Não configure esses dois valores como variáveis comuns de build. Limite quem tem permissão de escrita/execução no repositório de controle e não habilite debug de Actions/Wrangler com credenciais reais.

## Quando houver autorização para executar

1. Deixe o assistente Git de Workers Builds sem publicar. Este fluxo usa GitHub Actions diretamente; não precisa conectar o repositório de controle ao Workers Builds.
2. Confira que a PR dos quatro arquivos está revisada e integrada somente na main do controle. O workflow de validação aprovado permanece independente.
3. No controle, abra **Actions → Primeira publicacao privada HML → Run workflow**.
4. Escolha a branch `main` **do controle**. Não há seletor livre de fonte, Worker ou configuração: a fonte permanece fixa na branch/commit indicados acima.
5. Digite exatamente `PUBLICAR-HML-SEM-URL` e marque a confirmação de publicação sem URL/Supabase/IA. Sem ambas, a execução falha antes de receber credenciais.
6. Dispare apenas quando autorizado. Esse clique executará um deploy real para criar o Worker; não é outro dry-run. O comando final é executado pelo script, sempre com `--config wrangler.homolog.json`.

## Confirmar que a aplicação continua sem exposição

Após a execução autorizada, confira:

1. O passo final terminou e exibiu o relatório controlado: Worker `black-sales-ai-hml`, commit aprovado, `workersDev: false`, `previews: false`, `customDomains: 0`, IA desativada e exportação desativada.
2. No Cloudflare **Workers & Pages**, selecione `black-sales-ai-hml` na conta correta.
3. Em **Settings → Domains & Routes**, confirme ausência de rotas/domínios públicos, workers.dev desativado e Preview URLs desativadas. Não habilite nenhum endereço para tentar abrir a aplicação.
4. Em **Variables & Secrets**, confirme somente os bindings esperados; não há Supabase, IA nem Basic configurados por esse fluxo.

Sem endereço público, ainda não há um site para abrir no navegador. Isso é intencional. Uma etapa posterior, separadamente autorizada, deverá cadastrar `HOMOLOG_BASIC_AUTH` como Secret de runtime e somente depois planejar a ativação HTTPS. usuário no formato [A-Za-z0-9][A-Za-z0-9._-]{0,63}, dois-pontos e senha aleatória exclusiva de 32–128 caracteres ASCII visíveis sem espaços; não reutilize senha Supabase ou fixtures públicas dos testes. A configuração do Supabase e a ativação de IA ficam fora desta missão.

Se o upload falhar ou a verificação final não confirmar o estado privado, o job falha, não tenta novamente e não apaga recursos automaticamente. Uma falha após upload pode deixar um Worker criado. Confira o painel antes de qualquer nova ação: uma segunda execução será bloqueada se encontrar o Worker. Não contorne a trava nem habilite URLs para resolver erro de configuração.

## Verificação local sem Cloudflare

Com Node 24 e o código aprovado da aplicação disponível em outro diretório:

```sh
HML_TEST_SOURCE=/caminho/da/aplicacao node --test tests/publish-hml.test.mjs
node scripts/publish-hml.mjs validate /caminho/da/aplicacao
```

O primeiro comando simula todas as chamadas de API e o publicador. O segundo faz apenas leituras locais e consulta Git da branch pública; não acessa Cloudflare nem publica. Os testes cobrem confirmações, Secrets ausentes, origem/hash, configuração pública, permissões, Worker existente, erros de API, estado final público e ausência de retries. Não alegam validar permissões reais de um token ou a API hospedada.

Referências oficiais: [GitHub Actions com Workers](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [API Tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) e [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

# Catálogo das funções do fork MIA

Este documento é o roteiro de quem confere se as NOSSAS funções continuam ligadas. Ele é lido
por um agente revisor (ou por uma pessoa) a cada fusão do upstream e a cada PR de função nova.

O defeito que ele existe para pegar é sempre o mesmo: o upstream muda ou cria um caminho, e uma
peça nossa deixa de ser chamada ou é contornada, **sem erro e sem teste vermelho**. Exemplo real
(fusão da v1.107): entrou um arquivo novo do upstream, `lib/cadencias/worker.ts`, que chamava
`sendEmail(` sem `organizationId`. O roteador de e-mail só pergunta se a empresa é de demonstração
quando recebe a organização; sem ela, a cadência mandaria e-mail de verdade a contato fictício.
O conserto foi uma linha (`organizationId: inscricao.organization_id`) e a conferência desta
página existe para esse tipo de linha não escapar de novo.

As regras de convivência com o upstream estão em [`../FORK-MIA.md`](../FORK-MIA.md). Cada função
tem o seu documento em `docs/fork/`; este catálogo aponta para eles e diz **o que conferir**.

## Como usar

**Quando conferir.** Toda fusão do upstream (o agente de fusão e quem revisa) e todo PR que cria
ou muda uma função do fork. Em PR de função nova, a entrada dela neste catálogo entra no mesmo PR.

**Ordem.**

1. As **regras que valem para todas as funções** (seção seguinte). São as que o diff do upstream
   mais quebra, e nenhuma depende de saber qual função foi tocada.
2. Descubra **quais funções o diff toca**: rode a lista de arquivos alterados (abaixo) e procure,
   nas seções por função, os arquivos citados em "Pontos de encaixe".
3. Em cada função tocada, rode as conferências de "Como conferir depois de uma fusão".

Lista dos arquivos que a fusão mexeu, e dos que nasceram nela (`vA` é a versão antes, `vB` a
depois; use o rótulo da tag, por exemplo `v1.107.0`, ou os dois commits):

```bash
git diff --name-only vA vB -- lib app components hooks easypanel .github docker > /tmp/tocados.txt
git diff --name-only --diff-filter=A vA vB -- lib app components hooks > /tmp/novos.txt
```

**Defeito achado.** Corrija no mesmo PR da fusão. Sempre que der, **transforme a conferência em
teste automático** (uma cerca em `tests/unit`, ou uma invariante em `tests/invariants`) e cite o
teste na seção da função: o objetivo é nunca mais depender de olho humano para aquele caso.
Uma cerca nova só reprova padrão que existe de verdade (rode-a contra o defeito antes de
confiar nela). O que ainda depende de conferência manual está marcado com **LACUNA**.

**Como ler os comandos.** `git grep` roda na raiz do repositório, na árvore já fundida.
"Lê só" quer dizer que a ferramenta do MCP de plataforma não grava nada. A empresa de
demonstração é a **Empresa Modelo · Demonstração** (slug `empresa-modelo-demonstracao`); nunca
confira com empresa de cliente real.

---

## Regras que valem para todas as funções

### R1. A trava da empresa de demonstração

Toda saída que chegaria a uma pessoa de verdade tem de passar pela trava da empresa de
demonstração. A marca é a coluna `organizations.demonstracao`; a pergunta é `fn_mia_e_demonstracao`
(`lib/demonstracao/trava.ts`, `travaDaDemonstracao`). A trava **falha fechada**. Detalhes em
[`cliente-modelo.md`](cliente-modelo.md), seção "A trava: o que bloqueia".

Há duas portas, e o defeito é sempre uma saída nova que não passa por nenhuma:

| saída | onde é barrada | o que o diff novo pode contornar |
|---|---|---|
| e-mail (`sendEmail`, roteador) | `lib/email/roteador.ts`, só quando recebe `organizationId` | chamada de `sendEmail(` sem `organizationId`; chamada direta a `lib/email/resend.ts`, `smtp.ts` ou `ses.ts` |
| e-mail das automações | `lib/automation/actions/send-email.ts` (`travaDaDemonstracao`) e o gatilho da 9043 | ação nova de automação que envia por outro caminho |
| mensagem de WhatsApp | a fila de `messages` recusa saída `queued`/`sending` (9010) | envio **sem** passar pela tabela `messages`: chamada direta à API do provedor |
| campanha, broadcast, follow-up, prospecção, lembrete | banco, na mudança de estado (9010) | caminho novo que dispara sem mudar o estado barrado |
| conversões da Meta e do Google | a conexão de conversões não liga na demonstração (9010) | consumidor novo que fala com a rede sem ler a conexão |
| agenda externa, push, ligação, servidor MCP externo, webhook de saída | gatilhos da 9010, 9016, 9043 | integração nova com conexão própria |
| e-mail marketing | `lib/email-marketing/envio.ts` (`travaDaDemonstracao`) e `trg_mia_email_demonstracao_nao_envia` (9064) | motor novo que manda sem o `mandar` |

**Conferir.**

```bash
# 1. Arquivo NOVO (não só os de sempre) que chama sendEmail: cada chamada precisa de organizationId
git diff --name-only --diff-filter=A vA vB | xargs grep -l "sendEmail(" 2>/dev/null
# e o mesmo para os arquivos que a fusão alterou
git diff --name-only vA vB -- lib app | xargs grep -l "sendEmail(" 2>/dev/null
# em cada arquivo achado, a chamada e as 14 linhas seguintes têm de conter organizationId
git grep -n -A14 "sendEmail(" -- lib app ':!lib/email' ':!*.test.*' | grep -c organizationId
# 2. Alguém falando direto com os transportes, sem o roteador
git grep -n "from \"@/lib/email/\(resend\|smtp\|ses\)\"" -- lib app ':!lib/email' ':!lib/email-marketing' ':!*.test.*'
# 3. Envio de WhatsApp fora da fila de messages (arquivo novo que fala com o provedor)
git diff --name-only --diff-filter=A vA vB -- lib app | xargs grep -l "graph.facebook.com\|uazapi\|/send/text" 2>/dev/null
# 4. Conversões: consumidor ou handler novo de evento de anúncio
git diff --name-only --diff-filter=A vA vB -- lib | xargs grep -l "conversions\|capi\|gtag\|measurement" 2>/dev/null
# 5. Os testes que provam a trava
npx vitest run tests/unit/send-email-na-demonstracao.test.ts tests/unit/cliente-modelo-trava.test.ts \
  tests/unit/convite-de-equipe-na-demonstracao.test.ts tests/unit/empresa-de-demonstracao-nao-envia.test.ts
```

Hoje há onze chamadores de `sendEmail(` fora de `lib/email/` (`git grep -ln "sendEmail(" -- lib app`).
Quem manda para a PLATAFORMA ou para o dono de uma empresa de verdade (cobrança, chamado, raio-X) pode
não passar a organização; todo o resto passa.

**LACUNA.** Não existe cerca que reprove, em qualquer arquivo, um `sendEmail(` sem
`organizationId` (o teste `send-email-na-demonstracao.test.ts` prova só a ação de automação). É o
candidato número um a virar teste: percorrer `lib/` e `app/` e exigir `organizationId` ou uma
exceção nomeada, no molde de `convite-de-equipe-na-demonstracao.test.ts`, que já reprova um
segundo chamador da exceção do convite.

### R2 e R3. O schema mora ao lado do do upstream, e a gente estende, nunca redefine

`supabase/baseline.sql` e `supabase/migrations/` (arquivos e `MANIFEST.md`) são do upstream e entram
**byte a byte**. O nosso mora em `supabase/baseline-mia.sql` e `supabase/migrations-mia/` (o
`easypanel/bootstrap.sh` aplica os dois, nessa ordem), na faixa 9000+, com a descrição numa linha
`-- manifest:` no próprio arquivo. O `baseline-mia.sql` não pode fazer `create or replace` de função,
gatilho, view ou constraint que já exista no `baseline.sql`: vale o nosso (roda por último) e a melhoria
futura do upstream some em silêncio. Migration do upstream que passa a definir um nome que o fork já usa
também é colisão. O carimbo (`lib/schema/carimbo.ts` e o `insert` no `baseline-mia.sql`) é a nossa mais nova.
Exceção à ordem: o trecho entre `-- >>> ANTES DO BASELINE DO UPSTREAM` e `-- <<< ...` do `baseline-mia.sql`
(migration 9163) roda ANTES do `baseline.sql`, recortado por `antes_do_upstream` nas duas passadas do modo update
do `bootstrap.sh` e pelo `scripts/ensaio-de-banco.sh`; se ele some ou perde a chamada, nada dá erro e a
`organization_modules` do upstream (9416) cai na nossa.

```bash
git diff --stat upstream/main vB -- supabase/baseline.sql supabase/migrations   # vazio se vB é o upstream puro
ls supabase/migrations supabase/migrations-mia | grep -E "_9[0-9]{3}_" | sort | uniq -d   # número repetido
node scripts/redefinicoes-do-upstream.mjs supabase/baseline.sql supabase/baseline-mia.sql
npx vitest run tests/unit/schema-mia-estende-nunca-redefine.test.ts tests/unit/carimbo-do-schema.test.ts   tests/unit/mcp-de-implantacao-espelhos.test.ts   # o último guarda as funções do upstream que copiamos (9022, 9045)
npx vitest run tests/unit/schema-mia-antes-do-upstream.test.ts   # o trecho da 9163 existe e roda antes do baseline.sql
```

### R4. LGPD: anonimização e exportação cobrem as tabelas nossas

Toda tabela nossa com dado de pessoa (ou `contact_id`) é anonimizada **e** entra no pacote do titular; toda
coluna nova de pessoa do upstream precisa de resposta para "isto é dado pessoal?". Encaixes:
`lib/lgpd/export-collector.ts` e `copia-do-titular.ts` (as seções do fork) e as funções nossas de
anonimização (9007, 9047, 9051, 9064); a `fn_lgpd_cascade_redact_contact` é do upstream e o fork NÃO a redefine.

```bash
npx vitest run tests/unit/lgpd-as-duas-pontas.test.ts tests/unit/lgpd-exporta-o-que-redige.test.ts   tests/unit/lgpd-varredura-completa-a-cascata.test.ts tests/unit/lgpd-pacote-do-titular-paridade.test.ts
npx vitest run -c vitest.db.config.ts tests/invariants/lgpd-redact-unificado-alcanca-pelo-catalogo.test.ts
git grep -c "FORK MIA" -- lib/lgpd/export-collector.ts lib/lgpd/copia-do-titular.ts   # os blocos nossos continuam
```

### R5. Toda função nova entra no MCP de plataforma

Regra do dono do produto: a ferramenta entra **na mesma versão** da função, nos dois arrays:
`FERRAMENTAS` em `lib/mcp-plataforma/ferramentas.ts` e `OPERACOES` em `operacoes.ts`. Ferramenta que sumiu
do array na fusão não dá erro: a função só deixa de existir para o agente de implantação. Função nova ou
alterada **do upstream** também entra (um `mcp-de-implantacao-novidades-do-upstream-<versão>.test.ts` por versão
trazida; ver o `-1107`).

```bash
for f in lib/mcp-plataforma/ferramentas/*.ts; do b=$(basename $f .ts); git grep -q "ferramentas/$b" lib/mcp-plataforma/ferramentas.ts || echo "SEM LIGAÇÃO: $b"; done
npx vitest run tests/unit/mcp-de-implantacao-ferramentas.test.ts tests/unit/mcp-de-plataforma-escopo.test.ts   tests/unit/mcp-de-implantacao-espelhos.test.ts
```

### R6. Toda tela nova tem manual e pergunta do assistente

Toda tela do app (`app/app/**/page.tsx`, porta do catálogo de navegação) tem manual em
`lib/assistente/manuais-das-telas.ts` (ou roteiro), e a subpágina é alcançada pela ajuda da tela de cima.
Tela do upstream que nasceu na fusão entra na mesma conta.

```bash
npx vitest run tests/unit/assistente-ajuda-cobre-todas-as-telas.test.ts tests/unit/ajuda-leva-a-telas-que-existem.test.ts   tests/unit/navegacao-completude.test.ts
git diff --name-only --diff-filter=A vA vB -- app | grep "page.tsx"      # tela nova: tem manual?
```

### R7. RLS em toda tabela `mia_*`

Tabela nova do fork nasce com RLS ligada, política por empresa (gerente lê, só o servidor escreve, salvo
decisão em contrário) e entra nas provas.

```bash
npx vitest run -c vitest.db.config.ts tests/invariants/rls-tabelas-da-mia.test.ts   tests/invariants/rls-completude-varredura.test.ts tests/invariants/hardening-definer-varredura.test.ts
for f in $(git ls-files supabase/migrations-mia | grep ".sql$"); do grep -qi "create table" $f && ! grep -qi "enable row level security" $f && echo "SEM RLS?: $f"; done
```

### R8. Workflows e robôs: o que é só do fork

`.github/workflows/sincronizar-upstream.yml` é nosso; os outros vêm do upstream, com toques `FORK MIA` em
`ci.yml`, `e2e.yml`, `mysql-integracao.yml`, `perf.yml` e `publish-image.yml`. O defeito típico é workflow
**novo** do upstream que publica imagem, tag, release ou issue no namespace DELE. Os cron das funções nossas
moram em `docker/scheduler/entrypoint.sh` (`ia-pendente`, `email-marketing`, `leads-da-meta`, `raio-x`,
`obrigacoes-avisos`, `assistente-resumo-da-manha`, `cobranca`): se a fusão reescreveu o arquivo, as linhas e as
rotas em `app/api/v1/cron/` têm de continuar.

```bash
git diff --name-only --diff-filter=A vA vB -- .github/workflows               # workflow novo
git grep -n "melgarafael" -- .github/workflows ':!.github/workflows/acolhida.yml'   # só comentário, nunca alvo de escrita
git grep -n "cron/" docker/scheduler/entrypoint.sh
npx vitest run tests/unit/robo-da-sincronizacao-fala-com-o-fork.test.ts tests/unit/workflows-tem-permissions.test.ts   tests/unit/namespace-das-imagens.test.ts tests/unit/toda-imagem-publicada-constroi-em-pr.test.ts   tests/unit/acolhida-nao-toca-no-fork.test.ts
```

### R9. Os marcadores, as rotas públicas e os textos-contrato `FORK MIA` não podem sumir

Os marcadores são os pontos de encaixe. Fusão que resolve conflito "pegando o lado do upstream"
apaga o encaixe e a função desliga em silêncio. Compare a contagem por arquivo antes e depois:

```bash
git grep -c "FORK MIA" vA -- lib app components easypanel .github | sed 's/^[^:]*://' | sort > /tmp/marc-antes.txt
git grep -c "FORK MIA" HEAD -- lib app components easypanel .github | sed 's/^[^:]*://' | sort > /tmp/marc-depois.txt
diff /tmp/marc-antes.txt /tmp/marc-depois.txt        # linha com contagem MENOR depois = encaixe que sumiu
```

Arquivos do upstream que levam encaixe de **várias** funções (confira primeiro, quase toda fusão
os toca): `lib/audit/actions.ts` (códigos de auditoria `*.` das funções), `lib/i18n/dicionario.ts`
(uma linha que espalha cada `lib/i18n/dicionario-mia-*.ts`), `lib/auth/public-paths.ts` (rotas
públicas: preços, preferências de e-mail, raio-X, consultas de cupom), `lib/navigation/catalogo.ts`
(portas do menu), `lib/mcp-plataforma/ferramentas.ts` e `operacoes.ts`, `lib/lgpd/export-collector.ts`,
`docker/scheduler/entrypoint.sh`, `components/admin/AdminSidebar.tsx`.

```bash
# cada dicionário nosso continua importado e espalhado
for f in lib/i18n/dicionario-mia-*.ts lib/i18n/dicionario-cartoes-mia.ts lib/i18n/dicionario-empresas-mia.ts \
         lib/i18n/dicionario-obrigacoes-mia.ts lib/i18n/dicionario-relatorios-mia.ts; do
  b=$(basename $f .ts); git grep -q "$b" lib/i18n/dicionario.ts || echo "DICIONÁRIO DESLIGADO: $b"; done
npx vitest run tests/unit/i18n-espanhol-cobre-a-tela.test.ts
```

Duas leituras que o upstream muda sem aviso e desligam função nossa: a lista de rotas públicas
(`lib/auth/public-paths.ts`: as nossas são ancoradas; reescrita da lista derruba `/precos`, as preferências
de e-mail ou o link do raio-X) e os textos-contrato (etiqueta `Formulario_Meta`, chave `MetaEtapa:<uuid>`,
a marca `demonstracao`), lidos por código nosso. Confira com `git grep -n "Formulario_Meta" -- lib`.

---

## Uma seção por função

Em cada seção: o que faz, onde mora, os pontos de encaixe no upstream, o que protege, como conferir
e os riscos conhecidos. Os testes citados existem em `tests/unit` ou `tests/invariants`. As
invariantes precisam do Postgres de teste (`-c vitest.db.config.ts`).

### 1. Agenda com o Microsoft 365 · [`agenda-microsoft.md`](agenda-microsoft.md)
**O que faz.** A pessoa conecta o Outlook, a MIA lê o que está ocupado (a IA marca sem
conflito), publica o compromisso no Outlook e cria a reunião no Teams. **Migrations** 9011 (conexão e
ocupação), 9014 (publicação), 9015 (Teams), 9016 (demonstração sem Outlook), 9044. **Mora em**
`lib/agenda/microsoft/`, `lib/agenda-mia/`, `components/agenda/microsoft/`, rotas
`app/api/v1/agenda/microsoft/`.

**Pontos de encaixe no upstream** (a lista fechada está na seção 3.4 do documento):
`lib/agenda/consulta.ts` e `lib/agenda/ocupacao-externa.ts` (somam a ocupação da Microsoft; se o
upstream reescrever, a IA volta a marcar em cima do Outlook), `app/app/agenda/page.tsx`,
`app/app/settings/tenant/agenda/_client.tsx`, `app/api/v1/agenda/tipos/route.ts` (apelido
`microsoft_teams`), `app/api/v1/agenda/agendamentos/_handler.ts` e `[id]/route.ts`,
`components/agenda/DetalheDoCompromisso.tsx`, `lib/agent-engine/agent/meet-delivery.ts`,
`lib/agenda/texto-do-compromisso.ts`, `lib/mcp/tools/agendamento.ts`,
`lib/agent-engine/agent/compromissos-do-contato.ts`.

**Protege.** `tests/unit/agenda-microsoft.test.ts` (e as irmãs `agenda-microsoft-*.test.ts`), `agenda-do-atendente-ve-a-ocupacao-do-dono.test.ts`, `agenda-nenhuma-tabela-sem-rls.test.ts`, `agenda-lgpd-alcanca.test.ts`; invariante `tests/invariants/agenda-nasce-com-o-que-marcar.test.ts`.

**Conferir depois da fusão.**
1. `git grep -n "FORK MIA" -- lib/agenda/consulta.ts lib/agenda/ocupacao-externa.ts app/api/v1/agenda/tipos/route.ts` (os encaixes 1, 2 e 5 vivos).
2. `git grep -n "agenda-mia/ocupacao" -- lib/agenda` (a chamada que soma a Outlook à ocupação).
3. `npx vitest run tests/unit/agenda-microsoft.test.ts tests/unit/agenda-do-atendente-ve-a-ocupacao-do-dono.test.ts`.
4. Na demonstração, a conta Microsoft só existe desconectada (R1): `git grep -n "travaDaDemonstracao" -- app/api/v1/agenda/microsoft/connect/route.ts`.

**Riscos.** Falta o teste com conta real do Azure (seção 8 do documento). Com destino no Outlook, a
reserva do Google grava "Escolha uma agenda de destino" em `google_sync_error` a cada 15 min
(efeito conhecido, seção 3.5).

### 2. Área de cobrança e o lado da Time · [`area-de-cobranca.md`](area-de-cobranca.md)
**O que faz.** A empresa vê as cobranças com nota e recibo, paga, troca o cartão e pede a correção de
uma nota errada; a Time vê o funil e a situação do pagamento e, depois de 30 dias sem pagar, pode
apagar o cadastro. **Migrations** 9125 (cartão das mensalidades), 9126 (funil e cadastro sem
pagamento). **Mora em** `lib/area-de-cobranca/`, `components/area-de-cobranca/`,
`lib/pagamento-inicial/situacao-na-lista.ts` e `cadastro-sem-pagamento.ts`.

**Pontos de encaixe.** `app/app/settings/billing/page.tsx` (a área, só do administrador),
`app/admin/(protected)/empresas-do-cadastro/page.tsx` (funil, coluna e botão),
`components/pagamento-inicial/CamposFiscais.tsx` (prop `documentoTravado`),
`lib/mcp-plataforma/ferramentas/plataforma.ts` (`cobrancas` no `plataforma_ver_cliente`),
`easypanel/bootstrap.sh` (reaplica o schema quando só sobra deadlock), `lib/assistente/manuais-das-telas.ts`.

**Protege.** `tests/unit/area-de-cobranca-regras.test.ts`, `area-de-cobranca-leitura.test.ts`,
`area-de-cobranca-servico.test.ts`, `area-de-cobranca-cartao-fora-dos-registros.test.ts`,
`area-de-cobranca.test.ts`, `cadastro-sem-pagamento-apagar.test.ts`,
`bootstrap-reaplica-no-deadlock.test.ts`, `mcp-de-implantacao-area-de-cobranca.test.ts`.

**Conferir.**
1. `git grep -n "FORK MIA" -- app/app/settings/billing/page.tsx app/admin/\(protected\)/empresas-do-cadastro/page.tsx easypanel/bootstrap.sh`.
2. `npx vitest run tests/unit/area-de-cobranca-servico.test.ts tests/unit/bootstrap-reaplica-no-deadlock.test.ts tests/unit/area-de-cobranca-cartao-fora-dos-registros.test.ts`.
3. MCP (lê só): `plataforma_ver_cobranca` e `plataforma_ver_cliente` na demonstração.

**Riscos.** O cartão nunca pode aparecer em registro nenhum (só final e bandeira); "Apagar o cadastro"
só depois de 30 dias sem pagamento, com verificação em duas etapas.

### 3. O assistente da MIA · [`assistente.md`](assistente.md)
**O que faz.** O chat da equipe do cliente dentro do sistema: rotina, números, uso do sistema; chamados
ao suporte; "Me mostra como" (trilhas); propostas que ele faz com aprovação humana. **Migrations**
9050, 9051, 9052, 9080, 9081, 9082, 9090, 9091, 9100, 9101 (e a 9010 para a demonstração). **Mora em**
`lib/assistente/`, `components/assistente/`, `app/app/assistente/`, `app/api/v1/assistente/`.

**Pontos de encaixe** (seção 7 do documento): `components/shell/TopBar.tsx` (o botão),
`lib/navigation/catalogo.ts` e `registry.ts`, `lib/ai/pontos/registro.ts` e `lib/ai/custo/natureza.ts`
(o ponto de IA e a natureza do gasto), `lib/ai/inbox-destino.ts` (as referências `mia_chamado`,
`mia_assistente_resumo`, `mia_assistente_proposta`), `lib/api/client.ts`, `lib/lgpd/export-collector.ts`,
`lib/ai/agents/publish.ts` (o follow-up proposto sai com o agente), `components/admin/AdminSidebar.tsx`,
`docker/scheduler/entrypoint.sh`.

**Protege.** `tests/unit/assistente-faz-com-aprovacao.test.ts`, `assistente-trilhas-marcadores.test.ts`, `assistente-ajuda-cobre-todas-as-telas.test.ts`, `primeiros-passos-do-assistente.test.ts`, `demonstracao-recomeca-o-assistente.test.ts`, `mcp-de-implantacao-assistente.test.ts`; invariante `tests/invariants/assistente-da-mia.test.ts`.

**Conferir.**
1. `git grep -n "FORK MIA" -- components/shell/TopBar.tsx lib/ai/pontos/registro.ts lib/ai/inbox-destino.ts lib/ai/agents/publish.ts`.
2. `npx vitest run tests/unit/assistente-faz-com-aprovacao.test.ts tests/unit/assistente-ajuda-cobre-todas-as-telas.test.ts`.
3. Se o diff mexeu em `lib/ai/` ou nas telas que a trilha destaca: `npx vitest run tests/unit/assistente-trilhas-marcadores.test.ts` (um `data-testid` por elemento destacado).
4. MCP (lê só): `plataforma_ver_assistente`, `plataforma_ver_propostas_do_assistente`, `plataforma_ver_trilhas`.

**Riscos.** O assistente só **propõe**; quem decide é a pessoa (regra que não se dobra, seção 1). Tela do
upstream que perde um `data-testid` quebra a trilha sem erro.

### 4. Broadcast unificado · [`broadcast-unificado.md`](broadcast-unificado.md)
**O que faz.** Um produto só chamado Broadcast, com a tela de Campanhas do upstream como base e três
caminhos: número oficial, número por QR (as Campanhas dele) e e-mail. Os motores seguem separados.
**Sem migration própria.** **Mora em** `lib/broadcast/` (`canais-do-disparo.ts`, `lista-unificada.ts`,
`acesso.ts`), `lib/modulos/recusa-por-recurso.ts`, `components/broadcast/`, `app/app/broadcast/`.

**Pontos de encaixe.** `app/app/campaigns/page.tsx` (redireciona para o Broadcast),
`app/app/campaigns/layout.tsx`, `lib/auth/require-role.ts` (a trava por módulo, uma chamada),
`lib/navigation/catalogo.ts` (sai a entrada Campanhas), `.github/workflows/e2e.yml` (a spec nova).

**Protege.** `tests/unit/broadcast-unificado.test.ts`, `navegacao-completude.test.ts`,
`navegacao-registry.test.ts`; `tests/e2e/broadcast-unificado.spec.ts`.

**Conferir.**
1. `git grep -n "FORK MIA" -- app/app/campaigns/page.tsx lib/auth/require-role.ts lib/navigation/catalogo.ts`.
2. `npx vitest run tests/unit/broadcast-unificado.test.ts tests/unit/navegacao-completude.test.ts`.
3. Se o upstream mexeu em `app/app/campaigns/`: o redirecionamento ainda leva a `/app/broadcast`.

**Riscos.** O formulário de Campanhas oferece também o número que só entrega modelo aprovado
(candidato a PR no upstream).

### 5. Cartões e fichas do CRM · [`cartoes-e-fichas.md`](cartoes-e-fichas.md)
**O que faz.** O cartão fechado do funil responde "quanto vale, vai fechar, o que fazer, com quem
está a bola"; o cartão aberto é uma gaveta larga; a ficha do contato mostra as fichas conectadas.
**Migrations** 9012 (sinais do cartão), 9013 (papel do contato na empresa), 0264. **Mora em**
`lib/cartoes/`, `components/cartoes/`.

**Pontos de encaixe.** `components/kanban/KanbanCard.tsx`, `KanbanBoard.tsx`, `FilterBar.tsx`,
`ConversaSlot.tsx`; `app/app/pipelines/[id]/_client.tsx`; `app/app/contacts/[id]/_client.tsx` (a
ficha conectada, uma linha); `app/api/v1/leads/_handler.ts` (`updateLeadHandler`, o "veio da
conversa"); `app/api/v1/pipelines/[id]/board/route.ts`; `app/api/v1/leads/[id]/contatos-relacionados/route.ts`
(três trechos `FORK MIA` que unem as pessoas do negócio dos dois modelos).

**Protege.** `tests/unit/cartao-fechado-mia.test.tsx`, `cartao-aberto-mia.test.tsx`,
`pessoas-do-negocio-dos-dois-modelos.test.ts`, `fichas-conectadas-mia.test.tsx`.

**Conferir.**
1. `git grep -n "FORK MIA" -- components/kanban/KanbanCard.tsx app/api/v1/pipelines/\[id\]/board/route.ts app/api/v1/leads/\[id\]/contatos-relacionados/route.ts`.
2. `npx vitest run tests/unit/cartao-fechado-mia.test.tsx tests/unit/pessoas-do-negocio-dos-dois-modelos.test.ts`.
3. O teste do upstream `contatos-relacionados-nao-vaza-outra-org` segue verde (`git grep -l "contatos-relacionados-nao-vaza" tests`).

**Riscos.** Contrato de altura do cartão (o do upstream, `docs/handoffs/BRIEFING-crm-vivo.md`, seção 5):
linha nova no cartão sem respeitá-lo quebra o quadro. Pessoas do negócio vivem em dois modelos
(`envolvido` do fork e `related` do upstream); a leitura une os dois e não converte dado.

### 6. O cliente modelo · as empresas de demonstração · [`cliente-modelo.md`](cliente-modelo.md)
**O que faz.** Cinco empresas de dados fictícios, em produção, marcadas para que nada saia de verdade
e tiradas dos números da plataforma. A mesma semente gera todas. **Migrations** 9010 (a marca e a
trava), 9016, 9017, 9018, 9020 (convite de equipe sai), 9021, 9043. **Mora em** `lib/demonstracao/`
(`trava.ts`, `selo.ts`, `semente/`), `lib/mcp-plataforma/ferramentas/demonstracao.ts`.

**Pontos de encaixe.** `lib/email/roteador.ts` (a pergunta antes de enviar), `lib/automation/actions/send-email.ts`,
`app/api/v1/messages/_handler.ts` (o 403 `organizacao_de_demonstracao`), `lib/api/errors.ts`,
`app/app/layout.tsx` (o selo), `app/app/team/invite/_components/AvisoDeConviteNaDemonstracao.tsx`,
`lib/catalogo/origens-do-fork.ts` (a origem `demonstracao`). A regra geral é a **R1**.

**Protege.** `tests/unit/cliente-modelo-trava.test.ts`, `cliente-modelo-semente.test.ts`,
`convite-de-equipe-na-demonstracao.test.ts`, `send-email-na-demonstracao.test.ts`,
`mcp-de-demonstracao.test.ts`, `seed-de-demonstracao-recusa-destino-remoto.test.ts`,
`automacoes-de-demonstracao-sao-coerentes.test.ts`, `mcp-externo-na-demonstracao.test.ts`; invariantes
`empresa-de-demonstracao-nao-envia.test.ts`, `cliente-modelo-semente.test.ts`, `mcp-de-demonstracao.test.ts`.

**Conferir.** (Esta é a função mais importante: rode sempre.)
1. Os comandos da **R1**.
2. `npx vitest run tests/unit/cliente-modelo-trava.test.ts tests/unit/send-email-na-demonstracao.test.ts`.
3. MCP (lê só): `plataforma_listar_demonstracoes` (as cinco aparecem marcadas).
4. Ação nova do upstream que "envia algo" (automação, aviso, integração): ela tem porta própria na tabela da seção
   "A trava" do documento? Se não, abra a porta (gatilho em migration 9xxx) antes de implantar.

**Riscos.** A trava não cobre "Testar o agente" (gasta saldo real da OpenAI), configuração em conta de
fora e o e-mail de login (GoTrue); estão no documento. O convite de equipe sai de propósito (9020), com
exceção nomeada e um só chamador.

### 7. Contatos em massa · [`contatos-em-massa.md`](contatos-em-massa.md)
**O que faz.** A planilha de contatos entra com o telefone; "Selecionar todos os N contatos deste
filtro" etiqueta em massa além de 100; o Broadcast explica a lista vazia. **Sem migration** (o carimbo
não muda). **Mora em** `lib/contacts/completar-na-importacao.ts`, `lib/contacts/lote-em-partes.ts`,
`app/api/v1/contacts/bulk/filtro/`, `lib/implantacao/etiquetar-contatos.ts`.

**Pontos de encaixe** (seção 5 do documento, todos `FORK MIA (.97)`): `lib/contacts/csv.ts`
(`HEADER_ALIASES` com `phone`), `app/api/v1/contacts/import/route.ts`, `app/api/v1/contacts/_handler.ts`
(`com_total`), `hooks/contacts/useBulkContacts.ts`, `components/contacts/ImportContactsDialog.tsx`,
`BarraDeContatosEmLote.tsx`, `app/app/contacts/_client.tsx`.

**Protege.** `tests/unit/disparo-conferencia-do-filtro.test.ts`, `mcp-etiquetar-contatos.test.ts`.

**Conferir.**
1. `git grep -n "phone" lib/contacts/csv.ts | head` (o alias do telefone vive).
2. `git grep -n "FORK MIA (.97)" -- lib/contacts app/api/v1/contacts hooks/contacts components/contacts`.
3. `npx vitest run tests/unit/disparo-conferencia-do-filtro.test.ts tests/unit/mcp-etiquetar-contatos.test.ts`.

**Riscos.** O upstream mexe na mesma leitura da importação (`contatosDonosDosExtras`, telefone extra
da ficha): ela entra na lista de quem é conhecido, sem mudar a decisão por linha. LACUNA: não há teste da
importação por planilha de ponta a ponta; confira com um CSV de dado fictício.

### 8. Conversões da Meta por etapa · [`conversoes-da-meta.md`](conversoes-da-meta.md)
**O que faz.** Avisa a Meta de cada etapa do funil (quanto antes o sinal, mais rápido o anúncio aprende);
a volta dos leads de formulário e o diagnóstico "Testar conexão" são nossos; a régua por etapa é do
upstream desde a .72 (0524). **Migrations** 9003, 9010, 9017, 9019 (obsoleta, mantém objetos). **Mora em**
`lib/conversoes-meta/`, `lib/implantacao/conversoes.ts`, `lib/mcp-plataforma/ferramentas/conversoes.ts`,
`components/cartoes/aberto/ConversoesDaOrigem.tsx`.

**Pontos de encaixe.** `lib/conversoes/gravar-regras-meta.ts` (o miolo tirado da gravação da tela, par
de `gravar-regras-google.ts`), `lib/event-log/register-handlers.ts` (o consumidor dos formulários),
`app/app/settings/conversoes/page.tsx` (o link do negócio na pendência),
`app/actions/settings/conversoesDaMeta.ts`, `lib/plataformas-de-anuncio/meta/diagnostico-de-conversoes.ts`.

**Protege.** `tests/unit/conversoes-da-meta-por-etapa.test.ts`, `conversoes-da-meta-consumidor.test.ts`
(a regra da casa: **uma ida só à Meta por evento**, com os três consumidores juntos),
`conversoes-da-meta-transporte.test.ts`, `conversoes-da-meta-regras-e-diagnostico.test.ts`,
`conversoes-da-meta-acoes.test.ts`, `conversoes-da-meta-tela.test.tsx`, `mcp-de-implantacao-conversoes.test.ts`;
invariante `conversoes-da-meta-por-etapa.test.ts`, `rls-tabelas-da-mia.test.ts`.

**Conferir.**
1. `git grep -n "conversoesDoLeadDeFormulario\|conversaoDoLeadDeFormularioHandler" lib/event-log/register-handlers.ts` (o consumidor segue registrado).
2. `git grep -n "FORK MIA" -- lib/conversoes/gravar-regras-meta.ts app/app/settings/conversoes/page.tsx`.
3. `npx vitest run tests/unit/conversoes-da-meta-consumidor.test.ts tests/unit/conversoes-da-meta-por-etapa.test.ts`.
4. Um consumidor novo de evento de anúncio do upstream repete o envio de um evento? A regra da casa (seção "A regra da casa" do documento) reprova.
5. MCP (lê só): `plataforma_ver_conversoes`, `plataforma_diagnosticar_conversoes_da_meta`.

**Riscos.** Perdas ao adotar a régua do upstream (valor por etapa, canal de entrada, chave por evento) são
candidatas a PR. Falta prova com conta real da Meta. Na demonstração, sem conexão ligada o consumidor para
em `sem_conexao`.

### 9. Cupons, parceiros e comissão · [`cupons-e-parceiros.md`](cupons-e-parceiros.md)
**O que faz.** Cupom de desconto ou de dias grátis (o desconto vai para o Asaas), parceiro que indica e
ganha comissão sobre o líquido, repasse do mês com extrato por e-mail, setup de implantação cobrado à
parte. **Migrations** 9122, 9130, 9131, 9132. **Mora em** `lib/cupons/`, `lib/parceiros/`,
`lib/setup-de-implantacao/`, `components/cupons/`.

**Pontos de encaixe** (seção 12): `lib/cobranca/checkout.ts` (o desconto na assinatura recém-criada),
`lib/cobranca/sincronizar.ts` (`conferirPreco`: preço de cupom não é divergência),
`lib/cobranca/sinal.handler.ts`, `components/auth/SignupForm.tsx`, `lib/auth/schemas.ts`,
`app/actions/auth/signUp.ts`, `app/(public)/signup/page.tsx`, `app/auth/callback/route.ts` (o cupom no
cadastro pelo Google), `lib/auth/public-paths.ts` (a consulta pública), `app/admin/(protected)/cobranca/page.tsx`.

**Protege.** `tests/unit/cupons-regras.test.ts`, `cupons-desconto-no-asaas.test.ts`,
`cupons-no-passo-e-setup.test.ts`, `cupom-no-cadastro-pelo-google.test.ts`,
`parceiros-comissao-e-repasse.test.ts`, `cupons-e-parceiros.test.ts`, `mcp-de-implantacao-cupons-e-parceiros.test.ts`;
invariante `tests/invariants/cupons-e-parceiros.test.ts`.

**Conferir.**
1. `git grep -n "FORK MIA" -- lib/cobranca/checkout.ts lib/cobranca/sincronizar.ts lib/cobranca/sinal.handler.ts app/auth/callback/route.ts`.
2. `npx vitest run tests/unit/cupons-desconto-no-asaas.test.ts tests/unit/cupom-no-cadastro-pelo-google.test.ts`.
3. Se o upstream mexeu na cobrança (`lib/cobranca/`): a assinatura recém-criada ainda recebe o desconto.
4. MCP (lê só): `plataforma_ver_cupons`, `plataforma_ver_parceiros`, `plataforma_ver_repasses`.

**Riscos.** O repasse é Pix feito por fora pela Time (`plataforma_marcar_repasse_pago` registra). Cobrança
do upstream que passa a recalcular preço sem olhar o cupom desfaz o desconto em silêncio.

### 10. Disparo de e-mail marketing · [`email-marketing.md`](email-marketing.md)
**O que faz.** Campanhas de e-mail para a base da empresa, pelo domínio dela, com descadastro de um
clique, lista de supressão, aquecimento e cobrança da mesma carteira do número oficial; transporte é a
Amazon (SES v2). **Migrations** 9060 a 9065, 9110 (preço por plano). **Mora em** `lib/email-marketing/`,
`lib/email/ses.ts`, `app/api/v1/email-marketing/`, `app/api/v1/webhooks/email-marketing/`,
`app/preferencias/[token]/`, `components/email-marketing/`.

**Pontos de encaixe.** `lib/lgpd/export-collector.ts` e `copia-do-titular.ts` (duas seções do relatório do
titular), `lib/navigation/catalogo.ts` e `interface.ts`, `lib/recursos-opcionais/*`, `lib/auth/public-paths.ts`
(preferências), `lib/env.ts`, `docker/scheduler/entrypoint.sh` (cron `email-marketing`),
`app/app/contacts/[id]/_client.tsx` (o consentimento na ficha), `lib/planos-mia/preco-por-email.ts`.

**Protege.** `tests/unit/email-marketing-regras.test.ts`, `email-marketing-rotas-publicas.test.ts`,
`email-marketing.test.ts`, `preco-do-email-por-plano.test.ts`, `mcp-de-implantacao-email-marketing.test.ts`;
invariante `tests/invariants/email-marketing.test.ts` (isolamento, demonstração, supressão que só
acrescenta, anonimização, débito por lote).

**Conferir.**
1. `git grep -n "travaDaDemonstracao" lib/email-marketing/envio.ts` (a porta do código; a do banco é `trg_mia_email_demonstracao_nao_envia`).
2. `git grep -n "email-marketing" docker/scheduler/entrypoint.sh lib/auth/public-paths.ts`.
3. `npx vitest run tests/unit/email-marketing-regras.test.ts tests/unit/email-marketing-rotas-publicas.test.ts`.
4. Se o upstream mexeu em `lib/email/` (roteador, SMTP, Resend): `lib/email/ses.ts` não pode depender do que ele mudou.
5. MCP (lê só): `plataforma_ver_email_marketing`, `plataforma_ver_campanhas_de_email`.

**Riscos.** Tópicos de assunto ainda não existem. A imagem do bloco vai para o bucket privado
`email-marketing-imagens`; imagem apagada da campanha não sai do bucket.

### 11. Empresa única · [`empresa-unica.md`](empresa-unica.md)
**O que faz.** Um cadastro de empresa só: a ponte entre `companies` (upstream) e `crm_empresas` (fichas,
cartões, obrigações, importação), com a consulta à Receita só pela tela. **Migrations** 9032, 9033, 9034
(e 9013). **Mora em** `lib/empresas/`, `app/api/v1/empresas/`, `lib/mcp-plataforma/ferramentas/empresa.ts`.

**Pontos de encaixe.** `lib/crm-b2b/import-process.ts` (a planilha do upstream reaproveita a empresa sem
CNPJ), `app/api/v1/companies/route.ts` e `[id]/route.ts` (o INSERT direto segue só do gestor),
`app/api/v1/imports/route.ts`, `app/actions/settings/updateTenant.ts`, `app/app/companies/[id]/page.tsx`,
a ficha do contato (`FichaConectadaDoContato`, uma linha).

**Protege.** `tests/unit/empresa-unica.test.ts`, `empresa-unica-lista-e-receita.test.ts`,
`papel-do-contato-na-empresa.test.ts`, `fichas-conectadas-mia.test.tsx`, `mcp-de-migracao-vinculos.test.ts`,
`mcp-de-migracao-importa-em-silencio.test.ts`; invariantes `hardening-definer-varredura.test.ts`,
`rls-tabelas-da-mia.test.ts`.

**Conferir.**
1. `git grep -n "fn_mia_gravar_empresa" -- lib app | head` (a escrita passa pela função nossa).
2. `git grep -n "FORK MIA" -- lib/crm-b2b/import-process.ts app/api/v1/companies`.
3. `npx vitest run tests/unit/empresa-unica.test.ts tests/unit/papel-do-contato-na-empresa.test.ts`.
4. Código novo do upstream que escreve em `companies` direto: ele cria a empresa duas vezes?

**Riscos.** A parte 5 (as pessoas do negócio alinhadas e a saída de `crm_empresas`) ficou para depois.
A demonstração não consulta a Receita (a trava vem antes da rede).

### 12. A IA responde a mensagem pendente · [`ia-responde-pendente.md`](ia-responde-pendente.md)
**O que faz.** Quando a equipe devolve a conversa, ou o silêncio de 5 minutos acaba, a IA responde o que o
cliente deixou pendente em vez de calar; e a pausa por outra conversa do mesmo contato aparece numa faixa.
**Sem migration** (a 9054 que o documento cita é de uma frente anterior). **Mora em**
`lib/escalacao/mensagem-pendente.ts`, `lib/escalacao/pausa-por-outra-conversa.ts`,
`components/inbox/FaixaDaPausaPorOutraConversa.tsx`, `app/api/v1/cron/ia-pendente/`.

**Pontos de encaixe** (todos `FORK MIA (.107)`): `lib/escalacao/retomada.ts` (a opção `responderPendente`),
`app/api/v1/conversations/[id]/release/route.ts`, `app/api/v1/conversations/[id]/close/route.ts`
(`responderPendente: false`), `lib/escalacao/handoff-tecnico.ts` (`responderPendente: false`),
`lib/agent-engine/agent/inbound-turn.ts` (`registrarPausaPorOutraConversa`),
`components/inbox/ConversationHeader.tsx`, `docker/scheduler/entrypoint.sh` (cron `ia-pendente`).

**Protege.** `tests/unit/ia-responde-pendente.test.ts`, `ia-responde-pendente-faixa.test.tsx`.

**Conferir.**
1. `git grep -n "FORK MIA (.107)" -- lib/escalacao lib/agent-engine/agent/inbound-turn.ts app/api/v1/conversations components/inbox`.
2. `git grep -n "responderPendente" lib app | wc -l` (as quatro chamadas em `retomada.ts`, `release`, `close`, `handoff-tecnico`).
3. `npx vitest run tests/unit/ia-responde-pendente.test.ts tests/unit/ia-responde-pendente-faixa.test.tsx`.
4. Se o upstream mexeu em `inbound-turn.ts` ou `retomada.ts`: reconferir os dois casos do documento (seção 1).

**Riscos.** `inbound-turn.ts` é o arquivo do upstream que mais recebe encaixe nosso (aqui e na trava de
robô, função 22): o merge dele é o mais provável de desligar uma das duas.

### 13. Jornada de assinatura: a cobrança · [`jornada-de-assinatura.md`](jornada-de-assinatura.md)
**O que faz.** A empresa que chega pelo site escolhe um plano, se cadastra, testa, paga e usa o que o
plano libera, sem ninguém da Time no meio; a Time acompanha e recebe no zap só o que exige ação. Tudo sai
desligado. **Migrations** 9070 (o plano libera módulo), 9071 (origem), 9072 (crédito por Pix), 9110, 0245.
**Mora em** `lib/planos-mia/`, `components/planos-mia/`, `lib/carteira/compra-pelo-asaas.ts`, `app/precos/`.

**Pontos de encaixe** (seção 11): `lib/modulos/liberacao.ts` (`moduloLiberado`, `modulosDaOrganizacao`
somam o plano), `lib/cobranca/sincronizar.ts` (`aplicarRegua`) e `lib/cobranca/troca.ts`,
`lib/cobranca/sinal.handler.ts`, `lib/cobranca/rodada.ts`, `lib/cobranca/emails.ts`,
`app/api/v1/cron/cobranca/route.ts` (a rodada da jornada depois da do upstream),
`lib/agent-engine/edge/llm/orcamento.ts`, `lib/ai/inbox-destino.ts` (`ref_kind` `plano`),
`lib/crm-b2b/route-helpers.ts`, `components/auth/SignupForm.tsx`, `app/actions/registration/decide.ts`,
`components/cobranca/PainelDaAssinatura.tsx`, `lib/auth/public-paths.ts` (`/precos`).

**Protege.** `tests/unit/jornada-de-assinatura.test.ts`, `jornada-tudo-desligado.test.ts`, `planos-mia-regras.test.ts`, `entrada-paga-sem-aviso-de-suspensa.test.ts`, `rotina-pula-modulo-fora-do-plano.test.ts`, `compra-de-creditos-pelo-asaas.test.ts`, `mcp-de-implantacao-cobranca.test.ts`.

**Conferir.**
1. `git grep -n "FORK MIA" -- lib/modulos/liberacao.ts lib/cobranca/sincronizar.ts lib/cobranca/rodada.ts app/api/v1/cron/cobranca/route.ts`.
2. `npx vitest run tests/unit/jornada-tudo-desligado.test.ts tests/unit/entrada-paga-sem-aviso-de-suspensa.test.ts tests/unit/rotina-pula-modulo-fora-do-plano.test.ts`.
3. `lib/cobranca/sincronizar.test.ts` (do upstream) tem um caso trocado pela regra do fork, marcado `FORK MIA`: se a fusão o reverteu, o teste pede o aviso de "suspensa" que a regra da entrada paga cala.
4. MCP (lê só): `plataforma_ver_assinatura`, `plataforma_listar_modulos`, `plataforma_ver_cobranca`.

**Riscos.** O upstream mexe muito em `lib/cobranca/` (zona quente). "Tudo desligado" é a premissa: função
nova ligada por padrão reprova `jornada-tudo-desligado`.

### 14. Leads dos formulários da Meta · [`leads-da-meta.md`](leads-da-meta.md)
**O que faz.** Os anúncios de cadastro instantâneo entregam o lead direto no funil (contato, negócio,
respostas, origem do anúncio e automações de "lead criado"), por consulta periódica e, se disponível, em
tempo real. Cada Página é de uma empresa. **Migrations** 9003, 9004, 9005, 9008, 9009, 9017.
**Mora em** `lib/leads-da-meta/`, `lib/plataformas-de-anuncio/meta/leads.ts`,
`app/api/v1/leads-da-meta/`, `app/api/v1/webhooks/leads-da-meta/`, `app/api/v1/cron/leads-da-meta/`.

**Pontos de encaixe.** `lib/ai/inbox-destino.ts` (o aviso quando a leitura para),
`lib/modulos/vendaveis.ts` (`LEADS_DA_META_E_MODULO_VENDAVEL`), `app/app/settings/meta-ads/page.tsx` e
`_formularios.tsx`, `createLeadHandler` (`app/api/v1/leads/_handler.ts`, que a gravação chama),
`registrarCaptacao` em `webhook_lead_captures`, `docker/scheduler/entrypoint.sh` (cron a cada 5 min).

**Protege.** `tests/unit/paginas-da-meta-por-empresa.test.ts`; invariante
`tests/invariants/paginas-da-meta-por-empresa.test.ts`.

**Conferir.**
1. `git grep -n "Formulario_Meta" -- lib` (a etiqueta-contrato; renomear desliga a régua de follow-up em silêncio).
2. `git grep -n "leads-da-meta" docker/scheduler/entrypoint.sh`.
3. `npx vitest run tests/unit/paginas-da-meta-por-empresa.test.ts`.
4. Se o upstream mudou `createLeadHandler`, `mapInboundPayload` ou o evento `lead.created`: a gravação (`lib/leads-da-meta/gravar.ts`) ainda os usa na mesma assinatura.
5. MCP (lê só): `plataforma_ver_conversoes` mostra a chave de leads de formulário; a ligação é `plataforma_ligar_leads_de_formulario_da_meta`.

**Riscos.** `ad_source_id` fica vazio de propósito (é o `meta_lead_id` do negócio que volta para a Meta).
LACUNA: o único teste de unidade é o das Páginas por empresa; a gravação e a deduplicação só se provam
com a conta real da Meta.

### 15. MCP de implantação · [`mcp-de-implantacao.md`](mcp-de-implantacao.md)
**O que faz.** O MCP de plataforma (`/api/mcp/plataforma`) cria o cliente e o monta por dentro (empresa,
funil, catálogo, etiquetas, conhecimento, follow-up, agente, automações, agenda, equipe, conversões,
canais), de modo que uma sessão do Claude Code implanta tudo conversando. **Migrations** 9022 e 9045 (as
duas funções copiadas do upstream), 9030, 9031, 9040 a 9042. **Mora em** `lib/mcp-plataforma/`
(`ferramentas.ts`, `operacoes.ts`, `servidor.ts`, `ferramentas/*`), `lib/implantacao/`, `lib/paineis/`.

**Pontos de encaixe.** As **seis rotas do upstream** de onde a lógica foi tirada para uma função
compartilhada, e as rotas espelhadas (seção 5): a cerca dos espelhos guarda a impressão de cada uma e
**reprova quando o código da rota muda**, para alguém reler o espelho. Também
`lib/ai/trava-da-ia-na-rota.ts` (o token nunca escolhe IA) e o token `dsk_` do upstream
(`resolveAuthDual`). Desde a v1.121, `lib/ai/agents/edicao.ts` (salvar rascunho, publicar e
reverter o agente, que o upstream tirou da tela para o MCP de agentes dele usar também): a trava
da IA mora ali, pelo `quemPede` do ator; sem ele (o token), ninguém escolhe IA.

**Protege.** `tests/unit/mcp-de-implantacao-ferramentas.test.ts`, `mcp-de-implantacao-espelhos.test.ts`, `mcp-de-implantacao-operacoes.test.ts`, `mcp-de-implantacao-ponta-a-ponta.test.ts`, `mcp-de-plataforma-escopo.test.ts`, `distribuicao-do-numero-pela-plataforma.test.ts`, `dono-do-contato-pela-plataforma.test.ts`, `mcp-de-implantacao-servidores-mcp-do-agente.test.ts` (os servidores MCP por agente, 9095) e a família `mcp-de-implantacao-novidades-do-upstream-*.test.ts`.

**Conferir.**
1. `npx vitest run tests/unit/mcp-de-implantacao-espelhos.test.ts` (vermelho = o upstream mudou uma rota espelhada: releia o espelho e regrave a impressão).
2. `npx vitest run tests/unit/mcp-de-implantacao-ferramentas.test.ts tests/unit/mcp-de-plataforma-escopo.test.ts`.
3. Função nova do upstream na faixa fundida: existe `mcp-de-implantacao-novidades-do-upstream-<versão>.test.ts` para ela? (R5)
4. MCP (lê só, na demonstração): `plataforma_ver_catalogo`, `plataforma_ver_implantacao`, `plataforma_ver_configuracao`.

**Riscos.** Uma ferramenta que grava passa pelo mesmo caminho da tela; se o caminho do upstream ganhar
um passo, o espelho fica atrás. A tela de tokens lista `OPERACOES`: chave nova aparece sozinha, sem migration.

### 16. MCP de migração · [`mcp-de-migracao.md`](mcp-de-migracao.md)
**O que faz.** Ferramentas do MCP de plataforma para trazer a base de outro CRM (empresas, contatos,
negócios, materiais) sem ninguém clicar na tela, sem disparar automação nem aviso. **Migration** 9022 (a
dependência). **Mora em** `lib/mcp-plataforma/importacao/` (um arquivo por assunto).

**Pontos de encaixe.** `FERRAMENTAS_DE_IMPORTACAO` em `lib/mcp-plataforma/ferramentas.ts`,
`OPERACOES_DE_IMPORTACAO` em `operacoes.ts`, `AREAS_DE_IMPORTACAO` (checklist), `argumentosParaAuditoria`
em `lib/mcp-plataforma/servidor.ts`, `app/api/v1/leads/_handler.ts` (`createLeadHandler` aceita
`importacao_silenciosa`: leva a história de origem e **não emite `lead.created`**),
`lib/audit/actions.ts` (`plataforma.importacao`).

**Protege.** `tests/unit/mcp-de-migracao-base.test.ts` (reprova se uma das ligações se perder),
`mcp-de-migracao-contatos.test.ts`, `mcp-de-migracao-empresas.test.ts`, `mcp-de-migracao-negocios.test.ts`,
`mcp-de-migracao-vinculos.test.ts`, `mcp-de-migracao-materiais.test.ts`, `mcp-de-migracao-importa-em-silencio.test.ts`.

**Conferir.**
1. `git grep -n "importacao_silenciosa" -- app lib`.
2. `npx vitest run tests/unit/mcp-de-migracao-base.test.ts tests/unit/mcp-de-migracao-importa-em-silencio.test.ts`.
3. Se o upstream mudou o `createLeadHandler`: a importação continua sem emitir evento (senão dispara régua e aviso para a base inteira).
4. MCP (lê só): `plataforma_ver_importacao`.

**Riscos.** O ponto sensível é o "silencioso": um evento a mais num handler do upstream vira disparo em
massa para contatos importados.

### 17. Documentos e obrigações com vencimento · [`obrigacoes.md`](obrigacoes.md)
**O que faz.** Os documentos e deveres que se repetem (alvará, AVCB, CNH, relatório mensal) viram uma lista
só, **Obrigações**, com avisos que saem pelas automações; o agente de IA propõe e a pessoa confirma.
**Migrations** 9018 (e 9010 para a demonstração). **Mora em** `lib/obrigacoes/`, `components/obrigacoes/`,
`app/app/obrigacoes/`, `app/api/v1/obrigacoes/`, `app/api/v1/cron/obrigacoes-avisos/`.

**Pontos de encaixe.** `lib/schemas/webhooks.ts` (os cinco gatilhos que o motor reconhece, e a recusa do
gatilho "de X dias" sem o X), `lib/automation/engine.ts` (um ramo em `buildContext` para `mia_obrigacao`),
`app/app/webhooks/_components/labels.ts` e `RuleEditor.tsx`, `components/kanban/KanbanCard.tsx` (o aviso no
rodapé), `lib/mcp/tools/index.ts` e `lib/leads/escopo-de-funil.ts` (as duas ferramentas do agente),
`lib/lgpd/export-collector.ts`, `docker/scheduler/entrypoint.sh`, `lib/navigation/catalogo.ts`.

**Protege.** `tests/unit/obrigacoes.test.ts`, `obrigacoes-situacao.test.ts`, `obrigacoes-gatilhos.test.ts`, `obrigacoes-contexto-da-automacao.test.ts`, `obrigacoes-ferramentas-do-agente.test.ts`, `obrigacoes-pelo-mcp.test.ts` (e `obrigacoes-*.test.ts*`).

**Conferir.**
1. `git grep -n "mia_obrigacao" lib/automation/engine.ts lib/schemas/webhooks.ts` (o ramo e os gatilhos vivos).
2. `npx vitest run tests/unit/obrigacoes-gatilhos.test.ts tests/unit/obrigacoes-contexto-da-automacao.test.ts`.
3. Se o upstream reescreveu o motor de automação (`lib/automation/`): reconferir o contexto da automação e a recusa do gatilho sem X.
4. MCP (lê só): `plataforma_ver_obrigacoes`.

**Riscos.** Os avisos reutilizam as automações; o e-mail delas passa pela trava da demonstração (R1).

### 18. Pagamento no início · [`pagamento-no-inicio.md`](pagamento-no-inicio.md)
**O que faz.** Quem chega num plano de entrada paga paga na própria tela (Pix, cartão ou boleto) antes de
montar a MIA; quem chega num plano com teste escolhe como paga depois; a nota fiscal sai pelo Asaas só
quando o dinheiro entra; no fim do teste sem pagar, bloqueia. **Migrations** 9120 (dados fiscais), 9121
(pagamento inicial), 9122 (bloqueio no fim do teste), 9125. **Mora em** `lib/dados-fiscais/`,
`lib/asaas-mia/`, `lib/pagamento-inicial/`, `components/pagamento-inicial/`.

**Pontos de encaixe** (seção 10, `FORK MIA (.96)`): `lib/auth/server.ts` (`resolveActiveOrg`: o destino da
empresa parada), `app/app/layout.tsx`, `app/onboarding/layout.tsx`, `app/onboarding/page.tsx`,
`app/account-suspended/page.tsx`, `components/auth/SignupForm.tsx`, `lib/auth/schemas.ts`,
`app/actions/auth/signUp.ts`, `lib/cobranca/sincronizar.ts` (`aplicarRegua`: o gancho do fim do teste),
`lib/cobranca/sinal.handler.ts`, `app/admin/(protected)/cobranca/page.tsx`, `lib/auth/public-paths.ts`;
(.99) `lib/lgpd/export-collector.ts` (`exportarDadosDeCobrancaDaEmpresa`).

**Protege.** `tests/unit/pagamento-no-inicio.test.ts`, `pagamento-inicial-servico.test.ts`,
`pagamento-inicial-cartao-rota.test.ts`, `pagamento-inicial-fim-do-teste.test.ts`, `dados-fiscais-regras.test.ts`,
`asaas-da-mia.test.ts`, `cartao-fora-dos-registros.test.ts`, `lgpd-dados-de-cobranca-da-empresa.test.ts`,
`lgpd-empresa-redigida-exporta.test.ts`; invariante `tests/invariants/pagamento-no-inicio.test.ts`.

**Conferir.**
1. `git grep -n "FORK MIA (.96)" -- lib/auth/server.ts app/app/layout.tsx app/onboarding lib/cobranca/sincronizar.ts`.
2. `npx vitest run tests/unit/pagamento-inicial-fim-do-teste.test.ts tests/unit/cartao-fora-dos-registros.test.ts`.
3. Se o upstream mexeu em `resolveActiveOrg` ou no layout do app: a empresa parada ainda vai para o passo "Pagamento".
4. MCP (lê só): `plataforma_ver_cobranca`, `plataforma_listar_pedidos_de_cadastro`.

**Riscos.** O cartão nunca fica em registro nosso. Em modo teste o sandbox do Asaas gera Pix simulado;
falta o Pix real visto pelo dono.

### 19. Os primeiros passos · [`primeiros-passos.md`](primeiros-passos.md)
**O que faz.** O caminho de quem acabou de entrar até a empresa estar de pé: o modelo do segmento, o "o
que falta", o assistente ao lado do passo, as propostas. Estende o `/onboarding` do upstream. **Migrations**
9070, 9071, 9080, 9081, 9082. **Mora em** `lib/onboarding/` (`modelos-de-agente-da-mia.ts`,
`pacotes-da-mia.ts`), `lib/assistente/propostas/`, `lib/assistente/retratos.ts`.

**Pontos de encaixe** (seção 7, lista fechada): `lib/schemas/onboarding.ts` (`welcome.segmento`),
`app/onboarding/welcome/_form.tsx`, `app/actions/onboarding/acceptWelcome.ts`,
`app/onboarding/setup-ai/_form.tsx`, `app/actions/onboarding/createDefaultAgent.ts`,
`app/onboarding/funil/_client.tsx`, `app/actions/onboarding/montarQuadro.ts`,
`app/onboarding/connect-whatsapp/_client.tsx`, `app/onboarding/layout.tsx`, `app/app/page.tsx`,
`app/app/layout.tsx`, `lib/ai/agents/publish.ts`, `tests/e2e/wizard-do-funcionario.spec.ts`.

**Protege.** `tests/unit/raiz-do-app-respeita-o-passo-a-passo.test.ts`,
`welcome-do-upstream-funciona-sozinho.test.tsx`, `primeiros-passos-do-assistente.test.ts`.

**Conferir.**
1. `git grep -n "FORK MIA" -- app/onboarding lib/schemas/onboarding.ts app/actions/onboarding`.
2. `npx vitest run tests/unit/welcome-do-upstream-funciona-sozinho.test.tsx tests/unit/raiz-do-app-respeita-o-passo-a-passo.test.ts`.
3. Se o upstream mexeu nos seis passos ou no ensaio sem envio: o nosso entra por ponto pequeno; reconferir "A MIA leu como".
4. MCP (lê só): `plataforma_ver_implantacao` (a lista do "o que falta").

**Riscos.** O e2e do upstream do wizard foi ajustado (aceita "Comecei por um quadro pronto"); se ele
reescrever o teste, o ajuste some.

### 20. O produto ou serviço no negócio · [`produto-no-negocio.md`](produto-no-negocio.md)
**O que faz.** O negócio diz o que foi vendido: itens do catálogo com preço congelado e valor que soma, a
janela "Marcar como ganho" no botão e no arrasto, a palavra e as duas opções por funil, dois quadros no
relatório de vendas, comanda do ganho por item. **Migrations** 9160, 9161. **Mora em**
`lib/produto-no-negocio/`, `components/produto-no-negocio/`, `hooks/produto-no-negocio/`,
`app/api/v1/leads/[id]/itens/`, `app/api/v1/pipelines/[id]/produto-no-negocio/`.

**Pontos de encaixe** (seção 10, `FORK MIA (.109)`): `components/kanban/LeadFieldsForm.tsx`,
`NewLeadDialog.tsx`, `KanbanCard.tsx`, `KanbanCardActions.tsx` ("Marcar como ganho" abre a janela),
`KanbanBoard.tsx` (a janela no arrasto), `hooks/kanban/useUpdateLead.ts`, `lib/schemas/settings.ts`
(`vocabulary.produto`, `pedir_produto_no_ganho`), `app/api/v1/leads/[id]/win/route.ts` e `move/route.ts`
(a recusa do ganho sem item), `app/api/v1/proposals/[id]/send/route.ts` (o recálculo do valor),
`lib/financeiro/comanda-do-ganho.ts` e `.handler.ts`, `app/app/settings/tenant/pipelines/_client.tsx`.

**Protege.** `tests/unit/produto-no-negocio.test.ts`, `produto-no-negocio-regras.test.ts`,
`produto-no-negocio-relatorio.test.ts`, `produto-no-negocio-servidor.test.ts`,
`mcp-de-implantacao-produto-no-negocio.test.ts`; invariantes `rls-completude-varredura.test.ts`,
`rls-tabelas-da-mia.test.ts`.

**Conferir.**
1. `git grep -n "FORK MIA (.109)" -- components/kanban app/api/v1/leads app/api/v1/proposals lib/financeiro | wc -l` (compare com a contagem antes da fusão).
2. `npx vitest run tests/unit/produto-no-negocio.test.ts tests/unit/produto-no-negocio-servidor.test.ts`.
3. O arrasto até a etapa de ganho e o botão "Ganho" no cartão aberto abrem a janela; rota `win` e `move` recusam ganho sem item quando a opção está ligada.
4. MCP (lê só): `plataforma_ver_funis`; a escrita é `plataforma_configurar_produto_no_negocio`.

**Riscos.** `KanbanBoard.tsx` e `LeadFieldsForm.tsx` são arquivos muito disputados com o upstream. A coluna
de recorrência (`crm_leads.recurring_months`) é dos dois lados (ver FORK-MIA, "Funcionalidade duplicada").

### 21. O raio-X do atendimento · [`raio-x-do-atendimento.md`](raio-x-do-atendimento.md)
**O que faz.** Ferramenta da Time: lê, só para leitura, as conversas do WhatsApp comercial de uma empresa
(por link, termo e código de 8 letras), transcreve áudios e gera o relatório do atendimento (velocidade,
quem ficou sem resposta, origem, nota, recomendações). Há o raio-X do cliente ativo (.102) e o grátis por
cadastro (.107). **Migrations** 9150, 9151, 9152 (e 9031). **Mora em** `lib/raio-x/`, `lib/channels/raio-x/`,
`components/raio-x/`, `app/raio-x/`, `app/admin/(protected)/raio-x/`, `app/api/v1/admin/raio-x/`,
`app/api/v1/publico/raio-x/`, `app/api/v1/cron/raio-x/`, `lib/mcp-plataforma/ferramentas/raio-x.ts`.

**Pontos de encaixe** (seção 11): `lib/audit/actions.ts` (`raio_x.*`), `lib/auth/public-paths.ts` (as seis
entradas públicas, ancoradas), `lib/admin/navegacao.ts`, `docker/scheduler/entrypoint.sh` (cron),
`tests/unit/suporte-cobertura-de-efeitos.test.ts` (a exceção nomeada dos dois POST públicos sem sessão),
`tests/unit/mcp-de-implantacao-ferramentas.test.ts` (as ferramentas sem `organization_id`),
`tests/invariants/rls-completude-varredura.test.ts` (`mia_raio_x`).

**Protege.** `tests/unit/raio-x-do-atendimento.test.ts`, `raio-x-leitor-nao-envia.test.ts` (o leitor nunca escreve no número), `raio-x-anonimizar.test.ts`, `raio-x-metricas.test.ts`, `raio-x-por-cadastro.test.ts`, `raio-x-cliente-ativo-regras.test.ts`, `mcp-de-implantacao-raio-x.test.ts` (e as irmãs `raio-x-*.test.ts`).

**Conferir.**
1. `git grep -n "raio-x\|raio_x" lib/auth/public-paths.ts lib/audit/actions.ts lib/admin/navegacao.ts docker/scheduler/entrypoint.sh`.
2. `npx vitest run tests/unit/raio-x-leitor-nao-envia.test.ts tests/unit/raio-x-anonimizar.test.ts tests/unit/suporte-cobertura-de-efeitos.test.ts`.
3. Se o upstream mexeu em `lib/channels/` (provedores de canal, sessão): o leitor continua num contêiner próprio e só lê.
4. MCP (lê só): `plataforma_ver_raio_x`, `plataforma_precos_do_raio_x`.

**Riscos.** O relatório inclui o bloco "o que a MIA resolveria" só para a Time; conversas de exemplo saem
anonimizadas (LGPD, seção 6 do documento). Falta o primeiro cadastro real pelo formulário.

### 22. A trava de robô · [`trava-de-robo.md`](trava-de-robo.md)
**O que faz.** Quando o robô de outra empresa responde às nossas mensagens, o laço para sem chamar o modelo:
o contato é calado, os negócios abertos viram perdidos e a conversa é encerrada; mais o teto de 30
respostas da IA por conversa em 60 minutos. **Migrations** 9153, 9154. **Mora em** `lib/trava-de-robo/`
(`deteccao.ts`, `config.ts`, `aplicar.ts`, `no-turno.ts`, `registros.ts`, `etiqueta.ts`, `textos.ts`),
`lib/mcp-plataforma/ferramentas/trava-de-robo.ts`.

**Pontos de encaixe** (todos `FORK MIA (.108)`): `lib/agent-engine/agent/inbound-turn.ts` (o import e a
chamada a `travaDeRoboNoTurno` no handler do `inbound_turn`), `lib/leads/nascimento-do-lead.ts` (o motivo
`contato_robo`, a coluna `force_human` e a recusa), `lib/audit/actions.ts` (`ai.trava_de_robo_*`),
`lib/mcp-plataforma/ferramentas.ts` e `operacoes.ts`, `lib/assistente/leituras/por-que-a-ia-nao-respondeu.ts`.

**Protege.** `tests/unit/trava-de-robo.test.ts`, `mcp-de-implantacao-trava-de-robo.test.ts`;
invariantes `lgpd-redact-unificado-alcanca-pelo-catalogo.test.ts`, `rls-tabelas-da-mia.test.ts`,
`rls-completude-varredura.test.ts`; unidade `lgpd-exporta-o-que-redige.test.ts`.

**Conferir.**
1. `git grep -n "travaDeRoboNoTurno" lib/agent-engine/agent/inbound-turn.ts` (**a chamada existe**; sem ela a trava desliga em silêncio).
2. `git grep -n "contato_robo" lib/leads/nascimento-do-lead.ts`.
3. `npx vitest run tests/unit/trava-de-robo.test.ts tests/unit/lgpd-exporta-o-que-redige.test.ts`.
4. MCP (lê só): `plataforma_ver_travas_de_robo`; desfazer é `plataforma_desfazer_trava_de_robo`.

**Riscos.** `inbound-turn.ts` é compartilhado com a função 12 (IA responde pendente). LACUNA: o teste
prova a detecção e a aplicação, mas não que a chamada em `inbound-turn.ts` continua no caminho do turno;
o `git grep` acima é a conferência manual, e é o candidato a cerca.

---

### 23. Coexistência do WhatsApp: o histórico da Meta · [`coexistencia.md`](coexistencia.md)
**O que faz.** O número usado no app WhatsApp Business e na MIA ao mesmo tempo: o histórico de até 180 dias
que a Meta manda no campo `history` entra como histórico importado (`metadata.historico_importado = 'true'`,
o corte da 0760) e não dispara nada; os contatos da agenda do app somam no pedido de contatos. Etapa S2;
conexão pelo app (S3) e saída e volta (S4) ainda não. **Migrations** 9162. **Mora em**
`lib/channels/meta/coexistencia/` (`historico.ts`, `mapear.ts`, `estado.ts`, `receber.ts`, `contatos.ts`,
`gravar-lote.ts`, `lote.handler.ts`).

**Pontos de encaixe** (todos `FORK MIA`): `app/api/v1/webhooks/meta/[token]/route.ts` (a chamada a
`receberHistoricoDaMeta` logo depois de nascer `desfechos`, e `ingerirContatoDoAppContando` no lugar de
`ingestMetaAppContactSync`), `lib/channels/consumidores.ts` (o `loteDoHistoricoHandler`).

**Protege.** Invariantes `coexistencia-historico-nao-dispara.test.ts` (nada dispara, nada muda na conversa
e no negócio que já existiam, reentrega não duplica, com o controle), `historico-importado-nao-dispara.test.ts`
(o corte da 0760), `rls-tabelas-da-mia.test.ts`, `rls-completude-varredura.test.ts`; unidade
`coexistencia-historico-leitura.test.ts`, `dispatcher-org-parada.test.ts`, `evento-comando-tem-consumidor.test.ts`,
`historico-midia-so-guarda.test.ts` (a mídia do histórico, pelos dois chamadores, a coexistência e a importação
do canal não oficial, só é guardada: sem derivação, transcrição, visão nem IA, com o controle sem a chave).

**Conferir.**
1. `git grep -n "receberHistoricoDaMeta\|ingerirContatoDoAppContando" "app/api/v1/webhooks/meta/[token]/route.ts"` (**as duas chamadas existem**; sem a primeira o histórico volta a ser ignorado em silêncio).
2. `git grep -n "historico_importado" supabase/migrations/*0760*` e a mesma chave em `fn_emit_message_event` no `baseline.sql` (se o upstream mudar o corte, o histórico passa a acordar a IA).
3. `npx vitest run tests/unit/coexistencia-historico-leitura.test.ts tests/unit/dispatcher-org-parada.test.ts`.
4. `npx vitest run tests/unit/historico-midia-so-guarda.test.ts` (se reprovar, o worker de mídia voltou a pedir
   a derivação paga para conversa de meses atrás: a guarda é o `historicoImportado` de `workers/media-persist-worker.ts`).
5. MCP: nenhuma ferramenta nesta etapa (a leitura da sincronização entra na S3, com a tela).

**Riscos.** Se o upstream passar a ler o campo `history` no `parseMetaWebhook` ou a gravar o histórico por
`ingestMetaInbound`, o histórico entraria duas vezes ou como mensagem nova: conferir na fusão. Relatórios e
raio-X do fork ainda contam o histórico importado (9163, espera a decisão D3).

---

### 24. O consumo de IA por mês e por agente · [`consumo-de-ia.md`](consumo-de-ia.md)
**O que faz.** A leitura do consumo de IA de um cliente num mês do calendário em Brasília (ou em N dias),
quebrada por agente, pela linha "Sistema" (chamadas sem `agent_id`) e por finalidade, em centavos de dólar e
em reais pela cotação de cada dia. Usada pela aba Uso do cliente e pelo MCP. Nas telas (MIA-46), "Este mês" e
"Mês passado" no seletor de `/admin/usage` e da aba Uso, e na aba Uso o R$ no card do custo de IA e as tabelas
por agente (com "Sistema") e por finalidade. Só no painel da plataforma: `/app/ai/usage` não mudou.
**Migrations** nenhuma (lê `llm_calls`, `ai_agents` e `platform_fx_rates`, da 0241). **Mora em**
`lib/ai/usage/consumo-do-periodo.ts`, `lib/ai/usage/atalhos-de-periodo.ts`,
`lib/ai/usage/contatos-pessoais.ts` (a lista dos contatos pessoais que as duas telas tiram da contagem, MIA-78),
`lib/mcp-plataforma/ferramentas/consumo-de-ia.ts`, `components/admin/tenants/UsoDoTenant.tsx`.

**Pontos de encaixe** (todos `FORK MIA (MIA-44)`): `app/api/v1/admin/tenants/[id]/usage/route.ts` (a rota é
do fork; o `mes` e a chamada a `lerConsumoDoPeriodo`), `lib/mcp-plataforma/ferramentas.ts`
(`FERRAMENTAS_DE_CONSUMO_DE_IA`), `app/api/v1/admin/usage/route.ts` (o `mes`, `periodoDoPedido` e o dia de
Brasília nas séries), `app/admin/(protected)/usage/_client.tsx` e `components/admin/usage/UsageTable.tsx` (o
seletor e o nome do CSV), `hooks/useAdminUsage.ts`, `lib/i18n/dicionario.ts` (o espalhamento de
`DICIONARIO_DO_CONSUMO_DE_IA`). Do upstream, só as colunas de `llm_calls`: `agent_id` (0130), `purpose`,
`input_tokens`, `output_tokens`, `cache_read_tokens`, `cost_cents`.

**Protege.** `tests/unit/consumo-de-ia-por-mes-e-por-agente.test.ts` (paginação acima de 1000, agente x
Sistema, cache, virada do mês em Brasília com TZ de Brasília e UTC, R$ e dia sem cotação, a rota e o MCP com os
mesmos números), `consumo-de-ia-telas-este-mes-e-mes-passado.test.tsx` (os atalhos, `/admin/usage?mes=` e a aba
Uso), `painel-de-custo-nao-para-na-linha-1000.test.ts`, `orcamento-uma-regua-de-gasto.test.ts` (nenhuma segunda
régua de gasto mensal), `consumo-de-ia-as-duas-telas-dao-o-mesmo-numero.test.ts` (MIA-78: a tela geral e a aba Uso
com os mesmos pessoais fora e a mesma janela de N dias de Brasília, e leitura que falha virando 500, não zero) e a e2e `admin-consumo-de-ia-por-mes-e-por-agente.spec.ts`.

**Conferir.**
1. `git grep -n "lerConsumoDoPeriodo" "app/api/v1/admin/tenants/[id]/usage/route.ts" lib/mcp-plataforma/ferramentas/consumo-de-ia.ts` (**as duas chamadas existem**; sem uma delas a tela e o MCP passam a divergir).
2. Se a fusão mexeu em `llm_calls` (`git diff vA vB -- supabase/migrations supabase/baseline.sql | grep -n "llm_calls"`), confira que as seis colunas acima continuam com o mesmo nome e o mesmo sentido (`cache_read_tokens` como parte de `input_tokens`).
3. `npx vitest run tests/unit/consumo-de-ia-por-mes-e-por-agente.test.ts tests/unit/consumo-de-ia-telas-este-mes-e-mes-passado.test.tsx tests/unit/orcamento-uma-regua-de-gasto.test.ts tests/unit/consumo-de-ia-as-duas-telas-dao-o-mesmo-numero.test.ts`.
4. MCP (lê só): `plataforma_ver_consumo_de_ia` com a empresa de demonstração e o mês corrente.
5. Se a fusão mexeu em `app/api/v1/admin/usage/route.ts` (do upstream), confira que `mes` ainda passa por `periodoDoPedido` e que a fatura e as cotações têm o limite de cima (`git grep -n "periodoDoPedido\|ultimoDia" app/api/v1/admin/usage/route.ts`).

**Riscos.** O mês daqui é o de Brasília e o do teto (`fn_gasto_de_ia_do_mes`) é o do banco, em UTC: os dois
números podem diferir pelas chamadas das últimas 3 horas do mês. Fica assim por decisão (mudar o teto muda o que
o cliente recebe). Se o upstream trouxer a soma de uso no banco por organização (`fn_uso_de_ia`, 0586) com
quebra por agente, a leitura daqui pode passar a perguntar a ela, desde que a régua do custo continue a mesma.

---

## Tabela final: por função, o documento, as migrations e os testes principais

| # | função | documento | migrations | testes principais |
|---|---|---|---|---|
| 1 | Agenda Microsoft 365 | `agenda-microsoft.md` | 9011, 9014, 9015, 9016, 9044 | `agenda-microsoft.test.ts`, `agenda-do-atendente-ve-a-ocupacao-do-dono.test.ts` |
| 2 | Área de cobrança | `area-de-cobranca.md` | 9125, 9126 | `area-de-cobranca-servico.test.ts`, `bootstrap-reaplica-no-deadlock.test.ts` |
| 3 | Assistente da MIA | `assistente.md` | 9050-9052, 9080-9082, 9090, 9091, 9100, 9101 | `assistente-faz-com-aprovacao.test.ts`, `assistente-ajuda-cobre-todas-as-telas.test.ts` |
| 4 | Broadcast unificado | `broadcast-unificado.md` | nenhuma | `broadcast-unificado.test.ts`, `navegacao-completude.test.ts` |
| 5 | Cartões e fichas | `cartoes-e-fichas.md` | 9012, 9013 (0264) | `cartao-fechado-mia.test.tsx`, `pessoas-do-negocio-dos-dois-modelos.test.ts` |
| 6 | Cliente modelo (demonstração) | `cliente-modelo.md` | 9010, 9016, 9020, 9021, 9043 | `cliente-modelo-trava.test.ts`, `send-email-na-demonstracao.test.ts` |
| 7 | Contatos em massa | `contatos-em-massa.md` | nenhuma | `disparo-conferencia-do-filtro.test.ts` |
| 8 | Conversões da Meta | `conversoes-da-meta.md` | 9017, 9019 (9003, 9010) | `conversoes-da-meta-consumidor.test.ts`, `conversoes-da-meta-por-etapa.test.ts` |
| 9 | Cupons e parceiros | `cupons-e-parceiros.md` | 9122, 9130, 9131, 9132 | `cupons-desconto-no-asaas.test.ts`, `parceiros-comissao-e-repasse.test.ts` |
| 10 | E-mail marketing | `email-marketing.md` | 9060-9065, 9110 | `email-marketing-regras.test.ts`, `tests/invariants/email-marketing.test.ts` |
| 11 | Empresa única | `empresa-unica.md` | 9032, 9033, 9034 | `empresa-unica.test.ts`, `papel-do-contato-na-empresa.test.ts` |
| 12 | IA responde pendente | `ia-responde-pendente.md` | nenhuma | `ia-responde-pendente.test.ts`, `ia-responde-pendente-faixa.test.tsx` |
| 13 | Jornada de assinatura | `jornada-de-assinatura.md` | 9070, 9071, 9072, 9110 | `jornada-tudo-desligado.test.ts`, `planos-mia-regras.test.ts` |
| 14 | Leads da Meta | `leads-da-meta.md` | 9003, 9004, 9005, 9008, 9009 | `paginas-da-meta-por-empresa.test.ts` |
| 15 | MCP de implantação | `mcp-de-implantacao.md` | 9022, 9045, 9030, 9031, 9040-9042 | `mcp-de-implantacao-espelhos.test.ts`, `mcp-de-implantacao-ferramentas.test.ts` |
| 16 | MCP de migração | `mcp-de-migracao.md` | 9022 | `mcp-de-migracao-base.test.ts`, `mcp-de-migracao-importa-em-silencio.test.ts` |
| 17 | Obrigações | `obrigacoes.md` | 9018 | `obrigacoes-gatilhos.test.ts`, `obrigacoes-contexto-da-automacao.test.ts` |
| 18 | Pagamento no início | `pagamento-no-inicio.md` | 9120, 9121, 9122 | `pagamento-inicial-fim-do-teste.test.ts`, `cartao-fora-dos-registros.test.ts` |
| 19 | Primeiros passos | `primeiros-passos.md` | 9070, 9071, 9080-9082 | `welcome-do-upstream-funciona-sozinho.test.tsx`, `raiz-do-app-respeita-o-passo-a-passo.test.ts` |
| 20 | Produto no negócio | `produto-no-negocio.md` | 9160, 9161 | `produto-no-negocio-servidor.test.ts`, `produto-no-negocio-regras.test.ts` |
| 21 | Raio-X do atendimento | `raio-x-do-atendimento.md` | 9150, 9151, 9152 | `raio-x-leitor-nao-envia.test.ts`, `raio-x-anonimizar.test.ts` |
| 22 | Trava de robô | `trava-de-robo.md` | 9153, 9154 | `trava-de-robo.test.ts`, `lgpd-redact-unificado-alcanca-pelo-catalogo.test.ts` |
| 23 | Coexistência do WhatsApp | `coexistencia.md` | 9162 | `coexistencia-historico-nao-dispara.test.ts`, `coexistencia-historico-leitura.test.ts`, `historico-midia-so-guarda.test.ts` |
| 24 | Consumo de IA por mês e por agente | `consumo-de-ia.md` | nenhuma (lê a 0241) | `consumo-de-ia-por-mes-e-por-agente.test.ts`, `consumo-de-ia-telas-este-mes-e-mes-passado.test.tsx`, `orcamento-uma-regua-de-gasto.test.ts`, `consumo-de-ia-as-duas-telas-dao-o-mesmo-numero.test.ts` |

Função nova do fork: crie `docs/fork/<nome>.md`, e **no mesmo PR** acrescente aqui a sua seção e a sua
linha na tabela. A cerca acima reprova o PR que esquecer.

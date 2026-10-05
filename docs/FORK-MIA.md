# O fork da MIA — como trazer o upstream sem estragar o nosso

A plataforma MIA é um fork do [DeskcommCRM](https://github.com/melgarafael/DeskcommCRM).
O autor original é muito rápido — perto de **240 commits por dia** — e traz coisa que
vale a pena ter: ligação por voz, campanhas, financeiro, prospecção. A MIA também
anda: multi-tenant de plataforma, cadastro incorporado da Meta, LGPD nas duas pontas.

Este documento é o jeito de os dois andarem juntos. Ele existe porque a primeira
sincronização (23/09/2026, 2.764 commits de uma vez) custou uma tarde inteira e quase
deixou passar um buraco de LGPD que ninguém teria visto.

## As seis regras

### 1. O nosso mora ao lado do dele, nunca dentro

| do upstream — **nunca editar** | nosso |
|---|---|
| `supabase/baseline.sql` | `supabase/baseline-mia.sql` |
| `supabase/migrations/` (arquivos e `MANIFEST.md`) | `supabase/migrations-mia/` (arquivos e `MANIFEST.md`) |

O `easypanel/bootstrap.sh` aplica os dois, nesta ordem. Os arquivos do upstream entram
da sincronização **exatamente** como ele os escreveu — e por isso não conflitam nunca.

Na fusão de 23/09, o `baseline.sql` sozinho deu 11 blocos de conflito cobrindo 15 mil
linhas. Com esta separação, na medição seguinte (479 commits depois), deu **zero**.

### 2. Migration nova da MIA usa a faixa 9000

`9001`, `9002`, ... O upstream está passando de `0390` e cresce. As nossas `0239..0272`
mantêm o número porque são história — o código as cita por ele — mas na pasta delas.

Desde a 9019 (.72) a descrição de migration nova mora no PRÓPRIO arquivo, numa
linha `-- manifest: <o quê e por quê>`, como o upstream passou a fazer na 1.70
(#2149): duas frentes em paralelo acrescentando linha no fim do mesmo MANIFEST
conflitavam sempre. O MANIFEST da MIA fica como histórico até a 9018; cada
migration se descreve num lugar só, vigiado por
`schema-mia-estende-nunca-redefine`. O carimbo (`lib/schema/carimbo.ts` e o
`insert` no `baseline-mia.sql`) continua sendo a migration mais nova.

### 3. Estender, nunca redefinir

Nada no `baseline-mia.sql` pode fazer `create or replace` de função, gatilho, view ou
constraint que já exista no `baseline.sql`. Quando a MIA precisa de mais, **pendura o
seu ao lado**: gatilho próprio, tabela nova, função com nome nosso.

O porquê é concreto. Se o nosso redefine um objeto dele, vale o nosso (roda por
último), e toda melhoria futura dele naquele objeto é desfeita **em silêncio** — sem
erro, sem teste vermelho. Foi assim que a nossa `fn_lgpd_cascade_redact_contact`
(7 tabelas) quase apagou a dele (19) da anonimização.

O próprio upstream estende assim: `trg_contacts_anonimizado_limpa_custom_fields`.

Vigiado por `tests/unit/schema-mia-estende-nunca-redefine.test.ts`.

### 4. Sincronizar sempre, nunca acumular

A dor de uma fusão cresce **mais** que o número de commits: nove dias divergindo não
dão 9 pontos de contato, dão 66. O robô `.github/workflows/sincronizar-upstream.yml`
mede todo dia útil e mantém **uma** issue atualizada com o veredito.

Ele **não funde nada** — a fusão é decisão de gente.

### 5. Armadilha conhecida vira teste

Cada coisa que entrou quebrada **sem dar erro** na fusão de 23/09 virou teste que
falha alto:

| armadilha | teste |
|---|---|
| objeto do upstream redefinido pela MIA | `schema-mia-estende-nunca-redefine` |
| coluna nova de pessoa sem resposta para "isto é dado pessoal?" | `lgpd-as-duas-pontas` |
| tabela nova com `contact_id` que nada anonimiza | `lgpd-exporta-o-que-redige` |
| namespace das imagens voltando para o do upstream | `namespace-das-imagens` |
| o schema da MIA deixando de ser aplicado no deploy | `carimbo-do-schema` |

Estas catracas são **nossas** e o upstream não as tem. Na fusão de 25/09 elas acharam
quatro buracos de LGPD no código novo dele, dois dias depois de ele escrever.

### 6. Defeito genérico vai para ele

Bug que não é particularidade da MIA vira pull request no repositório dele. Volta de
graça na próxima sincronização, e a gente carrega uma diferença a menos. Candidatos
abertos:

- `contacts.social_identity` não é anonimizada por nenhum caminho, nem exportada
- `google_ads_click_refs` / `meta_ads_click_refs` guardam `query_raw` e nada as alcança
- a rota direta de anonimização não zera `consent`, `tags`, `source_metadata`
- o diagnóstico da Meta (o par do `lerDiagnosticoGoogle`), e o link do negócio na
  lista de pendências da tela de Conversões, que para na lista de funis. A régua
  por etapa da Meta o upstream fez (0524) e a MIA adotou na .72; o "todo evento de
  etapa lê Compra" ele consertou no mesmo lançamento. Da régua dele faltam, se
  fizerem falta: valor por etapa e canal de entrada

## Como fazer uma sincronização

```bash
# 1. Medir antes (o que o robô faz todo dia)
node scripts/sincronizar-upstream.mjs

# 2. Fundir numa árvore separada — nunca direto na main que está em produção
git worktree add ../DeskcommCRM-sync -b sync/upstream-AAAA-MM-DD main
cd ../DeskcommCRM-sync
git merge upstream/main

# 3. Resolver os conflitos (só de código — se aparecer conflito no schema do
#    upstream, alguém quebrou a regra 1; ache o commit antes de continuar)

# 4. Provar
node scripts/redefinicoes-do-upstream.mjs supabase/baseline.sql supabase/baseline-mia.sql
pnpm typecheck
pnpm lint:channels
npx vitest run

# 5. Backup do banco ANTES de implantar — reverter imagem desfaz código, não
#    desfaz migration. Só o backup desfaz.
```

## O que ainda não está resolvido

- **Código ainda conflita.** A regra 1 resolve o schema; o código da MIA ainda mora
  dentro de arquivos do upstream em vários lugares (navegação, canais, agenda). A
  medição de 25/09 deu 15 arquivos em conflito, todos de código. Mover para módulos
  próprios é trabalho contínuo, feito a cada vez que se mexe num desses arquivos.
  A agenda do Outlook (9011, 9014, 9015) mora em `lib/agenda/microsoft/`,
  `lib/agenda-mia/` e `components/agenda/microsoft/`, e a lista fechada dos pontos
  de ligação dela no código do upstream está em
  [`docs/fork/agenda-microsoft.md`](fork/agenda-microsoft.md), seção 3.4.
  As conversões da Meta por etapa são do upstream desde a .72 (0524); o que é só
  nosso (a volta dos leads de formulário, o diagnóstico da Meta) mora em
  `lib/conversoes-meta/`, e a lista do que é de quem está em
  [`docs/fork/conversoes-da-meta.md`](fork/conversoes-da-meta.md).
  O MCP de implantação mora em `lib/mcp-plataforma/` e `lib/implantacao/`; as seis
  rotas do upstream de onde ele tirou a lógica para uma função compartilhada, e as
  rotas que ele espelha, estão em
  [`docs/fork/mcp-de-implantacao.md`](fork/mcp-de-implantacao.md), seção 5.
- **Funcionalidade duplicada.** Os dois lados construíram, na mesma semana, o
  cadastro incorporado da Meta, o disparo em massa e o aviso no WhatsApp. A decisão
  de ficar com um, com o outro ou com os dois é de produto. Para o **disparo em
  massa** ela foi tomada na .58: os dois ficam, como UM produto chamado Broadcast
  (as Campanhas dele são o caminho "número por QR"), com os motores separados por
  baixo — ver [`docs/fork/broadcast-unificado.md`](fork/broadcast-unificado.md).
  As outras duas continuam abertas.
- **A voz precisa de fiação.** O agente de voz é uma quarta imagem e um quinto
  contêiner (`asterisk`); o `docker-compose.easypanel.yml` é nosso e não recebe isso
  da fusão.

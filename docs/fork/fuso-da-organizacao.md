# O fuso da organização nos relatórios

**Tarefa:** MIA-102 (item 2.4 do mapa do sistema, "com defeito, pequeno"). **Migration:** 9166.

## A regra

O dia, a semana e o mês de um relatório são os do fuso da **organização**
(`organizations.timezone`), nunca o do navegador de quem olha: duas pessoas da mesma
empresa têm de ver a mesma venda no mesmo mês.

**Fuso vazio, só espaços ou com nome que não existe vale `America/Sao_Paulo`.** É o
padrão da própria coluna, e vale igual em todos os relatórios:

| onde | como recua |
|---|---|
| Relatório comercial (`/reports/comercial`, `lib/relatorios/janela.ts`) | `fusoDoRelatorio`, com `TZ_PADRAO = FUSO_PADRAO` |
| Série do Desempenho (`/metrics/serie`) | `fusoUtilizavel` (`lib/tempo/fusos.ts`) |
| Relatório de vendas (`/relatorio-de-vendas`) | `fusoUtilizavel` |
| Planilha dos relatórios montados (`/relatorios/exportar`) | `fusoUtilizavel` |
| Motor dos relatórios montados e dos painéis prontos (`fn_mia_relatorio`, `fn_mia_relatorio_lista`) | `fn_mia_relatorio_preparar` (9166): o nome tem de estar em `pg_timezone_names` |

O fuso válido de outro lugar continua valendo (Tóquio é Tóquio). Só recua o que não
existe.

### O defeito que isto fechou

Até a MIA-102 eram três comportamentos para o mesmo fuso torto. Reprodução com dado
fictício: a Academia Alfa grava `America/Sao_Pualo` e fecha uma venda às 22h de 31/10
em Brasília (01h de 01/11 em UTC).

- O relatório comercial recuava para **UTC**: a venda caía em novembro. E com o fuso
  nulo também (`org.timezone ?? "UTC"` na rota).
- A série do Desempenho recuava para **Brasília**: a venda caía em outubro.
- O motor dos relatórios montados (9041) só recuava com o fuso **vazio**. Com o nome
  torto, o `at time zone` levantava erro e o montador e os painéis prontos não abriam.
- O relatório de vendas recuava para UTC com o fuso vazio e caía em 500 com o torto
  (`janelaDoMes` passa o nome ao `Intl`, que lança). A planilha também caía em 500.

### No banco: por que não a `fn_fuso_valido` do upstream

O upstream tem a mesma regra em `public.fn_fuso_valido` (9404), mas com EXECUTE só
para `service_role`. O preparo do motor roda como quem pergunta (`security invoker`,
a RLS de cada um), então não pode chamá-la sem abrir uma permissão do upstream. A 9166
escreve a mesma conta ao lado: `coalesce((select name from pg_timezone_names where
name = btrim(timezone)), 'America/Sao_Paulo')`. O `pg_timezone_names` é lido uma vez
por pedido (o preparo lê uma linha de `organizations`), não por linha do relatório, e
sem `exception`.

## A gravação recusa o fuso que não existe

Quem grava `organizations.timezone` passa por `fusoGravavel`
(`lib/tempo/fuso-gravavel.ts`):

- **Configurações da empresa** e **painel da plataforma** (`tenantSchema`,
  `lib/schemas/settings.ts`, usado por `updateTenant` e por
  `PATCH /api/v1/admin/tenants/[id]`);
- **Boas-vindas** do primeiro acesso (`welcomeSchema`, `lib/schemas/onboarding.ts`);
- **MCP de implantação** (`configurarEmpresa`, `lib/implantacao/empresa.ts`), que já
  recusava o que o `Intl` recusa e passou para a mesma régua.

A frase da recusa é `MENSAGEM_DO_FUSO_INVALIDO`: diz o que mandar
("America/Sao_Paulo, America/Manaus, Europe/Lisbon"), não só que está errado.

A régua é "o `Intl` aceita **e** o nome tem a grafia da base IANA" (`UTC`, ou regiões
separadas por `/` começando em maiúscula). O `Intl` sozinho não basta: ele aceita
`america/manaus` e `+03:00`, que o Postgres não tem em `pg_timezone_names`. Gravados,
o TypeScript usaria Manaus e o motor do banco recuaria para Brasília. Não é a lista
`FUSOS_OFERECIDOS`: a tela só oferece aquela lista, mas a API e o MCP aceitam qualquer
fuso real (`America/Chihuahua`).

**O fuso já gravado não muda.** Nenhuma organização é alterada pela migration. A
empresa que já tem um fuso torto continua lendo Brasília em todos os relatórios e, na
próxima vez que salvar os dados da empresa, recebe a recusa até escolher um fuso
válido (no MCP, a dica pede `fuso` junto no pedido).

## Testes

- `tests/unit/fuso-dos-relatorios-uma-regra.test.ts`: a regra em TypeScript (o
  comercial e o Desempenho dão o mesmo fuso para cada valor torto), a venda das 22h de
  31/10 em outubro, a rota comercial com fuso nulo e torto, a gravação (`tenantSchema`,
  boas-vindas, toda opção das telas passa) e a catraca de que nenhum leitor de
  relatório volta a ter recuo próprio (`?? "UTC"`, `|| padrão`).
- `tests/invariants/fuso-invalido-nos-relatorios.test.ts`: o motor no Postgres de
  verdade com fuso inválido, vazio e só espaços; Tóquio como controle positivo; pela
  sessão de um gestor (`security invoker`); o fuso gravado intacto.

## Sugestão para o upstream (não aberta)

`lib/relatorios/janela.ts` e `app/api/v1/reports/comercial/route.ts` são do upstream.
A correção serve a ele do mesmo jeito: `TZ_PADRAO` igual a `FUSO_PADRAO` e a rota sem o
`?? "UTC"`. E `tenantSchema` com `refine` no fuso. Fica como sugestão no PR da MIA-102;
nada foi aberto lá.

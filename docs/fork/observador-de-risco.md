# O observador de risco lê a lista de empresas inteira

A rota `app/api/v1/cron/risk-watcher/route.ts` é do upstream. Ela roda a cada 15 minutos pelo
agendador, monta a lista das empresas que têm negócio aberto e, para cada uma (até 50 por passada,
`ORG_LIMIT`), chama `observaTravessias` e `venceReativacoes`.

## O defeito (MIA-320)

A lista de empresas saía de um `select organization_id` em `crm_leads` com `status = open` de
todas as empresas, sem `order` nem `range`. O PostgREST devolve no máximo 1000 linhas por pedido
(`max_rows` em `supabase/config.toml`). Em 27/11/2026 havia 2.085 negócios abertos em 11 empresas,
1.775 numa só: as outras só entravam na lista por sorte da ordem física da tabela. A empresa que
caísse depois da linha 1000 deixava de ser observada (nada esfriava, nenhuma proposta de reativação
nascia, nada vencia) sem erro nenhum.

## O conserto

Marcado com `FORK MIA (MIA-320)` na rota.

- A leitura passa por `lerTodasAsPaginas` (`lib/leitura/todas-as-paginas.ts`), ordenada por
  `organization_id` e desempatada por `id`, com teto de 200 páginas (200 mil negócios abertos).
- A lista sai na ordem de `organization_id`, a mesma em toda passada.
- Falha do banco continua sendo o 500 de antes.
- Teto de páginas acabado sem prova de fim não é silencioso: `logger.error("[risk-watcher] lista
  de empresas truncada")` e `organizations_truncado: true` na resposta (com `false` no caso normal).
- `ORG_LIMIT` (50) e o resto da rodada não mudaram. Como a lista agora tem ordem fixa, com mais de 50
  empresas com negócio aberto as mesmas 50 primeiras seriam observadas em toda passada (hoje são 11).

As leituras de dentro de `observaTravessias` (`lib/leads/risk-worker.ts` e `risk-seed.ts`) são outra
correção (MIA-293).

## Como conferir depois de uma fusão

O upstream ainda tem a leitura sem página. Se uma fusão trouxer mudança nesta rota e o conflito for
resolvido "pegando o lado dele", o defeito volta. Conferir:

```bash
git grep -n "FORK MIA (MIA-320)" -- app/api/v1/cron/risk-watcher/route.ts
NODE_ENV=test npx vitest run tests/unit/risco-lista-de-empresas-le-todas-as-paginas.test.ts
```

O teste usa um banco falso que respeita o teto de 1000 linhas por pedido: a Academia Alfa
(fictícia) tem 1.500 negócios abertos e vem primeiro na ordem física, a Academia Beta tem 3 e vem
depois. Com a leitura antiga a Beta fica fora da lista e o teste fica vermelho.

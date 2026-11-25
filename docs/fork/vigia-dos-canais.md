# O batimento do vigia dos canais

**Tarefa:** MIA-154 (saída da MIA-152). **Migration:** 9168.

## O que responde

"O vigia dos números passou, e quando?" O vigia é o cron `channel-health`
(`app/api/v1/cron/channel-health/route.ts`, do upstream), que a cada 5 min pergunta ao
transporte se cada número está de pé. Numa rodada estável (todo número `WORKING`,
contador do anti-pisco em zero) ele não escreve nada, de propósito: a rodada comum não
paga uma escrita por sessão. Por isso ninguém tinha como saber se ele tinha rodado.

Em 23/11 a ronda leu `channel_sessions.last_health_check_at` e concluiu que a checagem
estava parada desde 19/11. Aquela coluna é da tela de Conexões, não do vigia, e o vigia
estava rodando (MIA-152).

## Como funciona

1. No fim de cada rodada, o vigia chama `registrarBatimento(admin, "channel-health", resumo)`
   (`lib/cron/batimento.ts`). A função faz `upsert` de uma linha em
   `public.mia_batimentos_de_cron` (`rota` é a chave): `ultima_rodada_em` e o `resumo` da
   rodada, que é a mesma resposta da rota (`sessoes`, `verificadas`, `ignoradas` e os
   desfechos). Só contagens, nunca id, nome ou telefone.
2. A `GET /api/v1/health` lê a linha do vigia pelo PostgREST do servidor, com o
   `service_role` (o mesmo caminho do carimbo do schema e do bloco `backup`), e responde:

   ```json
   "vigia_dos_canais": { "ultima_rodada_em": "2026-11-23T22:40:00.000Z", "em_dia": true }
   ```

| `em_dia` | quando |
|---|---|
| `true` | bateu há menos de 15 min (três batidas do agendamento de 5 min) |
| `false` | bateu há mais de 15 min, ou nunca bateu (`ultima_rodada_em: null`) |
| `null` | não se sabe: a tabela não existe (`motivo: "sem_tabela"`), a leitura falhou (`falha_de_leitura`) ou o servidor não tem a URL e a chave (`nao_configurado`) |

Um monitor trata `em_dia !== true` como problema, igual ao bloco `backup`.

**O bloco não muda o `status` da saúde nem o HTTP.** O passo 1 do trem de implantação lê
só `status` e `schema`, e um vigia atrasado não impede o produto de atender.

**O batimento nunca derruba o vigia.** Falhou a escrita (tabela ainda não criada, rede,
permissão), vira `logger.warn("[batimento] não gravou")` com a rota, e a rodada responde
o que responderia.

## O que ele NÃO cobre

- **A saída ociosa não bate o ponto.** Sem nenhum número ativo (não arquivado), o vigia
  sai pelo portão do piso ocioso (`recursoOcioso("canal_vigiado")`) antes de tocar o
  banco. Essa é uma regra do upstream (#3731), provada em
  `tests/unit/piso-ocioso-das-filas.test.ts`, que exige **zero** `from()` nessa saída. Gravar
  o batimento ali quebraria a regra. Consequência: numa instalação sem número ativo, o
  batimento para e a `/health` diz `em_dia: false`. Na produção da MIA há números, então
  isso não acontece. Se acontecer, `em_dia: false` é verdade: não há nada sendo vigiado.
- **A consulta das sessões que falha não bate o ponto.** A rota responde 500 e o vigia não
  rodou de fato.
- **Os outros crons.** A tabela é por rota, e estender a outro cron é uma chamada a
  `registrarBatimento` com outra rota, sem migration. Fica para a dívida técnica, se este
  der certo.

## Banco (9168)

`public.mia_batimentos_de_cron (rota text primary key, ultima_rodada_em timestamptz not null, resumo jsonb)`.
RLS ligado, nenhuma policy, `revoke all` de `public`, `anon` e `authenticated`; só o
`service_role` lê e escreve. A linha é regravada, não acumulada: o histórico dos crons é o
log. Nenhuma função e nenhum gatilho.

Por que no banco, e não no Redis com TTL: o carimbo no Redis some quando ele reinicia, e a
`/health` diria "parado" sobre um vigia que está rodando.

## MCP de plataforma

Não se aplica. O batimento não é função de empresa nem configuração de cliente: é estado da
plataforma, e a leitura é pela `/health` (pública, sem segredo), que o n8n e a ronda já
consultam.

## Testes

- `tests/unit/vigia-dos-canais-bate-o-ponto.test.ts`: a rodada estável grava exatamente um
  batimento e nada mais; o resumo só tem contagens; o batimento que falha (erro ou exceção)
  não muda a resposta e deixa o `warn`; a consulta que falha e a saída ociosa não batem o ponto.
- `app/api/v1/health/health-diz-se-o-vigia-dos-canais-passou.test.ts`: em dia, atrasado, sem
  linha, sem tabela, leitura falhando; o `status` não muda; só a data e o booleano saem.
- `tests/invariants/batimento-dos-crons.test.ts` (banco de verdade): o `upsert` regrava a linha
  da rota; RLS ligado, zero policies, `anon` e `authenticated` sem acesso; a migration roda de
  novo sem erro.

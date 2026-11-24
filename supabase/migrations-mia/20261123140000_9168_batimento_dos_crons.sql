-- manifest: O BATIMENTO DOS CRONS (MIA-154; docs/fork/vigia-dos-canais.md). FORK MIA: o vigia dos números (`/api/v1/cron/channel-health`, a cada 5 min) não escreve nada numa rodada estável, e ninguém (a ronda, o trem, o n8n) sabia se ele tinha passado; em 23/11 a ronda leu `last_health_check_at`, que é da tela de Conexões, e concluiu que ele tinha parado (MIA-152). Tabela NOSSA nova, `mia_batimentos_de_cron`: uma linha por rota (`rota` é a chave), regravada por `upsert` no fim de cada rodada (`lib/cron/batimento.ts`), com `ultima_rodada_em` e um `resumo` só de contagens. A `/api/v1/health` lê a linha do vigia e responde `vigia_dos_canais.em_dia` (menos de 15 min, três batidas), sem mudar o `status` da saúde. Plataforma, RLS ligado e ZERO policies: só o `service_role` lê e escreve. Nenhum objeto do upstream é tocado. Idempotente.
--
-- 9168 · o batimento dos crons
--
-- FORK MIA (MIA-154). Só objeto NOSSO (docs/FORK-MIA.md, regra 3): uma tabela
-- nova com o prefixo `mia_`. Nenhuma função, nenhum gatilho.
--
-- ── Por que no banco, e não no Redis com TTL ─────────────────────────────────
--
-- Sem migration, o Redis seria mais barato, mas o carimbo some quando o Redis
-- reinicia, e a `/health` diria "parado" sobre um vigia que está rodando. Uma
-- escrita a cada 5 min no banco sobrevive a reinício e segue o padrão do bloco
-- `backup` (9006): carimbo no banco, julgado com prazo por quem lê.
--
-- ── Por que uma linha por ROTA ───────────────────────────────────────────────
--
-- A tabela nasce para o vigia dos números, mas o nome não é dele: estender o
-- batimento a outro cron é uma chamada a `registrarBatimento` com outra rota,
-- sem migration nova. A linha é regravada, não acumulada: o histórico dos
-- crons é o log, e uma tabela que cresce 288 linhas por dia por rota só para
-- responder "qual foi a última" seria custo sem pergunta.

create table if not exists public.mia_batimentos_de_cron (
  -- O nome da rota de cron, como em `app/api/v1/cron/<rota>` (ex.: `channel-health`).
  rota text primary key,
  ultima_rodada_em timestamptz not null,
  -- Só contagens da rodada (sessões, verificadas, desfechos). Nunca id de
  -- empresa, nome ou telefone: a `/health` é pública.
  resumo jsonb
);

comment on table public.mia_batimentos_de_cron is
  'MIA (9168): o batimento de cada cron, uma linha por rota, regravada por upsert no fim de cada rodada (lib/cron/batimento.ts). ultima_rodada_em = quando a rodada terminou; resumo = so contagens da rodada. A /api/v1/health le a linha do channel-health (vigia_dos_canais.em_dia: menos de 15 min). Plataforma, zero policies, so o service_role.';

alter table public.mia_batimentos_de_cron enable row level security;

-- ZERO POLICIES: é estado da plataforma, quem lê e escreve é o servidor.
revoke all on public.mia_batimentos_de_cron from public, anon, authenticated;
grant select, insert, update, delete on public.mia_batimentos_de_cron to service_role;

notify pgrst, 'reload schema';

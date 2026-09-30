-- 0250 — `channel_knobs.updated_at` para de mentir
--
-- Achado na implantação do tenant Academia Body Fit (18/09/2026), documentado em
-- `docs/audits/2026-09-18-pacing-janela-adiada-e-alertas-fantasma.md`.
--
-- A coluna existe, tem `default now()`, e NADA a atualiza: o upsert da rota
-- (`app/api/v1/ai/pacing/route.ts`) grava `organization_id`,
-- `channel_session_id` e os campos alterados, e não toca nela. Não havia
-- gatilho na tabela.
--
-- ── Por que dói mais do que uma coluna em branco ────────────────────────────
--
-- Ela não fica vazia: fica MENTINDO com cara de verdade. Na investigação, a
-- linha dizia `created_at == updated_at == 03:18:26Z` para uma janela que tinha
-- sido alargada depois das 04:36. Lendo a tabela, a conclusão inevitável é "a
-- janela já estava aberta quando o turno foi adiado" — e isso transforma
-- comportamento CORRETO do worker em suspeita de bug. Foi o que aconteceu, e
-- custou parte da hora que a auditoria mediu.
--
-- ── Por que GATILHO, e não conserto do upsert ───────────────────────────────
--
-- Consertar o upsert conserta UM chamador e deixa a armadilha armada para o
-- próximo. O gatilho pega também `psql` direto (que é como se mexe numa VPS
-- quando a tela não dá conta) e qualquer rota futura. É a mesma escolha que as
-- outras trinta e poucas tabelas deste schema já fizeram, com a MESMA função —
-- `fn_set_updated_at()` existe desde o dump original e não é criada aqui.

drop trigger if exists trg_channel_knobs_updated_at on public.channel_knobs;
create trigger trg_channel_knobs_updated_at
  before update on public.channel_knobs
  for each row execute function public.fn_set_updated_at();

comment on column public.channel_knobs.updated_at is
  'Carimbado pelo gatilho trg_channel_knobs_updated_at (migration 0250), nunca pelo chamador. Ate a 0250 a coluna nascia com o default e ficava congelada para sempre: a ficha de anti-ban alterada as 04:36 continuava dizendo 03:18, e uma investigacao de producao concluiu por isso que a janela ja estava aberta quando o turno foi adiado.';

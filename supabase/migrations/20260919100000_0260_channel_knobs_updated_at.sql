-- 0260 — `channel_knobs.updated_at` para de mentir
--
-- Auditoria de 18/09 (`docs/audits/2026-09-18-pacing-janela-adiada-e-alertas-fantasma.md`,
-- item 1), CONFIRMADA em banco: a linha tinha `created_at == updated_at ==
-- 03:18:26Z` mesmo tendo sido alterada depois das 04:36. A coluna existe com
-- `default now()`, o upsert da rota de pacing grava os campos alterados e NÃO
-- toca `updated_at`, e não havia gatilho.
--
-- ── Por que dói mais do que parece ────────────────────────────────────────
--
-- O campo não fica em branco: fica MENTINDO COM CARA DE VERDADE. Lendo a
-- tabela, a conclusão inevitável é "a janela já estava aberta quando o turno
-- foi adiado" — e isso transforma comportamento correto em suspeita de bug no
-- worker. Foi exatamente o que aconteceu, e custou a investigação inteira.
--
-- ── Gatilho, e não conserto do upsert ─────────────────────────────────────
--
-- A correção proposta na auditoria, e ela tem razão: o gatilho pega também SQL
-- direto e qualquer rota futura. Consertar o upsert conserta UM chamador e
-- deixa a armadilha armada para o próximo — que é como esta tabela chegou aqui.
--
-- `fn_set_updated_at` já existe e já serve a oito tabelas deste banco. Usar a
-- mesma é o que mantém uma regra só para "quando a linha mudou".

create or replace trigger trg_channel_knobs_updated_at
  before update on public.channel_knobs
  for each row execute function public.fn_set_updated_at();

notify pgrst, 'reload schema';

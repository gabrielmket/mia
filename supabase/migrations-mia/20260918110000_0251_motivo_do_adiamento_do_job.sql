-- 0251 — o motivo do adiamento sai da string livre e vira coluna
--
-- Passo anterior ao conserto do defeito 2 da auditoria de 18/09/2026
-- (`docs/audits/2026-09-18-pacing-janela-adiada-e-alertas-fantasma.md`):
-- alargar a janela anti-ban pela tela não reprograma turno já adiado. O
-- operador alarga, nada acontece, e conclui que a configuração não funciona.
--
-- ── Por que uma coluna, e não um `like` no `last_error` ─────────────────────
--
-- Hoje o motivo do adiamento vive numa frase, escrita para gente ler:
--
--   'fora da janela anti-ban de envio — turno adiado para a abertura'
--
-- Filtrar jobs comparando esse texto funcionaria HOJE e quebraria CALADO no dia
-- em que alguém melhorasse a frase — e "melhorar a frase" é a coisa mais
-- inocente que se faz num arquivo. O sintoma seria o mesmo defeito voltando:
-- operador alarga a janela, nada reprograma, e desta vez com o conserto no
-- lugar dizendo que está tudo certo.
--
-- ── Por que o CHECK, e por que ele tem par em TypeScript ────────────────────
--
-- A coluna é vocabulário fechado: cada valor é uma CONDIÇÃO diferente, e quem
-- reprograma precisa distinguir. `janela_anti_ban` depende do RELÓGIO e do knob
-- do canal — mudar o knob torna o adiamento obsoleto na hora. `horario_do_agente`
-- depende da versão publicada do agente, e `canal_fora` depende de a sessão WAHA
-- voltar: reprogramar os dois junto com a janela traria o turno cedo demais,
-- para ser adiado de novo no mesmo segundo.
--
-- O CHECK ganha par em `lib/agent-engine/queue/queue.ts` → `MOTIVOS_DE_ADIAMENTO`,
-- registrado em `tests/invariants/vocabulario-banco-x-typescript.test.ts`. A
-- lição daquela lista é que todos os pares que divergiram divergiram por terem
-- nascido sozinhos — este nasce acompanhado.
--
-- Toda linha existente fica NULL, então o CHECK não precisa de backfill: ele
-- aceita nulo, que é "este job nunca foi adiado".

alter table public.job_queue
  add column if not exists deferred_reason text;

alter table public.job_queue
  drop constraint if exists job_queue_deferred_reason_check;
alter table public.job_queue
  add constraint job_queue_deferred_reason_check
  check (
    deferred_reason is null
    or deferred_reason in ('janela_anti_ban', 'horario_do_agente', 'canal_fora')
  );

-- O índice serve UMA pergunta, que é a da rota de pacing: "quais jobs deste
-- canal estão parados esperando a janela?". Parcial porque a resposta quase
-- sempre é nenhum — indexar a tabela inteira por uma coluna que é NULL em
-- 99,9% das linhas paga escrita em todo enfileiramento para não devolver nada.
create index if not exists idx_job_queue_adiado_por_motivo
  on public.job_queue (organization_id, deferred_reason, run_after)
  where status = 'pending' and deferred_reason is not null;

comment on column public.job_queue.deferred_reason is
  'POR QUE este job esta com run_after no futuro, em vocabulario fechado. O texto legivel continua em last_error; esta coluna existe para ser FILTRADA. Ate a 0251 o unico registro do motivo era a frase de last_error, e reprogramar turno adiado exigia comparar texto de mensagem — que quebra calado no dia em que alguem melhorar a frase. Par em lib/agent-engine/queue/queue.ts (MOTIVOS_DE_ADIAMENTO), cobrado por tests/invariants/vocabulario-banco-x-typescript.test.ts.';

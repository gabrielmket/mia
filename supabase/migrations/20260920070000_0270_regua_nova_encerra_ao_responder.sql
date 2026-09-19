-- 0270 — régua NOVA encerra quando o lead responde (item B1-a)
--
-- ── A pergunta, em português ──────────────────────────────────────────────
--
-- Um lead está numa régua de follow-up, parado num nó de espera. Ele responde.
-- O que a régua faz para quem não configurou nada?
--
--   1. Segue em frente — a resposta acorda a espera e o motor vai para o passo
--      seguinte. Se o passo seguinte for a despedida, ele se despede de alguém
--      que acabou de falar com a gente.
--   2. Encerra — respondeu, a régua cumpriu o papel e sai de cena; a conversa
--      segue com o agente ou com uma pessoa.
--   3. Sai por uma porta própria, desenhada pelo autor da régua.
--
-- A 1 é o que estava no ar, por OMISSÃO: `trigger_config` nascia
-- `{"kind":"manual"}` e `cancel_on_reply` ausente resolve para `false`.
--
-- ── O que esta migration faz, e o que ela NÃO faz ─────────────────────────
--
-- Troca só o DEFAULT DA COLUNA. Isso vale para a próxima régua criada e para
-- mais nada: nenhuma linha existente é tocada, nenhuma régua em produção muda
-- de comportamento de um deploy para o outro.
--
-- E essa restrição é a decisão, não um detalhe de implementação. Um `update`
-- em massa aqui mudaria o que as réguas dos clientes fazem numa conversa em
-- andamento — sem ninguém ter pedido, e com o sintoma aparecendo dias depois,
-- num lead que não recebeu o follow-up que recebia antes. Mudar comportamento
-- vivo é decisão de quem opera a régua, e a tela já tem a chave
-- ("Cancelar se o lead responder", em IA › Follow-ups › Gatilho).
--
-- ── Por que a 2 é o padrão certo, e não a 1 ───────────────────────────────
--
-- Porque é o que a palavra "follow-up" promete a quem lê. Uma régua existe
-- para buscar quem sumiu; quem respondeu não sumiu. A 1 não é uma escolha que
-- alguém defendeu — é o valor que sobrou de o campo não existir ainda quando as
-- primeiras réguas foram escritas, e o defeito que ela produz (despedir-se de
-- quem acabou de falar) já foi medido neste repositório.
--
-- A 3 continua sendo a mais correta das três, e continua aberta: ela pede que o
-- editor da régua ganhe um nó de saída por resposta, que é trabalho de desenho
-- e não de default.

alter table public.followup_flows
  alter column trigger_config
  set default '{"kind":"manual","cancel_on_reply":true}'::jsonb;

comment on column public.followup_flows.trigger_config is
  'Como a regua dispara (kind + params) e o que ela faz quando o lead responde (cancel_on_reply). O DEFAULT traz cancel_on_reply=true desde a 0270: regua nova encerra ao receber resposta, em vez de avancar para o proximo passo — que podia ser a despedida, mandada a quem acabou de falar. Reguas criadas antes NAO foram tocadas: mudar comportamento de regua viva e decisao de quem opera, e a chave esta na tela (IA > Follow-ups > Gatilho).';

insert into public.schema_baseline (id, migration_mais_nova, aplicado_em)
values (1, '20260920070000_0270_regua_nova_encerra_ao_responder', now())
on conflict (id) do update
  set migration_mais_nova = excluded.migration_mais_nova,
      aplicado_em = now();

notify pgrst, 'reload schema';

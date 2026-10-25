-- manifest: A RETENÇÃO DAS PROPOSTAS E DOS RETRATOS (.91). A função NOSSA `fn_mia_expurgar_assistente_vencido` (9051) é redefinida com o corpo idêntico ao da 9051 e três blocos marcados "9082": a proposta do assistente (9080) pendente que passou de `expira_em` vira expirada; a rejeitada ou expirada há mais de 180 dias e a aplicada há mais de 365 saem (a peça que ela criou fica, é da empresa); e o retrato do "o que falta" (9081) com mais de um ano sai, guardando sempre o primeiro (o "ao entrar faltavam N") e o mais novo de cada empresa. A resposta ganha `propostas_vencidas`, `propostas` e `retratos`. Continua chamada pelo cron do resumo da manhã e só o servidor executa. Nenhum objeto do upstream é tocado.
--
-- 9082 · a retenção das propostas e dos retratos do assistente
--
-- Só a função NOSSA é redefinida (docs/FORK-MIA.md, regra 3). Idempotente:
-- `create or replace`.

create or replace function public.fn_mia_expurgar_assistente_vencido(
  p_retencao_dias integer default 90,
  p_limite integer default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  v_dias integer := greatest(coalesce(p_retencao_dias, 90), 30);
  v_limite integer := least(greatest(coalesce(p_limite, 5000), 1), 50000);
  v_mensagens integer := 0;
  v_conversas integer := 0;
  v_chamados integer := 0;
  -- 9082
  v_propostas_vencidas integer := 0;
  v_propostas integer := 0;
  v_retratos integer := 0;
begin
  with vencidas as (
    select id from public.mia_assistente_mensagens
     where created_at < now() - make_interval(days => v_dias)
     order by created_at
     limit v_limite
  )
  delete from public.mia_assistente_mensagens m
   using vencidas v
   where m.id = v.id;
  get diagnostics v_mensagens = row_count;

  with vazias as (
    select c.id from public.mia_assistente_conversas c
     where c.ultima_em < now() - make_interval(days => v_dias)
       and not exists (select 1 from public.mia_assistente_mensagens m where m.conversa_id = c.id)
     order by c.ultima_em
     limit v_limite
  )
  delete from public.mia_assistente_conversas c
   using vazias v
   where c.id = v.id;
  get diagnostics v_conversas = row_count;

  with resolvidos as (
    select id from public.mia_chamados
     where situacao = 'resolvido'
       and coalesce(respondido_em, updated_at) < now() - make_interval(days => 365)
     order by coalesce(respondido_em, updated_at)
     limit v_limite
  )
  delete from public.mia_chamados ch
   using resolvidos r
   where ch.id = r.id;
  get diagnostics v_chamados = row_count;

  -- 9082 · as propostas do assistente (9080): a pendente que passou do prazo
  --        vence (a pessoa pede de novo, se ainda quiser); a rejeitada ou
  --        vencida há mais de 180 dias e a aplicada há mais de 365 saem. A
  --        peça que a proposta criou não é tocada: ela é da empresa.
  with vencidas as (
    select id from public.mia_assistente_propostas
     where situacao = 'pendente'
       and expira_em < now()
     order by expira_em
     limit v_limite
  )
  update public.mia_assistente_propostas p
     set situacao = 'expirada'
    from vencidas v
   where p.id = v.id;
  get diagnostics v_propostas_vencidas = row_count;

  with decididas as (
    select id from public.mia_assistente_propostas
     where (situacao in ('rejeitada', 'expirada') and updated_at < now() - make_interval(days => 180))
        or (situacao = 'aplicada' and updated_at < now() - make_interval(days => 365))
     order by updated_at
     limit v_limite
  )
  delete from public.mia_assistente_propostas p
   using decididas d
   where p.id = d.id;
  get diagnostics v_propostas = row_count;

  -- 9082 · os retratos do "o que falta" (9081): ficam um ano. O primeiro de
  --        cada empresa (o "ao entrar faltavam N") e o mais novo ficam sempre.
  with velhos as (
    select r.id from public.mia_assistente_retratos r
     where r.rodada_em < now() - make_interval(days => 365)
       and r.id <> (select p.id from public.mia_assistente_retratos p
                     where p.organization_id = r.organization_id
                     order by p.rodada_em asc, p.id asc limit 1)
       and r.id <> (select u.id from public.mia_assistente_retratos u
                     where u.organization_id = r.organization_id
                     order by u.rodada_em desc, u.id desc limit 1)
     order by r.rodada_em
     limit v_limite
  )
  delete from public.mia_assistente_retratos r
   using velhos v
   where r.id = v.id;
  get diagnostics v_retratos = row_count;

  return jsonb_build_object(
    'mensagens', v_mensagens,
    'conversas', v_conversas,
    'chamados', v_chamados,
    'retencao_dias', v_dias,
    'propostas_vencidas', v_propostas_vencidas,
    'propostas', v_propostas,
    'retratos', v_retratos
  );
end
$f$;

comment on function public.fn_mia_expurgar_assistente_vencido(integer, integer) is
  'MIA (9051, 9082): a retencao do assistente da MIA. Apaga, em lotes, as mensagens com mais de p_retencao_dias (90 por padrao, piso de 30), as conversas que ficaram vazias e os chamados resolvidos ha mais de 365 dias (o print vai para storage_redaction_queue pelo gatilho da 9050). Desde a 9082: vence a proposta pendente que passou do prazo, apaga a rejeitada ou vencida ha mais de 180 dias e a aplicada ha mais de 365 (a peca criada fica), e apaga o retrato do o-que-falta com mais de 365 dias, guardando o primeiro e o mais novo de cada empresa. Chamada pelo cron do resumo da manha. So o servidor executa.';

revoke all on function public.fn_mia_expurgar_assistente_vencido(integer, integer) from public;
revoke execute on function public.fn_mia_expurgar_assistente_vencido(integer, integer) from anon, authenticated;
grant execute on function public.fn_mia_expurgar_assistente_vencido(integer, integer) to service_role;

notify pgrst, 'reload schema';

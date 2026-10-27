-- manifest: O PAGAMENTO NO INÍCIO, PARTE 3 (.96): O FIM DO TESTE SEM A PRIMEIRA MENSALIDADE PAGA BLOQUEIA NA HORA (ajuste do Gabriel em 27/10/2026 à decisão 12). A régua do upstream dá ao teste vencido o aviso de "acabou", o aviso final e a suspensão 48 h depois (`decidirRegua`, #2753), com textos de "conta suspensa por falta de pagamento". Para quem NUNCA pagou uma mensalidade, a MIA bloqueia no instante em que o teste acaba (com o cartão cadastrado, no fim do dia do débito) e trata a empresa exatamente como a ENTRADA PAGA do upstream (0679): `cobranca_assinaturas.pagamento_inicial_pendente = true` e a suspensão do tipo `cobranca` com o motivo "Aguardando o primeiro pagamento", que é o que o gatilho dele grava no cadastro. Daí em diante vale o caminho da entrada paga: o passo "Pagamento" do início (Pix e troca de cartão), e a releitura do upstream libera sozinha quando o pagamento confirma (ela desliga a pendência e reativa). `fn_mia_bloquear_fim_do_teste` é função NOVA, ao lado de `fn_cobranca_suspender_se_devendo` (nunca a redefine): trava a linha da assinatura e só bloqueia quem ainda está no teste vencido, nunca pagou (`proximo_vencimento` e `periodo_pago_desde` vazios), não tem prazo extra da Time e está ativa. Quem já pagou alguma mensalidade segue a régua de hoje. Só o servidor executa.
--
-- 9122 · o bloqueio no fim do teste
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `create or replace`
-- de função nossa.

create or replace function public.fn_mia_bloquear_fim_do_teste(p_org uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.cobranca_assinaturas%rowtype;
  v_status text;
begin
  if not public.fn_cobranca_ligada() then
    return jsonb_build_object('mudou', false, 'motivo', 'cobranca_desligada');
  end if;
  select * into v from public.cobranca_assinaturas where organization_id = p_org for update;
  if not found then
    return jsonb_build_object('mudou', false, 'motivo', 'isenta');
  end if;
  if v.pagamento_inicial_pendente then
    return jsonb_build_object('mudou', false, 'motivo', 'ja_espera_o_pagamento');
  end if;
  if v.estado not in ('trial', 'em_atraso') or v.trial_ate is null or v.trial_ate > now() then
    return jsonb_build_object('mudou', false, 'motivo', 'teste_em_curso');
  end if;
  if v.proximo_vencimento is not null or v.periodo_pago_desde is not null then
    return jsonb_build_object('mudou', false, 'motivo', 'ja_pagou');
  end if;
  if v.prazo_extra_ate is not null and v.prazo_extra_ate > now() then
    return jsonb_build_object('mudou', false, 'motivo', 'com_prazo_da_time');
  end if;
  select o.status into v_status from public.organizations o where o.id = p_org for update;
  if v_status is distinct from 'active' then
    return jsonb_build_object('mudou', false, 'motivo', 'empresa_parada');
  end if;

  update public.cobranca_assinaturas
     set pagamento_inicial_pendente = true, updated_at = now()
   where organization_id = p_org;
  perform public.fn_suspender_organizacao(p_org, 'cobranca', 'Aguardando o primeiro pagamento', null);
  return jsonb_build_object('mudou', true, 'motivo', 'fim_do_teste_sem_pagamento');
end;
$$;

comment on function public.fn_mia_bloquear_fim_do_teste(uuid) is
  'MIA (9122): o teste gratis acabou e nenhuma mensalidade foi paga: liga pagamento_inicial_pendente e suspende como a entrada paga do upstream (cobranca, Aguardando o primeiro pagamento). A releitura do upstream libera quando pagar. So o servidor.';

revoke all on function public.fn_mia_bloquear_fim_do_teste(uuid) from public;
revoke execute on function public.fn_mia_bloquear_fim_do_teste(uuid) from anon, authenticated;
grant execute on function public.fn_mia_bloquear_fim_do_teste(uuid) to service_role;

notify pgrst, 'reload schema';

-- manifest: O LADO DA TIME NO PAGAMENTO NO INÍCIO (.96, segunda frente; protótipo "Pagamento no início" aprovado em 27/10/2026, tela 4 e decisão 5), em Admin › Empresas do cadastro. Duas funções NOVAS, só do servidor. `fn_mia_funil_do_cadastro(p_desde)` conta o funil dos últimos dias para os números do topo: quem escolheu um plano no site (a conta criada com o plano escolhido, `auth.users` com `cobranca_plan_id`), as empresas que nasceram pelo cadastro próprio (`mia_origem_da_empresa`), as que pagaram, as que esperam o primeiro pagamento e, fora da janela, as que estão sem pagamento há mais de 30 dias; só lê. `fn_mia_cadastro_sem_pagamento_para_apagar(p_org, p_ator, p_dias)` é o passo do banco do botão "Apagar o cadastro" (nunca automático; a rota exige a verificação em duas etapas): trava a empresa e a assinatura e só segue com a empresa que ESPERA o primeiro pagamento (`pagamento_inicial_pendente`), nunca pagou nada (`proximo_vencimento`, `periodo_pago_desde` e o passo pago vazios), nasceu há pelo menos `p_dias` dias, não é a demonstração e está parada pela cobrança. Aí troca a suspensão de cobrança por uma ADMINISTRATIVA nova, pelas funções do upstream (`fn_reativar_organizacao` e `fn_suspender_organizacao`, na mesma transação), para que a exclusão do upstream (`excluirOrganizacao`, 0614) aceite apagar: a trava dela contra apagar empresa parada por cobrança existe para não deixar assinatura cobrando no provedor, e quem chama já cancelou a cobrança no Asaas antes. Reaplicar na empresa já preparada devolve `ja_preparada`. Nenhum objeto do upstream é redefinido.
--
-- 9126 · o funil do cadastro e o cadastro sem pagamento
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `create or replace`
-- de função nossa.

-- ── 1. o funil dos números do topo ──────────────────────────────────────────
create or replace function public.fn_mia_funil_do_cadastro(p_desde timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with empresas as (
    select o.id, o.created_at,
           coalesce(a.pagamento_inicial_pendente, false) as pendente,
           (a.proximo_vencimento is not null
             or a.periodo_pago_desde is not null
             or coalesce(p.situacao = 'pago', false)) as pagou
      from public.organizations o
      join public.mia_origem_da_empresa m on m.organization_id = o.id and m.origem = 'cadastro'
      left join public.cobranca_assinaturas a on a.organization_id = o.id
      left join public.mia_pagamento_inicial p on p.organization_id = o.id
     where not o.demonstracao
       and o.status <> 'redacted'
  )
  select jsonb_build_object(
    'escolheram_plano', (
      select count(*) from auth.users u
       where u.created_at >= p_desde
         and coalesce(u.raw_user_meta_data ->> 'cobranca_plan_id', '') <> ''),
    'criaram_conta', (select count(*) from empresas where created_at >= p_desde),
    'pagaram', (select count(*) from empresas where created_at >= p_desde and pagou),
    'esperando_pagamento', (select count(*) from empresas where created_at >= p_desde and pendente and not pagou),
    'sem_pagamento_ha_mais_de_30_dias', (
      select count(*) from empresas
       where pendente and not pagou and created_at < now() - interval '30 days')
  );
$$;

comment on function public.fn_mia_funil_do_cadastro(timestamptz) is
  'MIA (9126): o funil do cadastro desde p_desde (escolheram um plano no site, criaram a conta, pagaram, esperam o pagamento) e as empresas sem pagamento ha mais de 30 dias. So le. So o servidor.';

revoke all on function public.fn_mia_funil_do_cadastro(timestamptz) from public;
revoke execute on function public.fn_mia_funil_do_cadastro(timestamptz) from anon, authenticated;
grant execute on function public.fn_mia_funil_do_cadastro(timestamptz) to service_role;

-- ── 2. o cadastro sem pagamento fica pronto para a exclusão do upstream ─────
create or replace function public.fn_mia_cadastro_sem_pagamento_para_apagar(
  p_org uuid,
  p_ator uuid,
  p_dias integer default 30
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_motivo constant text := 'Cadastro sem pagamento: apagado pela Time';
  v_org record;
  v public.cobranca_assinaturas%rowtype;
begin
  if auth.uid() is not null then
    raise exception 'cadastro_sem_pagamento_so_pelo_servidor' using errcode = '42501';
  end if;
  if p_dias is null or p_dias < 30 then
    raise exception 'cadastro_sem_pagamento_prazo_minimo' using errcode = '22023';
  end if;

  select o.id, o.created_at, o.status, coalesce(o.suspended_kind, 'administrativa') as tipo,
         o.suspended_reason, o.demonstracao
    into v_org
    from public.organizations o
   where o.id = p_org
     for update;
  if not found then
    return jsonb_build_object('pode', false, 'motivo', 'nao_existe');
  end if;
  if v_org.demonstracao then
    return jsonb_build_object('pode', false, 'motivo', 'demonstracao');
  end if;

  select * into v from public.cobranca_assinaturas where organization_id = p_org for update;
  if not found then
    return jsonb_build_object('pode', false, 'motivo', 'sem_assinatura');
  end if;
  if not v.pagamento_inicial_pendente then
    return jsonb_build_object('pode', false, 'motivo', 'nao_espera_pagamento');
  end if;
  if v.proximo_vencimento is not null or v.periodo_pago_desde is not null
     or exists (select 1 from public.mia_pagamento_inicial p where p.organization_id = p_org and p.situacao = 'pago') then
    return jsonb_build_object('pode', false, 'motivo', 'ja_pagou');
  end if;
  if v_org.created_at > now() - make_interval(days => p_dias) then
    return jsonb_build_object('pode', false, 'motivo', 'antes_do_prazo');
  end if;
  if v_org.status <> 'suspended' then
    return jsonb_build_object('pode', false, 'motivo', 'nao_esta_parada');
  end if;
  -- Já preparada numa tentativa anterior (a exclusão não terminou): segue.
  if v_org.tipo = 'administrativa' and v_org.suspended_reason = c_motivo then
    return jsonb_build_object('pode', true, 'motivo', 'ja_preparada');
  end if;
  -- Parada à mão pela Time por outro motivo: quem decide é a exclusão do painel da empresa.
  if v_org.tipo <> 'cobranca' then
    return jsonb_build_object('pode', false, 'motivo', 'parada_pela_time');
  end if;

  -- A suspensão de cobrança vira uma ADMINISTRATIVA nova, pelas funções do
  -- upstream, na mesma transação: ninguém vê a empresa ativa no meio.
  perform public.fn_reativar_organizacao(p_org, 'cobranca', p_ator);
  perform public.fn_suspender_organizacao(p_org, 'administrativa', c_motivo, p_ator);
  return jsonb_build_object('pode', true, 'motivo', 'preparada');
end;
$$;

comment on function public.fn_mia_cadastro_sem_pagamento_para_apagar(uuid, uuid, integer) is
  'MIA (9126): Apagar o cadastro (Empresas do cadastro). So a empresa que espera o primeiro pagamento, nunca pagou, nasceu ha p_dias (30 ou mais), nao e a demonstracao e esta parada pela cobranca: a suspensao de cobranca vira uma administrativa nova (fn_reativar_organizacao e fn_suspender_organizacao do upstream) para a exclusao do upstream aceitar. Quem chama cancela a cobranca no Asaas antes. So o servidor.';

revoke all on function public.fn_mia_cadastro_sem_pagamento_para_apagar(uuid, uuid, integer) from public;
revoke execute on function public.fn_mia_cadastro_sem_pagamento_para_apagar(uuid, uuid, integer) from anon, authenticated;
grant execute on function public.fn_mia_cadastro_sem_pagamento_para_apagar(uuid, uuid, integer) to service_role;

notify pgrst, 'reload schema';

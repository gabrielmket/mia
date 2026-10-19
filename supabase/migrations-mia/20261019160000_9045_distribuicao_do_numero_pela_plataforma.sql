-- manifest: AS REGRAS DE ATENDIMENTO POR NUMERO (upstream v1.85, 0663, #2331) pelo MCP de PLATAFORMA (.83). A porta de escrita do upstream, `fn_set_channel_routing`, exige SESSAO de gerente membro da empresa com MFA provado (`auth.uid()`, `fn_role_at_least(...,'manager')`, `fn_session_mfa_proven()`); o MCP de plataforma age por um token de plataforma, cujo dono em geral nao e membro da empresa que implanta, e a porta recusa (`routing_forbidden`). Funcao NOVA nossa, `fn_mia_distribuicao_do_numero_pela_plataforma(p_org, p_token, p_channel, p_users, p_reset default false, p_mode default null, p_default_assignee default null)`: SECURITY DEFINER, so `service_role` executa, e o ator e o TOKEN DE PLATAFORMA vivo (nao revogado, nao vencido) que carrega a operacao `implantar_configuracao` e cujo criador continua admin de plataforma de escopo cheio (a mesma conferencia da 9022). Dali em diante o corpo e o MESMO da porta do upstream na 0663: os tres modos (manual, round_robin, load; nulo = herda a organizacao), o numero da empresa e nao arquivado (travado `for update`, a ordem canal -> conversa da 0228), os responsaveis membros ativos `agent`/`manager`/`admin` (lista inteira), o destino padrao pela mesma regua, o upsert em `channel_routing_policies` com as duas colunas da 0663, a troca dos `channel_routing_responsibles`, o `reset` que apaga a regra do numero, e `fn_wake_channel_routing` no fim; a resposta tem a mesma forma. Nenhum objeto do upstream e tocado. A copia do corpo e vigiada: `tests/unit/mcp-de-implantacao-espelhos.test.ts` guarda a impressao de `fn_set_channel_routing` e reprova quando o upstream a muda. Provado em tests/invariants/distribuicao-do-numero-pela-plataforma.test.ts (com controle negativo: a porta do upstream recusa o mesmo ator).
--
-- 9045 · a distribuição de cada número pela plataforma (MCP de implantação)
--
-- `fn_mia_`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente:
-- `create or replace` de função nossa, `revoke`/`grant` repetíveis.
--
-- Os códigos de erro são os da porta do upstream (42501, 22023, P0002), com as
-- MESMAS mensagens: quem traduz a recusa para frase (`lib/implantacao/canal.ts`)
-- lê a mensagem. Nenhum 40001 (a regra da 9043: o PostgREST repete 40001).

create or replace function public.fn_mia_distribuicao_do_numero_pela_plataforma(
  p_org uuid,
  p_token uuid,
  p_channel uuid,
  p_users uuid[],
  p_reset boolean default false,
  p_mode text default null,
  p_default_assignee uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_criador uuid;
  v_revogado timestamptz;
  v_vence timestamptz;
  v_operacoes text[];
  v_policy_id uuid;
  v_mode text;
  requested_count integer;
  found_count integer;
begin
  if p_token is null then
    raise exception 'distribuicao_sem_token_de_plataforma' using errcode = '42501';
  end if;
  if p_org is null or p_channel is null then
    raise exception 'routing_channel_not_found' using errcode = 'P0002';
  end if;

  -- Quem muda: o TOKEN DE PLATAFORMA vivo, com a operação de montar a
  -- implantação, e o criador dele continua admin de plataforma de escopo cheio.
  -- É a mesma conferência que o servidor do MCP faz antes do handler, repetida
  -- aqui como defesa em profundidade (o molde da 9022): a função é do
  -- service_role, e um chamador que não passou pelo servidor não ganha a porta.
  select t.created_by, t.revoked_at, t.expires_at, t.operacoes
    into v_criador, v_revogado, v_vence, v_operacoes
    from public.platform_api_tokens t
   where t.id = p_token;
  if v_criador is null
     or v_revogado is not null
     or (v_vence is not null and v_vence <= now())
     or not ('implantar_configuracao' = any(coalesce(v_operacoes, array[]::text[]))) then
    raise exception 'distribuicao_sem_token_de_plataforma'
      using errcode = '42501',
            detail = 'A distribuição de um número só é gravada por um token de plataforma vivo com a operação implantar_configuracao.';
  end if;
  if not exists (
    select 1
      from public.platform_admins pa
     where pa.user_id = v_criador
       and pa.revoked_at is null
       and pa.scope = 'full'
  ) then
    raise exception 'distribuicao_sem_admin_de_plataforma'
      using errcode = '42501',
            detail = 'Quem criou o token deixou de ser admin de plataforma (ou é só de suporte).';
  end if;

  -- Daqui para baixo, o corpo de `fn_set_channel_routing` (0663), sem a sessão.
  if p_users is null or cardinality(p_users) > 1000 or array_position(p_users, null) is not null then
    raise exception 'routing_invalid_members' using errcode = '22023';
  end if;
  if p_mode is not null and p_mode not in ('manual', 'round_robin', 'load') then
    raise exception 'routing_invalid_mode' using errcode = '22023';
  end if;
  -- Leitores de claim usam SHARE nesta identidade, inclusive na ausência de policy.
  perform 1 from public.channel_sessions
   where organization_id = p_org and id = p_channel and archived_at is null
   for update;
  if not found then
    raise exception 'routing_channel_not_found' using errcode = 'P0002';
  end if;
  if p_reset then
    delete from public.channel_routing_policies
     where organization_id = p_org and channel_session_id = p_channel;
    v_mode := null;
  else
    select count(distinct x) into requested_count from unnest(p_users) x;
    perform 1 from public.user_organizations
     where organization_id = p_org and user_id = any(p_users)
       and revoked_at is null and role in ('agent', 'manager', 'admin')
     order by user_id
     for share;
    get diagnostics found_count = row_count;
    if found_count <> requested_count then
      raise exception 'routing_invalid_members' using errcode = '22023';
    end if;
    -- O destino padrão passa pela MESMA régua dos responsáveis: membro ativo.
    if p_default_assignee is not null then
      perform 1 from public.user_organizations
       where organization_id = p_org and user_id = p_default_assignee
         and revoked_at is null and role in ('agent', 'manager', 'admin')
       for share;
      if not found then
        raise exception 'routing_invalid_members' using errcode = '22023';
      end if;
    end if;
    insert into public.channel_routing_policies (organization_id, channel_session_id, distribution_mode, default_assignee_user_id)
    values (p_org, p_channel, p_mode, p_default_assignee)
    on conflict (organization_id, channel_session_id) do update
      set distribution_mode = excluded.distribution_mode,
          default_assignee_user_id = excluded.default_assignee_user_id,
          updated_at = now()
    returning id into v_policy_id;
    delete from public.channel_routing_responsibles r
     where r.organization_id = p_org and r.policy_id = v_policy_id;
    insert into public.channel_routing_responsibles (organization_id, policy_id, user_id)
    select p_org, v_policy_id, x from (select distinct unnest(p_users) x) users;
    v_mode := p_mode;
  end if;
  perform public.fn_wake_channel_routing(p_org, p_channel);
  return jsonb_build_object(
    'channel_session_id', p_channel,
    'policy_id', v_policy_id,
    'mode', case when p_reset then 'legacy_unconfigured' when cardinality(p_users) = 0 then 'restricted_empty' else 'restricted' end,
    'user_ids', case when p_reset then '[]'::jsonb else to_jsonb(p_users) end,
    'distribution_mode', to_jsonb(v_mode),
    'default_assignee_user_id', to_jsonb(case when p_reset then null else p_default_assignee end)
  );
end;
$$;

comment on function public.fn_mia_distribuicao_do_numero_pela_plataforma(uuid, uuid, uuid, uuid[], boolean, text, uuid) is
  'MIA (9045): as regras de atendimento de UM numero (upstream 0663: modo de distribuicao e atendente de destino padrao, com os responsaveis da 0228) gravadas pelo MCP de plataforma. O ator e o token de plataforma vivo com implantar_configuracao, cujo criador e admin de plataforma de escopo cheio; o resto e o corpo de fn_set_channel_routing (numero da empresa e nao arquivado, responsaveis e destino membros ativos agent/manager/admin, upsert da regra, troca dos responsaveis, reset, fn_wake_channel_routing). Execucao so para service_role.';

revoke all on function public.fn_mia_distribuicao_do_numero_pela_plataforma(uuid, uuid, uuid, uuid[], boolean, text, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_mia_distribuicao_do_numero_pela_plataforma(uuid, uuid, uuid, uuid[], boolean, text, uuid)
  to service_role;

notify pgrst, 'reload schema';

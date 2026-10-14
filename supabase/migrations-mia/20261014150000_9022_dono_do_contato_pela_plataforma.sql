-- manifest: O DONO DO CONTATO (a "carteira do cliente" do upstream, 0622) pelo MCP de PLATAFORMA, na importacao de contatos. A unica porta de escrita do upstream, `fn_definir_carteira_do_cliente`, exige que o ATOR seja gerente ou administrador MEMBRO da empresa (`user_organizations`); o MCP de plataforma age por um token de plataforma, cujo dono em geral nao e membro da empresa que implanta, e por isso a porta do upstream recusa (`carteira_permissao_negada`). Funcao NOVA nossa, `fn_mia_definir_dono_do_contato_pela_plataforma(p_org, p_token, p_contact, p_dono, p_origem default 'importacao')`: SECURITY DEFINER, so `service_role` executa, e o ator e o TOKEN DE PLATAFORMA vivo (nao revogado, nao vencido) que carrega a operacao `importar_base` e cujo criador continua admin de plataforma de escopo cheio. Dali em diante o corpo e o MESMO da porta do upstream (vocabulario da origem, contato da mesma empresa, dono membro ativo `agent`/`manager`/`admin`, grava o trio `carteira_*` e adota na mesma transacao os negocios abertos sem dono do contato); o gatilho `trg_contacts_carteira_so_pelo_servidor` deixa passar porque a funcao e definer. Nenhum objeto do upstream e tocado. A copia do corpo e vigiada: `tests/unit/mcp-de-implantacao-espelhos.test.ts` guarda a impressao de `fn_definir_carteira_do_cliente` e reprova quando o upstream a muda. Provado em tests/invariants/dono-do-contato-pela-plataforma.test.ts (com controle negativo: a porta do upstream recusa o mesmo ator).
--
-- 9022 · o dono do contato pela plataforma (na importação de contatos)
--
-- `fn_mia_`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente:
-- `create or replace` de função nossa, `revoke`/`grant` repetíveis.

create or replace function public.fn_mia_definir_dono_do_contato_pela_plataforma(
  p_org uuid,
  p_token uuid,
  p_contact uuid,
  p_dono uuid,
  p_origem text default 'importacao'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_criador uuid;
  v_revogado timestamptz;
  v_vence timestamptz;
  v_operacoes text[];
  v_dono_papel text;
  v_contato_org uuid;
  v_origem text := coalesce(p_origem, 'importacao');
begin
  if p_token is null then
    raise exception 'dono_sem_token_de_plataforma' using errcode = '42501';
  end if;
  if p_org is null or p_contact is null then
    raise exception 'carteira_parametro_invalido' using errcode = '22023';
  end if;
  if v_origem not in ('manual', 'importacao', 'atribuicao_automatica') then
    raise exception 'carteira_origem_invalida' using errcode = '22023';
  end if;

  -- Quem muda: o TOKEN DE PLATAFORMA vivo, com a operação de importar a base, e
  -- o criador dele continua admin de plataforma de escopo cheio. É a mesma
  -- conferência que o servidor do MCP faz antes do handler, repetida aqui como
  -- defesa em profundidade: a função é do service_role, e um chamador que não
  -- passou pelo servidor não ganha a porta.
  select t.created_by, t.revoked_at, t.expires_at, t.operacoes
    into v_criador, v_revogado, v_vence, v_operacoes
    from public.platform_api_tokens t
   where t.id = p_token;
  if v_criador is null
     or v_revogado is not null
     or (v_vence is not null and v_vence <= now())
     or not ('importar_base' = any(coalesce(v_operacoes, array[]::text[]))) then
    raise exception 'dono_sem_token_de_plataforma'
      using errcode = '42501',
            detail = 'O dono do contato só é gravado por um token de plataforma vivo com a operação importar_base.';
  end if;
  if not exists (
    select 1
      from public.platform_admins pa
     where pa.user_id = v_criador
       and pa.revoked_at is null
       and pa.scope = 'full'
  ) then
    raise exception 'dono_sem_admin_de_plataforma'
      using errcode = '42501',
            detail = 'Quem criou o token deixou de ser admin de plataforma (ou é só de suporte).';
  end if;

  -- Daqui para baixo, o corpo de `fn_definir_carteira_do_cliente` (0622).
  select c.organization_id into v_contato_org
    from public.contacts c
   where c.id = p_contact;
  if v_contato_org is null then
    raise exception 'carteira_contato_nao_encontrado' using errcode = '22023';
  end if;
  if v_contato_org <> p_org then
    raise exception 'carteira_contato_de_outra_organizacao' using errcode = '42501';
  end if;

  if p_dono is not null then
    select uo.role into v_dono_papel
      from public.user_organizations uo
     where uo.user_id = p_dono
       and uo.organization_id = p_org
       and uo.accepted_at is not null
       and uo.revoked_at is null;
    if v_dono_papel is null or v_dono_papel not in ('agent', 'manager', 'admin') then
      raise exception 'carteira_dono_invalido'
        using errcode = '22023',
              detail = 'O dono precisa ser membro ativo da mesma organização com papel agent, manager ou admin.';
    end if;
  end if;

  update public.contacts
     set carteira_user_id = p_dono,
         carteira_origem = case when p_dono is null then null else v_origem end,
         carteira_definida_em = case when p_dono is null then null else now() end,
         updated_at = now()
   where id = p_contact
     and organization_id = p_org;

  if p_dono is not null then
    update public.crm_leads
       set owner_user_id = p_dono,
           owner_kind = 'user',
           assigned_at = coalesce(assigned_at, now())
     where organization_id = p_org
       and contact_id = p_contact
       and status = 'open'
       and owner_user_id is null
       and owner_agent_id is null;
  end if;

  return p_dono;
end;
$$;

comment on function public.fn_mia_definir_dono_do_contato_pela_plataforma(uuid, uuid, uuid, uuid, text) is
  'MIA (9022): o dono do contato (carteira do cliente do upstream, 0622) gravado pelo MCP de plataforma na importacao. O ator e o token de plataforma vivo com importar_base, cujo criador e admin de plataforma de escopo cheio; o resto e o corpo de fn_definir_carteira_do_cliente (dono membro ativo agent/manager/admin da mesma empresa, trio carteira_* e adocao dos negocios abertos sem dono). Execucao so para service_role.';

revoke all on function public.fn_mia_definir_dono_do_contato_pela_plataforma(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fn_mia_definir_dono_do_contato_pela_plataforma(uuid, uuid, uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';

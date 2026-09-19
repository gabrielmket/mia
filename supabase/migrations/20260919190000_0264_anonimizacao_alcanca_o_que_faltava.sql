-- 0264 — a anonimizacao passa a alcancar `custom_fields`, `cargo` e `setor`
--
-- ── O achado, e ele e ANTERIOR a esta serie ────────────────────────────────
--
-- `fn_lgpd_cascade_redact_contact` zerava nome, e-mail, telefone, CPF,
-- nascimento, consentimento, `source_metadata` e tags do contato. NAO zerava
-- `contacts.custom_fields` — o jsonb livre onde o operador guarda exatamente o
-- que a lista fixa de colunas nao previu.
--
-- E o pior formato possivel para sobreviver a uma exclusao: campo livre,
-- preenchido pela operacao, invisivel para quem auditou a lista de colunas.
--
-- E o campo falhava nas DUAS pontas da LGPD ao mesmo tempo. Em
-- `lib/lgpd/export-collector.ts` ele estava no `select` e era DESCARTADO no
-- mapeamento — selecionado por alguem que sabia ser dado pessoal, e perdido
-- antes de chegar ao relatorio. Entao o titular que perguntava "o que voces
-- tem sobre mim" nao via o campo, e o titular que pedia exclusao continuava
-- com ele no banco. Acesso negado por omissao, esquecimento negado por
-- omissao — o mesmo silencio servindo aos dois lados. As duas pontas sao
-- consertadas no mesmo commit.
--
-- Note que `crm_leads.custom_fields` JA era zerado no passo 5 desde sempre. O
-- mesmo campo, na tabela vizinha, com o mesmo risco — o do CONTATO passou
-- despercebido porque a lista do passo 1 cresceu coluna a coluna, e ninguem
-- comparou as duas listas lado a lado.
--
-- ── E os dois campos que esta serie acrescentou ───────────────────────────
--
-- `cargo` e `setor` (0262) sao dado pessoal profissional: dizem o que a pessoa
-- FAZ e onde. Entraram sem passar pela anonimizacao. Mesmo passo, mesmo
-- conserto. `empresa_id` (0255) sai junto pelo motivo escrito no corpo.
--
-- ⚠️ O que NAO muda, e e deliberado:
--
--   · `crm_empresas` continua INTEIRA. A empresa e pessoa juridica e cliente do
--     tenant — nao e titular deste pedido, e apaga-la levaria junto o historico
--     de quem nao pediu nada.
--   · `crm_leads.empresa_id` continua apontando. Ali o vinculo e NEGOCIO↔EMPRESA
--     (com quem foi a venda), nao PESSOA↔EMPRESA; e o mesmo motivo pelo qual o
--     passo 5 preserva funil, etapa e valor.
--
-- ── Como esta migration foi escrita, e por que isso esta no comentario ────
--
-- O corpo abaixo foi RECORTADO do baseline, nao redigitado. A primeira tentativa
-- foi escrita de memoria a partir de trechos lidos — e perdia o
-- `insert into storage_redaction_queue` e o `insert into api_audit_log`. Ou
-- seja: a midia do titular nunca sairia do storage, e a exclusao nao deixaria
-- rastro de auditoria. Uma funcao de LGPD de 180 linhas nao se reescreve de
-- cabeca; recorta-se, e o script que recorta confere a presenca de cada bloco
-- (`fn_service_lock`, os sete `update`, os dois `insert`) antes de gravar.

CREATE OR REPLACE FUNCTION "public"."fn_lgpd_cascade_redact_contact"("p_organization_id" "uuid", "p_contact_id" "uuid", "p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_already bool;
  v_counts jsonb := '{}'::jsonb;
  v_media_paths text[] := '{}';
  v_anon_label text;
  v_count int;
begin
  perform public.fn_service_lock(p_organization_id,p_contact_id);
  select is_anonymized into v_already
    from contacts
    where id = p_contact_id and organization_id = p_organization_id;

  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;

  if v_already then
    return jsonb_build_object('already_anonymized', true, 'counts', v_counts, 'media_paths', v_media_paths);
  end if;

  v_anon_label := 'Cliente Anonimizado #' || substring(p_contact_id::text from 1 for 8);

  -- Collect media storage paths (we only delete what we own — media_storage_path)
  select coalesce(array_agg(distinct media_storage_path) filter (where media_storage_path is not null), '{}')
    into v_media_paths
    from messages
    where organization_id = p_organization_id
      and conversation_id in (
        select id from conversations
          where contact_id = p_contact_id and organization_id = p_organization_id
      );

  -- 1. contacts (irreversible)
  update contacts set
    name = v_anon_label,
    display_name = v_anon_label,
    email = null,
    -- email_normalized NÃO entra: é GENERATED ALWAYS AS (lower(trim(email)))
    -- e o Postgres recusa escrita nela — a linha acima já a zera por derivação.
    -- Com a atribuição, o cascade INTEIRO abortava e nada era anonimizado.
    phone_number = null,
    cpf_encrypted = null,
    cpf_hash = null,
    birthdate = null,
    is_anonymized = true,
    anonymized_at = now(),
    consent = '{}'::jsonb,
    source_metadata = '{}'::jsonb,
    tags = '{}'::text[],
    -- O jsonb LIVRE, onde vai o que a lista fixa de colunas nao previu:
    -- "CPF do responsavel", "endereco da obra", "nome da esposa". Ficava de
    -- fora, e e o campo com MAIOR chance de guardar o dado mais sensivel,
    -- justamente porque ninguem o modelou. A exportacao ja o SELECIONAVA e o
    -- descartava antes do relatorio: o produto sabia que era dado pessoal e
    -- perdia o campo nas duas pontas (ver `lib/lgpd/export-collector.ts`).
    custom_fields = '{}'::jsonb,
    -- Dado pessoal profissional (0262): o que a pessoa faz e onde.
    cargo = null,
    setor = null,
    -- O vinculo e sobre a PESSOA apagada, nao sobre a empresa. Sozinho nao
    -- identifica ninguem, mas um contato anonimizado ligado a uma empresa de
    -- tres pessoas estreita demais o conjunto.
    empresa_id = null,
    updated_at = now()
  where id = p_contact_id and organization_id = p_organization_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('contacts', v_count);

  -- 2. conversations metadata + preview strip
  update conversations set
    metadata = '{}'::jsonb,
    last_message_preview = null,
    updated_at = now()
  where contact_id = p_contact_id and organization_id = p_organization_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('conversations', v_count);

  -- 3. messages: redact body + null media + strip metadata (preserve status/timestamps/conversation_id)
  update messages set
    body = '[mensagem anonimizada]',
    media_url = null,
    media_mime = null,
    media_size_bytes = null,
    media_storage_path = null,
    metadata = '{}'::jsonb,
    updated_at = now()
  where organization_id = p_organization_id
    and conversation_id in (
      select id from conversations
        where contact_id = p_contact_id and organization_id = p_organization_id
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('messages', v_count);

  -- 4. crm_lead_activities — strip payload, metadata E reason (migration 0071).
  --    `reason` é texto livre escrito por LLM sobre a conversa do lead: supor que
  --    nunca conterá um nome é a suposição que falha. `evidence` NÃO é limpa —
  --    guarda só ids, e as linhas apontadas são redigidas por conta própria.
  update crm_lead_activities set
    payload = '{}'::jsonb,
    metadata = '{}'::jsonb,
    reason = null
  where organization_id = p_organization_id
    and (
      contact_id = p_contact_id
      or lead_id in (
        select lead_id from crm_lead_links
          where target_kind = 'contact'
            and target_id = p_contact_id
            and organization_id = p_organization_id
      )
      or lead_id in (
        select id from crm_leads
          where contact_id = p_contact_id and organization_id = p_organization_id
      )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('activities', v_count);

  -- 5. crm_leads — strip title/description/custom_fields/source_metadata/tags but PRESERVE pipeline/stage/value
  update crm_leads set
    title = v_anon_label,
    description = null,
    custom_fields = '{}'::jsonb,
    source_metadata = '{}'::jsonb,
    tags = '{}'::text[],
    updated_at = now()
  where organization_id = p_organization_id
    and (
      contact_id = p_contact_id
      or id in (
        select lead_id from crm_lead_links
          where target_kind = 'contact'
            and target_id = p_contact_id
            and organization_id = p_organization_id
      )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('leads', v_count);

  -- 6. orders — PRESERVE values + status + timestamps. Strip personal fields from payload jsonb
  --    and replace customer_external_id with null (FK-safe; soft de-link). Keep contact_id null.
  update orders set
    payload = (coalesce(payload, '{}'::jsonb))
      - 'customer'
      - 'customer_name'
      - 'customer_email'
      - 'customer_phone'
      - 'shipping_address'
      - 'billing_address'
      - 'contact_identification',
    customer_external_id = null,
    contact_id = null,
    is_anonymized = true,
    updated_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('orders', v_count);

  -- 7. enqueue media for async deletion (idempotent via unique (bucket, object_path))
  if array_length(v_media_paths, 1) > 0 then
    insert into storage_redaction_queue (organization_id, request_id, bucket, object_path)
    select p_organization_id, p_request_id, 'whatsapp-media', path
      from unnest(v_media_paths) as path
      where path is not null and length(path) > 0
    on conflict (bucket, object_path) do nothing;
  end if;

  -- 7b. voice_calls — o TELEFONE de quem falou ao telefone (migration 0235).
  --
  -- `peer_phone` é `not null` e guarda o número da outra ponta: depois de
  -- anonimizar o contato, ele sobrevivia ligado ao `contact_id` e reidentificava
  -- a pessoa que pediu para ser esquecida. É o mesmo argumento que a foto de
  -- perfil já tinha (ver o bloco do avatar em `lib/lgpd/redact-cascade.ts`):
  -- anonimizar em toda parte menos numa é não ter anonimizado.
  --
  -- O que fica: direção, status, motivo do fim, marcas de tempo e duração. Um
  -- registro de "houve uma chamada de 12 minutos" sem número e sem dono não
  -- identifica ninguém e é o que sustenta a métrica do atendente e a fatura.
  -- `peer_phone` é NOT NULL, então recebe o rótulo, não `null`.
  update voice_calls set
    peer_phone = v_anon_label,
    owner_user_id = null,
    created_by = null,
    updated_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('voice_calls', v_count);

  -- 8. dense audit row
  insert into api_audit_log (organization_id, action, actor_user_id, resource_type, resource_id, metadata, bypassed_rls)
  values (
    p_organization_id,
    'lgpd.redact_executed',
    null,
    'contact',
    p_contact_id,
    jsonb_build_object(
      'cascaded_to', v_counts,
      'media_queued', coalesce(array_length(v_media_paths, 1), 0),
      'request_id', p_request_id
    ),
    true
  );

  return jsonb_build_object(
    'already_anonymized', false,
    'counts', v_counts,
    'media_paths', v_media_paths
  );
end;
$$;
revoke all on function public.fn_lgpd_cascade_redact_contact(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.fn_lgpd_cascade_redact_contact(uuid,uuid,uuid) to service_role;

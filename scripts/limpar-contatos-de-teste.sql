-- Limpar DOIS contatos de teste da base inteira, para reteste da Rafa.
--
--   Marcelo  +5531992753860
--   Gabriel  +5531973248187
--
-- Rodar no SQL Editor do Supabase. É IRREVERSÍVEL — não há desfazer.
--
-- ── Por que um bloco DO, e não uma transação com tabela temporária ──────────
--
-- A primeira versão criava uma `temporary table` e as instruções seguintes a
-- consultavam. No SQL Editor do Supabase isso falha com
-- `42P01: relation "alvos" does not exist`: a conexão é do pooler em MODO
-- TRANSAÇÃO, e cada instrução pode cair numa sessão diferente — tabela
-- temporária não sobrevive de uma para a outra.
--
-- Um bloco `DO` é UMA instrução só. Ele roda inteiro na mesma sessão, é atômico
-- por natureza (se qualquer passo falhar, nada é apagado) e não depende de
-- estado entre chamadas.
--
-- ── O QUE ESTE SCRIPT NÃO APAGA: USUÁRIO ───────────────────────────────────
--
-- Ele toca em OITO tabelas, e todas são de ATENDIMENTO: contatos, conversas,
-- cartões do funil, agenda, régua de follow-up, fila e avisos. Nenhuma é
-- `auth.users` nem `users`.
--
-- A confusão é justa, porque nas conversas a mesma pessoa aparece em DOIS
-- papéis: como CONTATO (quem escreveu) e como ATENDENTE
-- (`conversations.assigned_to_user_id`, quem atendeu). Este script remove o
-- primeiro. O segundo é só uma referência, que morre junto com a conversa sem
-- tocar na conta de ninguém.
--
-- Login, permissões e histórico de quem OPERA o sistema ficam intactos.

-- ── A ordem não é estilo: é o que a base exige ──────────────────────────────
--
-- Três tabelas apontam para `contacts` com ON DELETE RESTRICT, ou seja, o banco
-- RECUSA apagar o contato enquanto elas tiverem linha:
--
--   conversations         → RESTRICT
--   messages              → RESTRICT (mas somem por cascata da conversa)
--   calendar_appointments → RESTRICT  ← o Gabriel tem reunião marcada
--
-- Por isso apagamos de dentro para fora.

-- ───────────────────────────── passo 0: ver ────────────────────────────────
-- Rode SÓ este select primeiro e confira que são DOIS contatos, e os certos.

select id, organization_id, display_name, phone_number, created_at
  from public.contacts
 where phone_number in ('+5531992753860', '+5531973248187');

-- ─────────────────────── passo 1: apagar, em ordem ─────────────────────────
-- Selecione do `do $$` até o `$$;` e rode. É uma instrução só.

do $$
declare
  v_contatos uuid[];
  v_conversas uuid[];
begin
  select array_agg(id) into v_contatos
    from public.contacts
   where phone_number in ('+5531992753860', '+5531973248187');

  if v_contatos is null then
    raise notice 'Nenhum contato com esses telefones — nada a fazer.';
    return;
  end if;

  select coalesce(array_agg(id), '{}') into v_conversas
    from public.conversations
   where contact_id = any(v_contatos);

  raise notice 'Apagando % contato(s) e % conversa(s).',
    array_length(v_contatos, 1), coalesce(array_length(v_conversas, 1), 0);

  -- 1. A régua de follow-up. Vai PRIMEIRO porque é o que faria a Rafa
  --    "lembrar": um enrollment vivo retoma a cadência no meio, e o reteste
  --    começaria do passo 4 em vez do começo.
  delete from public.followup_enrollment_events
   where enrollment_id in (
     select id from public.followup_enrollments where conversation_id = any(v_conversas)
   );

  delete from public.followup_enrollments where conversation_id = any(v_conversas);

  -- 2. Trabalho pendente na fila. Sem isto, um job antigo acorda depois do
  --    reteste e responde no meio da conversa nova.
  delete from public.job_queue where contact_id = any(v_contatos);

  -- 3. Avisos da Central que apontam para eles.
  delete from public.agent_inbox_items
   where (ref_kind = 'contact' and ref_id = any(v_contatos))
      or (ref_kind = 'conversation' and ref_id = any(v_conversas));

  -- 4. O cartão do funil. A chave é SET NULL, então sem isto sobraria um card
  --    órfão sem contato — pior que apagar: um lead que ninguém consegue abrir.
  delete from public.crm_leads where contact_id = any(v_contatos);

  -- 5. Agenda. RESTRICT: trava o passo 7 se ficar.
  delete from public.calendar_appointments where contact_id = any(v_contatos);

  -- 6. As conversas. As MENSAGENS somem por CASCATA daqui — não precisa
  --    apagá-las à mão.
  delete from public.conversations where contact_id = any(v_contatos);

  -- 7. Enfim os contatos.
  delete from public.contacts where id = any(v_contatos);

  raise notice 'Pronto.';
end $$;

-- ──────────────────────────── passo 2: conferir ────────────────────────────
-- Tem de voltar VAZIO.

select id, phone_number from public.contacts
 where phone_number in ('+5531992753860', '+5531973248187');

-- ── Se falhar por chave estrangeira ────────────────────────────────────────
--
-- Existe uma tabela apontando para `contacts` ou `conversations` que este
-- roteiro não previu. O bloco DO desfaz tudo sozinho e a base fica intacta.
-- Mande a mensagem de erro: ela nomeia a constraint, e a constraint nomeia a
-- tabela que falta.

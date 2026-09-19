-- 0266 — as três tabelas com `contact_id` que nenhuma anonimização alcançava
--
-- ── Como foram encontradas ────────────────────────────────────────────────
--
-- Cruzando, a partir do baseline, TODA tabela que tem `contact_id` contra TODO
-- caminho que anonimiza (as duas funções, os nove gatilhos pendurados em
-- `is_anonymized`, e o TypeScript de `lib/lgpd/`). Quinze tabelas têm a coluna.
-- Onze eram cobertas. `lgpd_requests` é exceção declarada — é o REGISTRO do
-- pedido, a prova de que o direito foi exercido; apagá-la apagaria o recibo.
--
-- Sobraram três, e as três guardam dado pessoal:
--
-- ── 1 · ai_agent_runs — o rastro da IA ────────────────────────────────────
--
-- `tool_calls` é jsonb e guarda, por passo: até 4.000 caracteres da PROSA do
-- modelo, os `args` de cada ferramenta chamada e o `result` de cada uma. O
-- serializador (`lib/ai/runtime/serialize.ts`) só redige `authorization`,
-- `api_key`, `token`, `password` e `cpf`.
--
-- Ou seja: uma chamada de `crm_propose_contact_field` grava `{campo:"email",
-- valor:"joao@empresa.com"}` literal. Uma de `crm_book_appointment` grava nome e
-- telefone. Uma de `crm_search_contacts` grava a ficha inteira no `result`. Tudo
-- isso sobrevivia à exclusão, e sobrevivia no formato mais difícil de auditar
-- que existe — jsonb aninhado, escrito por máquina, que ninguém abre.
--
-- `error_message` entra junto: mensagem de erro de provedor frequentemente
-- devolve o payload que causou o erro, e o payload é a conversa.
--
-- NÃO entram: `tokens_in`, `tokens_out`, `cost_cents`, `latency_ms`,
-- `steps_count`, `status`. São a medição da operação — quanto custou, quanto
-- demorou, se falhou. Sem dono, não identificam ninguém, e são o que sustenta a
-- fatura e o diagnóstico de qualidade do agente.
--
-- Alcança por `contact_id` E pela conversa: `ai_agent_runs.contact_id` é
-- NULO em parte das linhas (o run nasce antes de o contato ser resolvido) e nelas
-- o vínculo existe só por `conversation_id`. Cobrir uma ponta só deixaria
-- justamente os runs do PRIMEIRO contato — os da mensagem que abriu a conversa.
--
-- ── 2 · demandas — o problema da pessoa, escrito à mão ────────────────────
--
-- `assunto` é o que a pessoa quer resolver e `proximo_passo` é o que o
-- atendente combinou com ela. Texto livre, escrito por humano, sobre uma pessoa
-- identificada.
--
-- É a MESMA classe que a migration 0184 já declarou dado pessoal em
-- `calendar_appointments.notes` ("numa clínica, queixa clínica"). Aqui é ainda
-- mais direto: uma demanda É a queixa.
--
-- Ficam: `estado`, `origem`, `desfecho`, `dono_kind` e as datas — vocabulário
-- fechado e medição de atendimento, que é o que responde "quanto demoramos para
-- resolver" sem dizer de quem era o problema.
--
-- ── 3 · broadcast_recipients — o telefone copiado de propósito ────────────
--
-- Esta tem decisão ESCRITA em contrário, e por isso merece a explicação mais
-- longa. O comentário da coluna diz: "COPIADO do contato de proposito: o contato
-- pode ser anonimizado pela LGPD ou apagado, e o relatorio de um disparo que ja
-- aconteceu nao pode virar lista de linhas sem destinatario."
--
-- O objetivo é legítimo — um relatório de disparo com linhas vazias não presta
-- para conciliar entrega nem cobrança. O meio é que não se sustenta: o telefone
-- É o identificador, e no WhatsApp é também o ENDEREÇO. Mantê-lo depois de um
-- pedido de exclusão significa que a pessoa esquecida continua alcançável, e
-- que a próxima lista montada a partir da tabela a inclui de novo.
--
-- A saída já existe neste mesmo repositório, escrita na 0235 para
-- `voice_calls.peer_phone`, que tem o mesmo `not null` e o mesmo dilema: a
-- coluna recebe o RÓTULO em vez de `null`. A linha continua lá, contável,
-- conciliável, com status, custo e id da Meta — e sem dizer para quem foi.
-- Preserva exatamente o que o comentário queria preservar.
--
-- `valores` também sai: é o que muda por pessoa no template ({"1": "Gabriel"}),
-- quase sempre o primeiro nome.
--
-- ── Por que UM gatilho para as três ───────────────────────────────────────
--
-- As anteriores (agenda, tarefas, captações, propostas) ganharam uma função
-- cada porque nasceram em migrations diferentes, meses distantes. Estas três
-- nascem do mesmo cruzamento, no mesmo instante, com a mesma condição — e uma
-- lista só é uma lista só para auditar. Quem for conferir "o que mais é
-- limpo?" lê um corpo, não três.
--
-- AFTER e não BEFORE: escrevem em OUTRAS tabelas. `before` não teria o que
-- alterar em `new`.

create or replace function public.fn_redigir_o_que_sobrou_do_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rotulo text := 'Contato anonimizado';
begin
  -- 1 · ai_agent_runs — o rastro da IA sobre esta pessoa.
  update public.ai_agent_runs
     set tool_calls    = '[]'::jsonb,
         error_message = null
   where organization_id = new.organization_id
     and (
       contact_id = new.id
       or conversation_id in (
         select id from public.conversations
          where organization_id = new.organization_id
            and contact_id = new.id
       )
     )
     and (tool_calls <> '[]'::jsonb or error_message is not null);

  -- 2 · demandas — o problema dela, escrito à mão.
  update public.demandas
     set assunto       = null,
         proximo_passo = null
   where organization_id = new.organization_id
     and contact_id = new.id
     and (assunto is not null or proximo_passo is not null);

  -- 3 · broadcast_recipients — rótulo, não `null`: a coluna é `not null` e a
  --     linha precisa continuar contável para o relatório do disparo.
  update public.broadcast_recipients
     set phone_e164 = v_rotulo,
         valores    = '{}'::jsonb
   where organization_id = new.organization_id
     and contact_id = new.id
     and (phone_e164 <> v_rotulo or valores <> '{}'::jsonb);

  return new;
end$$;

comment on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() is
  'Redige as tres tabelas com contact_id que nenhum outro caminho de anonimizacao alcancava: ai_agent_runs (tool_calls guarda args, results e a prosa do modelo), demandas (assunto e proximo_passo sao texto livre sobre a pessoa) e broadcast_recipients (o telefone copiado, que no WhatsApp e tambem o endereco).';

-- As DUAS origens de EXECUTE (item 9 do CLAUDE.md).
revoke all on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from public;
revoke execute on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from anon;
revoke execute on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from authenticated;

drop trigger if exists trg_redigir_o_que_sobrou_ao_anonimizar on public.contacts;
create trigger trg_redigir_o_que_sobrou_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized = true and coalesce(old.is_anonymized, false) = false)
  execute function public.fn_redigir_o_que_sobrou_do_contato_anonimizado();

-- ── E quem JÁ foi anonimizado ─────────────────────────────────────────────
--
-- Mesma razão da 0265: o gatilho dispara na TRANSIÇÃO, e para quem exerceu o
-- direito antes desta migration ela já passou. Sem isto, o rastro da IA e o
-- telefone deles ficam no banco para sempre — e são exatamente as pessoas que
-- já pediram para sair.

update public.ai_agent_runs r
   set tool_calls = '[]'::jsonb, error_message = null
  from public.contacts c
 where c.is_anonymized = true
   and c.organization_id = r.organization_id
   and (
     r.contact_id = c.id
     or r.conversation_id in (
       select id from public.conversations
        where organization_id = c.organization_id and contact_id = c.id
     )
   )
   and (r.tool_calls <> '[]'::jsonb or r.error_message is not null);

update public.demandas d
   set assunto = null, proximo_passo = null
  from public.contacts c
 where c.is_anonymized = true
   and c.organization_id = d.organization_id
   and d.contact_id = c.id
   and (d.assunto is not null or d.proximo_passo is not null);

update public.broadcast_recipients b
   set phone_e164 = 'Contato anonimizado', valores = '{}'::jsonb
  from public.contacts c
 where c.is_anonymized = true
   and c.organization_id = b.organization_id
   and b.contact_id = c.id
   and (b.phone_e164 <> 'Contato anonimizado' or b.valores <> '{}'::jsonb);

notify pgrst, 'reload schema';

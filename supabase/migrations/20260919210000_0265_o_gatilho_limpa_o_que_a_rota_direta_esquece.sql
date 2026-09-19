-- 0265 — o gatilho passa a limpar o que a ROTA DIRETA esquece
--
-- ── A correção de rumo da 0264, e a leitura que faltava ───────────────────
--
-- A 0264 acrescentou `custom_fields`, `cargo`, `setor` e `empresa_id` ao
-- `update contacts set` de `fn_lgpd_cascade_redact_contact`. Duas coisas
-- ficaram claras logo depois, lendo os gatilhos:
--
--   1. `custom_fields` JÁ era limpo — por
--      `trg_contacts_anonimizado_limpa_custom_fields`, um gatilho
--      `before update of is_anonymized`. A atribuição da 0264 é redundante
--      (inofensiva: mesma linha, mesmo valor). A ponta REAL do achado era a
--      outra: o campo era pedido ao banco e DESCARTADO antes do relatório do
--      titular, em `lib/lgpd/export-collector.ts`.
--
--   2. `cargo`, `setor` e `empresa_id` continuam vazando — porque
--      HÁ MAIS DE UM CAMINHO QUE ANONIMIZA, e a 0264 consertou um só.
--
-- ── Os dois caminhos, e o que cada um esquece ─────────────────────────────
--
--   fn_lgpd_cascade_redact_contact   o cascade completo (a Central, o cron)
--   fn_lgpd_anonymize_contact        a ROTA DIRETA, chamada por
--                                    `app/api/v1/lgpd/anonymize/route.ts` —
--                                    o botão "Anonimizar contato" da ficha
--
-- A rota direta limpa nome, display_name, e-mail, telefone, CPF (cifrado e
-- hash) e nascimento. E PARA AÍ. Nunca limpou `consent`, `tags` nem
-- `source_metadata` — e `source_metadata` guarda `waha_lid`, de onde saem as
-- colunas geradas `wa_identity` e `wa_lid`: a identidade da pessoa no WhatsApp,
-- intacta depois de um pedido de exclusão atendido pelo botão da tela.
--
-- Não é hipótese: o comentário do gatilho de `custom_fields`, neste mesmo
-- baseline, já registrava isso por escrito ("a rota direta, que faz um UPDATE
-- próprio e nem sequer limpa `consent`/`tags`/`source_metadata`"). O defeito
-- estava DOCUMENTADO e não consertado — só contornado para uma coluna.
--
-- ── Por que GATILHO, e não mais uma linha em cada função ──────────────────
--
-- É o argumento que este repositório já escreveu e que a 0264 deixou de seguir:
-- pendurar no FATO (`is_anonymized` virou true) cobre os dois caminhos, cobre o
-- terceiro que alguém escrever amanhã, e cobre o DBA que fizer à mão numa
-- madrugada. Espalhar a lista por três funções é como o produto chegou aqui:
-- três listas escritas à mão, em arquivos diferentes, sem nada que as obrigue a
-- concordar.
--
-- BEFORE e não AFTER, como o gatilho já era: o alvo é coluna da PRÓPRIA linha.
-- Em `after` seria preciso um segundo UPDATE, com o risco de recursão.
--
-- ── O que NÃO entra, e por quê ────────────────────────────────────────────
--
--   name, display_name   cada caminho escreve o RÓTULO dele ("Cliente
--                        Anonimizado #ab12" no cascade, "Contato Anonimizado
--                        #ab12" na rota). O gatilho sobrescrevendo um rótulo
--                        que o caminho acabou de escolher seria disputa, não
--                        garantia — e nenhum dos dois é PII.
--   is_anonymized        é a própria condição do gatilho.
--   anonymized_at        é a data do exercício do direito: o que RESPONDE ao
--                        prazo legal. Reescrevê-la apagaria a prova.

create or replace function public.fn_contato_anonimizado_limpa_campos_personalizados()
  returns trigger
  language plpgsql
as $$
begin
  -- Anonimização é irreversível (L-04): não há o que preservar aqui.
  --
  -- A lista abaixo é a das colunas de `contacts` declaradas PESSOAIS em
  -- `tests/unit/lgpd-as-duas-pontas.test.ts` e que nenhum caminho de
  -- anonimização limpa de forma confiável. O teste cobra a coerência: coluna
  -- pessoal nova que não apareça aqui (nem nas duas funções) reprova.
  new.custom_fields := '{}'::jsonb;

  -- Dado pessoal profissional (0262): o que a pessoa faz e onde. Numa lista de
  -- cinco contatos da mesma empresa, "Diretor Financeiro" reidentifica sozinho.
  new.cargo := null;
  new.setor := null;

  -- O vínculo é sobre a PESSOA apagada. `crm_empresas` continua INTEIRA: a
  -- empresa é pessoa jurídica e não é titular deste pedido.
  new.empresa_id := null;

  -- ── as três que a ROTA DIRETA nunca limpou ──────────────────────────────
  --
  -- `source_metadata` é a mais grave: dela derivam `wa_identity` e `wa_lid`
  -- (`generated always as`), a identidade da pessoa no WhatsApp. Zerar aqui
  -- mata as duas junto, sem precisar tocá-las — que é exatamente por que elas
  -- foram feitas geradas.
  new.source_metadata := '{}'::jsonb;

  -- Tags são segmentação escrita por humano sobre a pessoa ("gestante",
  -- "inadimplente", "amigo do dono"). O cascade já limpava; a rota, não.
  new.tags := '{}'::text[];

  -- Consentimento diz o que a pessoa autorizou, quando e por onde. É registro
  -- SOBRE ela, e depois da exclusão não há mais a que consentir.
  new.consent := '{}'::jsonb;

  return new;
end$$;

comment on function public.fn_contato_anonimizado_limpa_campos_personalizados() is
  'Limpa as colunas pessoais de contacts que os caminhos de anonimizacao nao cobrem de forma confiavel. Pendurado no FATO (is_anonymized) e nao no chamador: ha mais de um caminho que anonimiza (fn_lgpd_cascade_redact_contact e fn_lgpd_anonymize_contact) e a rota direta nunca limpou consent/tags/source_metadata.';

-- As DUAS origens de EXECUTE (item 9 do CLAUDE.md). Função de gatilho não é
-- alcançável pela REST, mas o `ALTER DEFAULT PRIVILEGES ... TO anon` do baseline
-- vale para toda função criada depois dele, e `revoke from public` não remove um
-- grant nominal a `anon`.
revoke all on function public.fn_contato_anonimizado_limpa_campos_personalizados() from public;
revoke execute on function public.fn_contato_anonimizado_limpa_campos_personalizados() from anon;
revoke execute on function public.fn_contato_anonimizado_limpa_campos_personalizados() from authenticated;

-- O gatilho já existe e continua igual — só a função por trás dele mudou. A
-- recriação é para o clone que ainda não o tinha (o `update.sh` roda o baseline
-- inteiro, e `create or replace function` sozinho não cria gatilho nenhum).
drop trigger if exists trg_contacts_anonimizado_limpa_custom_fields on public.contacts;
create trigger trg_contacts_anonimizado_limpa_custom_fields
  before update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized = true and coalesce(old.is_anonymized, false) = false)
  execute function public.fn_contato_anonimizado_limpa_campos_personalizados();

-- ── E os contatos JÁ anonimizados antes desta migration ───────────────────
--
-- Sem isto, quem exerceu o direito ontem pelo botão da tela continua com o
-- `waha_lid`, as tags e o consentimento no banco para sempre — o gatilho só
-- dispara na TRANSIÇÃO, e para eles ela já passou. É o mesmo raciocínio da
-- varredura que completa cascatas interrompidas: um direito exercido não pode
-- depender de alguém lembrar de reexecutar.
--
-- `is_anonymized` não é tocado, então o gatilho não redispara.
update public.contacts
   set custom_fields   = '{}'::jsonb,
       cargo           = null,
       setor           = null,
       empresa_id      = null,
       source_metadata = '{}'::jsonb,
       tags            = '{}'::text[],
       consent         = '{}'::jsonb
 where is_anonymized = true
   and (
        custom_fields   <> '{}'::jsonb
     or cargo           is not null
     or setor           is not null
     or empresa_id      is not null
     or source_metadata <> '{}'::jsonb
     or tags            <> '{}'::text[]
     or consent         <> '{}'::jsonb
   );

notify pgrst, 'reload schema';

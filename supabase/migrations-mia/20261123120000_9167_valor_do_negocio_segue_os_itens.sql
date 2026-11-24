-- manifest: O VALOR DO NEGÓCIO COM ITEM SEGUE OS ITENS (fusão v1.124; docs/fork/produto-no-negocio.md, seção "As vendas registradas do upstream"). FORK MIA: a 9450 do upstream (`trg_valor_do_negocio_pelas_vendas`) passou a gravar `crm_leads.value_cents` = soma das vendas registradas (9449) a cada venda, guardando o valor anterior em `valor_digitado_cents` e ligando `valor_pelas_vendas`. A nossa 9160 grava a mesma coluna pela rota dos itens (soma dos itens ou valor à mão). Sem esta migration os dois escreveriam por cima um do outro e venceria o último. A regra da fusão é "nada muda para quem já usa itens" (decisão do Gabriel na MIA-127): em negócio com item do bloco (`mia_itens_do_negocio`), o valor continua sendo o nosso e a marca dele fica desligada; sem item, vale o upstream inteiro. Três peças, todas NOSSAS e nenhuma redefinindo objeto dele: (1) gatilho `before update of value_cents, valor_pelas_vendas` em `crm_leads` que, com item do bloco, desfaz a troca pela soma das vendas (o valor volta, a marca desliga), e por isso pega também a auto-cura da 9450 quando o `baseline.sql` é reaplicado; (2) gatilho `after insert` em `mia_itens_do_negocio` que desliga a marca quando o primeiro item entra num negócio que já tinha venda (a rota grava a soma dos itens logo depois); (3) `fn_mia_valor_do_negocio_volta_as_vendas`, chamada pela rota quando o último item sai, que devolve o negócio ao gatilho do upstream (as vendas voltam a mandar). A venda registrada continua contando no painel de vendas dele em qualquer caso. Corrige no ato o negócio que já tenha item e venda marcada. Sem dado pessoal. Idempotente.
--
-- 9167 · o valor do negócio com item segue os itens
--
-- FORK MIA (fusão v1.124). Só objetos NOSSOS (docs/FORK-MIA.md, regra 3): duas
-- funções de gatilho e uma função com nome nosso, dois gatilhos nossos (um em
-- `crm_leads`, do upstream, pendurado ao lado do dele; um na nossa tabela de
-- itens). Do upstream só se LÊ e se escreve nas colunas que a 9450 criou, sem
-- redefinir `fn_valor_do_negocio_pelas_vendas` nem o gatilho dela.
--
-- A INVARIANTE: negócio com item do bloco nunca fica com `valor_pelas_vendas`
-- ligado. As três peças existem para que ela valha por qualquer caminho.

-- (1) A troca pela soma das vendas, desfeita em negócio com item.
--
-- Pega o gatilho da 9450 (venda registrada, alterada ou apagada) e a auto-cura
-- do fim da 9450, que roda de novo toda vez que o `baseline.sql` é reaplicado.
-- Só age quando a escrita LIGA (ou mantém ligada) a marca das vendas: qualquer
-- outra escrita do valor (rota dos itens, formulário, MCP) passa intacta.
create or replace function public.fn_mia_valor_do_negocio_segue_os_itens()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.valor_pelas_vendas is true
     and exists (select 1 from public.mia_itens_do_negocio i where i.lead_id = new.id) then
    -- Marca desligada antes: o valor de antes é o nosso. Marca já ligada (negócio
    -- de antes desta migration): o nosso está guardado no digitado.
    new.value_cents := case
      when old.valor_pelas_vendas is true then coalesce(old.valor_digitado_cents, old.value_cents)
      else old.value_cents
    end;
    new.valor_pelas_vendas := false;
    new.valor_digitado_cents := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_mia_valor_do_negocio_segue_os_itens() from public, anon, authenticated;

drop trigger if exists trg_mia_valor_do_negocio_segue_os_itens on public.crm_leads;
create trigger trg_mia_valor_do_negocio_segue_os_itens
  before update of value_cents, valor_pelas_vendas on public.crm_leads
  for each row execute function public.fn_mia_valor_do_negocio_segue_os_itens();

-- (2) O primeiro item num negócio que já tinha venda: a marca desliga.
--
-- A rota dos itens grava os itens ANTES do valor; quando ela grava o valor (a
-- soma dos itens ou o digitado), a marca já está desligada e o gatilho (1) não
-- tem o que desfazer.
create or replace function public.fn_mia_item_do_negocio_tira_a_marca_das_vendas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.crm_leads
     set valor_pelas_vendas = false,
         valor_digitado_cents = null
   where id = new.lead_id
     and organization_id = new.organization_id
     and valor_pelas_vendas is true;
  return null;
end;
$$;

revoke execute on function public.fn_mia_item_do_negocio_tira_a_marca_das_vendas() from public, anon, authenticated;

drop trigger if exists trg_mia_item_do_negocio_tira_a_marca_das_vendas on public.mia_itens_do_negocio;
create trigger trg_mia_item_do_negocio_tira_a_marca_das_vendas
  after insert on public.mia_itens_do_negocio
  for each row execute function public.fn_mia_item_do_negocio_tira_a_marca_das_vendas();

-- (3) O último item saiu: as vendas voltam a mandar.
--
-- Chamada pela rota dos itens DEPOIS de gravar o valor (lib/produto-no-negocio/
-- servidor.ts). Num gatilho de `delete` ela rodaria antes da gravação do valor
-- e a rota escreveria por cima. Sem venda, ou ainda com item, não faz nada. Com
-- venda, regrava as vendas do negócio com o mesmo valor: é o gatilho do upstream
-- (9450) quem soma, guarda o digitado e liga a marca, do jeito dele.
create or replace function public.fn_mia_valor_do_negocio_volta_as_vendas(p_org uuid, p_lead uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.mia_itens_do_negocio i where i.organization_id = p_org and i.lead_id = p_lead) then
    return;
  end if;
  update public.vendas_registradas v
     set valor_cents = v.valor_cents
   where v.organization_id = p_org
     and v.lead_id = p_lead;
end;
$$;

revoke execute on function public.fn_mia_valor_do_negocio_volta_as_vendas(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_mia_valor_do_negocio_volta_as_vendas(uuid, uuid) to service_role;

-- A cura: negócio que já tem item e ficou marcado pelas vendas volta ao nosso
-- valor (guardado no digitado). O gatilho (1) não age nesta escrita, porque ela
-- desliga a marca. Rodar de novo não casa nada.
update public.crm_leads l
   set value_cents = coalesce(l.valor_digitado_cents, l.value_cents),
       valor_pelas_vendas = false,
       valor_digitado_cents = null
 where l.valor_pelas_vendas is true
   and exists (select 1 from public.mia_itens_do_negocio i where i.lead_id = l.id);

notify pgrst, 'reload schema';

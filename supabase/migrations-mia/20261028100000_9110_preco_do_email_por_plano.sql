-- manifest: O PREÇO DO E-MAIL POR PLANO (.95, pedido do Gabriel em 27/10/2026: "o valor do disparo de WhatsApp e do e-mail é diferente"). `mia_plano_modulos` (9070, tabela NOSSA ao lado de `cobranca_planos`) ganha `preco_por_email_cents`, o preço de cada e-mail de marketing aceito pela Amazon para quem está no plano, ao lado do preço por mensagem do Broadcast. Chega à empresa pelo MESMO caminho do preço da mensagem, perguntado na hora e nunca copiado: o preço definido à mão para a empresa (`tenant_broadcast_pricing.preco_por_email_cents`, 9060) vence; sem ele, o do plano ATUAL da assinatura (o `plano_id`, que o upstream só troca quando a troca vale), só com a cobrança ligada e só para empresa com assinatura (a isenta não tem plano); sem nenhum dos dois, o padrão de R$ 0,02 do código. Nulo no plano = o plano não diz (vale o padrão). A trava de 9070 cresce junto: mudar o preço por e-mail de um plano que alguém assina (atual, agendado ou troca pendente) é recusado no banco (`plano_com_assinantes`), como o preço por mensagem: arquiva e cria outro. Só a função NOSSA da trava é redefinida; nenhum objeto do upstream é tocado. Desenho em docs/fork/jornada-de-assinatura.md.
--
-- 9110 · o preço do e-mail por plano
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `add column if
-- not exists`, a constraint dentro de um `do` que confere antes, `comment on` e
-- `create or replace` da função nossa da 9070.

-- ── 1. a coluna ao lado do preço por mensagem ───────────────────────────────
alter table public.mia_plano_modulos
  add column if not exists preco_por_email_cents integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'mia_plano_modulos_preco_email'
       and conrelid = 'public.mia_plano_modulos'::regclass
  ) then
    alter table public.mia_plano_modulos
      add constraint mia_plano_modulos_preco_email
      check (preco_por_email_cents is null or preco_por_email_cents between 0 and 100000);
  end if;
end $$;

comment on column public.mia_plano_modulos.preco_por_email_cents is
  'MIA (9110): o preco de cada e-mail de marketing aceito pela Amazon para quem esta no plano, em centavos. Nulo = o plano nao diz: vale o padrao de R$ 0,02 do codigo. O preco definido a mao para a empresa (tenant_broadcast_pricing.preco_por_email_cents) vence o do plano. Nao muda em plano assinado.';

comment on table public.mia_plano_modulos is
  'MIA (9070, 9110): o que cada plano de cobranca_planos liga alem dos limites do upstream: os modulos vendaveis, o preco por mensagem do Broadcast, o preco por e-mail de marketing e o texto do cartao da pagina de precos. Tabela AO LADO: cobranca_planos e do upstream e nao muda. So o servidor le e escreve.';

-- ── 2. a trava de 9070 leva o preço por e-mail ──────────────────────────────
-- Mesmo motivo de o upstream travar o preço do plano assinado: não mudar o que
-- alguém comprou sem ele pedir. LIGAR um módulo num plano sempre pode (vale na
-- hora para as empresas dele). Os dois preços travam como o preço do plano.
create or replace function public.fn_mia_plano_modulos_trava_assinantes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plano uuid := coalesce(old.plano_id, new.plano_id);
  v_tira boolean;
begin
  if tg_op = 'DELETE' then
    v_tira := cardinality(old.modulos) > 0
              or old.preco_por_mensagem_cents is not null
              or old.preco_por_email_cents is not null;
  else
    v_tira := not (old.modulos <@ new.modulos)
              or new.preco_por_mensagem_cents is distinct from old.preco_por_mensagem_cents
              or new.preco_por_email_cents is distinct from old.preco_por_email_cents
              or new.plano_id is distinct from old.plano_id;
  end if;
  if v_tira and exists (
    select 1 from public.cobranca_assinaturas a
     where a.plano_id = v_plano or a.plano_agendado_id = v_plano or a.plano_troca_pendente_id = v_plano
  ) then
    raise exception 'plano_com_assinantes'
      using errcode = '23514',
            hint = 'Este plano tem assinantes: os modulos so crescem e os precos por mensagem e por e-mail nao mudam. Arquive o plano e crie outro.';
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function public.fn_mia_plano_modulos_trava_assinantes() from public, anon, authenticated;

comment on function public.fn_mia_plano_modulos_trava_assinantes() is
  'MIA (9070, 9110): recusa (plano_com_assinantes, 23514) tirar modulo, mudar o preco por mensagem ou o preco por e-mail, ou apagar a linha de um plano que alguem assina (atual, agendado ou troca pendente). Acrescentar modulo pode.';

notify pgrst, 'reload schema';

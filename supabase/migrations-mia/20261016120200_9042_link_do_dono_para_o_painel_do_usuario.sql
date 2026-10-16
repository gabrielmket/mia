-- manifest: O PAINEL DO USUÁRIO VIRA LINK PARA O DONO (item 9, protótipo aprovado em 15/10/2026, tela 5: "Gerar link para o dono"), pelo molde da 9031. A tabela NOSSA `mia_paineis_links` ganha `painel_id` (o painel montado no montador, `mia_paineis_usuario`, por chave estrangeira composta da MESMA empresa; apagar o painel apaga o link dele, e a página pública passa a responder "não está disponível"). O link é de UM tipo: os prontos escolhidos (`paineis`, como na 9031) OU um painel do usuário (`painel_id`, com `paineis` vazio). A regra dos painéis (`mia_paineis_links_paineis`) é trocada, com o MESMO nome, pela que aceita os dois tipos; a troca só acontece se a regra ainda for a da 9031 (confere a definição no catálogo), então reaplicar o baseline não volta atrás nem recusa os links de painel. Token, hash, validade, revogação, contador e auditoria são os da 9031, sem mudança. O que a página pública mostra do painel (só números somados; relatório que agrupa ou filtra por pessoa da equipe fica de fora) mora em `lib/relatorios/link.ts`. Nenhum objeto do upstream é redefinido. Provado em tests/invariants/montador-de-relatorios.test.ts.
--
-- 9042 · o link do dono para o painel do usuário
--
-- `mia`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `add
-- column if not exists`, as constraints dentro de `do` que conferem o catálogo.

alter table public.mia_paineis_links
  add column if not exists painel_id uuid;

comment on column public.mia_paineis_links.painel_id is
  'MIA (9042): o painel do usuario (mia_paineis_usuario) que o link mostra. Nulo: o link mostra os prontos de paineis (9031). Apagar o painel apaga o link.';

do $$
declare
  v_def text;
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_links_painel_da_empresa') then
    alter table public.mia_paineis_links
      add constraint mia_paineis_links_painel_da_empresa
      foreign key (organization_id, painel_id)
      references public.mia_paineis_usuario (organization_id, id)
      on delete cascade;
  end if;

  -- A regra dos painéis, com o MESMO nome: ou os prontos (como na 9031), ou o
  -- painel do usuário com a lista vazia. Só troca a da 9031 (a que não fala de
  -- `painel_id`): o bloco da 9031 no baseline confere o NOME antes de criar, e
  -- com o nome mantido ele não recria a regra antiga por cima desta.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conname = 'mia_paineis_links_paineis'
     and c.conrelid = 'public.mia_paineis_links'::regclass;
  if v_def is null or v_def not like '%painel_id%' then
    if v_def is not null then
      alter table public.mia_paineis_links drop constraint mia_paineis_links_paineis;
    end if;
    alter table public.mia_paineis_links
      add constraint mia_paineis_links_paineis
      check (
        (painel_id is null
         and cardinality(paineis) between 1 and 12
         and paineis <@ array['resultado', 'meta', 'funil', 'origem', 'perdas', 'atendimento',
                              'resposta', 'agenda', 'followup', 'anuncios', 'previsao', 'assuntos']::text[]
         and public.fn_mia_lista_sem_repeticao(paineis))
        or (painel_id is not null and cardinality(paineis) = 0)
      );
  end if;
end $$;

create index if not exists mia_paineis_links_painel_idx
  on public.mia_paineis_links (painel_id) where painel_id is not null;

notify pgrst, 'reload schema';

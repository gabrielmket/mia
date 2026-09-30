-- 9009 · desconectar a conta própria da Meta solta as Páginas que a empresa assumiu
--
-- ── O que muda desde a 9008 ─────────────────────────────────────────────────
--
-- Na 9008 a empresa com conexão própria de Meta Ads (Configurações › Meta Ads,
-- `ad_insights_connections`) passou a assumir Páginas (origem `conta_propria`).
-- Mas desconectar a conta só apagava a conexão: as Páginas continuavam em nome
-- dela e os formulários, "ativos". Sem o token próprio, a leitura
-- (lib/leads-da-meta/paginas.ts) ou falhava por falta de acesso, ou seguia
-- pelo token da PLATAFORMA, quando ele também alcança a Página: uma Página que
-- a empresa escolheu pela conta dela passava a ser lida por uma conexão que ela
-- não escolheu. E nenhuma outra empresa podia assumir a Página, que tinha dono.
--
-- A decisão do Gabriel: "solta a página, o usuário pode conectar e
-- desconectar". Desconectar solta TODAS as Páginas que a empresa assumiu, com
-- o mesmo efeito de desmarcar uma por uma (`fn_mia_soltar_pagina_da_meta`, da
-- 9008): os formulários ativos dela ali desligam com o motivo `pagina_solta`,
-- o aviso de falha deles zera e o dono sai. Reconectar e marcar de novo volta
-- a importar, como no desmarcar.
--
-- A Página atribuída pela PLATAFORMA (origem `plataforma`) NÃO é solta: ela
-- não dependia da conexão da empresa (a plataforma lê pela conexão dela), e
-- quem a atribuiu é quem decide soltar.
--
-- ── Por que no banco (gatilho), e não na rota ───────────────────────────────
--
-- A tela desconecta com um DELETE em `ad_insights_connections`
-- (app/actions/settings/updateAdInsightsConnection.ts), mas a linha também
-- some por outros caminhos (apagar a empresa, a mão no banco, uma rota futura).
-- Um gatilho AFTER DELETE vale para todos, na mesma transação do DELETE: ou a
-- conexão sai e as Páginas são soltas, ou nada acontece.
--
-- Guardas:
--   · só a conexão de Meta Ads (`platform = 'meta_ads'`) solta Página;
--   · se ainda houver outra conexão de Meta Ads da mesma empresa, nada é solto
--     (o índice único `(organization_id, platform)` da 0214 não deixa existir
--     hoje; a guarda é para não depender dele);
--   · a soltura é a função da 9008, chamada Página por Página: o motivo, o que
--     zera e o que fica são UM código só, e não uma cópia que envelhece.
--
-- Nomes com prefixo `mia_`/`fn_mia_`, gatilho NOSSO numa tabela do upstream:
-- estender, nunca redefinir (docs/FORK-MIA.md, regra 3). Nada da 9004/9008 nem
-- da 0214 é tocado.

create or replace function public.fn_mia_soltar_paginas_ao_desconectar_a_meta()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_pagina text;
begin
  if old.platform is distinct from 'meta_ads' then
    return null;
  end if;

  -- Ainda conectada por outra linha: a empresa segue alcançando as Páginas.
  if exists (
    select 1
      from public.ad_insights_connections c
     where c.organization_id = old.organization_id
       and c.platform = 'meta_ads'
  ) then
    return null;
  end if;

  for v_pagina in
    select p.page_id
      from public.mia_paginas_da_meta p
     where p.organization_id = old.organization_id
       and p.origem = 'conta_propria'
     order by p.page_id
  loop
    perform public.fn_mia_soltar_pagina_da_meta(old.organization_id, v_pagina);
  end loop;

  return null;
end
$f$;

comment on function public.fn_mia_soltar_paginas_ao_desconectar_a_meta() is
  'MIA (9009): ao apagar a conexao propria de Meta Ads da empresa (desconectar), solta as Paginas que ela assumiu (origem conta_propria) com fn_mia_soltar_pagina_da_meta: formularios desligados com o motivo pagina_solta e dono apagado. Pagina atribuida pela plataforma fica.';

revoke all on function public.fn_mia_soltar_paginas_ao_desconectar_a_meta() from public;
revoke execute on function public.fn_mia_soltar_paginas_ao_desconectar_a_meta() from anon, authenticated;

drop trigger if exists trg_mia_soltar_paginas_ao_desconectar_a_meta on public.ad_insights_connections;
create trigger trg_mia_soltar_paginas_ao_desconectar_a_meta
  after delete
  on public.ad_insights_connections
  for each row
  when (old.platform = 'meta_ads')
  execute function public.fn_mia_soltar_paginas_ao_desconectar_a_meta();

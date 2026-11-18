-- manifest: A NOSSA `organization_modules` (0245, os módulos VENDÁVEIS contratados, com `revoked_at`) vira `mia_modulos_contratados`, porque a v1.118 do upstream (9416, #4065) criou uma `organization_modules` DELE com outro formato e outro sentido (módulo opcional por empresa, `estado`). Com o mesmo nome, quem nascesse primeiro ficava com ele: no servidor no ar a dele não nasceria e os módulos opcionais sumiriam do menu de todas as empresas; numa instalação nova o baseline-mia quebraria. Só renomeia o NOSSO formato (coluna `revoked_at`), tabela, chave, FKs, índices e a policy, sem apagar nem copiar linha; rodar de novo não faz nada. Roda ANTES do `baseline.sql` (trecho marcado no bloco da 0245 do baseline-mia, recortado pelo `easypanel/bootstrap.sh` e pelo `scripts/ensaio-de-banco.sh`), para a 9416 criar a dela byte a byte. Nenhum objeto do upstream é tocado (MIA-73, decisão na MIA-74).
--
-- 9163 · a nossa `organization_modules` sai do caminho da dele
--
-- FORK MIA. O texto executável mora no bloco da 0245 do `baseline-mia.sql`,
-- entre os marcadores `>>> ANTES DO BASELINE DO UPSTREAM (migration 9163)` e
-- `<<< ...`, porque precisa rodar antes do `baseline.sql` do upstream (o
-- `easypanel/bootstrap.sh` o aplica primeiro). Este arquivo é o registro.
--
-- Depois dele, o resto do bloco da 0245 (policy, grants e comentários) já fala
-- de `mia_modulos_contratados`, e a `organization_modules` é só a do upstream.

do $$
declare
  v_nome text;
begin
  if exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'organization_modules' and column_name = 'revoked_at'
     ) and to_regclass('public.mia_modulos_contratados') is null then
    alter table public.organization_modules rename to mia_modulos_contratados;

    -- Chave e FKs: o nome da chave é também um índice, e a 9416 cria um
    -- `organization_modules_pkey` dela.
    for v_nome in
      select conname from pg_constraint
       where conrelid = 'public.mia_modulos_contratados'::regclass and conname like 'organization\_modules\_%'
    loop
      execute format('alter table public.mia_modulos_contratados rename constraint %I to %I',
                     v_nome, 'mia_modulos_contratados_' || substr(v_nome, length('organization_modules_') + 1));
    end loop;

    if to_regclass('public.uq_organization_modules_vivo') is not null then
      alter index public.uq_organization_modules_vivo rename to uq_mia_modulos_contratados_vivo;
    end if;
    if to_regclass('public.idx_organization_modules_org') is not null then
      alter index public.idx_organization_modules_org rename to idx_mia_modulos_contratados_org;
    end if;

    if exists (select 1 from pg_policies
                where schemaname = 'public' and tablename = 'mia_modulos_contratados'
                  and policyname = 'organization_modules_select') then
      alter policy organization_modules_select on public.mia_modulos_contratados
        rename to mia_modulos_contratados_select;
    end if;

    -- Só existe aqui se o `baseline.sql` rodou antes deste passo (o caminho de
    -- reserva): o gatilho é DELE e vai com a tabela dele.
    if exists (select 1 from pg_trigger
                where tgrelid = 'public.mia_modulos_contratados'::regclass
                  and tgname = 'trg_organization_modules_touch' and not tgisinternal) then
      drop trigger trg_organization_modules_touch on public.mia_modulos_contratados;
      raise warning 'MIA 9163: a organization_modules do upstream (9416) nasce na proxima aplicacao do baseline.sql; o passo "antes do baseline" nao rodou antes dele';
    end if;

    raise notice 'MIA 9163: organization_modules (a nossa, 0245) agora e mia_modulos_contratados, % linha(s)',
      (select count(*) from public.mia_modulos_contratados);
  end if;
end $$;

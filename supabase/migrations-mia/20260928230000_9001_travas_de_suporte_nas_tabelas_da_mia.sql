-- 9001 — as tabelas da MIA entram nas travas do modo somente leitura do suporte
--
-- ── O defeito ────────────────────────────────────────────────────────────────
--
-- O upstream planta as restritivas `support_write_{insert,update,delete}` por
-- `public.fn_aplicar_travas_de_suporte()` (migration 0274 dele), chamada no ÚLTIMO
-- bloco do baseline.sql, depois de toda tabela DELE. As nossas nascem depois, no
-- baseline-mia.sql, e numa instalação nova ficavam sem trava nenhuma:
-- `broadcasts`, `crm_empresas` e `sales_targets` aceitavam escrita de um operador
-- em suporte SOMENTE LEITURA. Numa atualização a segunda passada do baseline.sql
-- as alcançava, e por isso o buraco só apareceu quando o gate de banco passou a
-- aplicar o baseline-mia.sql (28/09/2026):
-- tests/invariants/travas-de-suporte-cobrem-toda-tabela-na-instalacao.test.ts.
--
-- ── A outra metade: escrita que a policy não dá não se concede ───────────────
--
-- Carteira, preço, módulos e destinatários do disparo têm policy só de LEITURA
-- para `authenticated` (quem grava é a plataforma, pelo service_role). Os blocos
-- delas faziam `revoke all ... from anon` + `grant select ... to authenticated`,
-- mas o default ACL do Supabase dá ALL a toda tabela nova: `authenticated`
-- continuava com insert/update/delete. A RLS barrava a escrita, então não havia
-- vazamento; havia um contrato mentindo, e a função de travas lê o PRIVILÉGIO
-- para decidir se a tabela é gravável pela sessão.
--
-- Chamar a função DELE, e não copiar o laço: a regra de seleção é dele e continua
-- dele (docs/FORK-MIA.md, regra 3). Idempotente.

revoke all on public.tenant_wallet_ledger from anon, authenticated;
grant select on public.tenant_wallet_ledger to authenticated;

revoke all on public.tenant_broadcast_pricing from anon, authenticated;
grant select on public.tenant_broadcast_pricing to authenticated;

revoke all on public.organization_modules from anon, authenticated;
grant select on public.organization_modules to authenticated;

revoke all on public.broadcast_recipients from anon, authenticated;
grant select on public.broadcast_recipients to authenticated;

do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

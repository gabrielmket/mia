-- ─── 9006 · o estado do backup, sem dado sensível, para a saúde ────────────
--
-- FORK MIA (.62). O banco de produção (supabase-sistema-mia) tem backup diário
-- às 06:00 UTC, e cada rodada grava uma linha em `operacao.backup`
-- (infra/supabase-sistema-mia/backup/fazer-backup.sh; o envio ao Google Drive
-- é marcado em `enviado_em` depois de conferido pelo `rclone cryptcheck`).
-- Até aqui, ninguém era avisado se o backup falhasse ou parasse: o único sinal
-- era o healthcheck do contêiner no painel do EasyPanel, que ninguém abre.
--
-- `/api/v1/health` passa a responder `backup.em_dia`, e o vigia da plataforma
-- avisa os administradores. Os dois leem por ESTA função, e não pela tabela:
--
--  - o schema `operacao` NÃO é do app. É criado pelo serviço de backup, como
--    `supabase_admin`, fica fora do dump do app, da API e das migrations — e o
--    papel do app não tem USAGE nele. Abrir a tabela ao `service_role` daria a
--    quem tem a chave do servidor o `detalhe` de cada falha (texto de erro do
--    pg_dump e do rclone, que carrega nome de tabela e caminho);
--  - a função devolve SÓ três campos: a situação (código), quando ficou pronta
--    a última cópia completa e quando ela foi enviada ao Drive. Nada de
--    `detalhe`, `pasta`, contagens ou tamanhos.
--
-- ⚠️ A FUNÇÃO RODA COM O DONO (security definer), e o dono é quem aplica este
-- arquivo — no deploy, o `postgres`, que NÃO é superusuário nesta imagem do
-- Supabase. Medido num contêiner descartável da MESMA imagem de produção
-- (supabase/postgres:17.6.1.084, 30/09/2026): o `postgres` é membro de
-- `pg_read_all_data`, e por isso lê `operacao.backup` sem grant nenhum. Numa
-- instalação em que ele não seja (outra imagem, papel mexido), a função responde
-- `sem_permissao` e a saúde diz `desconhecido` com esse motivo — visível, e
-- nunca um erro que derrube a rota. O remédio, como `supabase_admin`, uma vez:
--
--     grant usage on schema operacao to postgres;
--     grant select (ok, terminado_em, enviado_em) on operacao.backup to postgres;
--
-- As situações:
--   ok             há cópia completa (ok = true); as datas vêm preenchidas
--   sem_copia      a tabela existe e nunca houve cópia completa
--   sem_tabela     o schema ou a tabela não existem (ambiente de teste, ou o
--                  serviço de backup nunca rodou neste banco)
--   sem_permissao  existem, e o dono desta função não pode lê-los (acima)
--
-- Por que o catálogo primeiro: `pg_class`/`pg_namespace` respondem sem
-- permissão nenhuma, e é o que separa "não existe" de "existe e não posso ler".
-- O `execute` dinâmico é de propósito: com SQL estático o plpgsql resolveria a
-- tabela ao preparar o plano, e a mensagem de erro dependeria de quando a
-- função foi chamada pela primeira vez.
--
-- `stable` para o PostgREST aceitar GET (/rest/v1/rpc/...), o mesmo verbo das
-- outras leituras da saúde. Execução só para `service_role`, que é o papel da
-- chave com que `/api/v1/health` e o cron conversam com o banco.
create or replace function public.fn_mia_estado_do_backup()
returns table (situacao text, ultima_copia_em timestamptz, enviada_em timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $f$
begin
  if not exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'operacao'
       and c.relname = 'backup'
  ) then
    return query select 'sem_tabela'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  begin
    return query execute
      'select ''ok''::text, b.terminado_em, b.enviado_em
         from operacao.backup b
        where b.ok is true
          and b.terminado_em is not null
        order by b.terminado_em desc
        limit 1';
    if not found then
      return query select 'sem_copia'::text, null::timestamptz, null::timestamptz;
    end if;
  exception
    when insufficient_privilege then
      return query select 'sem_permissao'::text, null::timestamptz, null::timestamptz;
    when undefined_table or undefined_column or invalid_schema_name then
      return query select 'sem_tabela'::text, null::timestamptz, null::timestamptz;
  end;
end;
$f$;

comment on function public.fn_mia_estado_do_backup() is
  'MIA (9006): o estado do backup diario para /api/v1/health e o vigia da plataforma, sem dado sensivel: situacao (ok, sem_copia, sem_tabela, sem_permissao), quando ficou pronta a ultima copia completa de operacao.backup e quando ela foi enviada ao Drive. Security definer porque o schema operacao nao e do app: o dono le pela pertenca a pg_read_all_data (imagem do Supabase); sem ela, responde sem_permissao ate supabase_admin conceder USAGE em operacao e SELECT (ok, terminado_em, enviado_em) em operacao.backup. Execucao so para service_role.';

revoke all on function public.fn_mia_estado_do_backup() from public;
revoke execute on function public.fn_mia_estado_do_backup() from anon, authenticated;
grant execute on function public.fn_mia_estado_do_backup() to service_role;

-- 0269 — o carimbo passa a contar os erros, não só a chegada
--
-- ── O que a 0268 provava, e o que ela NÃO provava ─────────────────────────
--
-- O carimbo é gravado perto do fim de `supabase/baseline.sql`. Se ele está lá
-- com a migration certa, o arquivo foi lido até o fim.
--
-- Só que num banco existente o `psql` roda SEM `ON_ERROR_STOP`: um comando que
-- falha vira uma linha de ERROR no log e a execução CONTINUA. Ou seja, o
-- carimbo provava "o baseline chegou ao fim" — e não "cada comando passou".
--
-- Na prática: a migration nova podia ter falhado, o baseline seguir até o fim,
-- o carimbo ser gravado com o nome dela, e a saúde responder `em_dia: true`
-- sobre um banco que não tem o que o carimbo diz ter.
--
-- É a mesma armadilha que a 0268 veio consertar, um degrau acima: um sinal que
-- responde "sim" com confiança sobre um estado que não verificou desliga a
-- pergunta em vez de deixá-la aberta.
--
-- ── Quem já sabia a resposta ──────────────────────────────────────────────
--
-- `easypanel/bootstrap.sh` JÁ calcula isso, e há tempo:
--
--     inesperados="$(grep -iE 'ERROR|FATAL' /tmp/baseline.log | grep -viE "$BENIGNOS")"
--
-- (`BENIGNOS` são os "already exists" e afins, que num re-aplique são esperados
-- e corretos.) O valor existia, era impresso como `AVISO:` e morria ali — no
-- stdout de um contêiner efêmero, com a agregação de logs desligada (E4).
--
-- Esta migration só dá a ele um lugar onde ficar.
--
-- ── Por que a AMOSTRA, e por que ela é curta ──────────────────────────────
--
-- Um contador sozinho responde "deu errado" e não "o quê". Quem for diagnosticar
-- sem acesso ao contêiner precisa da primeira linha do erro para saber se foi
-- coluna que faltou, permissão, ou sintaxe. Três linhas bastam para isso e não
-- viram um despejo de log dentro do banco.
--
-- ⚠️ A amostra NUNCA sai na resposta pública da saúde — só com `?verbose=1`
-- autenticado, junto com o nome da migration. Mensagem de erro de Postgres
-- carrega nome de tabela, de coluna e às vezes o valor que violou a constraint.

alter table public.schema_baseline
  -- Quantos erros NÃO benignos o `psql` cuspiu ao aplicar o baseline.
  -- `0` = passou limpo. Default 0 e não null: uma linha carimbada por uma
  -- versão anterior desta migration não pode parecer "nunca conferida" e
  -- derrubar a saúde de uma instalação correta no primeiro deploy.
  add column if not exists erros_inesperados integer not null default 0,
  -- As primeiras linhas, para o diagnóstico começar em algum lugar.
  add column if not exists erros_amostra text;

comment on column public.schema_baseline.erros_inesperados is
  'Erros NAO benignos ao aplicar o baseline (o bootstrap ja filtra "already exists" e afins). 0 = passou limpo. Num banco existente o psql roda sem ON_ERROR_STOP: o baseline chega ao fim e carimba mesmo tendo falhado no meio, e sem esta coluna a saude responderia em_dia:true sobre um banco que nao tem o que o carimbo diz ter.';

comment on column public.schema_baseline.erros_amostra is
  'Primeiras linhas do erro, para diagnosticar sem acesso ao conteiner. NUNCA sai na resposta publica da saude: mensagem de erro de Postgres carrega nome de tabela, de coluna e as vezes o valor que violou a constraint.';

insert into public.schema_baseline (id, migration_mais_nova, aplicado_em)
values (1, '20260920050000_0269_o_carimbo_conta_os_erros', now())
on conflict (id) do update
  set migration_mais_nova = excluded.migration_mais_nova,
      aplicado_em = now();

notify pgrst, 'reload schema';

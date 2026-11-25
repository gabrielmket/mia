-- manifest: A TRAVA DE ROBÔ ganha o sinal D, o ritmo de máquina (MIA-210; docs/fork/trava-de-robo.md). FORK MIA (MIA-210): o robô que varia o texto, responde curto e devagar (uns 15 s) passava por baixo dos sinais A, B e C e do teto de 30 respostas em 60 min; a marca que sobra é o relógio, porque ele responde sempre com o mesmo atraso e gente varia. Um giro de ritmo é a última resposta da IA seguida da primeira recebida em TEXTO com corpo, sem a equipe no meio; a trava dispara quando os últimos `ritmo_giros` giros seguidos cabem na janela de 15 min, cada latência fica até `ritmo_latencia_maxima_segundos` e a maior menos a menor fica até `ritmo_variacao_segundos`. A ação é a do TETO (pausa só a conversa, não perde negócio, não encerra), com `motivo = 'teto'` e o sinal `ritmo` em `sinais`: nenhuma CHECK da 9154 muda. Quatro colunas novas em `mia_trava_de_robo_config` (a 9153), com os padrões do código (`lib/trava-de-robo/config.ts`) e as faixas em CHECKs nomeadas: `ritmo_ligado` (padrão TRUE; desliga só este sinal, `ligada` continua desligando tudo), `ritmo_giros` 6 (4 a 30), `ritmo_latencia_maxima_segundos` 60 (10 a 300) e `ritmo_variacao_segundos` 8 (2 a 60). Só aditiva; a linha que já existe ganha o padrão. RLS e grants da 9153 valem como estão. Nenhum objeto do upstream é tocado. Idempotente.
--
-- 9171 · o ritmo de máquina na trava de robô
--
-- FORK MIA (MIA-210). Só objeto NOSSO (docs/FORK-MIA.md, regra 3): colunas
-- novas na tabela da 9153 e as CHECKs delas dentro de `do` que confere o
-- catálogo, no padrão da 9153. Nenhuma função criada, nenhuma CHECK mudada.

alter table public.mia_trava_de_robo_config
  -- O sinal D (ritmo de máquina). Desliga só ele: o laço e o teto continuam.
  add column if not exists ritmo_ligado                    boolean not null default true,
  -- Quantos giros SEGUIDOS no mesmo ritmo disparam.
  add column if not exists ritmo_giros                     integer not null default 6,
  -- Cada giro, o outro lado respondeu em até estes segundos...
  add column if not exists ritmo_latencia_maxima_segundos  integer not null default 60,
  -- ...e a maior latência menos a menor fica até aqui.
  add column if not exists ritmo_variacao_segundos         integer not null default 8;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_trava_de_robo_config_ritmo_giros') then
    alter table public.mia_trava_de_robo_config add constraint mia_trava_de_robo_config_ritmo_giros
      check (ritmo_giros between 4 and 30);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_trava_de_robo_config_ritmo_latencia') then
    alter table public.mia_trava_de_robo_config add constraint mia_trava_de_robo_config_ritmo_latencia
      check (ritmo_latencia_maxima_segundos between 10 and 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_trava_de_robo_config_ritmo_variacao') then
    alter table public.mia_trava_de_robo_config add constraint mia_trava_de_robo_config_ritmo_variacao
      check (ritmo_variacao_segundos between 2 and 60);
  end if;
end $$;

comment on column public.mia_trava_de_robo_config.ritmo_ligado is
  'MIA (9171): liga o sinal D, o ritmo de maquina (padrao true). Desliga so ele: o laco com robo e o teto continuam valendo. ligada false desliga os tres.';
comment on column public.mia_trava_de_robo_config.ritmo_giros is
  'MIA (9171): quantos giros seguidos (a ultima resposta da IA e a primeira recebida em texto depois dela, sem a equipe no meio) no mesmo ritmo disparam. Dispara como o teto: pausa so a conversa.';
comment on column public.mia_trava_de_robo_config.ritmo_latencia_maxima_segundos is
  'MIA (9171): em cada giro do ritmo, o outro lado respondeu em ate estes segundos. Acima disto o giro quebra a sequencia.';
comment on column public.mia_trava_de_robo_config.ritmo_variacao_segundos is
  'MIA (9171): a maior latencia menos a menor, nos giros do ritmo, fica ate aqui. Gente varia mais que isto.';

notify pgrst, 'reload schema';

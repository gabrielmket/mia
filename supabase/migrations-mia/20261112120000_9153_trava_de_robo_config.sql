-- manifest: A TRAVA DE ROBÔ, a configuração por empresa (.108; docs/fork/trava-de-robo.md). FORK MIA (.108): uma empresa recebia no WhatsApp as mensagens do ROBÔ de outra, e a IA respondia a cada ~30 s por 80 minutos (uns 150 turnos gastando token): `ehRespostaDeRobo` (issue 3106 do upstream) só impedia o menu de abrir passagem para humano. A trava fica no começo do turno de mensagem e age em dois casos, sem chamar o modelo: o laço com outro robô (3 mensagens automáticas em 15 min, cada uma depois de uma resposta da IA; a IA cala para o contato, os negócios abertos viram perdidos e a conversa é encerrada) e o teto de respostas (30 turnos da IA na conversa em 60 min; a IA pausa só ali). `mia_trava_de_robo_config` guarda, por empresa, a chave (`ligada`, padrão TRUE: a proteção é o comportamento de fábrica) e os limites; empresa SEM linha usa o padrão, e o padrão está no código (`lib/trava-de-robo/config.ts`), igual às CHECKs daqui. Sem tela: quem ajusta é a Time, pelo MCP (`plataforma_configurar_trava_de_robo`). RLS igual às tabelas vizinhas do fork (as da conversão da Meta, 9017): gerente lê a própria empresa, o administrador de plataforma lê todas, só o servidor escreve (sem grant de escrita para authenticated). Nenhum objeto do upstream é tocado. Idempotente.
--
-- 9153 · a configuração da trava de robô
--
-- FORK MIA (.108). Só objetos NOSSOS (docs/FORK-MIA.md, regra 3): uma tabela
-- nova, constraints dela dentro de `do` que confere o catálogo, o gatilho de
-- `updated_at` com a função de sempre do upstream (`fn_set_updated_at`, só
-- CHAMADA). Nenhuma função criada.

create table if not exists public.mia_trava_de_robo_config (
  organization_id                    uuid primary key references public.organizations(id) on delete cascade,
  -- A chave das DUAS proteções (o laço com robô e o teto de respostas).
  ligada                             boolean not null default true,
  -- A janela em que os giros do laço são contados.
  janela_minutos                     integer not null default 15,
  -- Quantos giros (mensagem de robô depois de uma resposta da IA) disparam a trava.
  mensagens_para_disparar            integer not null default 3,
  -- O sinal B (repetição) olha para trás até aqui...
  repeticao_janela_minutos           integer not null default 120,
  -- ...e conta a partir da (repeticoes_anteriores + 1)-ésima vez do mesmo texto.
  repeticoes_anteriores              integer not null default 2,
  -- O sinal C (velocidade): texto deste tamanho para cima...
  velocidade_minimo_de_caracteres    integer not null default 80,
  -- ...chegando a mais disto, em caracteres por segundo, depois de uma mensagem nossa.
  velocidade_caracteres_por_segundo  integer not null default 15,
  -- O teto: respostas (turnos) da IA na mesma conversa nesta janela.
  teto_respostas                     integer not null default 30,
  teto_janela_minutos                integer not null default 60,
  updated_by_user_id                 uuid references auth.users(id) on delete set null,
  created_at                         timestamptz not null default now(),
  updated_at                         timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_trava_de_robo_config_janela') then
    alter table public.mia_trava_de_robo_config add constraint mia_trava_de_robo_config_janela
      check (janela_minutos between 1 and 240);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_trava_de_robo_config_mensagens') then
    alter table public.mia_trava_de_robo_config add constraint mia_trava_de_robo_config_mensagens
      check (mensagens_para_disparar between 2 and 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_trava_de_robo_config_repeticao_janela') then
    alter table public.mia_trava_de_robo_config add constraint mia_trava_de_robo_config_repeticao_janela
      check (repeticao_janela_minutos between 10 and 1440);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_trava_de_robo_config_repeticoes') then
    alter table public.mia_trava_de_robo_config add constraint mia_trava_de_robo_config_repeticoes
      check (repeticoes_anteriores between 1 and 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_trava_de_robo_config_velocidade_caracteres') then
    alter table public.mia_trava_de_robo_config add constraint mia_trava_de_robo_config_velocidade_caracteres
      check (velocidade_minimo_de_caracteres between 20 and 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_trava_de_robo_config_velocidade_por_segundo') then
    alter table public.mia_trava_de_robo_config add constraint mia_trava_de_robo_config_velocidade_por_segundo
      check (velocidade_caracteres_por_segundo between 3 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_trava_de_robo_config_teto') then
    alter table public.mia_trava_de_robo_config add constraint mia_trava_de_robo_config_teto
      check (teto_respostas between 5 and 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_trava_de_robo_config_teto_janela') then
    alter table public.mia_trava_de_robo_config add constraint mia_trava_de_robo_config_teto_janela
      check (teto_janela_minutos between 5 and 1440);
  end if;
end $$;

comment on table public.mia_trava_de_robo_config is
  'MIA (9153): a trava de robo por empresa (docs/fork/trava-de-robo.md). ligada (padrao true) liga as duas protecoes: o laco com outro robo (mensagens_para_disparar mensagens automaticas em janela_minutos, cada uma depois de uma resposta da IA) e o teto (teto_respostas turnos da IA na conversa em teto_janela_minutos). Empresa sem linha usa o padrao do codigo (lib/trava-de-robo/config.ts). Sem tela: ajustada pelo MCP de plataforma. Gerente le a propria empresa; so o servidor escreve.';

drop trigger if exists trg_mia_trava_de_robo_config_touch on public.mia_trava_de_robo_config;
create trigger trg_mia_trava_de_robo_config_touch
  before update on public.mia_trava_de_robo_config
  for each row execute function public.fn_set_updated_at();

-- ── RLS: gerente lê a própria empresa; só o servidor escreve ────────────────
alter table public.mia_trava_de_robo_config enable row level security;

drop policy if exists mia_trava_de_robo_config_select on public.mia_trava_de_robo_config;
create policy mia_trava_de_robo_config_select on public.mia_trava_de_robo_config
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- O default ACL do Supabase dá ALL a anon e authenticated em toda tabela nova;
-- o `grant select` sozinho não o desfaz (lição da 9001).
revoke all on public.mia_trava_de_robo_config from public, anon, authenticated;
grant select on public.mia_trava_de_robo_config to authenticated;
grant select, insert, update, delete on public.mia_trava_de_robo_config to service_role;

notify pgrst, 'reload schema';

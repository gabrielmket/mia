-- 0257 — cadastro incorporado: a conta que chega pelo login do cliente
--
-- Hoje conectar o número oficial é um trabalho de duas pessoas ao telefone: o
-- cliente abre o painel da Meta, acha o WABA ID, acha o phone number ID, gera
-- um token e cola tudo na nossa tela. Funciona, e é a razão de a implantação
-- levar meia hora com alguém do nosso lado junto.
--
-- O cadastro incorporado inverte: o cliente clica, entra com o Facebook dele,
-- escolhe a conta, e a Meta nos AVISA. Nada é digitado.
--
-- ── As duas portas continuam existindo, de propósito ───────────────────────
--
-- Decisão do Gabriel: manual e incorporado lado a lado na mesma tela. O
-- incorporado depende da análise do app na Meta e da conta do cliente estar em
-- ordem; quando ele trava — e vai travar em algum cliente —, a porta manual é o
-- que evita "volto semana que vem". Tirar a manual transformaria uma dependência
-- externa em parada de implantação.
--
-- ── Por que a chegada vira LINHA antes de virar canal ──────────────────────
--
-- O aviso da Meta chega por webhook, assíncrono, e NÃO diz para qual cliente
-- nosso ele é: o link é da instalação, não do tenant. Se o webhook tentasse
-- adivinhar o dono, erraria no dia em que dois clientes onboardassem na mesma
-- tarde — e amarrar o número errado ao tenant errado é o pior desfecho possível
-- desta feature, porque a conversa de um cliente sai pelo número de outro.
--
-- Então a chegada é GUARDADA como fato ("esta WABA se conectou ao nosso app,
-- nesta hora, com estes números") e a amarração é um ato humano, no painel. É
-- o mesmo princípio do resto do repositório: cai-se para trás quando falta
-- informação, nunca se inventa a que falta.

create table if not exists public.meta_onboardings (
  id uuid primary key default gen_random_uuid(),
  -- O identificador da conta do WhatsApp Business do cliente. É a chave natural
  -- do que chegou: a Meta pode reenviar o mesmo evento, e reenvio não pode
  -- virar duas linhas para o operador escolher qual é a boa.
  waba_id text not null,
  business_name text,
  phone_number_id text,
  phone_number text,
  /**
   * O evento CRU, como veio.
   *
   * A Meta muda o formato destes avisos sem aviso, e o que hoje é ruído pode
   * ser o único lugar onde está o dado que faltou. Guardar o payload inteiro é
   * o que permite consertar depois sem pedir ao cliente que refaça o cadastro.
   */
  payload jsonb not null default '{}'::jsonb,
  -- Nulo enquanto ninguém amarrou. É esta coluna que separa "chegou" de
  -- "está no ar": a tela do painel lista justamente as de organização nula.
  organization_id uuid references public.organizations(id) on delete set null,
  channel_session_id uuid references public.channel_sessions(id) on delete set null,
  bound_at timestamptz,
  bound_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.meta_onboardings is
  'O que chegou pelo cadastro incorporado da Meta, antes de alguem amarrar a um cliente. O webhook NAO adivinha o dono: o link e da instalacao, e dois clientes podem entrar na mesma tarde. Amarrar e ato humano no /admin.';

-- Reenvio da Meta atualiza a linha, não cria outra.
create unique index if not exists uq_meta_onboardings_waba
  on public.meta_onboardings (waba_id);

-- "O que chegou e ninguém amarrou" é a única pergunta que a tela faz.
create index if not exists idx_meta_onboardings_pendentes
  on public.meta_onboardings (created_at desc)
  where organization_id is null;

alter table public.meta_onboardings enable row level security;

-- ZERO POLICIES: quem escreve é o webhook (service role) e quem lê é o painel
-- da plataforma, pela rota. Nenhum tenant tem o que fazer aqui — a linha ainda
-- não é de ninguém, e essa é justamente a informação que ela carrega.
revoke all on public.meta_onboardings from anon, authenticated;
grant select, insert, update on public.meta_onboardings to service_role;

-- ── O link do cadastro incorporado ─────────────────────────────────────────
--
-- Gerado uma vez no painel da Meta ("Cadastro incorporado hospedado pela Meta")
-- e colado aqui. É da INSTALAÇÃO, como a marca e o modelo de IA — por isso
-- linha única, e não uma cópia por cliente.

create table if not exists public.platform_meta (
  id                    smallint primary key default 1,
  embedded_signup_url   text,
  updated_at            timestamptz not null default now(),
  updated_by            uuid,
  constraint platform_meta_singleton check (id = 1)
);

comment on table public.platform_meta is
  'Configuracao da INSTALACAO para o canal oficial da Meta — hoje so o link do cadastro incorporado. Linha unica id=1, no mesmo formato de platform_branding e platform_ia. Sem link, a tela do cliente mostra so a porta manual: ausencia esconde a porta, nunca mostra uma porta quebrada.';

alter table public.platform_meta enable row level security;

-- ZERO POLICIES pelo mesmo motivo das irmãs. O link em si NÃO é segredo (ele
-- vai para o cliente), mas quem o DEFINE é quem opera a plataforma.
revoke all on public.platform_meta from anon, authenticated;
grant select, insert, update on public.platform_meta to service_role;

notify pgrst, 'reload schema';

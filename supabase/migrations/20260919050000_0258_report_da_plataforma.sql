-- 0258 — o report da plataforma: o grupo que recebe o que é NOSSO
--
-- O número de avisos (migration 0254) fala com o grupo de cada CLIENTE quando a
-- IA passa o bastão. Este é o outro lado do mesmo número: o grupo interno, onde
-- quem opera a plataforma precisa saber que o crédito de IA está acabando, que
-- um número caiu, que a fila travou.
--
-- ── Por que não basta a Central ────────────────────────────────────────────
--
-- A Central (`agent_inbox_items`) é por ORGANIZAÇÃO e serve a quem está com a
-- tela aberta. Estes avisos são da INSTALAÇÃO e chegam de madrugada, no fim de
-- semana, no meio de uma implantação — e quem precisa vê-los está no WhatsApp,
-- não no painel. Um crédito que acaba às 2h de sábado derruba TODOS os clientes
-- até alguém abrir o navegador por acaso.
--
-- ── A trava anti-ruído é a razão da segunda tabela ─────────────────────────
--
-- Um grupo que recebe aviso demais é ignorado em uma semana, e aí o aviso que
-- importa chega junto com o lixo. Este repositório já mediu esse defeito duas
-- vezes: alertas que nunca se fechavam e avisos fantasma que sobreviviam à
-- condição que os criou.
--
-- `platform_avisos_enviados` guarda "este aviso, com esta chave, saiu nesta
-- hora". Quem for avisar pergunta antes se já avisou hoje. A chave é do AVISO,
-- não do momento: `saldo_baixo` sai uma vez por dia enquanto o saldo continuar
-- baixo, e não a cada rodada do cron — que é de minuto em minuto.

create table if not exists public.platform_avisos (
  id                    smallint primary key default 1,
  -- O grupo interno, no mesmo formato de `organizations.settings.grupo_de_avisos`:
  -- id do WhatsApp mais o nome NA HORA em que foi escolhido, para a tela poder
  -- dizer qual é mesmo com o canal fora do ar.
  grupo_id              text,
  grupo_nome            text,
  -- Abaixo disto, avisa. Em dólares, como o resto do saldo do provedor.
  limite_saldo_usd      numeric(12,2) not null default 20,
  -- Liga/desliga o resumo diário sem precisar apagar o grupo.
  resumo_diario         boolean not null default true,
  updated_at            timestamptz not null default now(),
  updated_by            uuid,
  constraint platform_avisos_singleton check (id = 1),
  constraint platform_avisos_grupo_par check ((grupo_id is null) = (grupo_nome is null))
);

comment on table public.platform_avisos is
  'O grupo INTERNO que recebe o que e da plataforma: credito de IA acabando, numero caido, fila travada, resumo diario. Linha unica id=1, no formato de platform_branding/platform_ia/platform_meta. Sem grupo escolhido, nada e enviado — ausencia cala, nunca manda para o lugar errado.';

create table if not exists public.platform_avisos_enviados (
  -- A chave do AVISO, não do momento: `saldo_baixo`, `canal_caiu:<sessao>`,
  -- `resumo_diario`. É ela que faz o mesmo problema render um recado por dia em
  -- vez de um por rodada de cron.
  chave       text primary key,
  enviado_em  timestamptz not null default now(),
  detalhe     jsonb not null default '{}'::jsonb
);

comment on table public.platform_avisos_enviados is
  'Trava anti-ruido do report da plataforma: quando cada aviso saiu pela ultima vez. Grupo que recebe demais e ignorado em uma semana, e ai o aviso que importa chega junto com o lixo.';

alter table public.platform_avisos enable row level security;
alter table public.platform_avisos_enviados enable row level security;

-- ZERO POLICIES nas duas, como as irmãs: quem escreve é o cron (service role) e
-- quem lê é o painel, pela rota. Nenhum tenant tem o que fazer aqui.
revoke all on public.platform_avisos from anon, authenticated;
revoke all on public.platform_avisos_enviados from anon, authenticated;
grant select, insert, update on public.platform_avisos to service_role;
grant select, insert, update, delete on public.platform_avisos_enviados to service_role;

notify pgrst, 'reload schema';

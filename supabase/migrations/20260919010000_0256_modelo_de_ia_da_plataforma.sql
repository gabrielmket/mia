-- 0256 — o MODELO de IA é escolha da plataforma, não do cliente
--
-- Mesma doutrina da chave de IA (`lib/ai/custo-e-da-plataforma.ts`): quem
-- comprou atendimento comprou um agente que funciona, não a tarefa de comparar
-- `gpt-4.1` com `claude-sonnet` e descobrir sozinho qual deles chama ferramenta
-- direito. A escolha do cérebro é engrenagem nossa — e é nossa também a conta.
--
-- ── O que isso conserta ────────────────────────────────────────────────────
--
-- Hoje o modelo é resolvido por organização, na primeira publicação, por
-- `escolherModeloDoProvedor`: pega o marcado como padrão do provedor e, quando
-- não há nenhum (a OpenRouter chega com 400 modelos e nenhum padrão), escolhe
-- automaticamente entre os que suportam ferramentas. A regra é boa como
-- ÚLTIMO recurso e péssima como política: cada cliente novo pode cair num
-- modelo diferente conforme o catálogo do dia, e ninguém decidiu nada.
--
-- ── Tabela de linha única, como `platform_branding` ────────────────────────
--
-- É configuração da INSTALAÇÃO, não do tenant, então não cabe em
-- `organizations.settings` — lá dentro ela seria uma cópia por cliente, que é
-- justamente o que se quer acabar. Segue a forma que o repositório já usa para
-- essa categoria: `id smallint primary key default 1` com CHECK de singleton.
--
-- ── Sem policy, de propósito ──────────────────────────────────────────────
--
-- Igual a `platform_branding`: RLS ligada e NENHUMA policy, com grant só para
-- `service_role`. Quem lê é o servidor; a tela do cliente não precisa saber
-- qual é o cérebro, e a do admin passa pela rota, que exige platform admin.

create table if not exists public.platform_ia (
  id          smallint primary key default 1,
  -- Nulos = "ninguém decidiu ainda", e nesse caso vale a escolha automática de
  -- antes. AUSÊNCIA faz cair para trás; nunca uma escolha errada.
  provider    text,
  model_id    text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint platform_ia_singleton check (id = 1),
  -- Os dois juntos ou nenhum: um `model_id` sem provedor não endereça nada, e
  -- um provedor sem modelo faria a publicação voltar à escolha automática sem
  -- dizer por quê.
  constraint platform_ia_par_completo check ((provider is null) = (model_id is null))
);

comment on table public.platform_ia is
  'O modelo de IA padrao da INSTALACAO (linha unica id=1). Quem escolhe e quem opera a plataforma, no /admin — o cliente nao ve e nao troca, mesma doutrina da chave de IA. Nulo = ninguem decidiu, e ai vale a escolha automatica de escolherModeloDoProvedor. Lida/escrita so server-side (service_role).';

alter table public.platform_ia enable row level security;

-- ZERO POLICIES, DE PROPÓSITO — ver o comentário acima.

revoke all on public.platform_ia from anon, authenticated;
grant select, insert, update on public.platform_ia to service_role;

notify pgrst, 'reload schema';

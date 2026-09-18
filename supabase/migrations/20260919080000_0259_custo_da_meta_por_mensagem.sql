-- 0259 — o que cada mensagem da Meta custou, e de quem é a conta
--
-- A Meta manda, em TODO status de entrega, um objeto `pricing`. Ele chega ao
-- nosso webhook e é descartado desde sempre. O que se perde com isso é a única
-- resposta confiável para "quanto este cliente gastou em mensagem este mês" —
-- e é essa pergunta que decide preço, margem e se o plano fecha.
--
-- ── O que o `pricing` REALMENTE traz (e o que ele não traz) ────────────────
--
-- Traz: `billable` (esta mensagem é cobrada?), `category` (marketing, utility,
-- authentication, service) e `pricing_model`. NÃO traz valor em dinheiro — a
-- Meta cobra por tabela, que varia por país e categoria.
--
-- Isso decide o desenho: a mensagem guarda o FATO (foi cobrada, desta
-- categoria), e o preço vem de uma tabela nossa. Gravar um valor calculado na
-- linha da mensagem seria congelar o preço do dia no histórico — e no dia em
-- que a Meta reajustar, todo relatório do passado mudaria de ideia ou mentiria,
-- dependendo de qual dos dois erros se escolhesse.
--
-- ── Por que colunas em `messages`, e não uma tabela de eventos ─────────────
--
-- Já existe uma linha por mensagem, e é nela que o status de entrega já é
-- carimbado por este mesmo caminho. Uma tabela paralela duplicaria a chave
-- (`external_id`), exigiria um join em toda pergunta de custo e abriria a
-- possibilidade de as duas discordarem sobre quantas mensagens saíram.

alter table public.messages
  add column if not exists meta_pricing_category text,
  add column if not exists meta_billable boolean;

comment on column public.messages.meta_pricing_category is
  'A categoria que a META cobrou (marketing, utility, authentication, service), como veio no `pricing` do status de entrega. NAO e o que pedimos: e o que ela decidiu cobrar — os dois divergem, e e a decisao dela que vira fatura.';

comment on column public.messages.meta_billable is
  'Se a Meta cobrou por esta mensagem. Ha mensagem gratuita (janela de servico, ponto de entrada de anuncio) e conta-la como paga inflaria o custo do cliente.';

-- "Quanto este cliente gastou em mensagem no mês" é a única pergunta que estas
-- colunas existem para responder, e ela filtra por organização, período e
-- categoria. Parcial: a esmagadora maioria das linhas de `messages` é conversa
-- de canal por QR, que não tem preço nenhum.
create index if not exists idx_messages_custo_meta
  on public.messages (organization_id, created_at, meta_pricing_category)
  where meta_billable is true;

-- ── A tabela de preços ─────────────────────────────────────────────────────
--
-- Da PLATAFORMA e não do cliente: quem negocia com a Meta e conhece a tabela
-- vigente é quem opera. E é o mesmo motivo do modelo de IA — o cliente comprou
-- atendimento, não uma planilha de tarifa por categoria.

create table if not exists public.platform_precos_meta (
  categoria text primary key,
  -- Centavos de REAL. A Meta publica em dólar, mas quem paga a fatura do cliente
  -- decide em real — e converter na hora de mostrar faria o mesmo mês valer
  -- dois números conforme o dia em que alguém abrisse o relatório.
  centavos_brl integer not null check (centavos_brl >= 0),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);

comment on table public.platform_precos_meta is
  'Quanto custa cada categoria de mensagem da Meta, em centavos de REAL. A Meta nao manda valor no webhook — so a categoria —, entao o dinheiro sai daqui. Vazia = o relatorio mostra a CONTAGEM e diz que o preco nao foi informado, nunca zero (que se leria como "de graca").';

alter table public.platform_precos_meta enable row level security;

-- ZERO POLICIES, como as outras de plataforma: quem lê é o servidor e quem
-- escreve é o painel, pela rota.
revoke all on public.platform_precos_meta from anon, authenticated;
grant select, insert, update, delete on public.platform_precos_meta to service_role;

notify pgrst, 'reload schema';

-- 0254 — o número que avisa o TIME, e o grupo de cada cliente
--
-- O aviso de "lead qualificado, passa o bastão" precisa cair no grupo de
-- WhatsApp onde o time comercial do cliente já trabalha. A ação que envia
-- (`notify_group`) existe desde a série do disparador; o que faltava era de
-- ONDE ela sai e PARA ONDE vai, sem exigir configuração por cliente.
--
-- ── Por que o número é da PLATAFORMA, e não do cliente ──────────────────────
--
-- Decisão do Gabriel em 18/09: um número só, conectado uma vez por quem opera,
-- adicionado aos grupos de todos os clientes. Exigir um número por cliente
-- transformaria cada implantação numa conexão a mais — e é encanamento nosso,
-- não escolha de quem comprou atendimento. Mesma doutrina da chave de IA em
-- `lib/ai/custo-e-da-plataforma.ts`.
--
-- ⚠️ E isso tem um custo que precisa ficar escrito: um número servindo todos os
-- clientes é PONTO ÚNICO DE FALHA. Se ele cair ou for bloqueado, NENHUM cliente
-- recebe aviso — enquanto com número por cliente a queda de um não afeta os
-- outros. A troca é consciente (implantação mais simples) e cobra uma
-- contrapartida: quem opera precisa ser avisado quando esse número cai, em vez
-- de descobrir pelo cliente reclamando que parou de receber.
--
-- ── Por que uma COLUNA e não uma tabela nova ────────────────────────────────
--
-- O número de avisos é uma sessão de canal como qualquer outra: conecta por QR,
-- tem status, tem saúde, aparece na lista. O que muda é o PAPEL. Uma tabela
-- própria duplicaria conexão, reconexão e monitoramento — e o primeiro defeito
-- seria o número de avisos caindo sem ninguém ver, porque o vigia olha a outra
-- tabela.
--
-- Índice único PARCIAL: só UMA sessão pode ser a de avisos na instalação
-- inteira. Sem a trava, marcar a segunda deixaria duas, e qual delas envia
-- viraria sorteio do `order by`.

alter table public.channel_sessions
  add column if not exists e_numero_de_avisos boolean not null default false;

comment on column public.channel_sessions.e_numero_de_avisos is
  'Esta sessao e o NUMERO DA PLATAFORMA que avisa os grupos dos clientes (passagem de bastao). Uma so na instalacao inteira — ver o indice unico parcial. ATENCAO: ela CONTINUA aparecendo em Conexoes da organizacao que a conectou, e e assim de proposito — e por ali que se le o QR, se reconecta e se ve a saude. O que falta, e esta anotado no backlog (G-block), e tira-la do seletor de atendimento para que ninguem amarre um agente nela por engano.';

create unique index if not exists uq_channel_sessions_numero_de_avisos
  on public.channel_sessions ((true))
  where e_numero_de_avisos;

notify pgrst, 'reload schema';

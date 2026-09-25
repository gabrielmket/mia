-- 0267 — quem responde legalmente pela INSTALAÇÃO (item E7 do backlog)
--
-- ── O defeito ─────────────────────────────────────────────────────────────
--
-- `/legal/privacy` diz, em letras grandes: "O controlador dos dados tratados
-- aqui é <X> — quem instalou e opera este sistema."
--
-- E `<X>` vem de `lib/legal/operador.ts`, que lê a ORGANIZAÇÃO ATIVA DA SESSÃO.
--
-- Num self-host isso está certo e é o desenho original: uma instalação, um
-- operador, e a organização é ele. No modelo GERENCIADO — uma instalação da
-- Time Company com Academia Reativa, Body Fit e Ultra Sorriso dentro — abrir a
-- página com a Reativa selecionada faz o documento declarar que a Academia
-- Reativa instalou e opera o servidor, e que ela é a controladora dos dados de
-- TODOS os tenants. Não é impreciso: é falso, num documento jurídico público,
-- sobre uma empresa que não pode cumprir o que ele promete em nome dela.
--
-- E o texto TROCA DE NOME conforme quem está logado. O mesmo documento, na
-- mesma URL, no mesmo instante, nomeia controladores diferentes para leitores
-- diferentes — que é o oposto do que uma política de privacidade é.
--
-- ── É a MESMA família de defeito que esta série já achou duas vezes ───────
--
-- A suposição "uma instalação = um operador" também produziu o custo de IA
-- atribuído ao tenant errado e a chave de IA única. Aqui ela reaparece no lugar
-- mais caro: o documento que diz quem responde.
--
-- ── O desenho ─────────────────────────────────────────────────────────────
--
-- Estas colunas vão em `platform_branding` porque é a tabela da INSTALAÇÃO —
-- singleton `id = 1`, RLS ligada, zero policies, lida e escrita só por
-- `service_role`. A identidade legal de quem opera é exatamente do mesmo nível
-- da marca: anterior a qualquer organização, igual para todos os tenants.
--
-- ⚠️ `operador_razao_social` NULA é o que mantém o self-host intacto. Ela é o
-- INTERRUPTOR entre os dois modos:
--
--   nula        self-host: o operador continua saindo da organização da
--               sessão, como sempre foi. Quem instalou de graça numa VPS não
--               precisa preencher nada, e nada muda para ele.
--   preenchida  gerenciado: ESTE é o operador, para todo leitor, com sessão ou
--               sem. A organização da sessão deixa de ter voz no documento.
--
-- Interruptor implícito e não uma coluna `modo text check (...)`: um modo
-- explícito pode ficar em 'gerenciado' com a razão social vazia, e aí a página
-- diria "o controlador é " e pararia. Aqui o estado impossível não existe —
-- quem declara o operador É o operador.

alter table public.platform_branding
  -- A razão social, não o nome fantasia: é o documento legal que a nomeia.
  add column if not exists operador_razao_social text,
  add column if not exists operador_cnpj text,
  -- Encarregado (DPO) da PLATAFORMA. Continua havendo o do tenant
  -- (`organizations.dpo_email`), e eles respondem por coisas diferentes: o do
  -- tenant atende os contatos DELE, o daqui atende quem usa a instalação.
  add column if not exists operador_dpo_email text,
  -- A política publicada pelo operador. Quando existe, `/legal/privacy`
  -- redireciona para ela em vez de renderizar o texto do produto.
  add column if not exists operador_politica_url text;

comment on column public.platform_branding.operador_razao_social is
  'Razao social de quem opera ESTA instalacao. NULA = self-host, e ai o operador sai da organizacao da sessao (desenho original). PREENCHIDA = modelo gerenciado, e ai ela vale para todo leitor: a organizacao da sessao deixa de ter voz no documento legal. E o interruptor entre os dois modos.';

comment on column public.platform_branding.operador_dpo_email is
  'Encarregado (DPO) da PLATAFORMA. Nao substitui organizations.dpo_email: aquele atende os contatos DO TENANT, este atende quem usa a instalacao.';

comment on column public.platform_branding.operador_politica_url is
  'Politica de privacidade publicada pelo operador da instalacao. Quando presente, /legal/privacy redireciona para ela. Validada na SAIDA por urlDePoliticaSegura (http/https apenas) — o schema do formulario aceita javascript: e a rota e publica.';

notify pgrst, 'reload schema';

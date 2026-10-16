-- manifest: O CONSERTO QUE O UPSTREAM v1.84 FEZ NA AGENDA DO GOOGLE (0668, `calendar_connections.catalog_retry_at`), LEVADO AO OUTLOOK (.82). A leitura da lista de agendas de uma conta Microsoft (`atualizarCatalogoMicrosoft`, cron `agenda-microsoft-sync`, que roda a cada minuto) que falha (429, 5xx ou 403 da Graph) nao grava `catalogo_conferido_em` (so o sucesso grava), entao o tick seguinte tentava de novo: 60 chamadas por hora a Graph por conta com defeito, e cinco contas assim ocupavam as cinco vagas de catalogo de cada rodada, e as outras nunca eram relidas. Coluna NOVA na tabela NOSSA `mia_agenda_microsoft_conexoes`: `catalogo_tentar_apos` (timestamptz, nula). O cron grava "nao tente antes de" (agora + 15 min, o mesmo recuo da leitura de agenda que falha) e pula a conta enquanto o prazo nao vence; NULL ou passado = pode tentar. So o servidor le e escreve (a tabela ja e fechada a anon e authenticated desde a 9011). Nenhum objeto do upstream e tocado. Provado em tests/unit/agenda-microsoft-catalogo-recua.test.ts.

-- 9044 · o catálogo do Outlook que falha espera 15 minutos
--
-- O upstream (0668, #2866) passou o cron da agenda do Google para 1 minuto e,
-- junto, deu recuo à leitura do catálogo que falha: sem ele, a falha virava 60
-- tentativas e 60 auditorias por hora. O cron do Outlook (9011) já roda a cada
-- minuto e tinha o mesmo buraco: só o sucesso marca o catálogo como conferido.
--
-- A coluna é da CONEXÃO, como a do upstream (`calendar_connections`): é a lista
-- de agendas da conta que falhou, e não uma agenda dela.

alter table public.mia_agenda_microsoft_conexoes
  add column if not exists catalogo_tentar_apos timestamptz;

comment on column public.mia_agenda_microsoft_conexoes.catalogo_tentar_apos is
  'MIA (9044): nao ler a lista de agendas desta conta Microsoft antes deste instante. Gravado pelo cron agenda-microsoft-sync quando a leitura do catalogo falha (recuo de 15 min, como calendar_connections.catalog_retry_at do upstream, 0668). NULL ou passado = pode tentar.';

notify pgrst, 'reload schema';

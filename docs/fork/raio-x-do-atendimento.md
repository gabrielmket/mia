# O raio-X do atendimento (.101, e o cliente ativo na .102)

Ferramenta da Time Company, dentro do sistema MIA, na área da plataforma (só quem
administra a plataforma usa). A Time cadastra o raio-X de uma empresa, manda um link,
o dono abre sem login, aceita o termo e conecta o WhatsApp comercial pelo código de 8
letras ("Conectar com número de telefone"), com o QR como alternativa. O sistema lê,
só para leitura, as conversas 1:1 dos últimos 30, 60 ou 90 dias, transcreve os áudios,
conta foto, vídeo e documento sem guardar, e gera o relatório: velocidade da primeira
resposta, quem ficou sem resposta, de onde vieram os clientes, o que perguntaram, como
terminou, a nota em cinco critérios, cinco conversas boas e cinco ruins anonimizadas,
as recomendações e o bloco "o que a MIA resolveria" (só para a Time).

O relatório sai como RASCUNHO; só depois da revisão de alguém da Time ele gera o link
do dono. A empresa NÃO precisa ser cliente da MIA: o raio-X é a isca comercial.

Protótipo aprovado: `Projeto sistema MIA/Produto/Prototipo-raio-x-do-atendimento-2026-11-04.html`
(as 13 decisões da tela 6, todas como o protótipo adota).

---

## 1. O fluxo

| passo | quem | onde |
|---|---|---|
| cadastrar (empresa, segmento, WhatsApp, quem autoriza, período, tipo, horário, empresa da MIA opcional, teto) | a Time | Admin › Raio-X do atendimento › Novo raio-X, ou `plataforma_criar_raio_x` |
| mandar o link (vale 48 h) e a mensagem pronta | a Time, pelo WhatsApp dela | copiar na tela |
| aceitar o termo (nome, data, hora, versão e texto inteiro gravados) | o dono, sem conta | `/raio-x/<código>` |
| conectar: código de 8 letras pelo celular, ou QR pelo computador | o dono | a mesma página |
| o histórico chega em partes; a leitura espera estabilizar, lê e confere | o servidor (cron de minuto) | `api/v1/cron/raio-x` |
| transcrever, classificar em lote, gerar o relatório em rascunho | o servidor | o mesmo cron |
| revisar e gerar o link do dono (7, 30 ou 90 dias) | a Time | o detalhe, ou `plataforma_publicar_raio_x` |
| abrir o relatório | o dono, sem conta | `/raio-x/relatorio/<token>` |
| a conexão cai 7 dias depois do relatório (diagnóstico único) | o servidor | o cron |
| as conversas apagam 30 dias depois do relatório | o servidor | o cron |

Dois tipos (decisão 8): **diagnóstico único** (conecta, lê, gera o relatório e
desconecta em 7 dias) e **acompanhamento mensal** (fica conectado e gera um relatório no
dia 1 de cada mês, sobre o mês anterior, no fuso de São Paulo).

---

## 2. A arquitetura

### 2.1 Um contêiner próprio do leitor

O raio-X NÃO usa o MIAzap nem o canal WAHA dos clientes. A compose do EasyPanel
(`docker-compose.easypanel.yml`) ganha o serviço **`raio-x-leitor`**:

- a mesma imagem (`${WAHA_IMAGE}`) e a MESMA chave (`WAHA_API_KEY`, pelo `env_file`):
  nenhuma linha nova no Environment do EasyPanel;
- sem webhook: `WHATSAPP_HOOK_URL` vazio por cima do `.env`, e cada sessão nasce com
  `webhooks: []`; o contêiner não manda nada ao app;
- volumes próprios (`raio-x-data`, `raio-x-media`); apagar `raio-x-data` desconecta todos
  os raio-X e apaga o acervo deles;
- só na rede padrão do projeto, sem porta publicada e sem domínio (ele precisa sair para a
  internet, para o WhatsApp, e por isso a rede não é `internal`);
- `WAHA_CLIENT_DEVICE_NAME=Raio-X Time Company`: é o nome que o dono vê em Aparelhos
  conectados (também vai na config de cada sessão);
- `WHATSAPP_RESTART_ALL_SESSIONS=True`, para o mensal voltar sozinho depois de reiniciar;
- `mem_limit: 1024m`.

O app recebe `RAIO_X_LEITOR_URL=http://raio-x-leitor:3000` no bloco `environment` do
serviço `app` (endereço interno, não é segredo). A chave é `WAHA_API_KEY`, salvo
`RAIO_X_LEITOR_CHAVE` se um dia a Time quiser outra.

Por que um contêiner próprio: um número com muito histórico sincronizando não pesa no canal
dos clientes que estão atendendo, e nenhum caminho de envio do atendimento conhece esse
contêiner. Uma sessão por raio-X (`raiox_<24 hex do id>`, que nunca coincide com o nome de
sessão de um canal de empresa).

### 2.2 Só leitura, por construção

`lib/channels/raio-x/leitor.ts` é o único caminho até o contêiner. Ele não usa o
`WahaClient` do upstream (que tem `sendMessage`, `sendSeen`, `setPresence`): tem um cliente
próprio que expõe oito métodos (estado, preparar, pedir o código, QR, página de conversas,
página de mensagens, baixar um áudio, desconectar). Toda chamada passa por `rotaPermitida`,
uma lista FECHADA de método + caminho; envio, visto, presença, reação, edição, apagar
mensagem e o `PUT` da sessão (que poderia religar um webhook ou o "online") não estão nela.

A sessão nasce com:

| opção | valor | por quê |
|---|---|---|
| `noweb.store.enabled` / `fullSync` | `true` / `true` | o histórico anterior à vinculação; o fullSync só acontece NA vinculação (#999), por isso vai na criação |
| `noweb.markOnline` | `false` | com a sessão "online" o celular da loja deixa de receber notificação (doc do NOWEB, "Session Config", e o FAQ de Presença do WAHA: "send `markOnline: false` when you create a new session") |
| `ignore` | grupos, status, listas, canais | o filtro do upstream (`CONVERSAS_IGNORADAS`) |
| `client.deviceName` | "Raio-X Time Company" | o nome em Aparelhos conectados |
| `webhooks` | `[]` | nenhum aviso sai |

Depois de criar, o leitor relê a sessão: sem `store.enabled`, `fullSync` e `markOnline:
false` confirmados, a sessão é apagada e o pareamento recusado (`leitor_config_recusada`).

O pareamento por código é sempre para o número CADASTRADO (o termo é dele): o corpo do
pedido não escolhe número. Quando o aparelho pareia, o ciclo confere o número conectado;
diferente do cadastrado, desconecta sem ler nada e a página avisa.

### 2.3 As tabelas (migration 9150)

Sete tabelas nossas, todas só do servidor (RLS ligada sem política, grants revogados de
`anon` e `authenticated`, o molde de `mia_paineis_links`/9031):

| tabela | o que guarda | some quando |
|---|---|---|
| `mia_raio_x` | o cadastro, a situação, o hash do código do link de conexão, a sessão, o cursor da leitura, os prazos, o teto, a trava do agendador | fica (é o raio-X) |
| `mia_raio_x_aceites` | nome de quem aceitou, data e hora, versão e o TEXTO INTEIRO do termo, com o hash | fica (é a prova do consentimento) |
| `mia_raio_x_conversas` | uma por cliente: a MARCA do chat (HMAC, nunca o telefone), a referência cifrada (chat e nome de perfil, AES-GCM) só para baixar áudio e anonimizar os trechos, o número de ordem e a análise do modelo | 30 dias depois do relatório |
| `mia_raio_x_mensagens` | TRANSITÓRIA: o texto (sem telefone, e-mail ou documento) e a transcrição; do áudio, o id cifrado para pedir o arquivo | 30 dias depois do relatório |
| `mia_raio_x_relatorios` | o relatório: só números somados, rótulos, os 10 trechos anonimizados, as recomendações, a versão dos critérios, a comparação com o anterior, rascunho ou revisado, o custo | fica |
| `mia_raio_x_links` | o link do dono: só o hash do token, validade, revogação, acessos | fica |
| `mia_raio_x_gastos` | o gasto de IA da PLATAFORMA por chamada (`raio_x_analise` ou `raio_x_transcricao`), em dólar e em real | fica (registro financeiro) |

Funções, só para `service_role`: `fn_mia_raio_x_conversa` (acha ou cria a conversa e dá o
número de ordem, com trava por raio-X), `fn_mia_raio_x_link_acessado` (conta o acesso em
link vivo) e `fn_mia_raio_x_expurgar_conversas` (o prazo de 30 dias; com corte, só as
mensagens antigas do mensal). Carimbo: `20261104120000_9150_raio_x_do_atendimento`.

### 2.4 A leitura em segundo plano

`app/api/v1/cron/raio-x` roda a cada minuto (`docker/scheduler/entrypoint.sh`, `-m 60`),
dentro do prazo de 45 s da importação do histórico do upstream
(`lib/channels/historico/prazo.ts`). A ordem (`lib/raio-x/ciclo.ts`):

1. os prazos: derrubar a conexão do diagnóstico em 7 dias, apagar as conversas em 30, abrir
   o mês do mensal no dia 1 e apagar as mensagens do mês que fez 30 dias de relatório;
2. quem está conectando: o aparelho pareou? Confere o número e começa a leitura;
3. quem está lendo: uma rodada de leitura (`lib/raio-x/leitura.ts`);
4. quem está analisando: uma rodada de análise (`lib/raio-x/analise.ts`).

Cada raio-X anda com uma trava (`mia_raio_x.trava_ate`, update condicional no `updated_at`).

A leitura tem quatro fases:

| fase | o que faz |
|---|---|
| `sincronizando` | o histórico chega em PARTES depois do pareamento. Cada rodada conta as conversas do período; a leitura só começa quando a conta fica parada por 5 minutos (e 5 minutos depois de conectar), ou depois de 40 minutos |
| `lendo` | a passada inteira, conversa a conversa, do mais antigo ao mais novo dentro do período; cursor pela posição na lista e offset pelo que o leitor DEVOLVEU (o desenho da #999) |
| `conferindo` | uma segunda volta: lê de novo só a conversa que ganhou mensagem depois de lida, e a que apareceu no meio |
| `concluida` | fim; o raio-X vai para "analisando" e o período fecha no instante da conclusão |

O andamento aparece na página de conexão e no detalhe do Admin.

### 2.5 As telas e as rotas

- Admin: `/admin/raio-x` (lista e Novo raio-X) e `/admin/raio-x/[id]` (andamento, link de
  conexão, aceite, ajustes, desconectar agora, encerrar, relatório com a revisão, link do
  dono, evolução e relatório anterior). Rotas em `app/api/v1/admin/raio-x/**`, toda escrita
  com `requireSupportWrite` + `requirePlatformAdminEscrita` (verificação em duas etapas) e a
  recusa nomeada (`falhaDaEscritaDePlatformAdmin`).
- Públicas, sem login: `/raio-x/<código>` (8 letras, 48 h) e `/raio-x/relatorio/<token>` (24
  letras, 120 bits), com as rotas `api/v1/publico/raio-x/<código>` (andamento),
  `/aceite`, `/codigo` e `/qr`. Teto por IP; o pedido de código tem também 1 por 30 s por
  raio-X; a prévia do WhatsApp recebe uma página neutra; link ruim responde igual (404).
- MCP de plataforma: `plataforma_criar_raio_x`, `plataforma_ver_raio_x`,
  `plataforma_publicar_raio_x` e `plataforma_encerrar_raio_x`, operação `gerir_raio_x`
  ([`mcp-de-implantacao.md`](mcp-de-implantacao.md), seção 3). A quarta existe porque a
  revisão e o link do dono não cabem nas três do protótipo.
- Auditoria: `raio_x.criado`, `.link_de_conexao_gerado`, `.aceite`, `.conectado`,
  `.numero_diferente`, `.leitura_concluida`, `.relatorio_gerado`, `.relatorio_revisado`,
  `.link_do_dono_gerado`, `.link_do_dono_revogado`, `.link_do_dono_acessado`,
  `.desconectado`, `.encerrado`, `.conversas_apagadas`, `.mes_aberto`, `.alterado`. Nunca
  telefone de cliente, texto de conversa, código ou token.

---

## 3. O que o upstream já tinha, e o que foi reaproveitado

Conferido em 04/11/2026 contra `upstream/main` (v1.100.0, inclusive "Não lançado") e os 76
PRs abertos. Nada de diagnóstico ou auditoria do atendimento, relatório de conversas por
cliente ou leitura de WhatsApp de quem não é cliente. O que havia e entrou:

| do upstream | onde | como o raio-X usa |
|---|---|---|
| a importação do histórico (#999): acervo `noweb.store` + `fullSync`, paginação de chats por id e de mensagens por timestamp, offset pelo devolvido, prazo por chamada | `lib/waha/client.ts` (`ACERVO_DO_HISTORICO`, `CONVERSAS_IGNORADAS`), `lib/channels/historico/prazo.ts` | as constantes e o prazo, importados; o desenho das rodadas copiado no leitor e na leitura (o importador dele grava em `contacts`/`messages`, o raio-X não pode) |
| o esquema do payload e os leitores do ingest | `lib/waha/envelope.ts`, `lib/waha/ingest.ts` (`bodyOf`, `resolveMessageType`, `ehReacao`, `notifyNameOf`) | importados no mapeamento da mensagem |
| o anúncio do clique (CTWA) | `lib/waha/atribuicao-de-anuncio.ts` | a origem "anúncio do Meta" sai do metadado, quando há |
| o pareamento por código | `lib/channels/pairing-code.ts` | o esquema do telefone (`pairingPhoneSchema`) e o formato do código; a função dele lê `channel_sessions` de uma empresa, então o raio-X chama o endpoint pelo leitor |
| a transcrição | `lib/messaging/media/transcription.ts` | o mesmo transcritor do motor de agentes (`apiTranscriptionProvider`, `modeloDeTranscricaoEmVigor`), com a chave da instalação, em português |
| o preço dos modelos e o registro de provedores | `lib/agent-engine/edge/llm/pricing.ts`, `providers.ts` | o custo medido de cada chamada e a fábrica com o egress contido |
| o limitador e a prévia do link | `lib/auth/rate-limit.ts`, `lib/paineis/link.ts` (`ehVisitaDePrevia`) | as páginas públicas |
| as métricas de primeira resposta | `fn_attendant_metrics` / `fn_channel_metrics` | NÃO reaproveitadas: medem `conversations` de uma empresa e a resposta HUMANA dentro do CRM; o raio-X mede o WhatsApp de fora, com outra definição de episódio |

PR aberto relacionado: #3403 (painel do setor com "quem espera resposta"), que é do CRM e não
cobre o caso.

---

## 4. As definições das métricas (determinísticas)

Código: `lib/raio-x/metricas.ts` e `lib/raio-x/horario.ts`; testes em
`tests/unit/raio-x-metricas.test.ts`. Fuso America/Sao_Paulo.

- **Episódio de atendimento.** A conversa é cortada em trechos: um trecho novo começa na
  primeira mensagem do período e em toda mensagem que chega 24 horas ou mais depois da
  anterior (de qualquer lado). Trecho que começa com mensagem do cliente é um episódio;
  trecho que começa com mensagem da loja (campanha, retorno) não é.
- **Primeira resposta.** O tempo entre a PRIMEIRA mensagem do cliente no episódio e a
  primeira mensagem da loja depois dela, no mesmo episódio. Relógio de parede, não horário
  útil. O relatório mostra a mediana (metade das conversas é respondida em até).
- **Loja aberta ou fechada.** Pelo instante da primeira mensagem do cliente: segunda a sexta
  de `abre` até `fecha`, sábado de `abre` até `sabado_ate` (nulo = não abre), domingo
  fechado. Desde a .107, domingo de `abre` até `domingo_ate` (nulo = fechado, o padrão; seção
  17.7). Feriado não entra.
- **O mapa 7 × 4.** Dia da semana × faixa (8h-12h, 12h-14h, 14h-18h, 18h-8h) da primeira
  mensagem do episódio. A faixa da noite fica no dia do CALENDÁRIO: 02:00 de terça é "terça,
  18h às 8h". Cada quadro: quantos episódios e a mediana da primeira resposta.
- **Ficou sem resposta.** Episódio em que a loja não mandou nada e que já tem 24 horas desde
  a última mensagem do cliente no fim do período. Menos que isso é "em aberto" e fica fora
  das duas contas.
- **Sumiu.** A loja respondeu, a última palavra foi dela, e o cliente não escreveu mais por
  48 horas (até a próxima mensagem dele ou o fim do período).
- **A loja voltou a chamar.** Dentro desse silêncio, a loja mandou outra mensagem 12 horas ou
  mais depois da primeira que ficou sem resposta. "Sumiu e a loja não voltou" é o sumiço
  sem esse retorno.
- **Conversa de cliente.** Conversa 1:1 em que o cliente escreveu ao menos uma vez no período.
- **Nota de rapidez.** Do relógio: a mediana da primeira resposta da conversa (até 5 min = 10,
  15 = 9, 30 = 8, 1 h = 6, 3 h = 4, 12 h = 2, mais = 1; sem resposta nenhuma = 0).

"Sem resposta" no desfecho é sempre do relógio, nunca do modelo.

---

## 5. A análise por IA, o custo e o teto

**O modelo: `gpt-6-luna`** (OpenAI), o mais barato do catálogo que faz o trabalho: US$ 0,10
por milhão de tokens de entrada e US$ 0,50 de saída, a mesma faixa do Claude Haiku 5.5. A
escolha da OpenAI é pela chave: a transcrição de áudio já usa a chave OpenAI da instalação
(Whisper), então o raio-X inteiro roda com UMA chave. Sem chave OpenAI e com a da Anthropic,
vale o `claude-haiku-5-5`. O trabalho é classificação curta (origem, assunto, desfecho, quatro
notas e um comentário de 140 caracteres), com as métricas de tempo já calculadas fora do
modelo e passadas como fatos; raciocínio `low`. Lote de até 6 conversas (ou 14 mil
caracteres) por chamada, JSON validado por esquema; o que não passa fica sem análise.

A credencial é a da PLATAFORMA (o `.env`), e o gasto é da Time: cada chamada vira uma linha
em `mia_raio_x_gastos`, com o propósito (`raio_x_analise`, `raio_x_transcricao`), os tokens,
o custo em dólar (medido pela tabela de preço do motor; o áudio, pela duração, marcado
`estimado`) e em real pela cotação do dia (`platform_fx_rates`; sem cotação, R$ 6 de reserva).
O custo aparece só para a Time (detalhe e MCP).

**Estimativa por conversa (não medida com IA de verdade nesta entrega):** entrada ~850 tokens e
saída ~450 com o raciocínio → US$ 0,0003 (R$ 0,002) por conversa na classificação; um áudio de
20 s por duas conversas → US$ 0,002 (R$ 0,012). Perto de **R$ 0,015 por conversa, R$ 6 por um
raio-X de 400 conversas**, abaixo dos R$ 15 a 30 estimados no protótipo. O custo real de cada
raio-X fica gravado.

**O teto** (padrão R$ 40, editável no cadastro e no detalhe, de R$ 5 a R$ 500) vale por
relatório (no mensal, por mês). É conferido ANTES de cada chamada com a estimativa
conservadora dela (a entrada inteira mais a saída no teto). Bateu: a análise para, as conversas
que faltavam ficam `fora_do_teto`, os áudios pendentes ficam `fora_do_teto`, e o relatório sai
`parcial`, dizendo quantas ficaram de fora. Os tempos de resposta contam todas.

**O áudio** é baixado do leitor, transcrito (serviço da instalação `TRANSCRIPTION_API_KEY`, ou
a chave OpenAI com `whisper-1`, em português) e descartado; só o texto fica até as conversas
apagarem. Sem serviço de transcrição, o áudio é só contado (`sem_servico`).

O texto que vai ao modelo sai sem telefone, e-mail, documento, CEP, placa e link
(`tirarIdentificadores`, já na gravação).

---

## 6. LGPD

**Papéis.** O dono é o CONTROLADOR dos dados dos clientes dele; a Time Company é a OPERADORA,
só para esta análise. Os serviços de IA são suboperadores.

**O aceite.** Gravado em `mia_raio_x_aceites`: nome, data e hora, versão (`v1`) e o texto
INTEIRO aceito, com o hash SHA-256. Cada aceite é um registro (voltar à página e aceitar de
novo grava outro).

**O que fica e o que some:**

| dado | quando some |
|---|---|
| o link de conexão (o código) | vale 48 h; morre ao conectar e ao desconectar |
| a conexão (o aparelho "Raio-X Time Company") | diagnóstico: 7 dias depois do relatório; mensal: quando a Time encerra; a qualquer hora pelo dono, no celular |
| o acervo dentro do contêiner do leitor | junto com a conexão: desconectar faz logout E apaga a sessão |
| as conversas lidas (marca, referência cifrada, texto, transcrição, análise) | 30 dias depois do relatório (ou do encerramento); no mensal, as mensagens de cada mês 30 dias depois do relatório dele |
| o arquivo do áudio | nunca é guardado (3 minutos no disco do leitor, o padrão `WHATSAPP_FILES_LIFETIME`) |
| foto, vídeo e documento | nunca são guardados: só contados (o banco recusa referência de arquivo fora do áudio) |
| o relatório | FICA, sem telefone e sem nome de cliente (número de ordem), para comparar com o próximo |
| o aceite e o gasto | ficam (prova do consentimento e registro financeiro) |

**O pedido do titular.** Os clientes do dono não são contatos da MIA: nenhuma tabela do raio-X tem
`contact_id`, e o acesso e a anonimização por contato (`lib/lgpd/`) não as alcançam, de propósito. O pedido
de um cliente do dono vai ao dono (o controlador), e a Time atende encerrando o raio-X e, se preciso,
antecipando o expurgo (`fn_mia_raio_x_expurgar_conversas`). O nome da função é "expurgar", e não
"apagar", porque é o PRAZO de retenção, e não a anonimização a pedido do titular que a cerca
`lgpd-exporta-o-que-redige` vigia.

Os clientes aparecem por número de ordem ("Cliente 0187"), nunca por telefone ou nome. Os
trechos do relatório são curtos (180 caracteres, até 4 balões), sem telefone, e-mail ou
documento, e com os nomes trocados por [nome] (o nome de perfil do cliente, nomes depois de
"me chamo", "aqui é o", "oi", "bom dia" e os prenomes mais comuns do Brasil). Um sobrenome raro
escrito sozinho pode escapar: por isso a revisão da Time vem antes do link do dono.

### 6.1 O termo v1

> ⚠️ **PRECISA PASSAR POR ADVOGADO ANTES DO LANÇAMENTO.** O texto abaixo foi escrito para o
> produto andar. Mudou uma vírgula, é outra versão: suba `VERSAO_DO_TERMO` em
> `lib/raio-x/termo.ts` e mantenha o texto antigo, porque o aceite guarda o texto que a pessoa
> leu.

Exemplo com dados fictícios (a empresa, o número e o período entram do cadastro):

```
TERMO DE AUTORIZAÇÃO · RAIO-X DO ATENDIMENTO · versão 1

1. Quem é quem. A empresa Garagem Modelo Veículos ("Empresa"), representada por quem aceita este termo, é a CONTROLADORA dos dados pessoais dos clientes que conversam com o WhatsApp comercial (31) 90000-1101. A Time Company ("Time") é a OPERADORA: trata esses dados só por conta e ordem da Empresa e só para a finalidade abaixo.

2. Finalidade. Medir como está o atendimento comercial pelo WhatsApp (quanto tempo leva para responder, quem fica sem resposta, de onde vêm os clientes, o que perguntam e como as conversas terminam) e entregar à Empresa um relatório com o que melhorar.

3. O que é lido. As conversas individuais dos últimos 90 dias e as que chegarem até o relatório ficar pronto. Grupos, status e listas de transmissão ficam de fora. Os áudios são transcritos para entrar na análise. Fotos, vídeos e documentos são só contados: o conteúdo não é guardado.

4. Só leitura. Nenhuma mensagem é enviada, marcada como lida ou respondida a partir do número. A conexão aparece no WhatsApp como um aparelho conectado ("Raio-X Time Company") e a Empresa pode desconectá-la a qualquer momento, em WhatsApp › Aparelhos conectados.

5. Como é feito. A leitura roda num servidor da Time. A transcrição dos áudios e a classificação das conversas usam serviços de inteligência artificial contratados pela Time (suboperadores), que recebem o texto sem telefone, e-mail ou documento, só para esta análise e conforme os termos de uso de API desses serviços.

6. Prazos. A conexão é encerrada automaticamente 7 dias depois de o relatório ficar pronto. As conversas lidas são apagadas dos servidores da Time 30 dias depois do relatório (ou do encerramento, se ele vier antes). O relatório fica guardado, sem o telefone e sem o nome dos clientes, que aparecem só por um número de ordem, para comparar com o próximo raio-X e mostrar a evolução.

7. Segurança. Só a equipe da Time acessa as conversas e o relatório antes de ele ser entregue, e o que ela faz no raio-X (revisar, publicar, desconectar, encerrar) fica registrado. O relatório da Empresa abre por um link próprio, com validade, que a Time pode desligar.

8. Direitos dos clientes da Empresa. Os pedidos dos titulares (acesso, correção, eliminação) são respondidos pela Empresa, como controladora. A Time apoia e apaga as conversas antes do prazo se a Empresa pedir.

9. Riscos. A conexão usa o mesmo mecanismo do WhatsApp Web e não é a API oficial do WhatsApp. Como ela só lê, o risco é baixo, mas o WhatsApp pode, a critério dele, desconectar aparelhos.

10. Declaração. Quem aceita declara ser responsável pelo WhatsApp (31) 90000-1101, ter poderes para autorizar este tratamento em nome da Empresa e que a Empresa tem base legal para ele (o legítimo interesse de melhorar o próprio atendimento). O aceite fica registrado com o nome de quem aceitou, a data, a hora e a versão deste termo.
```

No mensal, o item 6 troca a primeira frase por: "No acompanhamento mensal, a conexão fica ativa e
um relatório é gerado no dia 1 de cada mês, sobre o mês anterior, até a Empresa ou a Time
encerrar."

Pontos para o advogado olhar: a base legal (legítimo interesse do controlador) e o teste de
balanceamento; se cabe aviso aos clientes finais do dono; o prazo de 30 dias; a transferência
internacional para os serviços de IA; e o "apaga antes do prazo se a Empresa pedir" (hoje é
"Encerrar" + a função de apagar, que a Time roda; não há botão do dono).

---

## 7. Evolução (decisão 13)

Todo relatório novo da mesma empresa é comparado com o anterior REVISADO: o do mesmo raio-X (o
mensal, mês a mês) ou o de outro raio-X com o mesmo WhatsApp normalizado, ou com a mesma conta
da MIA quando ligada. Os indicadores vão em proporção e em mediana (o total de conversas muda):
primeira resposta, primeira resposta com a loja fechada, sem resposta, sumiu sem retorno, pediu
o valor e não recebeu, agendou o próximo passo, nota. Cada relatório guarda a versão dos
critérios (`CRITERIOS_VERSAO`, `lib/raio-x/segmentos.ts`); se mudou entre os dois, a linha da
nota sai com o aviso "critérios diferentes" e sem melhorou/piorou. Aparece no relatório da Time
e no link do dono.

---

## 8. Limites e riscos

- Não é a API oficial do WhatsApp: é o mesmo mecanismo do WhatsApp Web. O risco é baixo porque
  só lê, mas existe.
- Cada número aceita até 4 aparelhos conectados. Cheio, o dono precisa tirar um.
- Número que está na API oficial do WhatsApp não tem o aplicativo e não conecta assim.
- O WhatsApp entrega cerca de 3 meses de histórico; um período maior não traz mais.
- O código de pareamento vale ~3 minutos; o QR troca a cada 20 segundos.
- A estabilização da sincronia é por heurística (a conta de conversas parada por 5 minutos, ou
  40 minutos no máximo); a conferência relê o que mudou no meio.
- Feriado não entra na conta de loja aberta ou fechada.
- A ordem da lista de conversas por id não foi medida no servidor real pelo upstream (está
  escrito no `paginaDeConversas` dele); uma conversa pulada pela troca de ordem é pega na
  conferência.

---

## 9. O roteiro de implantação

1. **Backup do banco** antes (a migration 9150 só cria objetos nossos, mas a regra da casa
   vale).
2. Implantar a versão pela compose do EasyPanel: ela já traz o serviço `raio-x-leitor`, os dois
   volumes e o `RAIO_X_LEITOR_URL` no `app`. **Nenhuma variável nova no Environment**: o
   contêiner usa `WAHA_API_KEY` e `WAHA_IMAGE` que já existem. O agendador precisa da imagem
   nova (a linha `api/v1/cron/raio-x` mora no `entrypoint.sh` da imagem do agendador).
3. Conferir a saúde: `/api/v1/health` com o carimbo `20261104120000_9150_raio_x_do_atendimento`
   e zero erros; o contêiner `raio-x-leitor` de pé (`GET /api/server/version` de dentro da rede
   responde, com a chave).
4. Conferir a chave de IA da plataforma: `OPENAI_API_KEY` no `.env` (classificação e
   transcrição). Sem ela, o relatório sai só com o relógio (sem origem, assunto, desfecho e nota
   do modelo) e os áudios só contados.
5. **Primeiro teste com um número da própria Time** (não de cliente): Admin › Raio-X do
   atendimento › Novo raio-X, período de 30 dias, teto de R$ 10. Abrir o link no celular do
   número, aceitar, conectar pelo código. Conferir no celular: o aparelho aparece como "Raio-X
   Time Company" e as notificações continuam chegando (o `markOnline: false`). Acompanhar o
   andamento no detalhe; quando o relatório sair, conferir os números contra o WhatsApp, os
   trechos (nenhum telefone, nomes como [nome]) e o custo gravado.
6. Revisar, gerar o link do dono e abrir num navegador sem login; depois "Desconectar agora" e
   conferir que o aparelho saiu da lista do celular.
7. Só então usar com cliente, e com o termo revisado pelo advogado (seção 6.1).

Para desfazer: tirar o serviço da compose (as conversas param de ser lidas), e o cron passa a
não ter trabalho. As tabelas ficam; o relatório guardado continua legível no Admin.

---

## 10. O que fica para depois, de propósito

- **Cliente oculto** (decisão 12, complemento opcional): a Time manda 3 mensagens de teste de um
  número da Time, em horários diferentes, e o relatório mostra como foram atendidas. NÃO
  construído nesta entrega: exigiria um número que ENVIA, o que o leitor do raio-X não pode ter.
- O botão "Falar com a Time" do link do dono (precisa de um número da Time configurado).
- Baixar o relatório em PDF (hoje, imprimir pelo navegador).
- Comparar vendedores (um número por vendedor), cruzar com o CRM, Instagram Direct, painel do
  dono com login (a lista "fica para depois" do protótipo).
- Feriados municipais e estaduais na conta de loja fechada.

---

## 11. Pontos de ligação no código do upstream

O raio-X mora em `lib/raio-x/`, `lib/channels/raio-x/`, `components/raio-x/`,
`app/admin/(protected)/raio-x/`, `app/raio-x/`, `app/api/v1/admin/raio-x/`,
`app/api/v1/publico/raio-x/`, `app/api/v1/cron/raio-x/` e
`lib/mcp-plataforma/ferramentas/raio-x.ts`. Toca arquivos do upstream só nestes pontos:

| arquivo | o quê |
|---|---|
| `lib/audit/actions.ts` | os códigos `raio_x.*` no fim da lista |
| `lib/auth/public-paths.ts` | as seis entradas públicas, ancoradas |
| `lib/admin/navegacao.ts` | a porta no menu do Admin |
| `lib/i18n/dicionario.ts` | uma linha que espalha `lib/i18n/dicionario-mia-raio-x.ts` |
| `docker/scheduler/entrypoint.sh` | a linha do cron |
| `tests/unit/suporte-cobertura-de-efeitos.test.ts` | a exceção nomeada dos dois POST públicos sem sessão |
| `tests/unit/mcp-de-implantacao-ferramentas.test.ts` | a lista das ferramentas sem `organization_id` e a exceção do "publicar" |
| `tests/invariants/rls-completude-varredura.test.ts` | `mia_raio_x` em PROVA_PROPRIA |

---

## 12. O que prova o quê

| teste | prova |
|---|---|
| `tests/unit/raio-x-metricas.test.ts` | episódio, primeira resposta, loja aberta e fechada (sábado até 13h, domingo), faixas do mapa no fuso, sem resposta e em aberto, sumiu com e sem retorno, o mapa e o pico, a nota de rapidez, o mês anterior no fuso |
| `tests/unit/raio-x-anonimizar.test.ts` | telefone, e-mail, CPF, CNPJ, CEP, placa e link saem; nomes viram [nome]; o trecho é curto e não corta marcador |
| `tests/unit/raio-x-comparacao-e-prazos.test.ts` | a evolução em proporção, critérios diferentes com aviso, "mesma empresa"; prazos de 48 h, 7 e 30 dias e o mensal no dia 1; o teto; o cadastro |
| `tests/unit/raio-x-relatorio.test.ts` | o relatório a partir das conversas fictícias fixas: números, origem pelo clique, desfecho do relógio, parcial pelo teto, sem telefone nem nome, sem o bloco da MIA no do dono |
| `tests/unit/raio-x-relatorio-na-tela.test.tsx` | o relatório renderizado (Time e dono), e o espanhol |
| `tests/unit/raio-x-leitor-nao-envia.test.ts` | o leitor não tem como enviar: a superfície, a lista fechada e o fio; a sessão nasce com acervo, `markOnline: false` e sem webhook |
| `tests/unit/raio-x-ciclo-com-duble.test.ts` | o ciclo inteiro com leitor e modelo dublados: conecta, estabiliza, lê sem o grupo, confere, classifica, grava o gasto, gera o relatório, cai em 7 dias, apaga em 30; número diferente não é lido; o teto para a análise |
| `tests/unit/mcp-de-implantacao-raio-x.test.ts` | as quatro ferramentas, a operação e a redação da auditoria |
| `tests/invariants/raio-x-do-atendimento.test.ts` | no Postgres: só o servidor nas sete tabelas, os CHECKs, o número de ordem, apagar as conversas e o acesso ao link |
| `tests/e2e/raio-x-do-atendimento.spec.ts` | pelo navegador: criar no Admin, aceitar o termo na página pública, relatório fictício renderizado, revisar, gerar o link do dono, abrir sem login, encerrar |

---

## 13. O raio-X do CLIENTE ATIVO (.102)

Protótipo aprovado: `Projeto sistema MIA/Produto/Prototipo-raio-x-cliente-ativo-2026-11-05.html`
(as 8 telas). A primeira pergunta do Novo raio-X passa a ser **de onde vêm as conversas**:

| fonte (`mia_raio_x.fonte`) | para quem | como lê |
|---|---|---|
| `conexao` (o padrão) | quem ainda não é cliente | a .101 sem mudança: o dono autoriza e conecta o WhatsApp ao leitor |
| `conversas_da_mia` | cliente ativo da MIA | nada é conectado e o leitor não é usado: o raio-X lê `conversations` e `messages` da própria organização, nos números escolhidos, inclusive os da API oficial |

### 13.1 O fluxo

| passo | quem | onde |
|---|---|---|
| escolher "Conversas que já estão na MIA" e a empresa; o segmento, os números, o período, o horário, quem autoriza e a estimativa vêm da conta | a Time | Admin › Raio-X do atendimento › Novo raio-X (`GET /api/v1/admin/raio-x/conta`), ou `plataforma_ver_raio_x` com `organization_id` |
| "Criar e gerar o link de autorização" (vale 48 h) e a mensagem pronta | a Time | a mesma tela, ou `plataforma_criar_raio_x` com `fonte`, `organization_id` e `numeros` |
| ler o termo "cliente ativo" v1 e autorizar com nome completo e e-mail (duas etapas: autorizar e pronto) | o dono, sem conta | `/raio-x/<código>` |
| a leitura começa NA HORA da autorização (situação "lendo") | o servidor | o cron de minuto, `lib/raio-x/leitura-da-conta.ts` |
| transcrever o áudio que a MIA ainda não transcreveu, classificar, gerar o rascunho | o servidor | o mesmo cron, `lib/raio-x/analise.ts` |
| revisar e gerar o link do dono | a Time | o detalhe, ou `plataforma_publicar_raio_x` (como na .101) |
| as transcrições e a análise de cada conversa apagam 30 dias depois do relatório | o servidor | o cron (`fn_mia_raio_x_expurgar_conversas`, da 9150) |

Não há conexão para cair: o cliente ativo nunca tem `sessao` nem `desconectar_em` (o CHECK
`mia_raio_x_fonte_sem_sessao` garante a primeira). O mensal existe para o cliente ativo e nasce
DESLIGADO (o tipo padrão é o único; a Time escolhe "Mensal · todo dia 1" por cliente).

### 13.2 As regras escolhidas

**Empresa ativa** (`lib/raio-x/conta.ts`, `ehClienteAtivo`): a mesma leitura de "Empresas do cadastro"
e do `plataforma_listar_assinaturas` (`lib/planos-mia/situacao.ts`, `situacaoDaEmpresa`, sobre
`cobranca_assinaturas` e o status da organização). Entra a organização que OPERA
(`organizations.status = 'active'`) e cuja situação na cobrança é **em dia, em teste ou isenta**.
Isenta é a empresa sem assinatura no sistema: a implantada pela Time, que paga por fora, é o cliente de
hoje. Em atraso (com ou sem prazo), suspensa e cancelada não entram: o raio-X é gasto da Time. A
**demonstração** (`organizations.demonstracao`) entra se opera, qualquer que seja a cobrança, para dar
para mostrar. A criação confere de novo (a lista da tela pode estar velha).

**Os números**: os canais da conta com endereço de telefone (`PROVIDERS_DE_TELEFONE`; rede social e voz
ficam de fora), com o rótulo, o telefone comercial e se é API oficial (`lib/channels/raio-x/numeros-da-conta.ts`,
que mora em `lib/channels/` porque só ali se nomeia o transporte). O `whatsapp` do raio-X é o
telefone do primeiro número escolhido: é a chave de "mesma empresa".

**O período**: os N dias INTEIROS antes do dia da criação (no fuso de São Paulo), e nunca antes do dia
da primeira conversa da conta nos números escolhidos (`mia_raio_x.primeira_conversa_em`). É fixado na
criação, para o termo dizer as datas que o dono autoriza ("de 06/09 a 04/11"). `periodo_fim` é
exclusivo (a meia-noite do dia da criação).

**O que fica de fora** (`elegiveis` em `leitura-da-conta.ts`, conferido de novo na análise e no relatório):

| o quê | como o fork marca |
|---|---|
| grupo | `conversations.is_group` e o contato `kind = 'whatsapp_group'` |
| conversa interna ou da equipe | o contato pessoal (`contacts.is_personal`, a vida pessoal de alguém da equipe, escondida da operação) e o número interno dos avisos (`config_aviso_de_caso.telefone_destino` e o do aviso de agendamento, quando é outro) |
| contato com pedido de exclusão (LGPD) | já anonimizado (`contacts.is_anonymized`) ou com pedido de anonimização em `lgpd_requests` (`request_type = 'redact'`, qualquer situação) |
| mensagem apagada | `messages.revoked_at` (o "apagar para todos"; não existe `redacted_at` em `messages`: a anonimização LGPD reescreve a linha e marca o contato) |
| reação e linha de sistema | `messages.type` em `reaction` e `system` |

**Quem respondeu** (`lib/raio-x/quem-respondeu.ts`): pelo `messages.sent_via`, e a direção separa o
cliente (a ingestão carimba `external_device` também na mensagem que chega):

| `direction` + `sent_via` | quem |
|---|---|
| `inbound` | o cliente |
| `outbound` + `ai` | a IA |
| `outbound` + `user` ou `crm` | a equipe pela MIA |
| `outbound` + `external_device` | o celular do número (fora da MIA: sem quem respondeu e sem o funil) |
| `outbound` + `automation` ou `system` | follow-up, automação ou integração |

A conta é por CONVERSA: o primeiro episódio do período que o cliente abriu (a definição da seção 4) e
quem deu a primeira resposta nele. A mediana da primeira resposta é em SEGUNDOS. "Fora do horário" é
quantas dessas conversas chegaram com a loja fechada. O indicador novo "Respondido fora do horário" é,
dos episódios que chegaram com a loja fechada, quantos tiveram a primeira resposta ANTES de a loja abrir
de novo (`proximaAbertura` em `horario.ts`).

**A passagem para humano** (`lib/raio-x/passagem.ts`): `passagens_de_atendimento` (upstream, 0291), uma
linha por vez que o atendimento saiu do automático (`criado_em`), reconhecida (`reconhecido_em`) quando
alguém assume a conversa (`fn_conversation_assign`) ou a devolve ao automático (0293). A conversa que
passou antes de a tabela ter escritor só tem `conversations.last_handoff_at`, que vale como passagem sem
reconhecimento. **Alguém assumiu** = o que vier primeiro: o reconhecimento, ou a primeira mensagem de uma
pessoa (equipe pela MIA ou celular) depois da passagem. Por conversa, a PRIMEIRA passagem do período, nas
faixas até 15 min, de 15 min a 2 h, mais de 2 h e ninguém assumiu ("ninguém" só com 2 h no relógio até o
fim do período; menos é "em aberto", fora das faixas). As medianas separam a passagem com a loja aberta e
fechada.

**No que virou** (o funil da própria conta, `mensagens-da-conta.ts`): o contato da conversa teve um
negócio (`crm_leads`) vivo no período (nasceu antes do fim e não estava fechado antes do começo), um
agendamento (`calendar_appointments`) criado no período, e uma venda ganha (`crm_leads.status = 'won'`,
fechada no período). O bloco mostra as conversas passadas para a equipe e, das que esperaram mais de 2 h
ou que ninguém assumiu, quantas viraram visita.

**A transcrição**: reaproveitada quando a MIA já tem (`messages.media_derived_text` com
`media_derived_status = 'ready'`). A que falta é baixada do storage da PRÓPRIA conta (`whatsapp-media`,
`messages.media_storage_path`) e transcrita pelo transcritor da plataforma (o mesmo da .101), com o teto
conferido antes de cada áudio e o gasto gravado. Ela é o único texto guardado fora das tabelas da conta:
uma linha transitória em `mia_raio_x_mensagens` (só a marca, o id da mensagem cifrado e o texto), que
apaga com as conversas em 30 dias. O raio-X NÃO escreve na conta (nem a transcrição em
`media_derived_text`): o termo promete só leitura.

**O que é guardado**: a conversa do raio-X (`mia_raio_x_conversas`: a marca HMAC do id da conversa, o
número de ordem, a referência CIFRADA com o id da conversa e a análise do modelo, sem texto) e o
relatório (números somados e trechos anonimizados). As mensagens são lidas da conta na hora da análise e
do relatório. Nenhuma mensagem é enviada: o módulo só faz `select` nas tabelas da conta.

### 13.3 O aceite (nas duas fontes)

A página do dono pede **nome completo** (nome e sobrenome: duas palavras, cada uma com letra) e
**e-mail** num formato válido (`lib/raio-x/aceite.ts`), na conexão também. O aceite grava nome completo,
e-mail, data e hora, versão e o texto inteiro do termo (`mia_raio_x_aceites.email`, 9151; o CHECK exige o
nome completo quando há e-mail, e os aceites antigos, sem e-mail, ficam como foram gravados). **O e-mail
não é usado para mandar nada**: o serviço de envio ainda não está configurado.

O termo "cliente ativo" v1 (`lib/raio-x/termo.ts`, `VERSAO_DO_TERMO_CLIENTE_ATIVO = "cliente_ativo_v1"`):

> ⚠️ **PRECISA PASSAR POR ADVOGADO, JUNTO COM O TERMO V1.** Mudou uma vírgula, é outra versão.

```
TERMO DE AUTORIZAÇÃO · RAIO-X DO ATENDIMENTO · CLIENTE ATIVO · versão 1

Eu, responsável pela conta Garagem Modelo Veículos na MIA, autorizo a Time Company a analisar as conversas de WhatsApp dos números Vendas e Pós-venda já registradas na MIA, de 06/09 a 04/11, só para medir o atendimento e gerar o relatório do raio-X. Nenhuma mensagem é enviada em meu nome. Os trechos de conversa do relatório não levam nome, telefone ou documento dos clientes. O relatório fica guardado para comparar com o próximo raio-X. Posso cancelar esta autorização falando com a Time Company.
```

No mensal, depois do período entra: "e, no acompanhamento mensal, as do mês anterior no dia 1 de cada
mês, até eu ou a Time Company encerrarmos,".

### 13.4 O relatório, o antes e depois e o link do dono

O mesmo relatório da .101, mais `dados.fonte` e `dados.clienteAtivo` (`BlocoDoClienteAtivo` em
`relatorio.ts`): quem respondeu primeiro, depois da passagem (faixas, medianas e o trecho anonimizado da
passagem que mais demorou), no que virou, e **"onde ainda dá para ganhar"** no lugar do "o que a MIA
resolveria" (a passagem lenta, as conversas respondidas pelo celular e o número sem follow-up com sumiços
sem retorno). Os trechos seguem anonimizados (`anonimizar.ts`, com o nome do contato lido da conta só para
tirá-lo).

O **antes e depois** é a comparação da .101 (decisão 13), agora buscando o anterior da mesma empresa por
`organization_id` OU por qualquer telefone dos números da conta (`samePhone`): o raio-X por conexão feito
antes de virar cliente é achado sozinho. Indicadores novos (opcionais, ausentes nos relatórios da .101):
"Sem resposta ou sumiu sem retorno", "Respondido fora do horário" e "Espera depois de passar para um
vendedor", que contra o raio-X por conexão sai "não existia" com o selo "novo". O tempo dos relatórios
novos vai em minutos com fração (9 s = 0,15 min), na mesma unidade da .101. A linha que nenhum dos dois
mede some da tabela.

O link do dono do cliente ativo mostra o resultado da MIA e onde a equipe ainda perde (tela 7), sem custo e
sem as anotações da Time.

### 13.5 O que mudou no MCP

As mesmas quatro ferramentas (seguem **110** no total): `plataforma_criar_raio_x` aceita `fonte`,
`organization_id` e `numeros`; `plataforma_ver_raio_x` mostra a fonte e o aceite (e-mail mascarado), o
andamento da análise e o bloco do cliente ativo e, com `organization_id` sem `raio_x_id`, o que dá para
ler da conta (os números com o `channel_session_id`, o período, a estimativa e se é cliente ativo).

### 13.6 Decisões (as recomendações do protótipo, tela 8)

- Só a Time gera o raio-X do cliente ativo (Admin e MCP); nada na tela do cliente.
- O dono autoriza pelo link também no cliente ativo (decidido em 05/11).
- O mensal existe e nasce desligado.
- Sem cobrança no código: só o teto e a estimativa (`estimativaDoRaioX` em `custo.ts`, conservadora como o
  teto: cada conversa com o texto no limite e a saída cheia, cada áudio com um minuto; o custo real fica
  gravado).

### 13.7 A compatibilidade com a .101

O raio-X criado na .101 segue funcionando depois da .102, e `tests/unit/raio-x-compatibilidade-com-a-101.test.ts` prova:

- os códigos e tokens são os mesmos para o mesmo id e versão: `lib/raio-x/tokens.ts` não mudou (o teste
  confere contra valores calculados fora do repositório pelo algoritmo da .101);
- a linha antiga ganha a fonte `conexao` pelo DEFAULT da 9151 (provado no Postgres pela invariante) e é
  tratada como conexão na lista, no detalhe e na página pública; o raio-X "aguardando" abre a página com o
  formulário novo (nome completo e e-mail) e segue as três etapas;
- o aceite antigo, sem e-mail, é lido sem erro;
- o cursor de leitura da .101 (`leitura`, que não mudou de formato) é retomado de onde parou.

### 13.8 Limites e o que ficou de fora

- O horário "da conta" sai do "Só atender em horário de funcionamento" de um agente publicado; sem ele, o
  padrão do raio-X (a tela avisa e a Time ajusta).
- O segmento "da conta" sai do passo "Seu negócio" do onboarding (clínica vira clínica odontológica;
  indústria e outro viram outro).
- O funil é por CONTATO: o contato com conversa em dois números conta nos dois.
- Feriado continua fora da conta de loja aberta ou fechada.
- Não medido com IA de verdade nem com conta real: o custo estimado é a tabela de preço, e o real fica
  gravado no primeiro uso.

### 13.9 O roteiro de implantação

1. **Backup do banco** antes (a 9151 só ACRESCENTA: duas colunas em `mia_raio_x`, uma em
   `mia_raio_x_aceites`, os CHECKs novos e a tabela `mia_raio_x_numeros`).
2. Implantar a versão pela compose do EasyPanel. **Nenhuma variável nova** e nenhum serviço novo: o
   cliente ativo não usa o `raio-x-leitor`. O agendador não muda (a linha do cron é a da .101).
3. Conferir a saúde: `/api/v1/health` com o carimbo `20261105120000_9151_raio_x_do_cliente_ativo` e zero
   erros.
4. Conferir o raio-X que já existia (o mensal "aguardando" da .101): o link mandado ao dono ainda abre, com
   o formulário novo (nome completo e e-mail) e as três etapas; na lista ele aparece como "Conexão do
   WhatsApp".
5. **Primeiro teste com a Empresa Modelo** (demonstração, dado inventado): Admin › Novo raio-X ›
   "Conversas que já estão na MIA", a demonstração, os números, 30 dias, teto de R$ 10. Abrir o link de
   autorização num navegador sem login, autorizar com nome completo e e-mail, e acompanhar o andamento no
   detalhe ("Autorizado por …", "Leu as conversas da conta" em segundos ou minutos). Conferir no rascunho:
   quem respondeu primeiro, a passagem, no que virou, os trechos (nenhum telefone, nomes como [nome]) e o
   custo gravado; e que a conta não recebeu mensagem nenhuma.
6. Depois, com um cliente ativo de verdade e o termo "cliente ativo" revisado pelo advogado: o raio-X
   anterior por conexão da mesma empresa, se houver, aparece sozinho no antes e depois.

Para desfazer: voltar a imagem anterior. As colunas e a tabela novas ficam (são aditivas) e o raio-X do
cliente ativo para de andar; o da conexão segue como na .101.

### 13.10 O que prova o quê (.102)

| teste | prova |
|---|---|
| `tests/unit/raio-x-cliente-ativo-regras.test.ts` | a classificação por `sent_via`, quem respondeu primeiro (segundos, fora do horário), respondido com a loja fechada, a próxima abertura, as faixas da espera e "alguém assumiu", o funil, o nome completo e o e-mail, o termo "cliente ativo" v1, o cadastro da fonte nova e o "novo" do antes e depois |
| `tests/unit/raio-x-cliente-ativo-ciclo-com-duble.test.ts` | o ciclo inteiro sem leitor, com o banco em memória: cria (empresa ativa, números, período limitado), autoriza, lê a conta deixando de fora grupo, pessoal, interno e pedido de exclusão, reaproveita e faz a transcrição, classifica, gera o relatório com quem respondeu, a passagem e o funil, e não escreve na conta; recusa número de outra empresa e empresa que não é cliente ativo |
| `tests/unit/raio-x-compatibilidade-com-a-101.test.ts` | a seção 13.7 |
| `tests/unit/mcp-de-implantacao-raio-x.test.ts` | o criar com a fonte, a conta e os números; o ver com a fonte e o aceite; seguem 110 |
| `tests/invariants/raio-x-do-atendimento.test.ts` | no Postgres: as oito tabelas só do servidor (com `mia_raio_x_numeros`), a fonte fechada e sem sessão, o telefone comercial só em dígitos, o e-mail e o nome completo no aceite, a cascata dos números |
| `tests/e2e/raio-x-cliente-ativo.spec.ts` | pelo navegador: criar pelo Admin com a conta, autorizar sem conectar (o nome só não passa), o cron lê a conta e gera o rascunho, o detalhe com "Autorizado por" e quem respondeu, nenhuma mensagem nova |
| `tests/e2e/raio-x-do-atendimento.spec.ts` | a conexão da .101 com o aceite novo (nome completo e e-mail) |

## 14. A conexão que não trava (.103 e .104)

O primeiro raio-X de verdade (05/11/2026) parou na etapa de conectar. Três defeitos da .101, nenhum de banco:

1. **O código de 8 letras ia para o número com o nono dígito.** O código só vale para o número exato da conta do WhatsApp, e a conta de celular de DDD 31 a 99 fica registrada sem o 9. O celular respondia "Não foi possível conectar o dispositivo. Confira se você inseriu o número de telefone correto". Agora `numeroDaContaDoWhatsapp` (em `lib/channels/raio-x/leitor.ts`) tira o 9 do DDD 31 em diante. DDD 11 a 28, fixo e número de fora passam como vieram. O QR não depende disso.
2. **A sessão que falhou nunca voltava.** Quando o QR ou o código vence sem ninguém conectar, o contêiner marca a sessão FAILED, e `start` numa sessão FAILED responde 422 ("já iniciada"). O `preparar` tratava o 422 como sucesso, e a sessão ficava FAILED para sempre, sem QR nem código. A .103 passou a parar e iniciar a sessão que falhou, e na produção não bastou: o pedido do código de 8 letras grava o número na credencial antes do pareamento, e cada religada entra com essa credencial pela metade, o WhatsApp recusa e ela falha de novo. **Na .104 o `preparar` APAGA a sessão que falhou e a cria de novo, limpa** (com o acervo, sem o "online" e sem webhook). Não perde nada: o `preparar` só é chamado na etapa de conectar (aceite, código e QR), antes de qualquer pareamento ou leitura. A lista fechada não ganhou rota (o apagar já estava nela). O 409 do QR passou a dizer a etapa neutra (`details.estado`: iniciando, parado…).
3. **A cerca da página barrava a própria página.** O andamento (a cada 5 s) e o QR (a cada 20 s) dividiam a cerca de 60 pedidos em 10 minutos com a abertura da página e o aceite. Com uns 4 minutos de tela aberta, o dono era barrado (429) e o QR virava imagem quebrada. Agora o andamento e o QR têm a cerca própria, `raio_x_andamento`, com 400 por IP em 10 minutos (duas abas com folga). A abertura da página e o aceite continuam na cerca de 60.

Na página: enquanto o QR não existe (sessão iniciando ou religando), aparece "Preparando o QR… ele aparece em alguns segundos." no lugar da imagem quebrada, e ela tenta de novo em 5 s. No código, um aviso: se o WhatsApp disser que não foi possível conectar, gerar outro código ou usar o QR no computador.

| teste | prova |
|---|---|
| `tests/unit/raio-x-conexao-destrava.test.ts` | o número sem o 9 por DDD (31, 99, 11, 28, já sem o 9, fixo, fora do Brasil) e o pedido do código com ele; a sessão FAILED é apagada, criada e iniciada (e só parar e iniciar a devolve a FAILED; STOPPED só inicia, SCAN_QR_CODE não é mexida), só por rotas da lista; a cerca do andamento cabe duas abas e só vale para o andamento e o QR; a página troca a imagem quebrada pelo aviso |

## 15. Ler de novo, e a sincronia que não para em zero (.105)

O primeiro raio-X real pela conexão (05/11/2026, número da própria Time) conectou às 20:42 UTC, contou 0 conversas por 5 minutos e fechou a leitura às 20:49: o rascunho saiu com 0 conversas e custo zero, com o WhatsApp ainda conectado. A regra da seção de leitura tratava a contagem PARADA EM ZERO como sincronia pronta.

1. **Zero não é sincronia pronta.** `sincroniaEstavel` (`lib/raio-x/leitura.ts`): com 0 conversas, a leitura espera a espera máxima (40 minutos). Parada num número, continuam valendo os 5 minutos.
2. **Ler de novo.** `acaoLerDeNovo` (`lib/raio-x/acoes.ts`) e `voltarALer` (`lib/raio-x/banco.ts`): um raio-X PRONTO, pela conexão, com o WhatsApp ainda conectado (o leitor o vê conectado) e SEM relatório revisado no período volta a "lendo", desde a sincronia; o rascunho do período sai. No mês novo do mensal (ciclo > 1), a janela do mês fica e a leitura começa direto. As conversas já guardadas não se repetem (marca única) e a análise já feita no ciclo é reaproveitada. Recusa: cliente ativo, desconectado, encerrado, em andamento e período já revisado (aí é encerrar e criar outro). Na tela, o botão **Ler de novo** nos ajustes do detalhe (`POST /api/v1/admin/raio-x/<id>/ler-de-novo`); no MCP, `plataforma_reler_raio_x` (111 ferramentas). Auditoria `raio_x.relido`.
3. **O aparelho agora.** `acaoVerAparelho`: a etapa da sessão no leitor e quantas conversas individuais ele mostra neste momento (até 1.000), sem abrir nenhuma. Sai no `plataforma_ver_raio_x` com `raio_x_id`, como `aparelho`. É o que diz se o histórico chegou ao leitor: com `conversas_agora` em 0, ler de novo não adianta.

| teste | prova |
|---|---|
| `tests/unit/raio-x-ler-de-novo.test.ts` | zero parado não é sincronia pronta (até os 40 minutos), um número parado continua valendo, e a rodada com a lista vazia aos 7 minutos segue sincronizando; ler de novo volta a ler e tira o rascunho do período (e, no mensal, mantém a janela do mês e o revisado anterior); as recusas (em andamento, encerrado, cliente ativo, desconectado, sem sessão, aparelho fora, sem leitor, período revisado) não mexem em nada; o aparelho agora conta página a página, para em mil, diz zero e não pergunta sem conexão |
| `tests/unit/mcp-de-implantacao-raio-x.test.ts` | as cinco do raio-X, reler exige `gerir_raio_x`; seguem 111 |

## 16. A análise que não anda (.106)

Dois raio-X pela conexão entraram em "analisando" em 06/11/2026 e seguiam assim em 09/11, com o custo PARADO e sem relatório: um com 295 conversas e 2.707 mensagens (US$ 0,4191), outro com 9 conversas e 90 mensagens (US$ 0,0105). Até o de 9 conversas parou, então não era lentidão.

**A causa: o portão de tempo da classificação nunca abria.** A rota do cron dá 45 s a cada chamada (`prazo = agora + PRAZO_DA_CHAMADA_MS`, o prazo da importação do histórico do upstream). A .101 só chamava o modelo com os 45 s INTEIROS pela frente (`temTempo(amb, 45_000)`, em `classificar` e no laço de `rodadaDeAnalise`). As leituras do banco antes dela (os prazos, a lista dos que andam, a cotação, os áudios pendentes, as conversas e as mensagens do lote) já gastam milissegundos, e o portão fechava: a classificação devolvia "parou" antes de chamar o modelo, em TODA rodada, sem exceção, sem custo e sem log. O portão dos áudios era de 30 s, e por isso eles andavam: o custo subiu até a transcrição acabar e parou ali. Os testes davam 10 minutos de prazo com o relógio parado, e o portão nunca fechava neles. O primeiro raio-X real (seção 15) não passou por aqui: com 0 conversas, a classificação terminava sem chamar o modelo. O e2e do cliente ativo roda sem chave de IA e marca as conversas sem análise antes de chegar ao portão.

A prova está em `tests/unit/raio-x-analise-anda.test.ts`: com o prazo de verdade do cron e o relógio andando 30 ms por consulta ao banco, dez minutos de cron na .105 não fazem nenhum pedido ao modelo; com o prazo folgado dos testes antigos, a mesma semente gera o relatório. As hipóteses levantadas, pelo código:

1. **Exceção que se repete antes de gravar o progresso:** não era a causa (não havia exceção; o `catch` do ciclo nem era alcançado), mas o risco era real: uma exceção que se repetisse no mesmo item prenderia do mesmo jeito, para sempre. Fechado no item 2 abaixo.
2. **Chamada pendurada:** a transcrição do upstream não tem teto, mas o `fetch` do Node corta em 5 minutos, e isso daria um áudio a cada 5 minutos, não três dias parados com os áudios já transcritos. Fechado com os tetos.
3. **Gargalo de um áudio por vez:** verdadeiro, explica a lentidão dos áudios, não o travamento.
4. **Falta de rodízio:** a ordem por `updated_at` deixa sempre na frente quem não é gravado (o "conectando" que só pergunta ao leitor). Não era a causa, e também foi fechado.

**O conserto.**

1. **O relógio** (`lib/raio-x/relogio-da-analise.ts`). Uma chamada para fora que pode levar até T só começa se termina até o prazo + 10 s: o `-m` de 60 s do agendador deixa 15 s depois do prazo, e 5 deles ficam para gravar. O modelo (teto de 40 s, o mesmo do `AbortSignal` da chamada) e o lote de áudios (10 s de download + 30 s de transcrição) começam até 15 s depois do início da chamada. O prazo e a margem do upstream (`lib/channels/historico/prazo.ts`) ficam como estão.
2. **As falhas seguidas** (`registrarFalha` em `lib/raio-x/analise.ts`). A rodada que lança grava em `mia_raio_x.analise` o `ultimo_erro` (`quando`, `etapa`, `mensagem`, `chave`, `itens` e, quando for o caso, `pulou`) e as `falhas_seguidas`, antes de a exceção subir para o ciclo (que conta a falha e solta a trava, como antes). A `chave` resume a etapa e os itens em curso (ids internos); a mesma chave da rodada anterior soma. Na TERCEIRA seguida, o item sai do caminho: o áudio vira "falhou", a conversa vai sem análise (`analise: null` com o `analise_ciclo` do ciclo), o relatório sai sem a comparação com o anterior (`relatorio_sem_comparacao`) e, no cliente ativo, o preparo dos áudios é dado por feito. A rodada que anda zera a conta. A falha do modelo (o provedor que não responde) usa a mesma conta, por lote; o contador antigo (`falhas`) nunca zerava, e depois de três falhas em qualquer ponto cada falha nova derrubava um lote inteiro. A `mensagem` é curta e sem dado de cliente: as nossas (`raio-x: …`, `sem_resposta`, `transcription_429`, `leitor_…`) passam inteiras; a de fora (provedor, rede) vira só o nome e o status (`AI_APICallError 401`), porque pode trazer pedaço do pedido ou da chave.
3. **`transcrever`.** Os áudios vão de 4 em 4 (`Promise.allSettled`), com o teto de custo conferido para o LOTE antes (entra o que couber, na ordem; o resto fica `fora_do_teto`). O download tem teto próprio de 10 s (`TETO_DO_DOWNLOAD_DO_RAIO_X_MS`; cada um dos dois pedidos ao leitor leva o teto, e a corrida corta o total), e a transcrição, 30 s por `Promise.race` no nosso código. O transcritor da plataforma também passa a mandar um `AbortSignal` ao `fetch`, pelo parâmetro que o upstream já tinha; `lib/messaging/media/transcription.ts` não mudou. Com 10 downloads falhando em sequência (contados entre as rodadas, em `analise.falhas_de_download_seguidas`; um download que chega zera), os pendentes do período viram "falhou" e a análise segue. A fase de áudios tem teto de 30 minutos, contado de `analise.audios_desde`, gravado na primeira rodada que transcreve. Os valores de `transcricao` são só os da constraint da 9150: sem migration. A transcrição que acaba os pendentes segue direto para a classificação, no mesmo minuto. O caractere nulo sai do texto antes de gravar (o Postgres o recusa em texto e em jsonb).
4. **O rodízio** (`emRodizio` em `lib/raio-x/ciclo.ts`): a lista dos que andam começa num ponto que gira a cada minuto (`Math.floor(agora / 60 s) % n`).
5. **A visibilidade.** `andamentoDaAnaliseDaConta` vale para TODA fonte e traz o `ultimoErro` e as `falhasSeguidas`. No detalhe do Admin, a conexão em "analisando" mostra "Áudios: X de Y transcritos · Conversas analisadas: A de B" e, nas duas fontes, o último erro com a etapa. O `plataforma_ver_raio_x` traz o `andamento_da_analise` também na conexão, com a descrição atualizada; seguem 111 ferramentas. As frases novas estão em espanhol no `lib/i18n/dicionario-mia-raio-x.ts`.

**Os dois que estavam parados destravam sozinhos ao subir a versão.** Nada no banco precisa de conserto: os dois estão em "analisando", com a trava solta a cada minuto, os áudios já transcritos e as conversas com `analise_ciclo` nulo. O primeiro minuto de cron com a .106 no ar abre o portão, chama o modelo lote a lote (6 conversas por chamada) e, quando não falta conversa, gera o rascunho. Não precisa reconectar: a classificação e o relatório não chamam o leitor (só o download de áudio chama, e não há pendente). Se ainda houver áudio pendente, ele anda de 4 em 4, com os 30 minutos contados a partir dessa primeira rodada. Medido no teste com o estado de produção (295 e 9 conversas, áudios feitos, `analise` vazia): com o modelo em 6 s por lote, o de 9 conversas fica pronto no 2º minuto e o de 295 no 18º; com 15 s por lote, no 5º e no 53º. O custo da classificação, pela estimativa da seção 5, fica perto de R$ 0,60 no de 295 conversas e de R$ 0,02 no de 9, longe do teto de R$ 40.

**Limites.**

- A falha SEM item (a consulta dos pendentes que falha, a gravação do próprio `mia_raio_x` que falha) não deixa nada de lado: fica à vista no último erro e segue tentando.
- No relatório, o que sai na terceira falha é a comparação com o anterior; se a falha for outra, ela fica à vista e segue tentando.
- A falha de gravação depois de uma chamada paga (transcrição ou modelo) repete a chamada até três vezes antes de o item sair do caminho.
- A corrida de 30 s não cancela o pedido de um transcritor que não aceita sinal; o da plataforma aceita (o `AbortSignal` do `fetch`).
- Os 30 minutos da fase de áudios podem deixar áudios como "falhou" num raio-X com muitos áudios: o primeiro da fila transcreve uns 12 a 16 por minuto.
- O primeiro da fila faz até três lotes de classificação por minuto; com dois raio-X analisando, o rodízio os alterna, e o segundo da fila no mesmo minuto quase nunca tem tempo para o modelo.
- As contagens do andamento são do raio-X inteiro (todas as conversas e áudios), como na .102.

| teste | prova |
|---|---|
| `tests/unit/raio-x-analise-anda.test.ts` | a causa com o relógio de verdade do cron (o portão da .101 fecha com 1 ms gasto; o de agora abre até 15 s, e a chamada mais longa termina antes do `-m` do agendador); os dois de produção destravam sozinhos (295 e 9 conversas); a transcrição que o banco recusa sempre, a análise que não grava numa conversa, o modelo que nunca responde e o relatório que falha na comparação saem do caminho na terceira rodada, com o último erro gravado e sem dado de cliente; o modelo que falha uma vez e volta zera a conta; 4 áudios em paralelo; 10 downloads falhando seguidos (entre rodadas) e o download que chega no meio; o teto de 30 minutos; o teto de custo do lote; a transcrição e o download que não respondem; o rodízio; o andamento da conexão com o último erro no detalhe |
| `tests/unit/raio-x-cliente-ativo-ciclo-com-duble.test.ts` | o mesmo caminho do cliente ativo, agora com o relatório na rodada da transcrição |
| `tests/e2e/raio-x-do-atendimento.spec.ts` | pelo navegador, o detalhe da conexão em "analisando" com os áudios, as conversas analisadas e o último erro |

## 17. O raio-X GRÁTIS POR CADASTRO (.107)

(A seção 16 é o conserto da análise, a .106.)

Protótipo aprovado: `Projeto sistema MIA/Produto/Prototipo-raio-x-gratis-por-cadastro-2026-11-06.html` (as 10 telas, com os
dois ajustes do dono de 06/11: a linha da grátis no lugar dos três cartões da tela 1, e o cadastro sem "quem atende" e sem
horário, que viraram as "duas perguntas" opcionais da tela 3, com o domingo). Quem quer o raio-X do próprio atendimento se
cadastra sozinho, no formulário do SITE (iamia.com.br, outro repositório) ou na página do sistema (`/raio-x/gratis`): a
primeira análise é GRÁTIS, o relatório vai DIRETO para a pessoa (sem a revisão da Time; a Time é avisada), e a pessoa entra
numa área própria SEM SENHA (e-mail + código de 6 números). As próximas análises são AVULSA ou MENSAL, pagas pelo Asaas da
MIA. Todo cadastro vira LEAD no CRM da Time.

### 17.1 O fluxo

| passo | quem | onde |
|---|---|---|
| preencher nome completo, e-mail, o WhatsApp DELA, o WhatsApp ANALISADO (pode ser o mesmo), empresa, segmento e marcar "Li e autorizo" | a pessoa, sem conta | o formulário do site ou `/raio-x/gratis` |
| criar a conta, conferir a grátis, criar o raio-X, gravar o aceite (termo v1), preparar a sessão do leitor, mandar o lead e o e-mail "começou" | o servidor | `POST /api/v1/publico/raio-x/cadastro` |
| conectar o WhatsApp (código de 8 letras ou QR); a página já abre em "conectar" | a pessoa | `/raio-x/<código>` (a mesma de sempre) |
| enquanto o histórico chega: quem atende e o horário (opcional) | a pessoa | o cartão "Enquanto isso: duas perguntas" da página de conexão |
| ler, analisar, gerar o relatório JÁ REVISADO | o servidor (cron de minuto) | `lib/raio-x/ciclo.ts`, `analise.ts` |
| o e-mail "está pronto", o lead atualizado, o aviso à Time | o servidor | `lib/raio-x/entrega.ts` |
| entrar (e-mail → código no e-mail → cookie), ver os raio-X, o relatório, a conexão | a pessoa | `/raio-x/entrar`, `/raio-x/minha-area`, `/raio-x/minha-area/<id>` |
| pedir a nova análise (avulsa ou mensal): interesse sem preço, pagamento com preço | a pessoa | `/raio-x/minha-area/nova` |
| o pagamento confirmado: o raio-X novo da conta | o servidor | o webhook da cobrança acorda a releitura no Asaas |

### 17.2 As decisões do dono (06/11/2026)

1. A primeira análise é grátis; as próximas são avulsa (paga uma vez) ou mensal (assinatura, uma análise todo dia 1).
2. O relatório do cadastro vai direto para quem pediu, sem a revisão; a Time é avisada.
3. Área própria com entrada sem senha: e-mail + código de 6 números.
4. Dois números: o WhatsApp da pessoa (contato) e o analisado (o comercial; pode ser o mesmo).
5. Todo cadastro vira lead no CRM da Time.
6. O formulário mora no site e posta no sistema, que leva a pessoa direto para conectar; o sistema tem a página dele também.
7. Preço ainda não definido; o Asaas da MIA ainda em teste. Sem preço, não há venda: o pedido vira interesse.

### 17.3 O CONTRATO do formulário do site

**Endereço.** `POST https://app.iamia.com.br/api/v1/publico/raio-x/cadastro`

**Corpo.** `application/x-www-form-urlencoded` (o `<form method="post">` comum), `multipart/form-data` ou `application/json`
(o site com `fetch`). Campo que vier a mais é ignorado. Para JSON de outro domínio, o CORS só vale para as origens de
`RAIO_X_SITE_ORIGENS` (separadas por vírgula, só https; na produção, `https://iamia.com.br,https://www.iamia.com.br`, no
`docker-compose.easypanel.yml`). O `OPTIONS` responde 204 com `Access-Control-Allow-Origin`; o POST de formulário não precisa
de CORS. O `retorno_erro` também só aceita essas origens. O domínio mora no ambiente, e não no código, porque é da instalação
(a catraca de host de terceiro em `tests/unit/branding.test.ts`).

| campo | obrigatório | valores aceitos |
|---|---|---|
| `nome` | sim | nome completo: duas palavras ou mais, cada uma com letra, até 120 caracteres |
| `email` | sim | e-mail válido, até 160 (gravado em minúsculas). O relatório e o código de acesso chegam nele |
| `telefone` | sim | o WhatsApp DA PESSOA, com DDD: `(31) 90000-2202`, `31900002202` ou `5531900002202`; de fora do Brasil, com `+` |
| `whatsapp` | sim | o WhatsApp que vai ser ANALISADO, no mesmo formato; pode ser igual ao `telefone` |
| `empresa` | sim | 1 a 120 caracteres |
| `segmento` | sim | `revenda_de_veiculos`, `clinica_odontologica`, `clinica_de_estetica`, `academia`, `imobiliaria`, `loja_e_varejo`, `outro` |
| `aceite` | sim | `sim` (vale também `true`, `on`, `1`; o booleano `true` no JSON) |
| `site` | ARMADILHA | precisa vir VAZIO. No HTML: escondido da tela e do leitor de tela, `tabindex="-1"` e `autocomplete="off"` |
| `quem_atende` | não | `humano` (padrão), `agente` (robô), `misto` (os dois) |
| `abre`, `fecha` | não | `HH:MM` de segunda a sexta; padrão `08:00` e `18:00`; `fecha` depois de `abre` |
| `sabado_ate` | não | `HH:MM` depois de `abre`; AUSENTE = `13:00`; VAZIO = fechado |
| `domingo_ate` | não | `HH:MM` depois de `abre`; ausente ou vazio = fechado |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | não | texto, até 200 (vão ao lead da Time) |
| `gclid`, `fbclid` | não | texto, até 500 (a atribuição do anúncio no lead) |
| `origem` | não | texto, até 200 (ex.: `site`, `instagram`); vai ao lead como `origem_do_site` |
| `retorno_erro` | não | para onde o erro do formulário volta: só `https://iamia.com.br/...` ou `https://www.iamia.com.br/...` (ou `/raio-x/gratis`, a página do sistema). Outro endereço é ignorado |

O termo inteiro para o link "Ler o termo inteiro" do site: `https://app.iamia.com.br/raio-x/gratis#termo` (o termo v1, com
"[a sua empresa]" e "[o WhatsApp analisado]" no lugar do que o aceite grava).

**Respostas do formulário (x-www-form-urlencoded ou multipart):**

| caso | resposta |
|---|---|
| criado | `303` para `https://app.iamia.com.br/raio-x/<CÓDIGO>` (a página de conexão, já na etapa de conectar) |
| a grátis deste número (nas duas grafias do nono dígito) ou deste e-mail já foi usada | `303` para `https://app.iamia.com.br/raio-x/entrar?email=<e-mail>&motivo=ja_usou` (o lead é atualizado mesmo assim) |
| inválido, com `retorno_erro` | `303` para o `retorno_erro` com `?erro=<campo>,<campo>` (os nomes da tabela acima; a armadilha volta como `erro=site`) |
| inválido, sem `retorno_erro` (ou com um de fora) | `400`, uma página simples do sistema com o que conferir e o link "Voltar ao cadastro" |
| muitas tentativas | `429`, página simples |
| falha do servidor | `500`, página simples ("tente de novo em alguns minutos") |

**Respostas do JSON:**

| caso | status | corpo |
|---|---|---|
| criado | `201` | `{ "data": { "raio_x_id", "link", "entrar", "pronto_para_parear" } }` (o site leva a pessoa para `link`) |
| já usou | `409` | `{ "error": { "code": "conflict", "message", "details": { "motivo": "ja_usou", "entrar" } } }` |
| inválido | `400` | `{ "error": { "code": "validation_failed", "message", "details": { "campos": [...] } } }` |
| muitas tentativas | `429` | `{ "error": { "code": "rate_limited" } }`, com `Retry-After` |
| falha | `500` | `{ "error": { "code": "internal_error" } }` |

**Tetos.** 20 cadastros por IP e 5 por e-mail, por hora (`authRateLimited`, rótulo `raio_x_cadastro`).

Exemplo mínimo do formulário do site (dados fictícios):

```html
<form method="post" action="https://app.iamia.com.br/api/v1/publico/raio-x/cadastro">
  <input name="nome" autocomplete="name" required>
  <input name="email" type="email" autocomplete="email" required>
  <input name="telefone" type="tel" placeholder="(31) 90000-2202" required>
  <input name="whatsapp" type="tel" placeholder="(31) 90000-1101" required>
  <input name="empresa" autocomplete="organization" required>
  <select name="segmento">
    <option value="revenda_de_veiculos">Revenda de veículos</option>
    <option value="clinica_odontologica">Clínica odontológica</option>
    <option value="clinica_de_estetica">Clínica de estética</option>
    <option value="academia">Academia</option>
    <option value="imobiliaria">Imobiliária</option>
    <option value="loja_e_varejo">Loja e varejo</option>
    <option value="outro">Outro</option>
  </select>
  <label><input type="checkbox" name="aceite" value="sim" required> Li e autorizo</label>
  <div style="position:absolute;left:-9999px" aria-hidden="true">
    <input name="site" tabindex="-1" autocomplete="off">
  </div>
  <input type="hidden" name="retorno_erro" value="https://iamia.com.br/raio-x">
  <input type="hidden" name="utm_source" value="">
  <button type="submit">Criar meu Raio-X grátis</button>
</form>
```

### 17.4 A conta, a entrada sem senha e a área

- **A conta** (`mia_raio_x_contas`): o e-mail é a identidade (único, minúsculo). O cadastro é SEM login, então NUNCA altera
  uma conta que já existe (decisão do dono, 09/11/2026). E-mail novo: cria a conta com os dados do formulário. E-mail que já
  existe: a conta fica como está (nome e telefone); o raio-X novo, quando permitido (a grátis ainda não usada, por exemplo a
  anterior terminou sem histórico), guarda o WhatsApp e a empresa do formulário NO PRÓPRIO raio-X; e o lead recebe só uma nota
  "Novo cadastro com o mesmo e-mail", com os telefones informados mascarados, sem trocar o contato. Atualizar os dados da
  pessoa, se um dia for preciso, fica dentro da área, depois do código (não construído).
- **A grátis** (`lib/raio-x/contas.ts`, `gratisUsada`): uma por número analisado, pelas DUAS grafias do nono dígito
  (`phoneLookupVariants`), e uma por conta. Não conta a que fechou sem histórico. O banco segura a mesma grafia e a mesma conta
  com dois índices únicos parciais; a corrida de dois cadastros iguais cai neles e vira "já usou".
- **O raio-X do cadastro**: pela conexão, diagnóstico único, 30 dias, teto de R$ 10, `origem = 'cadastro'`, `gratis`,
  `conta_id`, `criado_via = 'cadastro'`. O aceite é gravado na hora (nome completo, e-mail, termo v1, o texto inteiro), a
  sessão do leitor é preparada (como a rota de aceite faz) e a página de conexão abre direto em "conectar". O e-mail "seu
  Raio-X começou" leva o link de conexão (48 h) e como entrar na área.
- **Entrar** (`lib/raio-x/acesso.ts`): conferido antes de construir, o upstream não tem entrada por código no e-mail (o
  CHANGELOG só fala do código do autenticador e do "entrar com o Google"), e usar o Supabase Auth abriria o `/app` para quem
  não é usuário da MIA. A peça segue o jeito dos links HMAC do raio-X e dos painéis, com o `INTERNAL_SECRET`:
  - `POST /api/v1/publico/raio-x/entrar` `{ email }`: código de 6 números (`randomInt`), só o HMAC no banco
    (`mia_raio_x_codigos_de_acesso`, amarrado à conta), 15 minutos. A resposta é a MESMA exista ou não a conta, e o e-mail sai
    sem a rota esperar. Teto: 20 por IP e 5 por e-mail por hora;
  - `POST /api/v1/publico/raio-x/entrar/confirmar` `{ email, codigo }`: vale só o código mais novo, não usado, dentro dos 15
    minutos, com 5 tentativas (cada uma conta ANTES de comparar, por update condicional). Certo: cookie `mia_raio_x_area` =
    `v1.<conta>.<expira>.<HMAC>`, HttpOnly, Secure, SameSite=Lax, 30 dias. Errado, vencido, esgotado ou e-mail sem conta: a
    MESMA frase. Teto: 30 por IP e 10 por e-mail em 10 minutos;
  - `POST /api/v1/publico/raio-x/sair`: apaga o cookie.
- **A área**: `/raio-x/minha-area` (os raio-X da conta com análise, período, conversas, nota, situação e "Abrir"; a conexão do
  número com "Desconectar agora", só do raio-X dela, e "Conectar o WhatsApp" para o que espera, com link novo se o de 48 h
  venceu; "Pedir nova análise"; os pedidos), `/raio-x/minha-area/<id>` (o MESMO relatório do link do dono, `dadosParaODono`:
  sem custo, sem as anotações da Time e sem o bloco da MIA; outro id = 404) e `/raio-x/minha-area/nova`. Todo POST da área
  (`minha-area/nova`, `minha-area/conexao`) confere o cookie e a ORIGEM (Origin, ou Referer, do próprio app). Ao abrir a área,
  os pedidos em aberto são relidos no Asaas (com teto de 4 s de espera).

### 17.5 O lead no CRM da Time

A Time tem a fonte de formulário "Site · pedido de Raio-X" no CRM dela (funil "MIA - SDR" › "Novo contato"). O cadastro entra
por ela pela MESMA lógica de qualquer formulário: `lib/raio-x/lead-da-time.ts` chama a rota de captação
`app/api/v1/webhooks/in/[token]` POR DENTRO (no mesmo processo, com o token e, se a fonte tiver, a assinatura). Não há uma
função em `lib/webhooks/` com o processamento inteiro: ele mora no POST da rota, e chamá-lo é o que não diverge numa
sincronização. Assim o lead passa pela deduplicação, pela atribuição (utm, gclid, fbclid), pelo histórico de captação, pela
classificação inicial e pelos eventos das automações da Time.

- **Configuração:** `RAIO_X_FONTE_DO_CRM` = o id da fonte. Sem ela, o cadastro segue, o log avisa, a conta fica com
  `crm_erro = 'sem_fonte'` e o detalhe do Admin mostra "falta a variável RAIO_X_FONTE_DO_CRM". Fonte apagada ou desligada:
  `fonte_inexistente`.
- **O corpo:** `external_id` = `raiox-conta-<id da conta>` (estável: o mesmo cadastro cai no mesmo negócio), `nome`,
  `telefone` (o da PESSOA, `+55...`), `email`, `empresa`, `segmento` (o rótulo), `whatsapp_analisado` (com nome próprio, para
  não ser lido como telefone), `origem = raio-x-gratis`, `origem_do_site`, `utm_*`, `gclid`, `fbclid` e `raio_x_situacao`.
- **O e-mail que já tinha conta** não vai de novo à fonte: o negócio existente ganha só a nota (17.4), e o contato não muda.
- **Depois do cadastro** (já usou, relatório pronto, sem histórico, nova análise, pagamento): o negócio JÁ criado
  (`crm_lead_id` da conta) é usado como está, sem reenviar o cadastro; só quando ainda não há negócio (a fonte faltou antes, ou
  ele foi apagado) o cadastro vai à fonte com os dados guardados da conta. O negócio ganha os campos pelo merge atômico (`fn_lead_anotar_campos`: `raio_x_situacao`, `raio_x_nota`,
  `raio_x_sem_resposta`, `raio_x_conversas`, `raio_x_relatorio` = o link do dono, `raio_x_pedido`) e uma NOTA na linha do
  tempo (`crm_lead_activities`, tipo `note`, ator sistema). Nunca telefone nem texto de cliente do dono. O `crm_lead_id`
  fica na conta.
- **O aviso à Time:** na Central de avisos da organização da Time (`agent_inbox_items`, `ref_kind = 'lead'`, o botão "Abrir
  negócio") e, com `RAIO_X_AVISO_EMAIL`, por e-mail. A plataforma não tem um canal próprio de aviso para a Time além desses.

### 17.6 O ciclo do cadastro

- O relatório de origem `cadastro` nasce **REVISADO**, sem ator (`revisado_por` nulo) e com a nota da Time "automático:
  cadastro" (`analise.ts`). O ciclo então entrega (`entrega.ts`): o link do dono de 30 dias (`created_via = 'cadastro'`), o
  e-mail "seu Raio-X está pronto" com o resumo e o botão para a área, o lead e o aviso à Time; grava `entregue_em`. Efeitos
  auditados: `raio_x.relatorio_gerado` e `raio_x.relatorio_entregue`. O raio-X da Time não muda: continua em rascunho, com
  revisão.
- **Sem histórico** (o caminho escolhido, o mais simples e correto): a GRÁTIS que chega ao relatório sem nenhuma conversa de
  cliente não gera relatório. A conexão cai (logout e a sessão apagada), o raio-X encerra marcado (`sem_historico_em`), e a
  regra da grátis ignora o raio-X marcado: a pessoa recebe o e-mail "O WhatsApp não mandou o histórico" com o link do
  cadastro e cadastra o MESMO número de novo, como da primeira vez. Efeito `raio_x.sem_historico`. A espera da sincronia é a
  da .105 (zero espera os 40 minutos).

### 17.7 As duas perguntas e o domingo

- **O domingo** (`mia_raio_x.domingo_ate`, 9152): a regra do sábado. Abre no horário da semana e vai até `domingo_ate`; nulo =
  fechado (todo raio-X de antes). Vale em `lojaAberta` e `proximaAbertura` (`horario.ts`), no Novo raio-X do Admin ("Abre no
  domingo?"), no `plataforma_criar_raio_x` (`domingo_ate`, opcional) e no `plataforma_ver_raio_x` (o horário). O horário da
  conta do cliente ativo abre o domingo quando a janela do agente inclui o 0. O relatório não cita o horário por extenso: ele
  só separa loja aberta e fechada, e o domingo entra nessa conta.
- **As duas perguntas** (tela 3): o cadastro não pede mais quem atende nem o horário. Na etapa "lendo" da página de conexão do
  CADASTRO aparece o cartão "Enquanto isso: duas perguntas (opcional)": quem atende hoje (Pessoas, Robô, Os dois), segunda a
  sexta (abre e fecha), sábado e domingo (Fechado ou Aberto até), e "Se não responder, o relatório usa segunda a sexta das 8h
  às 18h, sábado até 13h e domingo fechado." Salva em `POST /api/v1/publico/raio-x/<código>/horario`, com a régua do cadastro
  (`lerHorario`), só no raio-X do cadastro e só ANTES do relatório (situação aguardando, conectando, lendo ou analisando, sem
  relatório nenhum; depois, 409 "O relatório já saiu com o horário que estava"). Confere a origem e tem cerca própria
  (`raio_x_horario`, 30 por IP em 10 minutos). A análise lê o horário do banco na hora de analisar: o que for salvo antes vale.

### 17.8 A nova análise e o pagamento

- `POST /api/v1/publico/raio-x/minha-area/nova` `{ tipo: "avulsa" | "mensal", aceite: true, documento? }`. O número é o do
  raio-X mais novo da conta. Recusa: sem a autorização, tipo errado, sem raio-X na conta e raio-X ainda em andamento (ou mensal
  vivo).
- **Sem preço ativo**: o pedido vira `interesse` (sem valor), o lead ganha "nova análise <tipo>: interesse" e a Time é avisada;
  a tela diz que a equipe vai falar com a pessoa.
- **Com preço** (`mia_raio_x_precos`): pela integração que já existe (`lib/asaas-mia/api.ts`: a chave da tela de Cobrança só no
  cabeçalho, o erro só com o `code`). O cliente do Asaas é o da CONTA (`externalReference = raiox-conta:<id>`, criado na
  primeira vez com o CPF ou CNPJ, que o Asaas exige para o Pix e o boleto; ele vai direto ao Asaas e não é guardado, o molde de
  `lib/cobranca/documento.ts`). Avulsa = cobrança única (`POST /payments`, vence em 2 dias); mensal = assinatura (`POST
  /subscriptions`, mensal); as duas com `billingType = UNDEFINED` (a fatura do Asaas oferece Pix, boleto e cartão) e
  `externalReference = raiox-pedido:<id>`. A tela leva a pessoa à fatura. Falha no Asaas: o pedido vira interesse, com o `code`.
- **O aviso do Asaas**: o webhook que já existe (`app/api/v1/webhooks/cobranca/[provedor]`) reconhece o cliente de uma conta do
  raio-X e só ACORDA a releitura dos pedidos dela (`relerPedidosDaConta`), sem emitir `cobranca.sinal`, sem passar pelo balde
  dos clientes desconhecidos, e fecha a linha. O cliente de empresa e o desconhecido seguem exatamente como antes. Quem decide
  é o GET no Asaas, nunca o corpo do aviso (a cobrança tem de ter a referência do pedido).
- **Pago** (uma vez só, update condicional): nasce o raio-X novo da conta (o mesmo número, `origem = cadastro`, nunca grátis;
  avulsa = único, mensal = mensal; teto R$ 40), com o aceite da pessoa (termo v1). Se o WhatsApp do anterior ainda está
  conectado, a MESMA sessão do leitor passa para o novo (o anterior fica com o relatório e o prazo das conversas, sem o prazo
  de derrubar a conexão) e a leitura começa sozinha; senão, o link de conexão vai por e-mail. O lead e a Time ficam sabendo.
- **Cancelado ou estornado**: o pedido vira `cancelado`, e nada nasce.

### 17.9 O Admin e o MCP

- **Admin › Raio-X**: a lista mostra a ORIGEM (Time, cadastro grátis, avulsa, mensal), quem se cadastrou (nome, e-mail,
  WhatsApp da pessoa), "enviado" e "sem histórico"; o detalhe tem o bloco "Quem pediu" (a conta, o lead no CRM da Time, a
  entrega e os pedidos). O preço da nova análise fica num formulário pequeno na lista (`PUT /api/v1/admin/raio-x/precos`, com a
  verificação em duas etapas; auditoria `raio_x.precos_alterados`).
- **MCP**: `plataforma_ver_raio_x` mostra a origem, a conta (e-mail e telefone MASCARADOS, `maskEmail`/`maskPhone`), a entrega,
  o sem histórico, os pedidos e, na lista, os preços. Ferramenta nova `plataforma_precos_do_raio_x` (`gerir_raio_x`): vê e
  define o preço. **112** ferramentas.
- **Auditoria nova**: `raio_x.cadastro_repetido`, `raio_x.entrou_na_area`, `raio_x.relatorio_entregue`, `raio_x.sem_historico`,
  `raio_x.pedido_criado`, `raio_x.pedido_pago`, `raio_x.pedido_cancelado`, `raio_x.precos_alterados`. Nunca o código, o cookie,
  o CPF ou o CNPJ.

### 17.10 O banco (9152)

Carimbo `20261106120000_9152_raio_x_por_cadastro`. Só objetos nossos, idempotente, espelho no `baseline-mia.sql`:

| objeto | o quê |
|---|---|
| `mia_raio_x` (colunas) | `conta_id` (fk, set null), `origem` ('time' padrão, 'cadastro'), `gratis`, `sem_historico_em`, `entregue_em`, `domingo_ate`; CHECKs `mia_raio_x_origem`, `mia_raio_x_gratis_do_cadastro`, `mia_raio_x_cadastro_pela_conexao`, `mia_raio_x_domingo`; a CHECK NOSSA `mia_raio_x_criado_via` aceita 'cadastro' (drop + add só quando ainda não aceita); índices únicos parciais da grátis por conta e por número |
| `mia_raio_x_links` | a CHECK NOSSA `mia_raio_x_links_created_via` aceita 'cadastro' |
| `mia_raio_x_contas` | e-mail único e minúsculo, nome completo, o WhatsApp da pessoa, o lead do CRM, o cliente do Asaas, o último acesso |
| `mia_raio_x_codigos_de_acesso` | só o hash, validade, tentativas, usado em; cascata com a conta |
| `mia_raio_x_pedidos` | tipo, valor, situação (interesse, aguardando, pago, cancelado), as referências do Asaas, o raio-X anterior e o que nasceu |
| `mia_raio_x_precos` | o preço por tipo (R$ 5 a R$ 10 mil), ativo; nasce VAZIA |

As quatro tabelas novas são só do servidor (RLS ligada SEM política, grants revogados de `anon` e `authenticated`).

### 17.11 O roteiro de implantação

1. **Backup do banco** antes (a 9152 só acrescenta).
2. Implantar a imagem. **Variáveis novas, as duas opcionais:** `RAIO_X_FONTE_DO_CRM` (o id da fonte "Site · pedido de Raio-X"
   da Time) e `RAIO_X_AVISO_EMAIL` (o e-mail que recebe o aviso). Sem a primeira, o cadastro funciona e o lead não entra.
   `RAIO_X_SITE_ORIGENS` já vem no `docker-compose.easypanel.yml` (não é segredo); sem ela, o site não consegue postar por JSON
   nem receber o erro de volta.
3. Saúde: `/api/v1/health` com o carimbo `20261106120000_9152_raio_x_por_cadastro` e zero erros.
4. Conferir o envio de e-mail da instalação (o remetente `naoresponda@iamia.com.br`): sem e-mail, o cadastro funciona, mas o
   código de acesso e o "está pronto" não chegam.
5. **Primeiro teste com um número da própria Time**: `/raio-x/gratis`, cadastrar, conectar, responder as duas perguntas,
   esperar o e-mail, entrar com o código, abrir o relatório. Conferir o lead no CRM da Time e o aviso na Central.
6. Só então ligar o formulário do site (17.3) e, com o preço e o Asaas em produção, os preços (Admin ou MCP).

Para desfazer: voltar a imagem. As tabelas e colunas ficam (são aditivas); o raio-X da Time segue como antes.

### 17.12 Os limites e o que ficou de fora

- **O preço não está definido** e o Asaas da MIA está em teste: a tabela de preços nasce vazia, e todo pedido é interesse até
  a Time definir.
- **O CPF ou CNPJ na nova análise**: a tela 8 do protótipo não tem o campo, mas o Asaas exige o documento para criar o cliente
  (Pix e boleto). A tela pede só quando há preço e a conta ainda não é cliente do Asaas; o documento não fica guardado.
- **O termo**: a grátis, a avulsa e a mensal usam o termo v1 (o mensal com a frase do acompanhamento). O texto do mensal e a
  revisão do advogado continuam pendentes (decisão 4 do protótipo).
- **Verificação contra robô**: só a armadilha `site` e os tetos por IP e por e-mail; não há captcha.
- **Aviso por WhatsApp**: só e-mail (decisão 3 do protótipo: o WhatsApp oficial da MIA ainda não existe).
- **"Falar com a equipe"**: não há número da Time configurado; a área diz para falar pelo WhatsApp do cadastro.
- **Os dados da pessoa não se editam** em lugar nenhum por enquanto: o cadastro sem login não muda a conta (17.4), e a área
  ainda não tem a tela de editar.
- **O "valor volta como crédito"** da tela 8, quando o histórico não chega na análise paga: não há crédito no código; a tela
  diz que a equipe combina uma nova tentativa.
- **O e2e** foi escrito no molde da spec do raio-X (entra na parte 7), mas não rodou nesta máquina (sem a pilha do e2e).

### 17.13 O que prova o quê (.107)

| teste | prova |
|---|---|
| `tests/unit/raio-x-cadastro-regras.test.ts` | a validação do cadastro (campos, recusa pelos campos, opcionais e padrões, o domingo), a armadilha, o `retorno_erro` só do site, o código (hash amarrado à conta), o cookie (assinatura, validade, adulterado) e a origem dos POST |
| `tests/unit/raio-x-cadastro-com-duble.test.ts` | o cadastro de ponta a ponta no banco em memória; o lead pela chamada interna da fonte com os campos certos e sem a variável não quebra; o 2º cadastro com o mesmo e-mail e outro telefone não muda a conta nem o contato do lead (só a nota, mascarada); a grátis pelas duas grafias e por conta; o sem histórico não conta; o código (15 min, 5 tentativas, e-mail sem conta); a área só vê o que é da conta; o ciclo publica direto o do cadastro e NÃO o da Time; 0 conversas não gasta a grátis; sem preço vira interesse; com preço a cobrança no Asaas; pago cria o raio-X novo uma vez só e passa a conexão; cancelado marca |
| `tests/unit/raio-x-rotas-do-cadastro.test.ts` | o 303, 201, 409 e 400 do cadastro, o CORS do site, a armadilha, entrar com a resposta igual, o cookie HttpOnly/Secure/Lax, a área sem cookie e de fora |
| `tests/unit/raio-x-webhook-do-pedido.test.ts` | o aviso do Asaas de um pedido acorda a releitura, e o cliente de empresa e o desconhecido seguem como antes |
| `tests/unit/raio-x-domingo-e-duas-perguntas.test.ts` | o domingo aberto e fechado em `lojaAberta` e `proximaAbertura`, o horário da conta, o Novo raio-X; o endpoint do horário aceita antes do relatório, recusa depois, valida, recusa o da Time e de fora |
| `tests/unit/mcp-de-implantacao-raio-x-por-cadastro.test.ts` | a origem, a conta mascarada e os pedidos no ver; a ferramenta dos preços (mostrar, definir, tirar, auditar); 112 |
| `tests/invariants/raio-x-por-cadastro.test.ts` | no Postgres: as quatro tabelas só do servidor, os CHECKs, uma grátis viva por conta e por número, a sem histórico não conta, o `criado_via` e o link do dono com 'cadastro', o domingo |
| `tests/e2e/raio-x-por-cadastro.spec.ts` | pelo navegador: o formulário → a página de conexão → o código lido de um dublê de SMTP → a área com o raio-X e o relatório |

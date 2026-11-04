# O raio-X do atendimento (.101)

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
link vivo) e `fn_mia_raio_x_apagar_conversas` (o prazo de 30 dias; com corte, só as
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
  fechado. Feriado não entra.
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

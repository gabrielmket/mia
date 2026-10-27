# O assistente da MIA (.88, .91 nos primeiros passos e .94 no faz com aprovação)

O chat que a equipe de cada cliente usa dentro do sistema: a rotina do dia ("como
está minha rotina hoje?", "por onde eu começo?"), os números ("como estão meus
leads?", "minha performance no mês") e o uso do sistema ("como configuro o horário
da IA?"). Quando não sabe, diz que não sabe e manda a pergunta ao suporte da Time
Company; erro e pedido viram **chamado**.

Protótipo aprovado em 24/10/2026 (8 telas, 18 regras). É a **fase 1** da spec do
upstream (#2860, "agente interno de configuração e rotina", fechada sem código): o
chat de leitura. Na .91 (jornada de assinatura, protótipo aprovado em 25/10/2026) ele
ganhou a parte da **fase 2** (propostas com aprovação, só três peças) e da **fase 3**
(a auditoria da empresa, "o que falta", com retrato guardado) que serve à entrada de um
cliente novo: veja a seção 9 e [`primeiros-passos.md`](primeiros-passos.md). O laço de
retorno (fase 4) fica para depois.

## 1. A regra que não se dobra

**O assistente não tem acesso próprio.** O turno lê o CRM com o cliente da SESSÃO de
quem perguntou, e a RLS e o papel filtram como nas telas: o atendente vê os próprios
números, o gestor e o administrador veem a equipe. O cliente de serviço é proibido
dentro do turno:

- `lib/assistente/turno.ts` recusa o cliente montado com a chave de serviço (ou com a
  marca do `createAdminClient`) antes de qualquer leitura (`exigirClienteDeSessao`);
- o turno, as ferramentas e as leituras não importam o cliente de serviço nem o pool;
- `tests/unit/assistente-turno-usa-a-sessao.test.ts` prova as três coisas, com a
  sabotagem (tirar a guarda deixa 1 vermelho de 14).

Duas preparações usam o cliente de serviço FORA do turno, e as duas são as mesmas que
o produto já fazia: o diretório de nomes da equipe (`lib/assistente/diretorio.ts`, o
mesmo de `/api/v1/team/assignable`, que qualquer atendente já recebe) e o pool do seam
de modelo (telemetria e orçamento em `llm_calls`, `lib/assistente/modelo.ts`).

## 2. As peças

| peça | onde |
|---|---|
| botão "Assistente" no topo, ao lado do sino; abre o painel ao lado de qualquer tela e sabe em que tela a pessoa está | `components/assistente/BotaoDoAssistente.tsx` (em `components/shell/TopBar.tsx`) |
| o painel (conversa, sugestões, "de onde veio", botões) | `components/assistente/PainelDoAssistente.tsx`, `MensagemDoAssistente.tsx`, `CartaoDoChamado.tsx` |
| a página: histórico, resumo da manhã, chamados; para o administrador, "como trabalhamos aqui", quem usa e as perguntas sem resposta | `app/app/assistente/` (porta no `NAV_CATALOG`, hub do CRM, "O dia a dia da venda") |
| o turno e as ferramentas de leitura | `lib/assistente/turno.ts`, `ferramentas.ts`, `leituras/*.ts` |
| o ponto de IA `assistente` | `lib/ai/pontos/registro.ts` (papel "entender", natureza "sistema") |
| as rotas | `app/api/v1/assistente/{chat,chamados,chamados/[id]/print,pedir,preferencias,empresa}` |
| os chamados do lado da Time | `/admin/chamados` e `app/api/v1/admin/chamados/*` |
| o resumo da manhã e a retenção | `lib/assistente/resumo-da-manha.ts`, cron `assistente-resumo-da-manha` |
| o MCP de plataforma | `lib/mcp-plataforma/ferramentas/assistente.ts` ([`mcp-de-implantacao.md`](mcp-de-implantacao.md)) |
| o schema | 9050 (tabelas, RLS, bucket, gatilhos), 9051 (LGPD e retenção) e 9052 (o índice dos contatos citados) |

## 3. O que o assistente lê (ferramentas só de leitura)

| ferramenta | de onde vem o número |
|---|---|
| `ver_minha_rotina` | `crm_tasks`, `calendar_appointments`, `conversations` (a aba Minhas e a Fila do Inbox), `channel_sessions` (só o administrador) |
| `ver_prioridades` | as mesmas, mais o Radar e a meta, na ordem do protótipo: algo parado na empresa, cliente esperando, compromisso do dia, atraso, meta |
| `ver_meus_leads` | `crm_leads` abertos por dono e o Radar (`carregaRadarDeRisco`, a mesma função da tela) |
| `ver_minha_performance` / `ver_numeros_da_equipe` | o motor de relatórios do fork (`fn_mia_relatorio`, `security invoker`) e a meta (`lerMetasDoMes`, a MESMA leitura do `GET /api/v1/metas`) |
| `ver_por_que_a_ia_nao_respondeu` | a conversa pela sessão (o atendente só acha as suas), o opt-out, quem está com a conversa, o número, o agente no ar, o horário da IA (.85) e `agent_turn_traces` (v1.88) |
| `buscar_ajuda` | os manuais e roteiros do fork, o guia de operação do upstream, o catálogo de navegação e a base própria da empresa (seção 9) |
| `ver_contato` | o nome; telefone e e-mail só quando a pessoa pediu |

Desde a .91, mais quatro (seção 9): `ver_o_que_falta` (leitura) e as três propostas,
`propor_agente_do_modelo`, `propor_funil_do_pacote` e `propor_followup_do_modelo`, que
PREPARAM a peça sem gravar nada no turno.

E quatro que só põem botão na resposta: `mostrar_me_leva_la` (só tela que a pessoa
abre), `oferecer_pedir_a_pessoa`, `registrar_que_nao_sei` (vira "Mandar ao suporte" e
entra na lista do administrador) e `preparar_chamado` (antes de um Erro, confere se é
só um campo faltando, pela última recusa que a tela viu, `lib/assistente/ultima-recusa.ts`).
Nenhuma escreve: pedir, mandar e abrir chamado são cliques da pessoa.

O "de onde veio" de cada resposta sai do que as ferramentas DE FATO leram, não do que
o modelo diz ter lido. Nenhuma ferramenta lê texto de conversa.

## 4. Os chamados

Erro, Dúvida ou Pedido. O contexto (tela, hora, versão, navegador, mensagem do sistema)
é montado no servidor; o print é opcional, no bucket privado `mia-assistente`. O
gatilho `fn_mia_chamado_nasce` faz o chamado nascer da própria pessoa, "novo", sem
resposta, com o número da sequência, e a marca de demonstração vem da EMPRESA. Na
demonstração ele fica no assistente e não sai: não aparece no admin, não vai recado ao
grupo interno. Fora dela, o grupo interno da Time recebe o número e a empresa (nunca o
texto). A resposta chega a quem abriu no assistente, no sino e no e-mail.

## 5. O limite e o custo

A IA é da plataforma: 50 perguntas por pessoa por dia (padrão), ajustável por empresa
pelo MCP, contadas no banco pela sessão (a pessoa não apaga as próprias perguntas). O
gasto entra no consumo de IA da empresa (`llm_calls`, ponto `assistente`). O custo em
dinheiro segue a doutrina do fork (`lib/ai/custo-e-da-plataforma.ts`): só a plataforma
o vê, no `plataforma_ver_assistente`; o cliente não.

## 6. Histórico, resumo da manhã e LGPD

- Cada pessoa vê só o seu histórico; o administrador vê só as PERGUNTAS sem resposta.
- Retenção de 90 dias (`fn_mia_expurgar_assistente_vencido`, piso de 30), e os chamados
  resolvidos há mais de um ano; o print sai pela fila de remoção do upstream.
- A mensagem guarda os contatos que cita (`contatos`): anonimizar o contato apaga o
  texto dela (bloco 6 de `fn_redigir_o_que_sobrou_do_contato_anonimizado`, 9051), e o
  acesso do titular a coleta (`assistente_da_mia`, seção da equipe: vai no relatório e
  não no arquivo dele, como a conversa com a IA sobre o caso).
- O acesso do titular procura por IGUALDADE, como toda outra seção do coletor: a lista
  vira o índice `mia_assistente_citacoes` (9052, mantido por gatilho, só do servidor), e
  o coletor lê as citações pelo `contact_id` e depois as mensagens. A primeira versão
  usava "contém" (`cs`) e reprovou no CI: nenhum dublê do coletor nem ponte SQL dos
  invariantes responde esse operador.
- O resumo da manhã nasce desligado; cada pessoa liga o seu. Em dia útil (sem sábado,
  domingo e feriado nacional), às 8h no fuso da empresa, o cron escreve o plano do dia
  sem IA nenhuma (as mesmas leituras e a mesma ordem) e avisa no sino.

## 7. Os pontos de ligação no código do upstream (lista fechada)

| arquivo do upstream | o que entrou (marcado FORK MIA) |
|---|---|
| `components/shell/TopBar.tsx` | o botão do assistente |
| `lib/navigation/catalogo.ts`, `registry.ts` | a porta e o ícone |
| `lib/ai/pontos/registro.ts`, `lib/ai/custo/natureza.ts` | o ponto de IA e a natureza do gasto |
| `lib/ai/inbox-destino.ts` | as referências `mia_chamado` e `mia_assistente_resumo` |
| `lib/api/client.ts` | a anotação da última recusa do servidor |
| `lib/audit/actions.ts` | os códigos `assistente.*` |
| `lib/lgpd/export-collector.ts`, `copia-do-titular.ts` | a seção `assistente_da_mia` |
| `lib/i18n/dicionario.ts` | o dicionário do assistente |
| `components/admin/AdminSidebar.tsx` | a porta dos chamados |
| `docker/scheduler/entrypoint.sh` | o cron |
| `lib/ai/agents/publish.ts` (.91) | o follow-up proposto sai junto com o agente publicado (import dinâmico de `lib/assistente/propostas/sai-com-o-agente.ts`) |
| `lib/ai/inbox-destino.ts` (.94) | a referência `mia_assistente_proposta` (o pedido com o cartão pronto e o resultado dele) |
| `lib/audit/actions.ts` (.94) | `assistente.proposta_pedida`, `_ajustada`, `_desfeita` e `assistente.desfazer_travado` |
| `lib/i18n/dicionario.ts` (.94) | o dicionário do faz com aprovação (`dicionario-mia-assistente-faz.ts`) |

## 8. Para voltar ao upstream

O desenho e os nomes seguem a spec #2860 (o turno sem `send_message`, as ferramentas de
leitura, o ponto próprio no registro, a porta no topo junto do sino). As tabelas levam
o prefixo `mia_` para não colidir com as `config_threads`/`config_messages` que a spec
propõe: no dia em que o upstream construir a fase 1, a troca é de nome, não de forma.

## 9. Os primeiros passos (.91): "o que falta" e as propostas

O assistente aparece como painel ao lado nos primeiros passos (o `/onboarding` do
upstream e o Início, `/app/inicio`), o MESMO `PainelDoAssistente` desta página, com as
sugestões e a saudação do contexto. Quem vê, e por quê, está em
[`primeiros-passos.md`](primeiros-passos.md).

**`ver_o_que_falta`.** O "o que falta" é o checklist do MCP
(`plataforma_ver_implantacao`), avaliado com o cliente da SESSÃO
(`lib/assistente/leituras/o-que-falta.ts` → `avaliarAreas`) e lido no rótulo do cliente
(`lib/mcp-plataforma/checklist/rotulo-do-cliente.ts`): preenchido, posso completar,
preciso confirmar e não se aplica, com a dependência de cada item. Não existe segunda
régua. A área que o papel não lê fica "não medida" e o item dela sai do rótulo, em vez
de virar uma pendência que não é verdade. A única coisa da instalação que a sessão não
lê, a chave da cobrança, a rota lê fora do turno (como o layout de `/app`) e passa pronta.

**As três propostas.** Uma proposta é UMA peça (`lib/assistente/propostas/`):

| ferramenta | a peça | nasce como |
|---|---|---|
| `propor_agente_do_modelo` | o agente de exemplo da demonstração do segmento (`lib/onboarding/modelos-de-agente-da-mia.ts`), com o nome e o texto do modelo | RASCUNHO; vira o agente padrão se a empresa não tem um |
| `propor_funil_do_pacote` | o quadro pronto do segmento, no lugar do quadro de e-commerce que veio com a empresa | o funil padrão da empresa |
| `propor_followup_do_modelo` | o follow-up do modelo do segmento, armado no rascunho do agente, só em horário comercial (8h às 19h, dia útil) | rascunho; SAI JUNTO com o agente publicado |

- **Propor não cria nada.** O turno só LÊ (com a sessão) e junta a proposta no coletor;
  a rota do chat grava a linha PENDENTE em `mia_assistente_propostas` (9080), pela
  sessão, e põe o cartão na resposta (`AcaoDoAssistente` do tipo `proposta`). Pedir de
  novo a mesma peça devolve a mesma pendente (uma por peça e empresa).
- **Quem pede:** gestor e administrador. O atendente recebe a recusa com quem pode.
- **Quem aplica:** só o administrador, no cartão ("Aprovar e aplicar", desabilitado
  para os outros, com o porquê ao lado). `POST /api/v1/assistente/propostas/[id]`
  exige o papel de administrador para `aplicar` (gestor para `rejeitar`), passa pela
  guarda do suporte e grava o registro (`assistente.proposta_aplicada`,
  `_rejeitada`, `_falhou`). A peça nasce pelo caminho da implantação
  (`garantirAgente`, `garantirFunil`, `garantirFollowup`), o mesmo do MCP.
- **A ordem é do banco:** pendente → aprovada → aplicada (ou rejeitada, expirada). O
  gatilho `fn_mia_proposta_segue_a_ordem` recusa aplicar sem aprovar, mesmo pelo
  servidor (a sabotagem que o desenho do upstream pede, provada em
  `tests/invariants/primeiros-passos-do-assistente.test.ts`).
- **Nada crítico é proposto.** Canal, número, cobrança, usuários, convite, chave e
  exclusão não têm ferramenta, e o banco recusa o risco `critico`: no "o que falta"
  eles são "preciso confirmar", com o botão da tela.
- **O follow-up sai junto com o agente publicado.** Publicar o agente (pela tela, pelo
  passo a passo ou pelo MCP) passa por `publishAgentVersion`; o gancho
  `publicarFollowupsQueSaemComOAgente` publica o fluxo proposto que a versão publicada
  carrega armado, e anota `saiu_com_o_agente_em`. Sem quem publicou, não sai.

**O retrato** (`mia_assistente_retratos`, 9081): a cada rodada do "o que falta" de quem
administra, o servidor guarda as contas e a coluna de cada item, só quando algo mudou.
É o "ao entrar faltavam N, agora faltam M" e o "zerou" que tira o bloco do Início.

**No MCP** (seção .91 de [`mcp-de-implantacao.md`](mcp-de-implantacao.md)):
`plataforma_ver_implantacao` devolve o rótulo do cliente; a Time vê as propostas de uma
empresa com `plataforma_ver_propostas_do_assistente` e decide com
`plataforma_decidir_proposta_do_assistente`.

## 10. A ajuda de uso cobre todas as telas (.92)

Em 26/10/2026 o Gabriel perguntou, na tela "Servidor MCP externo", "como eu uso o mcp
aqui", e o assistente respondeu que não sabia: os manuais tinham 19 assuntos e nenhum
falava da tela. A causa era cobertura. Desde então o `buscar_ajuda` lê quatro fontes,
todas pela mesma régua (`lib/assistente/busca-da-ajuda.ts`):

| fonte | onde | "de onde veio" |
|---|---|---|
| manuais das telas e do dia a dia | `lib/assistente/manuais.ts`, `manuais-das-telas.ts` | Manual do sistema |
| roteiros (tarefas que cruzam telas: começar a atender, campanha, a IA está vendendo, ligar o Claude) | `lib/assistente/roteiros.ts` | Manual do sistema |
| o guia de operação do upstream, tela a tela | `lib/assistente/guia-de-operacao.gen.ts` (gerado) e `guia-de-operacao.ts` | Guia de operação |
| o mapa das telas e a base da empresa | `NAV_CATALOG` e `mia_assistente_conhecimento` | Mapa das telas, Como trabalhamos aqui |

- **A busca:** sem acento e sem maiúscula; um radical leve que não junta "conversa" com
  "conversão"; sinônimos do jeito que a equipe fala (MCP, token e chave, número e
  WhatsApp, follow-up e retomada); palavra rara pesa mais. A tela em que a pessoa está
  pesa: "como uso isso aqui" traz a ajuda dela primeiro. Volta no máximo 3 manuais, 3
  trechos curtos do guia e 3 telas.
- **MCP é duas coisas.** O Servidor MCP externo (a IA da empresa consulta um sistema de
  fora; tela do dono da instalação) e o MCP da MIA (`/api/mcp`, token criado em API
  Tokens pelo administrador, com `mcp:read` e `mcp:write`). Cada manual traz o outro em
  `veja_tambem`, e o assistente responde pela tela em que a pessoa está.
- **O guia do upstream** mora em `.claude/skills/deskcomm-operacao/`, que a imagem não
  leva. `scripts/gerar-guia-de-operacao.ts` gera o módulo; a cerca
  `assistente-guia-de-operacao` fica vermelha quando a fusão trouxer o guia novo. Onde o
  código da MIA desmente o guia (o MCP externo tem tela; modelo, chave e marca são da
  plataforma), a correção é `SUPERADOS_PELO_CODIGO`, nunca o guia nem o gerado.
- **As cercas:** `assistente-ajuda-cobre-todas-as-telas` (toda tela principal do app,
  inclusive cada subpágina de Configurações, tem ajuda própria; toda subpágina é
  alcançada) e `assistente-perguntas-reais` (uma pergunta por tela e por roteiro, com a
  tela de onde veio; o trecho certo entre os 3 primeiros, sem IA).
- **Tela nova:** escreva o manual em `manuais-das-telas.ts` lendo o código da tela e
  acrescente a pergunta em `assistente-perguntas-reais`. Sem isso o CI reprova.

## 11. O assistente faz com aprovação (.94)

Protótipo "ensina e faz" aprovado pelo Gabriel em 26/10/2026, sem mudanças (telas 3, 4, 5 e
7; as 13 decisões da tela 8). É a fase 2 do desenho do upstream (#2860) crescendo na MESMA
tabela da .91 (`mia_assistente_propostas`, 9080 e 9100), sem duplicar. A parte de ENSINAR
(as trilhas e o "Me mostra como", telas 1, 2 e 6) é de outra frente.

### As peças

Nove novas e as três da .91 (`lib/assistente/propostas/catalogo.ts`). Um cartão é uma peça:
três etapas são três cartões, e pedir de novo a mesma peça devolve o mesmo cartão (a
`chave` da peça). Nas nove do dia a dia a chave é por pessoa (`chaveNoBanco`): o atendente não enxerga a pendente de outra pessoa, e assim cada um recebe o seu cartão; se duas pessoas pedem a mesma peça, quem aprova vê os dois cartões, e a segunda a ser aplicada esbarra no "já existe" quando a peça não pode repetir (etapa, atalho, etiqueta, follow-up, item de conhecimento). As três da .91 continuam uma por empresa.

| peça | ferramenta do assistente | nasce pelo caminho de | quem aprova | desfaz enquanto |
|---|---|---|---|---|
| criar etapa do funil (antes de outra) | `propor_etapa_do_funil` | `criarEtapa` e `atualizarEtapa({ depois_de })` (Etapas do funil) | gestor ou administrador | a etapa estiver vazia (nenhum negócio, nenhuma entrada automática); sai ARQUIVADA, como na tela |
| renomear etapa | `propor_renomear_etapa` | `atualizarEtapa({ name })` | gestor ou administrador | ninguém renomear de novo: volta o nome antigo |
| resposta rápida | `propor_resposta_rapida` | o insert de `POST /api/v1/message-templates` | a sua: quem pediu; a da equipe: gestor ou administrador | ninguém editar |
| etiqueta | `propor_etiqueta` | `fn_vocabulario_de_tags_operar` (a função da tela de Etiquetas, com a verificação em duas etapas) | gestor ou administrador | nenhum contato, negócio ou conversa a tiver |
| tarefa | `propor_tarefa` | o insert de `POST /api/v1/tasks` | para si: quem pediu, ou gestor e administrador; para outra pessoa: gestor ou administrador | não for concluída nem cancelada |
| rascunho de follow-up | `propor_rascunho_de_followup` | o modelo de retomada do segmento, em rascunho, com as três mensagens escritas | gestor ou administrador | continuar rascunho, sem ninguém na régua e sem agente que o arme |
| item de conhecimento | `propor_item_de_conhecimento` | `garantirConhecimento`, no material de perguntas que o agente no ar já lê (ou em "Respostas do dia a dia") | gestor ou administrador | sempre: o item sai (o material novo, vazio, é arquivado) |
| relatório | `propor_relatorio` | `criarRelatorio` (o montador) | o seu: quem pediu; o da equipe: gestor ou administrador | não estiver num painel |
| meta do mês | `propor_meta_do_mes` | `gravarMeta` (Desempenho) | só o administrador (decisão 2) | ninguém mudar a meta: volta a anterior |
| agente do modelo (.91) | `propor_agente_do_modelo` | `garantirAgente` | só o administrador | nunca ter sido publicado e nenhum follow-up proposto depender dele: é arquivado e o nome fica livre |
| funil do quadro pronto (.91) | `propor_funil_do_pacote` | `garantirFunil` | só o administrador | nenhum negócio entrar: o funil volta ao quadro de antes (o retrato que o aplicar guarda; nas propostas aplicadas na .91, o quadro que veio com a empresa) |
| follow-up do modelo (.91) | `propor_followup_do_modelo` | `garantirFollowup` armado no agente | só o administrador | não sair com o agente publicado: sai do rascunho do agente e é apagado |

### As regras

- **Nada muda antes do "Aprovar e aplicar".** A ferramenta só LÊ com a sessão
  (`preparar-do-dia-a-dia.ts`); a rota do chat grava a linha pendente; a peça nasce no
  aplicar (`aplicar-do-dia-a-dia.ts`). O pedido é conferido no servidor antes do aplicar
  (`validar.ts`): a linha nasce pela sessão, e um pedido forjado no PostgREST é recusado.
- **Com o login de quem aprova.** Pelo cartão, a peça do dia a dia nasce com a SESSÃO de
  quem clicou e pela mesma função da tela, então a RLS vale como no clique. A linha da
  proposta continua escrita só pelo servidor (a sessão não a atualiza). As três da .91
  seguem pelo caminho da implantação, como antes.
- **Quem aprova é quem pode fazer o mesmo na tela** (decisão 1, `quem-aprova.ts`). As
  exceções são mais fechadas que a tela: a meta e as três peças da .91, só o administrador
  (decisão 2). Também fecha a tarefa para outra pessoa (gestor), como a tabela do protótipo.
  Desfazer é de quem aprova aquele tipo. Propor é de atendente em diante; a meta, de gestor
  em diante (o atendente não vê a meta da equipe pelo assistente).
- **Pedir com o cartão pronto** (decisão 5, `pedir.ts`). Quem não aprova clica em "Pedir
  a <nome>": a proposta continua pendente, ganha `pedida_a`, o aviso chega no sino de quem
  aprova (`mia_assistente_proposta` em `REFERENCIAS_DE_AVISO`) e o cartão aparece em
  "Pedidos esperando você". Quando outra pessoa aplica, recusa ou desfaz, o resultado volta
  para quem pediu, no mesmo cartão e no sino. A empresa pode desligar o pedido
  (`pode_pedir`).
- **Ajustar antes de aprovar** (`ajustar.ts`). O servidor manda os campos do cartão; o
  ajuste prepara de novo com o que mudou e regrava o cartão, que continua pendente. O
  gatilho da 9100 só deixa a peça mudar assim (pendente que continua pendente).
- **Desfazer não é apagar** (decisões 4 e 6, `desfazer.ts`). Desfaz só o que a própria
  proposta fez, e só enquanto nada depende disso: a trava é o USO, sem prazo, contada pelo
  servidor na empresa inteira. Travado, o cartão diz o porquê e leva até a tela. A peça que
  alguém já tirou pela tela deixa a proposta desfeita, com o aviso. Desfazer de novo devolve
  `ja_estava`.
- **Conhecimento entra ligado** (decisão 3). O item vai para o material de perguntas que o
  agente no ar já lê, e o cartão avisa que ele passa a usar na próxima conversa. Sem esse
  material, vai para "Respostas do dia a dia", e o cartão avisa que escolher o material no
  agente e publicar é na tela de Agentes.
- **Rascunho de campanha fica fora** (decisão 7): o assistente escreve o texto na conversa e
  a pessoa cola na campanha.
- **A lista fechada do "nunca"** (`lib/assistente/nunca.ts`, tela 4): número e canal,
  cobrança e plano, convite, usuários e papéis, chaves e tokens, apagar, publicar agente e
  mensagem a cliente. Não existe ferramenta para eles (a cerca reprova quem criar), o tipo
  é uma lista fechada no banco e o risco crítico não cabe (9080). O assistente diz o porquê
  em uma frase e leva até a tela, ou oferece pedir a quem pode; para mensagem a cliente ele
  escreve o texto, mas não envia. As regras entram no system por `lib/assistente/regras-do-faz.ts`.
- **Tudo registrado como "via assistente".** `assistente.proposta_criada`, `_pedida`,
  `_ajustada`, `_aplicada`, `_rejeitada`, `_falhou`, `_desfeita` e `assistente.desfazer_travado`,
  com quem pediu, quem aprovou e quem desfez no metadata (nunca o texto da peça); o registro
  da própria peça (`pipeline.stage_created`, `template.created`, `crm_task.created`...) leva o
  ator de quem aprovou.

### As telas

- **O cartão** (`components/assistente/CartaoDaProposta.tsx`): o que muda, o aviso, quem
  aprova e até quando desfaz; "Aprovar e aplicar", "Pedir a", "Ajustar" e "Recusar"; depois,
  "Aplicada por" com "Ver na tela" e "Desfazer", ou "Não dá mais para desfazer" com o porquê.
  Permissão e trava vêm do servidor (`leitura.ts`); o cartão não decide nada.
- **A aba Propostas** da página do assistente (`components/assistente/PropostasDoAssistente.tsx`,
  `?aba=propostas`, o botão do aviso): pedidos esperando você (quem aprova), seus pedidos e o
  que o assistente fez.
- **As rotas**: `GET /api/v1/assistente/propostas` (`?ids`, `?lista=pedidos|meus_pedidos|feitas`),
  `POST .../[id]` (aplicar e recusar), `.../[id]/desfazer`, `.../[id]/pedir` e `.../[id]/ajustar`.

### O banco (9100 e 9101)

A 9100 estende a tabela da 9080 (as peças novas no `tipo`, a situação `desfeita`, `chave`,
`pedida_a`/`pedida_em`, `ajustada_por`/`ajustada_em`, `desfeita_por`/`desfeita_em`), redefine
as duas funções NOSSAS da 9080 (`fn_mia_proposta_nasce`: o risco vem do tipo, e pedido, ajuste
e desfazer não nascem pela sessão; `fn_mia_proposta_segue_a_ordem`: aplicada vira desfeita
só com a data, desfeita não muda, a peça só muda no ajuste da pendente) e troca a RLS (o
atendente propõe e lê as dele). O índice "uma pendente" mantém o NOME da 9080 com a definição
por peça: todo deploy reaplica o baseline inteiro, e o bloco da 9080 roda antes. A 9100 também
conserta um defeito da 9080: a referência que some (a conversa expurgada pela retenção, a
pessoa removida) vira nulo pela chave estrangeira em qualquer situação, e o expurgo da conversa
citada por uma proposta recusada parava. `mia_assistente_config` ganha `tipos_de_proposta` e
`pode_pedir`. A 9101 leva a desfeita na retenção como a aplicada (365 dias). Provado em
`tests/invariants/assistente-faz-com-aprovacao.test.ts`.

### No MCP

`plataforma_desfazer_proposta_do_assistente` (nova; o mesmo caminho do botão, as mesmas
travas, "já estava" na repetição) e quatro que crescem: `plataforma_ver_propostas_do_assistente`,
`plataforma_decidir_proposta_do_assistente`, `plataforma_configurar_assistente` e
`plataforma_ver_assistente` ([`mcp-de-implantacao.md`](mcp-de-implantacao.md), seção .94). A
lista vai a 95.

### O que fica para depois, de propósito

Aprovar em lote; rascunho de campanha no "faz" (se a decisão 7 mudar); e o laço de retorno
por empresa (fase 4 do desenho do upstream).

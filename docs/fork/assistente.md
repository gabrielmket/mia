# O assistente da MIA (.88)

O chat que a equipe de cada cliente usa dentro do sistema: a rotina do dia ("como
está minha rotina hoje?", "por onde eu começo?"), os números ("como estão meus
leads?", "minha performance no mês") e o uso do sistema ("como configuro o horário
da IA?"). Quando não sabe, diz que não sabe e manda a pergunta ao suporte da Time
Company; erro e pedido viram **chamado**.

Protótipo aprovado em 24/10/2026 (8 telas, 18 regras). É a **fase 1** da spec do
upstream (#2860, "agente interno de configuração e rotina", fechada sem código): o
chat de leitura. As propostas de configuração com aprovação (fase 2), a auditoria do
tenant (fase 3) e o laço de retorno (fase 4) ficam para depois.

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

## 8. Para voltar ao upstream

O desenho e os nomes seguem a spec #2860 (o turno sem `send_message`, as ferramentas de
leitura, o ponto próprio no registro, a porta no topo junto do sino). As tabelas levam
o prefixo `mia_` para não colidir com as `config_threads`/`config_messages` que a spec
propõe: no dia em que o upstream construir a fase 1, a troca é de nome, não de forma.

## 9. A ajuda de uso cobre todas as telas (.89)

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

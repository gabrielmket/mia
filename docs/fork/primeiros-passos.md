# Os primeiros passos (.91): o modelo do segmento, o "o que falta" e o assistente ao lado

A parte de **primeiros passos** da jornada de assinatura (protótipo aprovado pelo
Gabriel em 25/10/2026, tela 3). A cobrança, os planos e os módulos são da .90; aqui é o
caminho de quem acabou de entrar até a empresa estar de pé.

Tudo estende o `/onboarding` do upstream (seis passos e o ensaio sem envio): a ordem e
os textos dos passos dele ficam, e o nosso entra por pontos de ligação pequenos
marcados `FORK MIA`.

## 1. O fluxo, passo a passo

| passo do upstream | o que a .91 acrescenta |
|---|---|
| **Seu negócio** (`/onboarding/welcome`) | "A MIA leu como": o segmento (clínica, academia, imobiliária, indústria, outro) é lido do nome e do "o que vocês fazem" enquanto a pessoa escreve (`sugerirSegmento`); ela confirma ou troca, e o escolhido é gravado em `onboarding_state.welcome.segmento` |
| **O telefone dele** (`/onboarding/connect-whatsapp`) | pelo número oficial, depois de "Entrar com o Facebook" o passo fica **esperando a Time**: `whatsapp.status = "esperando_a_time"`, com a hora. A ligação do número à empresa continua à mão, em Admin › Cadastro incorporado, como no upstream (o aviso da Meta não diz de qual empresa é o número). O "o que falta" mostra o item com quem faz: **Time Company**, até o número aparecer conectado |
| **Treinar** (`/onboarding/setup-ai`) | com o segmento, o nome e o jeito começam os do agente de exemplo da demonstração daquele segmento, e o texto do agente sai de `promptDoModelo`. "Criar e continuar" cria e publica, como no upstream. As regras do segmento aparecem só como EXEMPLO do campo (uma regra inventada iria para a memória de uma empresa de verdade). A chave de IA nunca aparece para o cliente (a regra da .59). Se o agente já existe em rascunho pela proposta do assistente, o passo PUBLICA o rascunho aprovado ("Publicar e continuar", só quem administra) em vez de criar outro |
| **Onde ele organiza** (`/onboarding/funil`) | segmento confirmado (fora "outro") começa do quadro pronto dele, sem pedir à IA, e a tela diz isso. "Outro" segue o caminho do upstream (a sugestão do funcionário e o plano B) |
| **Ver ele atender** e **Quem trabalha com ele** | sem mudança |

Ao lado de cada passo, para quem administra ou gere a empresa: o bloco **"O que falta"**
e o **assistente da MIA** (o painel da .88). Depois do passo a passo, os dois ficam no
**Início** (`/app/inicio`) até zerar, com a faixa "Primeiros passos" no topo de `/app`.

## 2. O modelo do segmento

`lib/onboarding/modelos-de-agente-da-mia.ts`, ao lado de `pacotes-da-mia.ts`. Cada
segmento diz:

| segmento | agente de exemplo (demonstração) | quadro pronto | follow-up do modelo |
|---|---|---|---|
| Clínica ou consultório | Clara · Recepção (`clinica-odonto`) | Agendamentos (`clinica`) | Consulta · retomar quem sumiu na marcação (silêncio) |
| Academia ou estúdio | Duda · Atendimento (`academia`) | Matrículas (`curso`) | Aula experimental · marcar a primeira aula (etapa "qualifying") |
| Imobiliária ou corretor | Lívia · Atendimento (`construtora`) | Interessados (`imobiliaria`) | Visita · marcar a visita ao imóvel (etapa "qualifying") |
| Indústria ou distribuidora | Bento · Atendimento comercial (`industria`) | Pedidos (`industria`) | Cotação enviada · acompanhar até virar pedido (etapa "qualified") |
| Outro tipo de negócio | Mia · Atendimento (sem demonstração) | Clientes (`generico`) | Retomada · voltar a quem parou de responder (silêncio) |

**Um texto só.** O que o agente faz e o que nunca faz moram no modelo, frase por frase.
A demonstração do segmento (`lib/demonstracao/semente/segmentos/`) monta o texto do
agente pela mesma `promptDoModelo` e só acrescenta os fatos da empresa fictícia
(preços, empreendimento, tabela); o cliente novo recebe as frases do modelo, sem
nenhum fato inventado. A tela "Treinar" mostra as mesmas frases ("O que o modelo de
clínica ensina a ele"): ela não promete o que o texto não diz.

## 3. O "o que falta"

**A fonte é o checklist do MCP.** `plataforma_ver_implantacao` avalia as áreas
(`AREAS_DO_CHECKLIST`); `avaliarAreas` é a avaliação única do MCP e do cliente, e
`rotuloDoCliente` (`lib/mcp-plataforma/checklist/rotulo-do-cliente.ts`) só decide a
coluna, o texto e a dependência de cada item. Duas áreas novas no checklist:
`primeiros_passos` (o passo a passo e o número oficial que espera a Time) e
`plano_e_cobranca` (assinou ou não, lido direto de `cobranca_assinaturas` do upstream).

| item | preenchido | posso completar | preciso confirmar (quem faz) |
|---|---|---|---|
| Dados da empresa | o passo "Seu negócio" feito | | você |
| Número de WhatsApp | um número conectado | | você; ou a **Time Company**, com o número oficial esperando |
| Agente | um agente no ar | o agente do modelo (proposta) | você publica o rascunho |
| Funil | um funil próprio, com ganho e perda | o quadro pronto (proposta) | |
| Follow-up | publicado, ou aplicado em rascunho que "sai junto com o agente" | o follow-up do modelo (proposta), **depende do agente** | você publica um rascunho solto |
| Ensaio | o passo "Ver ele atender" feito | | você, **depende do agente** |
| Equipe | alguém além de quem criou, ou um convite | | você |
| Plano | assinado | | você (só quem administra vê) |

**Não se aplica agora:** conversões da Meta e do Google (sem conta de anúncios
ligada), base importada (começar vazio não é pendência) e o plano quando a cobrança
está desligada, a empresa é isenta ou é de demonstração (e, para o gestor, porque o
plano é de quem administra).

**O retrato** (`mia_assistente_retratos`, 9081): a rodada de quem administra guarda as
contas e a coluna de cada item quando algo mudou. "Ao entrar faltavam N, agora faltam
M" vem do primeiro retrato; o bloco sai do Início na primeira rodada com zero.

**Com o acesso de quem olha.** O bloco e o assistente leem com o cliente da SESSÃO (a
regra da .88). Uma área que o papel não lê fica fora do rótulo, em vez de virar
pendência falsa. A chave da cobrança, que é da instalação, a rota lê como o layout de
`/app` lê.

## 4. Quem vê (o critério)

Uma regra só, pura: `lib/onboarding/o-que-falta-aparece.ts`. Ela sai do **estado de
conclusão do `/onboarding` do upstream** (`organizations.onboarded_at` e
`organizations.onboarding_state`):

1. **No passo a passo** (`onboarded_at` nulo): aparece. Toda empresa que está no passo
   a passo é nova; a que já roda tem `onboarded_at`, ou nem entraria em `/app`.
2. **Depois do passo a passo:** só se a empresa passou pelo passo "Seu negócio" DESTA
   versão (`welcome.segmento`, que só a .91 grava), e até zerar. A empresa implantada
   pela Time (MCP, carga, SQL) nunca passou pelo passo a passo, e a que passou antes da
   .91 tem `welcome` sem segmento: nas duas, nada muda, e a empresa que já roda (Ultra
   Sorriso, JHS e as outras) não vê bloco novo, nem faixa, nem é mandada ao Início.
3. **Só administrador e gestor.** O atendente e o somente leitura veem o passo a passo
   do upstream sem mudança. Aplicar proposta é só do administrador.
4. **Nunca** na empresa de demonstração nem no acompanhamento do suporte.

Onde a regra é lida: o layout do `/onboarding` (o painel e o bloco ao lado do passo), a
raiz de `/app` (o login cai no Início), `/app/inicio` (redireciona quem não tem o
critério para a tela inicial de sempre), a faixa do topo de `/app` e a rota
`/api/v1/assistente/o-que-falta`. O MCP devolve `aparece_no_inicio` e o motivo.

## 5. As propostas do assistente

Fase 2 do desenho do upstream (#2860), só para as três peças do modelo: veja a seção 9
de [`assistente.md`](assistente.md). Em uma linha: o assistente PREPARA (só lê), a rota
grava a proposta PENDENTE, o cartão mostra o que muda, só o administrador aplica (a
peça nasce em rascunho, pelo caminho da implantação), e o follow-up sai junto com o
agente publicado.

## 6. As peças

| peça | onde |
|---|---|
| o modelo do segmento | `lib/onboarding/modelos-de-agente-da-mia.ts` |
| o critério | `lib/onboarding/o-que-falta-aparece.ts`, `criterio-da-sessao.ts` |
| as áreas novas do checklist e o rótulo | `lib/mcp-plataforma/checklist/area-dos-primeiros-passos.ts`, `area-do-plano-e-cobranca.ts`, `avaliar.ts`, `rotulo-do-cliente.ts` |
| a leitura e o retrato | `lib/assistente/leituras/o-que-falta.ts`, `lib/assistente/retratos.ts` |
| as propostas | `lib/assistente/propostas/` (preparar, gravar, aplicar, decidir, sai-com-o-agente) |
| as rotas | `app/api/v1/assistente/o-que-falta`, `app/api/v1/assistente/propostas`, `propostas/[id]` |
| as telas | `components/assistente/OQueFalta.tsx`, `CartaoDaProposta.tsx`, `PrimeirosPassosComAssistente.tsx`, `FaixaDosPrimeirosPassos.tsx`; `app/app/inicio/page.tsx` |
| o número oficial esperando a Time | `app/actions/onboarding/numeroOficial.ts` |
| publicar o rascunho do modelo no passo Treinar | `app/actions/onboarding/agenteDoModelo.ts`, `app/onboarding/setup-ai/_rascunho-do-modelo.tsx` |
| o schema | 9080 (propostas), 9081 (retratos), 9082 (a retenção dos dois) |
| o MCP | `lib/mcp-plataforma/ferramentas/propostas-do-assistente.ts` e `checklist.ts` |

## 7. Os pontos de ligação no código do upstream (lista fechada)

| arquivo do upstream | o que entrou (marcado FORK MIA) |
|---|---|
| `lib/schemas/onboarding.ts` | `welcome.segmento` e `whatsapp.entrou_com_facebook_em` |
| `app/onboarding/welcome/_form.tsx`, `page.tsx`, `app/actions/onboarding/acceptWelcome.ts` | "A MIA leu como" e o segmento gravado |
| `app/onboarding/setup-ai/page.tsx`, `_form.tsx`, `app/actions/onboarding/createDefaultAgent.ts` | o modelo do segmento no passo Treinar |
| `app/onboarding/funil/page.tsx`, `_client.tsx`, `app/actions/onboarding/montarQuadro.ts` | o quadro pronto do segmento |
| `app/onboarding/connect-whatsapp/_client.tsx`, `components/connections/CanalOficialClient.tsx` | o número oficial esperando a Time |
| `app/onboarding/layout.tsx` | o bloco e o assistente ao lado do passo |
| `app/app/page.tsx`, `app/app/layout.tsx` | o Início da empresa nova e a faixa do topo |
| `lib/ai/agents/publish.ts` | o follow-up proposto sai com o agente publicado |
| `lib/audit/actions.ts`, `lib/i18n/dicionario.ts` | os códigos e o dicionário |
| `tests/e2e/wizard-do-funcionario.spec.ts` | a tela do funil aceita "Comecei por um quadro pronto" (a "Clínica Bem Viver" é lida como clínica) |

## 8. O que fica para depois, de propósito

- **O número oficial "esperando a Time" só nasce no passo a passo.** Quem entra com o
  Facebook depois, pela tela de Conexões, não grava o estado (o componente é o mesmo,
  mas só o passo a passo passa o aviso).
- **O recado no zap da Time** a cada número oficial esperando é da tela da Time
  (`empresas-do-cadastro`, .90), que pode ler `whatsapp.status = "esperando_a_time"`.
- **O laço de retorno** (fase 4 do #2860): a telemetria de aprovação e de recusa das
  propostas no `/app/ai/evolution`.

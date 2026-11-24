/**
 * FORK MIA — OS ESPELHOS DO MCP DE IMPLANTAÇÃO NÃO ENVELHECEM EM SILÊNCIO.
 *
 * ── O problema que este arquivo guarda ────────────────────────────────────
 *
 * A regra do MCP de implantação é: cada escrita passa pelo MESMO caminho da
 * tela. Onde a lógica estava presa dentro da rota e dava para tirar, ela foi
 * tirada para uma função que a rota e a ferramenta chamam (funil, mapeamento do
 * agente, configuração do funil, material de conhecimento, contrato dos tipos
 * de agendamento): ali não há o que divergir, e este arquivo não tem nada a
 * dizer sobre elas.
 *
 * Nas outras áreas a rota é fina (validação com um schema de `lib/schemas/`,
 * uma gravação e a auditoria) ou é lida por uma cerca do upstream que mede o
 * TEXTO dela. Nesses casos a operação de `lib/implantacao/` monta a mesma
 * sequência com as mesmas funções de biblioteca: é um ESPELHO. Espelho tem um
 * defeito conhecido: no dia em que o upstream acrescentar uma regra na rota (um
 * campo novo, uma recusa nova), a tela passa a obedecer e a ferramenta não, e
 * nenhum teste reprova, porque cada lado continua certo sozinho.
 *
 * ── O que ele mede ────────────────────────────────────────────────────────
 *
 * 1. A única REGRA que morava só numa rota e foi copiada: a lista de gatilhos
 *    de follow-up que têm motor. Comparada literal a literal, nos dois sentidos.
 *
 * 2. A IMPRESSÃO de cada rota espelhada: o código dela sem comentário e sem
 *    espaço, resumido. Mudou o código da rota, o teste reprova e diz qual
 *    operação reler. Não é um veredito de que o espelho está errado: é o aviso
 *    de que alguém precisa OLHAR. Quem olha confere o diff da rota, ajusta a
 *    operação se for o caso e grava a impressão nova aqui, no mesmo commit.
 *
 * ── O custo, declarado ────────────────────────────────────────────────────
 *
 * Isto reprova em mudança que não importa (uma variável renomeada na rota).
 * É o preço de não saber, de fora, qual mudança importa. Comentário e
 * formatação não disparam. Quando o custo incomodar numa área, a saída é a das
 * outras: tirar a sequência de dentro da rota, e a linha dela sai desta lista.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { GATILHOS_COM_MOTOR } from "@/lib/implantacao/followup";

const RAIZ = process.cwd();

/** O código do arquivo sem comentário e sem diferença de formatação, resumido. */
function impressao(relativo: string): string {
  const fonte = readFileSync(path.join(RAIZ, relativo), "utf8");
  const arquivo = ts.createSourceFile(relativo, fonte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const semComentario = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(arquivo);
  return createHash("sha256").update(semComentario.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}

/**
 * Cada rota espelhada, a operação que a espelha e a impressão do código dela
 * no dia em que o espelho foi conferido.
 */
const ESPELHOS: ReadonlyArray<{ rota: string; espelho: string; impressao: string }> = [
  // Catálogo de produtos.
  // Relido na .76 (upstream 1.74 a 1.80): só o GET mudou (busca e página no servidor). O POST, que o espelho segue, é o mesmo.
  // Relido na .100 (upstream 1.99, #3858): POST e PATCH aceitam `fotos` por URL (o servidor baixa e guarda). O espelho monta a linha campo a campo e não passa `fotos`; foto pelo MCP segue na plataforma_importar_fotos_de_produto. Nada a levar.
  // Relido na fusão da 1.116: o POST recusa `capacidade` com a capacidade do produto desligada. O espelho não grava `capacidade`: nada a levar.
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  { rota: "app/api/v1/products/route.ts", espelho: "lib/implantacao/produtos.ts", impressao: "dc752a5cfaf6f4d3" },
  // Relido na fusão da 1.107: o DELETE apaga também o áudio da apresentação do produto no bucket. O espelho não apaga produto: nada a levar.
  // Relido na fusão da 1.116: o PATCH recusa `capacidade` com a capacidade do produto desligada. O espelho não grava `capacidade`: nada a levar.
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  { rota: "app/api/v1/products/[id]/route.ts", espelho: "lib/implantacao/produtos.ts", impressao: "8bca147853138646" },
  // Automações.
  // Relido na .76 (upstream 1.78): a fonte de formulário de `trigger_config.webhook_source_id` tem de ser da empresa. O espelho confere (conferirConfiguracaoDoGatilho), com a frase da rota; e também o funil e a etapa dos gatilhos de tempo.
  // Relido na .84 (upstream 1.86, #2791): o POST recusa o gatilho por data num campo do CONTATO (campoDoGatilhoDeDataEhDoContato, MENSAGEM_CAMPO_DE_DATA_DO_CONTATO). O espelho recusa com a mesma frase (recusarDataDoContato), ao criar e ao reescrever.
  // Relido na fusão da 1.107 (#4297): criar regra que move para etapa de PERDA sem `lost_reason` é recusado. O espelho (garantirAutomacao) confere com as mesmas funções (`motivo-da-perda-na-acao`).
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  { rota: "app/api/v1/automation-rules/route.ts", espelho: "lib/implantacao/automacoes.ts", impressao: "8d272b1841c86626" },
  // Relido na .72 (upstream 1.71, #2211): o PATCH parcial confere o laço de lead (acoesQueFechamLaco) contra a regra gravada. O espelho valida a regra INTEIRA com createAutomationRuleSchema, que já recusa o laço (recusarLacoDeLead): coberto.
  // Relido na .76 (upstream 1.78): a mesma conferência da fonte no PATCH. Coberta pelo mesmo conferirConfiguracaoDoGatilho, que roda antes de criar e de editar.
  // Relido na .84 (upstream 1.86, #2791): o PATCH recusa o mesmo campo do contato quando muda o gatilho, a configuração dele OU liga a regra. O espelho confere ao reescrever (garantirAutomacao) e ao ligar (ligarAutomacao); desligar e renomear seguem livres.
  // Relido na fusão da 1.107 (#4297): editar as ações confere o motivo da perda, e a fonte do webhook é conferida antes. O espelho confere o motivo antes de criar e de atualizar.
  // Relido na fusão da 1.116 (#1749): condição de campo alterado fora do gatilho "negócio alterado" é recusada. O espelho valida a regra inteira com `createAutomationRuleSchema`, que já tem a mesma recusa (`recusarCampoAlteradoForaDoGatilho`): coberto.
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  { rota: "app/api/v1/automation-rules/[id]/route.ts", espelho: "lib/implantacao/automacoes.ts", impressao: "a4671b89a340ab01" },
  // Follow-up.
  // Relido na .72 (upstream 1.70, #2028): só a autenticação mudou (sessão OU token dsk_, resolveAuthDual). Nenhuma regra nova para o espelho.
  // Relido na fusão da 1.116: a instalação saiu da rota para `lib/followup/instalar-modelo.ts`, com as mesmas recusas (modelo, etapa ausente, arquivada) e a mesma gravação. O espelho segue igual: nada a levar.
  { rota: "app/api/v1/ai/followup-flows/from-model/route.ts", espelho: "lib/implantacao/followup.ts", impressao: "b8c2c62e18ba713b" },
  // Relido na fusão da 1.107 (#3974): a leitura ganhou `send_when_assigned` (enviar mesmo com a conversa atribuída). Sem o campo, o espelho não grava a coluna, e a régua montada por ele nasce com o padrão do banco (desligado), como na tela. Desde a MIA-21 a ferramenta liga e desliga a chave (`enviar_com_conversa_atribuida`), com a mesma recusa do gatilho num fluxo publicado, e a cópia leva a chave, como a importação da tela.
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  { rota: "app/api/v1/ai/followup-flows/[id]/route.ts", espelho: "lib/implantacao/followup.ts", impressao: "5844c01e388aaf28" },
  // Relido na .84 (upstream 1.86, #3056 e #3048): a publicação confere os modelos de mensagem citados (carregaModelosCitados, modelo inexistente nesta conta é recusado) e devolve os AVISOS do gatilho de silêncio (avisosDoGatilho). O espelho (publicarFollowup) faz as duas coisas e devolve os avisos em `avisos`.
  { rota: "app/api/v1/ai/followup-flows/[id]/publish/route.ts", espelho: "lib/implantacao/followup.ts", impressao: "c669f202a47bde3d" },
  // Agente de IA.
  // Relido na .72 (upstream 1.70 #2028 e 1.73 #2296): token dsk_ e o corpo legado passa a criar mcp_agent com v1 rascunho pelo MESMO mcpAgentDraftRecords que o espelho já usa. A trava da IA continua na rota (lib/ai/trava-da-ia-na-rota.ts).
  // Relido na .76 (upstream 1.74 e 1.79): o código do erro de escopo (provedor desligado) e a coluna handoff_legal_enabled na leitura. O espelho já passava a versão inteira à conferência de escopo; a recusa passou a usar mensagemDoEscopo.
  // Relido na .81 (upstream 1.81, #2955): o corpo legado sem modelo passa a resolver o par (provedor, modelo) pelo padrão da instalação e RECUSA par que o provedor não executa, antes do insert. O espelho não recebe modelo (a IA é da plataforma, travarIaDaVersaoNova), e passou a conferir o par que vai gravar com a MESMA régua (validarParProvedorModelo), recusando com "Nada foi criado".
  // Relido na .100 (upstream 1.9x, 9052): a versão ganhou `voz_enabled` e `voz_quando` (responder em áudio). O espelho lê as duas colunas e a versão nova as herda da de referência, como a rota.
  // Relido na fusão da 1.107: o nome repetido de agente responde 409 (`nome-repetido`) e a leitura da versão ganhou `skill_names`, `image_vision_enabled` e `reply_min_interval_ms`. O espelho já recusa o nome repetido (23505) com frase própria, lê as três colunas e a versão nova as herda da de referência.
  { rota: "app/api/v1/ai/agents/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "0489795f7ac4479a" },
  // Relido na .72 (upstream 1.70, #2013 e #2028): a versão nova grava proposal_ai_draft_enabled; o espelho (inserirVersao) passou a gravar também. O resto é a autenticação por token.
  // Relido na .76 (upstream 1.74 e 1.79): a versão nova copia handoff_legal_enabled e o escopo confere provedor, chave e número. O espelho (inserirVersao e a conferência antes de gravar) faz os dois.
  // Relido na fusão da 1.107: a versão nova copia `skill_names`, `image_vision_enabled` e `reply_min_interval_ms`, e o escopo confere as skills. O espelho (inserirVersao e a conferência antes de gravar) faz os dois.
  // Relido na fusão da 1.123 (#5066): o POST ganhou o canal de voz (cadastro desligado, sem versão, para a telefonia). O espelho só cria agente de WhatsApp, que é o `default` de `ai_agents.channel`, e o caminho de WhatsApp da rota só trocou o tratamento do nome repetido por um auxiliar com a mesma regra.
  { rota: "app/api/v1/ai/agents/[id]/versions/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "cca535a84e9f3f5f" },
  // Relido na .76: token dsk_ (resolveAuthDual), handoff_legal_enabled no PATCH e a conferência de escopo antes de editar o rascunho. O espelho confere o escopo antes das duas gravações.
  // Relido na .81 (upstream 1.81): o PATCH do rascunho passa a GRAVAR pipeline_ids e knowledge_source_ids (antes só entravam no schema) e os confere no escopo. O espelho já gravava os dois e já os passava a validarEscopoDaVersao.
  // Relido na fusão da 1.107: o PATCH do rascunho grava as três colunas novas e confere as skills no escopo. O espelho edita o rascunho com as mesmas colunas (CAMPOS_DA_VERSAO) e passa as skills a validarEscopoDaVersao.
  { rota: "app/api/v1/ai/agents/[id]/versions/[vid]/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "f7e8d00fd301ba4d" },
  // Relido na .76 (upstream 1.79, #2156): publishAgentVersion recebe quemPublicou, e a mudança da chave jurídica sai como ai_agent.legal_handoff_changed com o ator. O espelho passa o autor do token. E a ferramenta de servidor MCP externo escolhida no agente conta como capacidade válida (`toolIdAceito`): o espelho usa a mesma régua ao publicar.
  { rota: "app/api/v1/ai/agents/[id]/publish/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "479026df35f97b55" },
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  { rota: "app/api/v1/ai/agents/[id]/pause/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "fe18897b3409d87a" },
  // Espelhado na .73 (upstream 1.71, #2216): o limiar de sentimento mora em `config` do cadastro. O espelho (configComLimiar) faz a mesma mescla do PATCH: padrões, o gravado e o pedido por cima, conferido por agentPatchSchema.
  // Relido na .76 (upstream 1.74): token dsk_ e a auditoria ai_agent.updated no PATCH do cadastro. O espelho deixa a mesma linha quando muda nome, descrição, prioridade ou limiar.
  // Relido na fusão da 1.107: o nome repetido responde 409, e o agente de VOZ publicado pode mudar o cadastro. O espelho já recusa o nome repetido e não monta agente de voz: nada a levar.
  { rota: "app/api/v1/ai/agents/[id]/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "039454176a58d78f" },
  // Roteador de intenção, espelhado na .73 (upstream 1.73, #2290: destino de funil por intenção). O espelho cria DESLIGADO de propósito; o resto segue a rota (número conferido, configDoRoteador, gravação das intenções pelas mesmas duas funções).
  // Relido na .76 (upstream 1.74, #2061): o roteador novo nasce com context_message_count 8, e a régua é 0 a 16. O espelho grava o mesmo e ganhou `mensagens_de_contexto`.
  // Relido na .82 (upstream 1.84, #2824): as três rotas do roteador passaram de requireRole para resolveAuthDual (token dsk_ com config:* e papel admin), e a auditoria leva o token. Nenhuma regra nova de gravação; a trava da IA nas rotas pergunta quem pede por quemPedeNaRota. O espelho não passa pela rota: nada a levar.
  { rota: "app/api/v1/ai/routers/route.ts", espelho: "lib/implantacao/roteador.ts", impressao: "d0b8746f564c94dc" },
  // Relido na .100 (upstream 1.9x): `config.sender_routes` (agente por número do remetente). O espelho mescla o config (as regras da tela ficam) e, ao trocar o agente reserva, recusa como a rota o reserva vazio ou reservado nas regras.
  // Relido na fusão da 1.116: o PATCH move o roteador de número (`moverRoteadorParaNumero`) e grava `passagem_ao_cliente`. O espelho só grava o que foi pedido (a frase não se perde) e continua sem trocar número; a recusa agora aponta a tela, que move.
  // Relido na fusão da 1.117 (#4750): o PATCH recusa `config.passagem_silenciosa` que não seja verdadeiro ou falso. O espelho não grava essa chave e mescla o config (o que a tela gravou fica); nada a levar. A troca silenciosa pelo MCP está na lista "falta no MCP" da fusão.
  { rota: "app/api/v1/ai/routers/[id]/route.ts", espelho: "lib/implantacao/roteador.ts", impressao: "06a990f04293230c" },
  // Relido na .76 (upstream 1.79, #2624): o cliente do pool que falhou no meio da transação volta com erro (release(err)). O espelho faz o mesmo em gravarIntencoes.
  { rota: "app/api/v1/ai/routers/[id]/members/route.ts", espelho: "lib/implantacao/roteador.ts", impressao: "bd2988da8205a0a4" },
  // Memória da empresa.
  // Relido na .100 (upstream 1.9x): a anotação ganhou `valid_until` (validade), opcional. O espelho grava sem validade, como antes; nada a levar.
  // Relido na fusão da 1.116: leitura do ponteiro ou da versão que falha vira 500, não "sem memória". Levado: `lerDocumentoDaMemoria` lança nos dois erros.
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  { rota: "app/api/v1/ai/memory/route.ts", espelho: "lib/implantacao/memoria.ts", impressao: "138222c800d52f94" },
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  { rota: "app/api/v1/ai/memory/entries/route.ts", espelho: "lib/implantacao/memoria.ts", impressao: "44101f8f3c3936c5" },
  // Dados da empresa e regras de atendimento.
  // Relido na .72 (upstream 1.70, #2027): o papel passa por podeAdministrarEmpresa, a regra única do upstream. O espelho é do servidor (o token do MCP de plataforma já é a autorização).
  // Relido na .76 (upstream 1.74 e 1.79): a gravação mora em gravarDadosCadastrais (com media_retention_enforced e a frase do CNPJ repetido), e o modo de venda ausente não muda. O espelho grava as mesmas colunas e dá a mesma frase.
  // Relido na .81 (upstream 1.81): só o IP da auditoria passou a sair de ipDoCliente. Nenhuma regra nova para o espelho.
  // Relido na .100 (upstream 1.9x): a action derruba o cache curto da organização (invalidarOrg) antes e depois de gravar, e cobra MFA. O espelho derruba o cache igual; MFA não se aplica ao token de plataforma.
  { rota: "app/actions/settings/updateTenant.ts", espelho: "lib/implantacao/empresa.ts", impressao: "b5b17c43a5c3d9e6" },
  // Espelhados na .81 (upstream 1.80 #978 e 1.81 #2063): as duas opções da agenda. As funções do upstream exigem sessão com MFA; o espelho grava a MESMA chave de topo pelo servidor (mudarSettingsDaOrganizacao), lida pelas mesmas réguas (colegasPodemMexerNaAgendaLigado, meetAbertoLigado), com a mesma auditoria.
  { rota: "app/actions/settings/definirAgendaDosColegas.ts", espelho: "lib/implantacao/empresa.ts", impressao: "a723732e45ad75f4" },
  { rota: "app/actions/settings/definirMeetAberto.ts", espelho: "lib/implantacao/empresa.ts", impressao: "62dbe5c947055ca7" },
  // Espelhado na .81 (upstream v1.83, #2147/#2948): o servidor MCP externo, com o guard anti-SSRF, a chave cifrada nas colunas e a auditoria só com o host. A recusa da demonstração é NOSSA nos dois lados.
  // Relido na fusão da 1.116: a tela ganhou a lista de escritas liberadas da conexão (`escritasLiberadasConexao`, `curinga_nao_aceito`). O espelho não mexe nela, e `mesclarServidorMcpExterno` preserva o resto do `settings`: nada a levar. A lista fica para a tarefa do que falta no MCP.
  { rota: "app/actions/settings/definirServidorMcpExterno.ts", espelho: "lib/implantacao/servidor-mcp-externo.ts", impressao: "6ce142d287866660" },
  // Espelhado com a fusão 1.100 a 1.107 (upstream 9095): os servidores MCP por agente, com o OAuth por contato. O espelho é o `servidores_mcp` de plataforma_garantir_agente: as mesmas peças (cifra, `chave_last4`, revogação quando a origem dos tokens muda, slug estável, teto por agente) e as mesmas auditorias, só com o host.
  { rota: "app/actions/agents/servidoresMcpDoAgente.ts", espelho: "lib/implantacao/servidores-mcp-do-agente.ts", impressao: "7746c0f49e6c8702" },
  // Espelhado na .76 (upstream 1.76, #2367): o freio do passo "a IA decide", com a mescla nos dois níveis de settings e a mesma auditoria.
  { rota: "app/actions/settings/definirAiDecideDaEmpresa.ts", espelho: "lib/implantacao/empresa.ts", impressao: "8168719014b15dca" },
  // Espelhado na .76 (upstream 1.77, #1752): os planos de tarefa, conferidos por planosSchema, em settings.task_plans.
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  { rota: "app/api/v1/settings/task-plans/route.ts", espelho: "lib/implantacao/planos-de-tarefa.ts", impressao: "031461ce3a4700ad" },
  // Espelhado na .76 (upstream 1.74, #2321): a camada de afirmação clínica da empresa, pelo mesmo upsert e auditoria.
  // Relido na .100 (upstream 1.9x): a lista configurável passou a ser CAMADAS_CONFIGURAVEIS (com a restrição comercial). O espelho mexe só na camada clínica; nada a levar.
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  { rota: "app/api/v1/ai/guardrail-layers/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "6db13a167b2ae408" },
  // Espelhados na .76: os dias da prospecção (1.80, 0642), guardar o histórico (1.74, #999) e a pausa agendada (1.79, #2388).
  // Relido na .100 (upstream 1.97, #3383): o PUT solta os turnos com o rastro `adiado_por_janela` quando a janela de resposta abre (soltarAdiadosDaSessao). O espelho chama a mesma função depois de gravar a janela, ao lado da reprogramação do fork.
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  // Relido na fusão da 1.124 (#3851): o GET lê e devolve `teto_so_abordagem` (nulo = desligado). O espelho não grava a coluna, então o número montado pela implantação nasce com a régua de sempre: nada a levar. O campo ficou em "Falta no MCP" (docs/fork/mcp-de-implantacao.md, 1.124), porque ligado ele muda o envio do follow-up.
  { rota: "app/api/v1/ai/pacing/route.ts", espelho: "lib/implantacao/canal.ts", impressao: "d8cf9fe6a177b569" },
  // Relido na fusão da 1.116: o GET aceita token. O espelho só lê, pela mesma `lerAcervoDoCanal`: nada a levar.
  { rota: "app/api/v1/channel-sessions/[id]/acervo/route.ts", espelho: "lib/implantacao/canal.ts", impressao: "a1ecd1e6b5d4d614" },
  // Relido na .81 (upstream 1.81, #2388): a régua da janela virou validarJanela, compartilhada por criar e EDITAR, e o [id] ganhou o PATCH que corrige os dois horários de uma janela que ainda não começou (status scheduled, com a trava contra a corrida do relógio). O espelho ganhou `ajustar_pausa_agendada` com a mesma régua (recusaDaJanela) e a mesma auditoria channel.schedule_updated.
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  { rota: "app/api/v1/channel-schedules/route.ts", espelho: "lib/implantacao/canal.ts", impressao: "1d6aefad4d863ac5" },
  { rota: "app/api/v1/channel-schedules/[id]/route.ts", espelho: "lib/implantacao/canal.ts", impressao: "71f6d0aeb4a8e9ae" },
  // Espelhado na .81 (upstream 1.81): o nome interno da conexão, com a mesma faixa (1 a 80) e a auditoria channel.renamed.
  { rota: "app/api/v1/channel-sessions/[id]/name/route.ts", espelho: "lib/implantacao/canal.ts", impressao: "9d65a85056a96789" },
  // Espelhados na .76 (upstream 1.76 e 1.78): a fonte de formulário, com as perguntas e a autorização de IA (que exige a assinatura).
  { rota: "app/api/v1/webhook-sources/route.ts", espelho: "lib/implantacao/fonte-de-formulario.ts", impressao: "a400691a20559e3f" },
  // Relido na .82 (upstream 1.84, #2316, 0683): a opção `update_existing_lead_on_capture` entra no PATCH e a recusa sem assinatura passa a dizer QUAL opção a pediu (`opcaoSemAssinatura`). O espelho ganhou `atualizar_card_no_reenvio`, com a mesma régua e uma frase por opção.
  // Relido na .86 (upstream 1.88, #3101, 0722): a terceira opção que pede assinatura, `reuse_open_lead_on_capture`, com a frase própria (`reuse_lead`). O espelho ganhou `reaproveitar_card_aberto`, pela mesma régua.
  // Relido na fusão da 1.116: o PATCH liga a página da Meta (token cifrado, busca dos leads, conferência da página). O espelho monta o patch campo a campo, sem esses campos, e lê colunas explícitas (o token cifrado não sai): nada a levar.
  { rota: "app/api/v1/webhook-sources/[id]/route.ts", espelho: "lib/implantacao/fonte-de-formulario.ts", impressao: "4cac890a97ad324a" },
  // Espelhado na .76 (upstream 1.74, 0558): a coluna do cliente numa conexão de banco externo, sem tocar na credencial.
  // Relido na .81 (upstream 0618): a leitura e a volta do PATCH trazem source_mode e sources_count. O espelho lê as duas pela visão segura.
  // Relido na .84 (upstream 1.86, 0691): a leitura e a volta do PATCH trazem db_type e last_test_aviso, e o pool fecha pelo registro de drivers. O espelho lê as duas colunas (tipo_do_banco, aviso_do_ultimo_teste); não muda endereço nem senha, então não fecha pool.
  { rota: "app/api/v1/external-db/connections/[id]/route.ts", espelho: "lib/implantacao/banco-externo.ts", impressao: "6eda05f3f92f18de" },
  // Espelhado na .81 (upstream 0618): as fontes liberadas, o modo e a lista inteira num UPDATE só, conferidos por atualizarFontesSchema, com a auditoria external_db_sources.updated.
  { rota: "app/api/v1/external-db/connections/[id]/sources/route.ts", espelho: "lib/implantacao/banco-externo.ts", impressao: "46c64eadd3622e63" },
  // Espelhado na .86 (upstream 1.87 e 1.88, 0706): as receitas prontas, a lista inteira, conferidas por atualizarReceitasSchema, cada `fixos` pela régua da receita e cada receita contra o motor da conexão, com a auditoria external_db_recipes.updated.
  // Relido na fusão da 1.116 (R5b): o destino do interesse (funil e etapa) tem de existir e estar ativo. Levado: o espelho guarda o `destino_do_interesse` que a tela gravou (regravar apagava) e confere com `primeiroDestinoInvalido`.
  { rota: "app/api/v1/external-db/connections/[id]/recipes/route.ts", espelho: "lib/implantacao/banco-externo.ts", impressao: "88e4eec6c13b2efd" },
  // Espelhado na .76 (upstream 1.79, #2591): o dono do contato. A rota chama fn_definir_carteira_do_cliente; o MCP chama a cópia do fork (9022) e deixa a mesma auditoria.
  // Relido na .81 (upstream 1.81): a rota ganhou o GET (quem é o dono hoje, para a tela). O PATCH, que o espelho segue, é o mesmo.
  // Relido na .100 (upstream 1.9x, 9039): o PATCH registra na conversa a troca de número que a função do banco passou a fazer. A cópia do fork (9022) não move conversa (ver PORTA_DA_CARTEIRA abaixo), então não há troca a registrar.
  // Relido na fusão da 1.107 (#3746): o Atendente muda a carteira com escopo de posse (`conferirPosse`), e a leitura devolve `pode_alterar`. O espelho age pelo token de plataforma (9022), sem papel de usuário: nada a levar.
  // Relido na fusão da 1.116: o GET aceita token e só a sessão recebe `pode_alterar`. O espelho não lê por esta rota: nada a levar.
  { rota: "app/api/v1/contacts/[id]/carteira/route.ts", espelho: "lib/mcp-plataforma/importacao/contatos.ts", impressao: "c61c1dab106f2381" },
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  { rota: "app/api/v1/settings/routing/route.ts", espelho: "lib/implantacao/empresa.ts", impressao: "fa6783e6119ce466" },
  // Espelhado na .83 (upstream 1.85, 0663, #2331): as regras de atendimento POR NÚMERO (responsáveis, modo do número e destino padrão), na mesma gravação. A rota chama fn_set_channel_routing; o MCP chama a cópia do fork (9045), com o token como ator, e deixa a mesma auditoria routing.config_changed.
  // Relido na fusão da 1.116: grava também o prazo de espera pela IA do número (`ai_wait_minutes`, `fn_set_channel_ai_wait`). O espelho não mexe nele: nada a levar (fica para a tarefa do MCP).
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  { rota: "app/api/v1/settings/routing/channels/route.ts", espelho: "lib/implantacao/distribuicao-do-numero.ts", impressao: "9bce5f1a3fba488a" },
  // Espelhado na .73 (upstream 1.70, #2079): quem fala, em negrito, na mensagem. O espelho confere com o mesmo assinaturaEntradaSchema e grava a mesma chave de settings.
  // Relido na .86 (upstream 1.88, #3318): `por_agente` (cada agente assina com o próprio nome), e o ausente mantém o gravado. O espelho ganhou `nome_de_cada_agente` e passou a manter o gravado quando o campo não vem.
  { rota: "app/api/v1/settings/assinatura/route.ts", espelho: "lib/implantacao/empresa.ts", impressao: "9802b14502f9d3fa" },
  // Espelhado na MIA-59 (upstream 1.112, #4023): a pesquisa de satisfação. O espelho segue o PATCH: mescla o bloco settings.satisfacao (o ausente mantém o gravado, com janela 24 h e a pergunta padrão), os mesmos limites (pergunta de 10 a 300, janela de 1 a 168 h) e a auditoria settings.satisfacao_alterada.
  { rota: "app/api/v1/settings/atendimento/route.ts", espelho: "lib/implantacao/empresa.ts", impressao: "e1eab791174773d0" },
  // Jornada de quem atende.
  { rota: "app/api/v1/attendants/availability/[user_id]/route.ts", espelho: "lib/implantacao/agenda.ts", impressao: "de0c21f50707a594" },
  // Espelhado na MIA-18 (upstream 1.105, 9235, doc 208): os prazos e a chave da lista de espera. O espelho segue o PATCH: o mesmo configDaListaDeEsperaSchema, a mesma chave settings.lista_de_espera e a auditoria agenda.lista_de_espera_configurada; o módulo não instalado, que na rota é 404, vira a recusa "módulo não instalado". A inscrição (POST) fica na tela: pede o aceite da pessoa.
  { rota: "app/api/v1/agenda/lista-de-espera/route.ts", espelho: "lib/implantacao/lista-de-espera.ts", impressao: "a5c4b357a7291be5" },
  // Respostas prontas e modelo oficial do WhatsApp.
  // Relido na .81 (upstream 1.81, #2526): `midias` nasce vazia no POST, o PATCH remove pela lista que fica (conferida, e o arquivo sai do bucket só depois da linha) e o upload é a rota /midias. O espelho ganhou `imagens`: a lista inteira por endereço, baixada e conferida pelos bytes, com o nome tirado do conteúdo (repetir não empilha), e as mesmas auditorias.
  // Relido na .86 (upstream 1.88, #3244, 0729; 1.87, #2833): a resposta nova nasce no TOPO (`ordem`, um passo acima da primeira) e a mídia pode ser áudio. O espelho grava a `ordem` das novas no topo, na ordem do pedido; as imagens seguem conferidas pelo farejador da imagem (áudio fica na tela).
  // Relido na .100 (upstream 1.95): grupo (`grupo_id`, conferido contra a organização) e `mostrar_na_barra`, os dois opcionais; e o PATCH só troca as mídias se ainda forem as lidas. O espelho não usa grupo nem a chave da barra (a resposta nasce fora de grupo e na barra, o padrão) e grava a lista de imagens inteira; nada a levar.
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  { rota: "app/api/v1/message-templates/route.ts", espelho: "lib/implantacao/mensagens.ts", impressao: "3a07fff3581c8c00" },
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  { rota: "app/api/v1/message-templates/[id]/route.ts", espelho: "lib/implantacao/mensagens.ts", impressao: "d4e4296353894096" },
  // Relido na fusão da 1.107: o corpo do envio é lido com teto (`lerCorpoComTeto`) em vez do content-length declarado. O espelho baixa a mídia com o próprio teto (baixarArquivoPublico): nada a levar.
  // Relido na fusão da 1.121: a rota passou a aceitar token `dsk_` (`resolveAuthDual`, `config:read`/`config:write`, papel admin) e o audit leva `actorApiTokenId`. Nenhuma regra de negócio mudou; o espelho entra pela plataforma, com a autorização dele: nada a levar.
  { rota: "app/api/v1/message-templates/[id]/midias/route.ts", espelho: "lib/implantacao/mensagens.ts", impressao: "e186976911ca9d0f" },
  { rota: "app/api/v1/channels/templates/criar/route.ts", espelho: "lib/implantacao/mensagens.ts", impressao: "42df61fe7056d0ea" },
  // Convite de equipe.
  // Relido na .75 (9020, mudança NOSSA na rota): convite que o banco não grava vira item de `failed` (`convite_nao_gravado`) e o lote segue, em vez de 500. O espelho faz o mesmo: desfecho `nao_gravou`, com aviso, e as outras pessoas seguem.
  // Relido na .76 (upstream 1.78, cobrança): o pedido inteiro é recusado antes do e-mail quando a empresa já ocupa os assentos do plano. O espelho faz a mesma conta e dá a mesma frase; com a cobrança desligada, não há limite.
  // Relido na .77 (9023, mudança NOSSA na rota): cada convite enviado devolve `link_curto` (`/c/<código>`), o mesmo link do e-mail. O espelho devolve o mesmo campo em `convidou`/`reenviou` (e um novo com `gerar_link`).
  { rota: "app/api/v1/team/invite/route.ts", espelho: "lib/implantacao/equipe.ts", impressao: "c57e5f3b7f70422f" },
  // Espelhados na .90 (a cobrança da jornada de assinatura, docs/fork/jornada-de-assinatura.md seção 6).
  // O card Cobrança do dono: atribuir, trocar, isentar e dar prazo. A rota segue a do upstream, sem gancho: o módulo pelo plano é lido na hora, e a rodada registra.
  { rota: "app/api/v1/admin/tenants/[id]/assinatura/route.ts", espelho: "lib/planos-mia/acoes-do-dono.ts", impressao: "b5ba78e4157f3102" },
  { rota: "app/api/v1/admin/tenants/[id]/assinatura/prazo/route.ts", espelho: "lib/planos-mia/acoes-do-dono.ts", impressao: "34a29a6222914551" },
  // A fila de /admin/cadastro: aprovar pelo mesmo ensureTenantForUser, só o primeiro a decidir grava.
  { rota: "app/actions/registration/decide.ts", espelho: "lib/planos-mia/pedidos-de-cadastro.ts", impressao: "a1c51a5a8ca0c35d" },
  // A aba Planos: novoPlanoSchema/edicaoDoPlanoSchema e a trava de preço do plano assinado.
  // Relido na fusão da 1.116: o POST aceita `moeda` e recusa dólar/euro com o Asaas. O espelho monta o plano campo a campo, sem `moeda` (nasce em real): nada a levar.
  // Espelhado na MIA-59 (upstream 1.112, 9332): o espelho passou a aceitar `moeda` na criação, com a mesma recusa de dólar/euro com o Asaas (MOEDAS_DO_ASAAS e provedorDaInstalacao).
  { rota: "app/api/v1/admin/cobranca/planos/route.ts", espelho: "lib/planos-mia/garantir-planos.ts", impressao: "769d0f55df050d4a" },
  { rota: "app/api/v1/admin/cobranca/planos/[id]/route.ts", espelho: "lib/planos-mia/garantir-planos.ts", impressao: "79549ecc4a6b4987" },
  // FORK MIA (upstream 1.118, MIA-79): o módulo opcional por empresa (9416). A ação é "use server" com a sessão do admin de plataforma; o espelho segue os três estados, as duas recusas (o teto da instalação e o que ainda não se liga) e a trilha.
  { rota: "app/actions/settings/updateModuloDaEmpresa.ts", espelho: "lib/implantacao/modulos-da-empresa.ts", impressao: "360af917b2cf1b9b" },
  // FORK MIA (upstream 1.118, #4864, MIA-79): a tela inicial da empresa. O espelho troca só a `inicio` e segue o resto da gravação (cache do menu, trilha, evento).
  { rota: "app/actions/settings/atualizarInterfaceDaEmpresa.ts", espelho: "lib/implantacao/tela-inicial.ts", impressao: "c5a12aee436db207" },
  // FORK MIA (upstream 1.118, #4864, MIA-79): a tela inicial da pessoa. O espelho segue o vínculo ativo e aceito, o cache da pessoa e a trilha.
  { rota: "app/api/v1/team/[user_id]/interface/route.ts", espelho: "lib/implantacao/tela-inicial.ts", impressao: "610a3c9ac737957b" },
  // FORK MIA (upstream 1.119, 9430, MIA-96): o funil de entrada do número. O espelho segue as três conferências (funil vivo da organização, etapa aberta do funil, etapa nula sem funil), o "igual não grava" e a trilha `channel.entry_pipeline_changed`.
  { rota: "app/api/v1/channel-sessions/[id]/entrada/route.ts", espelho: "lib/implantacao/funil-de-entrada.ts", impressao: "83f261ea9de0da84" },
  // FORK MIA (upstream 1.119, MIA-96): a Operação do dia. O espelho (configurarAtendimento) usa `configuracaoSchema.strict()`, `lerConfiguracao` e a mescla da rota (etiquetas e relatório chave a chave, a lista de etapas substituída), com a mesma trilha.
  { rota: "app/api/v1/operacao/configuracao/route.ts", espelho: "lib/implantacao/empresa.ts", impressao: "085a1a488b925c3a" },
  // FORK MIA (upstream 1.119, MIA-96): o primeiro nome do cliente no aviso de transferência. O espelho (configurarAtendimento) mescla `settings.crm` como a ação e grava a mesma trilha.
  { rota: "app/actions/settings/definirNomeNaTransferencia.ts", espelho: "lib/implantacao/empresa.ts", impressao: "c9d2f4cc9d9b7102" },
  // FORK MIA (MIA-103): a Análise do funil, uma LEITURA. O espelho faz as mesmas seis leituras da janela (paginadas, com o filtro da organização), lê as duas grafias de `stage_changed` e monta com as mesmas funções (montarRelatorioDeFunil, separarValoresDoPeriodo, a contra-métrica de fn_atrito_metrics). A paridade dos números é medida em tests/unit/mcp-de-implantacao-analise-e-conversas.test.ts, contra a rota.
  // Relido na fusão da 1.124 (#4191, MIA-127): a rota lê `nao_comercial_em` e passa a coluna a montarRelatorioDeFunil, que corta o negócio não comercial e as passagens dele da conta comercial (os valores do período seguem como antes). Levado: o espelho lê a mesma coluna e a passa igual.
  { rota: "app/api/v1/metrics/funil/route.ts", espelho: "lib/implantacao/analise-do-funil.ts", impressao: "d3a61e7f7e14aecb" },
];

describe("a regra copiada: gatilhos de follow-up que têm motor", () => {
  const PUBLICAR = "app/api/v1/ai/followup-flows/[id]/publish/route.ts";

  function daRota(): string[] {
    const fonte = readFileSync(path.join(RAIZ, PUBLICAR), "utf8");
    const achado = /const KINDS_COM_MOTOR = new Set\(\[([^\]]*)\]\)/.exec(fonte);
    if (achado === null) return [];
    return [...achado[1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!);
  }

  it("CONTROLE: o leitor acha a lista na rota (instrumento que não acha nada dá verde igual)", () => {
    expect(daRota().length, "não achei KINDS_COM_MOTOR na rota de publicar").toBeGreaterThan(0);
    expect(GATILHOS_COM_MOTOR.length).toBeGreaterThan(0);
  });

  it("⭐ a ferramenta publica exatamente os gatilhos que a tela publica, nos dois sentidos", () => {
    const rota = new Set(daRota());
    const ferramenta = new Set(GATILHOS_COM_MOTOR);
    expect(
      [...ferramenta].filter((k) => !rota.has(k)),
      "a ferramenta publicaria um gatilho que a tela recusa: fluxo ativo que nunca inscreve ninguém",
    ).toEqual([]);
    expect(
      [...rota].filter((k) => !ferramenta.has(k)),
      "a tela publica um gatilho que a ferramenta recusa: acrescente-o a GATILHOS_COM_MOTOR em lib/implantacao/followup.ts",
    ).toEqual([]);
  });
});

/**
 * A FUNÇÃO DO BANCO que a migration 9022 copia (`fn_definir_carteira_do_cliente`,
 * upstream 0622): a 9022 tem o mesmo corpo, com o token de plataforma no lugar do
 * gerente membro como ator. A impressão é do texto da função como ele vale no
 * install (a ÚLTIMA definição em `supabase/baseline.sql`), sem comentário e sem
 * diferença de espaço. Mudou, reprova: releia a 9022 e leve a regra nova numa
 * migration nova do fork (a 9022 não se edita depois de aplicada).
 */
const PORTA_DA_CARTEIRA = {
  marca: "create or replace function public.fn_definir_carteira_do_cliente(",
  copia: "supabase/migrations-mia/20261014150000_9022_dono_do_contato_pela_plataforma.sql",
  // Relida na .100 (upstream 1.9x): a função aceita a origem `automacao` (sem ator,
  // só do servidor) e, quando o dono MUDA, transfere para ele as conversas abertas
  // sem dono ou do dono anterior que não estão no automático (9039, "o número segue
  // o vendedor"). A cópia do fork (9022) NÃO leva a transferência nesta fusão: o MCP
  // define o dono ao importar a base, em geral antes de haver conversa, e mover
  // conversa pela plataforma pede uma migration nova do fork. Decisão do dono.
  // Relida na fusão da 1.107: duas mudanças, nenhuma alcança a cópia. (1) O
  // Atendente entra na porta com escopo de posse (#3746): na 9022 o ator é o
  // token de plataforma, não um papel. (2) A transferência das conversas passa
  // `p_negocio_so_sem_dono => true` (#4019): a 9022 não move conversa.
  impressao: "2ef3619ccb65602a",
};

function impressaoDaFuncao(baseline: string, marca: string): string | null {
  const inicio = baseline.lastIndexOf(marca);
  if (inicio < 0) return null;
  const fim = baseline.indexOf("$;", inicio);
  const corpo = baseline
    .slice(inicio, fim + 3)
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(corpo).digest("hex").slice(0, 16);
}

describe("a função do banco que a 9022 copia não mudou sem alguém reler a cópia", () => {
  const baseline = readFileSync(path.join(RAIZ, "supabase/baseline.sql"), "utf8");

  it("CONTROLE: o leitor acha a função, e a cópia do fork existe", () => {
    expect(impressaoDaFuncao(baseline, PORTA_DA_CARTEIRA.marca)).not.toBeNull();
    expect(existsSync(path.join(RAIZ, PORTA_DA_CARTEIRA.copia))).toBe(true);
    // A impressão enxerga mudança de código e ignora comentário.
    const base = impressaoDaFuncao("create or replace function public.f(\n x\n) as $ begin end; $;", "create or replace function public.f(");
    expect(impressaoDaFuncao("create or replace function public.f( -- comentário\n x\n) as $ begin end; $;", "create or replace function public.f(")).toBe(base);
    expect(impressaoDaFuncao("create or replace function public.f(\n y\n) as $ begin end; $;", "create or replace function public.f(")).not.toBe(base);
  });

  it("⭐ fn_definir_carteira_do_cliente", () => {
    expect(
      impressaoDaFuncao(baseline, PORTA_DA_CARTEIRA.marca),
      "A função fn_definir_carteira_do_cliente mudou no upstream desde que a 9022 a copiou. Leia o que mudou (git log -p -- supabase/baseline.sql), " +
        "leve a regra nova para uma migration nova do fork que redefina fn_mia_definir_dono_do_contato_pela_plataforma e grave a impressão nova aqui.",
    ).toBe(PORTA_DA_CARTEIRA.impressao);
  });
});

/**
 * .83 — A FUNÇÃO DO BANCO que a migration 9045 copia (`fn_set_channel_routing`,
 * na forma da 0663 do upstream 1.85: os responsáveis, o modo do número e o
 * destino padrão). A 9045 tem o mesmo corpo, com o token de plataforma no lugar
 * da sessão de gerente membro com MFA. Mesma régua da 9022: mudou lá, reprova
 * aqui, e a regra nova vai numa migration nova do fork.
 */
const PORTA_DA_DISTRIBUICAO = {
  marca: "create or replace function public.fn_set_channel_routing(",
  copia: "supabase/migrations-mia/20261019160000_9045_distribuicao_do_numero_pela_plataforma.sql",
  impressao: "531b1ac9afa209bb",
};

describe("a função do banco que a 9045 copia não mudou sem alguém reler a cópia", () => {
  const baseline = readFileSync(path.join(RAIZ, "supabase/baseline.sql"), "utf8");

  it("CONTROLE: o leitor acha a função, e a cópia do fork existe", () => {
    expect(impressaoDaFuncao(baseline, PORTA_DA_DISTRIBUICAO.marca)).not.toBeNull();
    expect(existsSync(path.join(RAIZ, PORTA_DA_DISTRIBUICAO.copia))).toBe(true);
  });

  it("⭐ fn_set_channel_routing", () => {
    expect(
      impressaoDaFuncao(baseline, PORTA_DA_DISTRIBUICAO.marca),
      "A função fn_set_channel_routing mudou no upstream desde que a 9045 a copiou. Leia o que mudou (git log -p -- supabase/baseline.sql), " +
        "leve a regra nova para uma migration nova do fork que redefina fn_mia_distribuicao_do_numero_pela_plataforma, " +
        "confira lib/implantacao/distribuicao-do-numero.ts e grave a impressão nova aqui.",
    ).toBe(PORTA_DA_DISTRIBUICAO.impressao);
  });
});

describe("as rotas espelhadas não mudaram sem alguém reler o espelho", () => {
  it("CONTROLE: a impressão ignora comentário e formatação, e enxerga mudança de código", () => {
    const resumo = (fonte: string) => {
      const arquivo = ts.createSourceFile("x.ts", fonte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      return ts.createPrinter({ removeComments: true }).printFile(arquivo).replace(/\s+/g, " ").trim();
    };
    const base = resumo("const teto = 10;\nexport function f() { return teto; }");
    expect(resumo("// um comentário\nconst teto = 10;\n\n\nexport function f() {\n  /* outro */ return teto;\n}")).toBe(base);
    expect(resumo("const teto = 11;\nexport function f() { return teto; }")).not.toBe(base);
  });

  it("toda rota da lista existe, e todo espelho também", () => {
    const sumiram = ESPELHOS.flatMap((e) => [e.rota, e.espelho]).filter((p) => !existsSync(path.join(RAIZ, p)));
    expect(
      [...new Set(sumiram)],
      "arquivo da lista de espelhos não existe mais: a rota foi movida ou apagada, e o espelho ficou sem par",
    ).toEqual([]);
  });

  it.each(ESPELHOS.map((e) => [e.rota, e] as const))("⭐ %s", (_rota, e) => {
    expect(
      impressao(e.rota),
      `O código de ${e.rota} mudou desde que ${e.espelho} foi conferido contra ele. ` +
        `Leia o que mudou na rota (git log -p -- "${e.rota}"), leve para ${e.espelho} a regra nova se houver ` +
        "e grave a impressão nova em ESPELHOS, neste arquivo.",
    ).toBe(e.impressao);
  });
});

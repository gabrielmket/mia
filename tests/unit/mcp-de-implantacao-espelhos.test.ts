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
  { rota: "app/api/v1/products/route.ts", espelho: "lib/implantacao/produtos.ts", impressao: "8e1d25078bb05b83" },
  { rota: "app/api/v1/products/[id]/route.ts", espelho: "lib/implantacao/produtos.ts", impressao: "0c030f4dbec32b72" },
  // Automações.
  // Relido na .76 (upstream 1.78): a fonte de formulário de `trigger_config.webhook_source_id` tem de ser da empresa. O espelho confere (conferirConfiguracaoDoGatilho), com a frase da rota; e também o funil e a etapa dos gatilhos de tempo.
  // Relido na .84 (upstream 1.86, #2791): o POST recusa o gatilho por data num campo do CONTATO (campoDoGatilhoDeDataEhDoContato, MENSAGEM_CAMPO_DE_DATA_DO_CONTATO). O espelho recusa com a mesma frase (recusarDataDoContato), ao criar e ao reescrever.
  { rota: "app/api/v1/automation-rules/route.ts", espelho: "lib/implantacao/automacoes.ts", impressao: "4473e2fcd29a5683" },
  // Relido na .72 (upstream 1.71, #2211): o PATCH parcial confere o laço de lead (acoesQueFechamLaco) contra a regra gravada. O espelho valida a regra INTEIRA com createAutomationRuleSchema, que já recusa o laço (recusarLacoDeLead): coberto.
  // Relido na .76 (upstream 1.78): a mesma conferência da fonte no PATCH. Coberta pelo mesmo conferirConfiguracaoDoGatilho, que roda antes de criar e de editar.
  // Relido na .84 (upstream 1.86, #2791): o PATCH recusa o mesmo campo do contato quando muda o gatilho, a configuração dele OU liga a regra. O espelho confere ao reescrever (garantirAutomacao) e ao ligar (ligarAutomacao); desligar e renomear seguem livres.
  { rota: "app/api/v1/automation-rules/[id]/route.ts", espelho: "lib/implantacao/automacoes.ts", impressao: "aed965ba98fa05c8" },
  // Follow-up.
  // Relido na .72 (upstream 1.70, #2028): só a autenticação mudou (sessão OU token dsk_, resolveAuthDual). Nenhuma regra nova para o espelho.
  { rota: "app/api/v1/ai/followup-flows/from-model/route.ts", espelho: "lib/implantacao/followup.ts", impressao: "a0e03549e796bcf8" },
  { rota: "app/api/v1/ai/followup-flows/[id]/route.ts", espelho: "lib/implantacao/followup.ts", impressao: "d7640ddfa33c7917" },
  // Relido na .84 (upstream 1.86, #3056 e #3048): a publicação confere os modelos de mensagem citados (carregaModelosCitados, modelo inexistente nesta conta é recusado) e devolve os AVISOS do gatilho de silêncio (avisosDoGatilho). O espelho (publicarFollowup) faz as duas coisas e devolve os avisos em `avisos`.
  { rota: "app/api/v1/ai/followup-flows/[id]/publish/route.ts", espelho: "lib/implantacao/followup.ts", impressao: "c669f202a47bde3d" },
  // Agente de IA.
  // Relido na .72 (upstream 1.70 #2028 e 1.73 #2296): token dsk_ e o corpo legado passa a criar mcp_agent com v1 rascunho pelo MESMO mcpAgentDraftRecords que o espelho já usa. A trava da IA continua na rota (lib/ai/trava-da-ia-na-rota.ts).
  // Relido na .76 (upstream 1.74 e 1.79): o código do erro de escopo (provedor desligado) e a coluna handoff_legal_enabled na leitura. O espelho já passava a versão inteira à conferência de escopo; a recusa passou a usar mensagemDoEscopo.
  // Relido na .81 (upstream 1.81, #2955): o corpo legado sem modelo passa a resolver o par (provedor, modelo) pelo padrão da instalação e RECUSA par que o provedor não executa, antes do insert. O espelho não recebe modelo (a IA é da plataforma, travarIaDaVersaoNova), e passou a conferir o par que vai gravar com a MESMA régua (validarParProvedorModelo), recusando com "Nada foi criado".
  { rota: "app/api/v1/ai/agents/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "2a79a511461b83ef" },
  // Relido na .72 (upstream 1.70, #2013 e #2028): a versão nova grava proposal_ai_draft_enabled; o espelho (inserirVersao) passou a gravar também. O resto é a autenticação por token.
  // Relido na .76 (upstream 1.74 e 1.79): a versão nova copia handoff_legal_enabled e o escopo confere provedor, chave e número. O espelho (inserirVersao e a conferência antes de gravar) faz os dois.
  { rota: "app/api/v1/ai/agents/[id]/versions/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "b7f10fdc1237e374" },
  // Relido na .76: token dsk_ (resolveAuthDual), handoff_legal_enabled no PATCH e a conferência de escopo antes de editar o rascunho. O espelho confere o escopo antes das duas gravações.
  // Relido na .81 (upstream 1.81): o PATCH do rascunho passa a GRAVAR pipeline_ids e knowledge_source_ids (antes só entravam no schema) e os confere no escopo. O espelho já gravava os dois e já os passava a validarEscopoDaVersao.
  { rota: "app/api/v1/ai/agents/[id]/versions/[vid]/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "500b60627f41c339" },
  // Relido na .76 (upstream 1.79, #2156): publishAgentVersion recebe quemPublicou, e a mudança da chave jurídica sai como ai_agent.legal_handoff_changed com o ator. O espelho passa o autor do token. E a ferramenta de servidor MCP externo escolhida no agente conta como capacidade válida (`toolIdAceito`): o espelho usa a mesma régua ao publicar.
  { rota: "app/api/v1/ai/agents/[id]/publish/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "479026df35f97b55" },
  { rota: "app/api/v1/ai/agents/[id]/pause/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "6e42c31f7151ac42" },
  // Espelhado na .73 (upstream 1.71, #2216): o limiar de sentimento mora em `config` do cadastro. O espelho (configComLimiar) faz a mesma mescla do PATCH: padrões, o gravado e o pedido por cima, conferido por agentPatchSchema.
  // Relido na .76 (upstream 1.74): token dsk_ e a auditoria ai_agent.updated no PATCH do cadastro. O espelho deixa a mesma linha quando muda nome, descrição, prioridade ou limiar.
  { rota: "app/api/v1/ai/agents/[id]/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "e0f5fecd68174ac1" },
  // Roteador de intenção, espelhado na .73 (upstream 1.73, #2290: destino de funil por intenção). O espelho cria DESLIGADO de propósito; o resto segue a rota (número conferido, configDoRoteador, gravação das intenções pelas mesmas duas funções).
  // Relido na .76 (upstream 1.74, #2061): o roteador novo nasce com context_message_count 8, e a régua é 0 a 16. O espelho grava o mesmo e ganhou `mensagens_de_contexto`.
  // Relido na .82 (upstream 1.84, #2824): as três rotas do roteador passaram de requireRole para resolveAuthDual (token dsk_ com config:* e papel admin), e a auditoria leva o token. Nenhuma regra nova de gravação; a trava da IA nas rotas pergunta quem pede por quemPedeNaRota. O espelho não passa pela rota: nada a levar.
  { rota: "app/api/v1/ai/routers/route.ts", espelho: "lib/implantacao/roteador.ts", impressao: "d0b8746f564c94dc" },
  { rota: "app/api/v1/ai/routers/[id]/route.ts", espelho: "lib/implantacao/roteador.ts", impressao: "6155a60257558350" },
  // Relido na .76 (upstream 1.79, #2624): o cliente do pool que falhou no meio da transação volta com erro (release(err)). O espelho faz o mesmo em gravarIntencoes.
  { rota: "app/api/v1/ai/routers/[id]/members/route.ts", espelho: "lib/implantacao/roteador.ts", impressao: "bd2988da8205a0a4" },
  // Memória da empresa.
  { rota: "app/api/v1/ai/memory/route.ts", espelho: "lib/implantacao/memoria.ts", impressao: "c28255da296e68b6" },
  { rota: "app/api/v1/ai/memory/entries/route.ts", espelho: "lib/implantacao/memoria.ts", impressao: "721aec1553d22379" },
  // Dados da empresa e regras de atendimento.
  // Relido na .72 (upstream 1.70, #2027): o papel passa por podeAdministrarEmpresa, a regra única do upstream. O espelho é do servidor (o token do MCP de plataforma já é a autorização).
  // Relido na .76 (upstream 1.74 e 1.79): a gravação mora em gravarDadosCadastrais (com media_retention_enforced e a frase do CNPJ repetido), e o modo de venda ausente não muda. O espelho grava as mesmas colunas e dá a mesma frase.
  // Relido na .81 (upstream 1.81): só o IP da auditoria passou a sair de ipDoCliente. Nenhuma regra nova para o espelho.
  { rota: "app/actions/settings/updateTenant.ts", espelho: "lib/implantacao/empresa.ts", impressao: "f0f3d2eca4518724" },
  // Espelhados na .81 (upstream 1.80 #978 e 1.81 #2063): as duas opções da agenda. As funções do upstream exigem sessão com MFA; o espelho grava a MESMA chave de topo pelo servidor (mudarSettingsDaOrganizacao), lida pelas mesmas réguas (colegasPodemMexerNaAgendaLigado, meetAbertoLigado), com a mesma auditoria.
  { rota: "app/actions/settings/definirAgendaDosColegas.ts", espelho: "lib/implantacao/empresa.ts", impressao: "a723732e45ad75f4" },
  { rota: "app/actions/settings/definirMeetAberto.ts", espelho: "lib/implantacao/empresa.ts", impressao: "62dbe5c947055ca7" },
  // Espelhado na .81 (upstream v1.83, #2147/#2948): o servidor MCP externo, com o guard anti-SSRF, a chave cifrada nas colunas e a auditoria só com o host. A recusa da demonstração é NOSSA nos dois lados.
  { rota: "app/actions/settings/definirServidorMcpExterno.ts", espelho: "lib/implantacao/servidor-mcp-externo.ts", impressao: "49a7cae71537b064" },
  // Espelhado na .76 (upstream 1.76, #2367): o freio do passo "a IA decide", com a mescla nos dois níveis de settings e a mesma auditoria.
  { rota: "app/actions/settings/definirAiDecideDaEmpresa.ts", espelho: "lib/implantacao/empresa.ts", impressao: "8168719014b15dca" },
  // Espelhado na .76 (upstream 1.77, #1752): os planos de tarefa, conferidos por planosSchema, em settings.task_plans.
  { rota: "app/api/v1/settings/task-plans/route.ts", espelho: "lib/implantacao/planos-de-tarefa.ts", impressao: "dbd8af9b1d6e19dd" },
  // Espelhado na .76 (upstream 1.74, #2321): a camada de afirmação clínica da empresa, pelo mesmo upsert e auditoria.
  { rota: "app/api/v1/ai/guardrail-layers/route.ts", espelho: "lib/implantacao/agente.ts", impressao: "2bde06e4c4f3887e" },
  // Espelhados na .76: os dias da prospecção (1.80, 0642), guardar o histórico (1.74, #999) e a pausa agendada (1.79, #2388).
  { rota: "app/api/v1/ai/pacing/route.ts", espelho: "lib/implantacao/canal.ts", impressao: "3a02cf8f709c4ea5" },
  { rota: "app/api/v1/channel-sessions/[id]/acervo/route.ts", espelho: "lib/implantacao/canal.ts", impressao: "1932744eaa41d92f" },
  // Relido na .81 (upstream 1.81, #2388): a régua da janela virou validarJanela, compartilhada por criar e EDITAR, e o [id] ganhou o PATCH que corrige os dois horários de uma janela que ainda não começou (status scheduled, com a trava contra a corrida do relógio). O espelho ganhou `ajustar_pausa_agendada` com a mesma régua (recusaDaJanela) e a mesma auditoria channel.schedule_updated.
  { rota: "app/api/v1/channel-schedules/route.ts", espelho: "lib/implantacao/canal.ts", impressao: "a15f8ed9f3c6296a" },
  { rota: "app/api/v1/channel-schedules/[id]/route.ts", espelho: "lib/implantacao/canal.ts", impressao: "71f6d0aeb4a8e9ae" },
  // Espelhado na .81 (upstream 1.81): o nome interno da conexão, com a mesma faixa (1 a 80) e a auditoria channel.renamed.
  { rota: "app/api/v1/channel-sessions/[id]/name/route.ts", espelho: "lib/implantacao/canal.ts", impressao: "9d65a85056a96789" },
  // Espelhados na .76 (upstream 1.76 e 1.78): a fonte de formulário, com as perguntas e a autorização de IA (que exige a assinatura).
  { rota: "app/api/v1/webhook-sources/route.ts", espelho: "lib/implantacao/fonte-de-formulario.ts", impressao: "a400691a20559e3f" },
  // Relido na .82 (upstream 1.84, #2316, 0683): a opção `update_existing_lead_on_capture` entra no PATCH e a recusa sem assinatura passa a dizer QUAL opção a pediu (`opcaoSemAssinatura`). O espelho ganhou `atualizar_card_no_reenvio`, com a mesma régua e uma frase por opção.
  // Relido na .86 (upstream 1.88, #3101, 0722): a terceira opção que pede assinatura, `reuse_open_lead_on_capture`, com a frase própria (`reuse_lead`). O espelho ganhou `reaproveitar_card_aberto`, pela mesma régua.
  { rota: "app/api/v1/webhook-sources/[id]/route.ts", espelho: "lib/implantacao/fonte-de-formulario.ts", impressao: "c07981ef8206507f" },
  // Espelhado na .76 (upstream 1.74, 0558): a coluna do cliente numa conexão de banco externo, sem tocar na credencial.
  // Relido na .81 (upstream 0618): a leitura e a volta do PATCH trazem source_mode e sources_count. O espelho lê as duas pela visão segura.
  // Relido na .84 (upstream 1.86, 0691): a leitura e a volta do PATCH trazem db_type e last_test_aviso, e o pool fecha pelo registro de drivers. O espelho lê as duas colunas (tipo_do_banco, aviso_do_ultimo_teste); não muda endereço nem senha, então não fecha pool.
  { rota: "app/api/v1/external-db/connections/[id]/route.ts", espelho: "lib/implantacao/banco-externo.ts", impressao: "6eda05f3f92f18de" },
  // Espelhado na .81 (upstream 0618): as fontes liberadas, o modo e a lista inteira num UPDATE só, conferidos por atualizarFontesSchema, com a auditoria external_db_sources.updated.
  { rota: "app/api/v1/external-db/connections/[id]/sources/route.ts", espelho: "lib/implantacao/banco-externo.ts", impressao: "46c64eadd3622e63" },
  // Espelhado na .86 (upstream 1.87 e 1.88, 0706): as receitas prontas, a lista inteira, conferidas por atualizarReceitasSchema, cada `fixos` pela régua da receita e cada receita contra o motor da conexão, com a auditoria external_db_recipes.updated.
  { rota: "app/api/v1/external-db/connections/[id]/recipes/route.ts", espelho: "lib/implantacao/banco-externo.ts", impressao: "fc60629210fa63e1" },
  // Espelhado na .76 (upstream 1.79, #2591): o dono do contato. A rota chama fn_definir_carteira_do_cliente; o MCP chama a cópia do fork (9022) e deixa a mesma auditoria.
  // Relido na .81 (upstream 1.81): a rota ganhou o GET (quem é o dono hoje, para a tela). O PATCH, que o espelho segue, é o mesmo.
  { rota: "app/api/v1/contacts/[id]/carteira/route.ts", espelho: "lib/mcp-plataforma/importacao/contatos.ts", impressao: "7b9ce7b08a58e8ba" },
  { rota: "app/api/v1/settings/routing/route.ts", espelho: "lib/implantacao/empresa.ts", impressao: "5141ab7ba6a82744" },
  // Espelhado na .83 (upstream 1.85, 0663, #2331): as regras de atendimento POR NÚMERO (responsáveis, modo do número e destino padrão), na mesma gravação. A rota chama fn_set_channel_routing; o MCP chama a cópia do fork (9045), com o token como ator, e deixa a mesma auditoria routing.config_changed.
  { rota: "app/api/v1/settings/routing/channels/route.ts", espelho: "lib/implantacao/distribuicao-do-numero.ts", impressao: "5b49c3b3a43fda9a" },
  // Espelhado na .73 (upstream 1.70, #2079): quem fala, em negrito, na mensagem. O espelho confere com o mesmo assinaturaEntradaSchema e grava a mesma chave de settings.
  // Relido na .86 (upstream 1.88, #3318): `por_agente` (cada agente assina com o próprio nome), e o ausente mantém o gravado. O espelho ganhou `nome_de_cada_agente` e passou a manter o gravado quando o campo não vem.
  { rota: "app/api/v1/settings/assinatura/route.ts", espelho: "lib/implantacao/empresa.ts", impressao: "9802b14502f9d3fa" },
  // Jornada de quem atende.
  { rota: "app/api/v1/attendants/availability/[user_id]/route.ts", espelho: "lib/implantacao/agenda.ts", impressao: "de0c21f50707a594" },
  // Respostas prontas e modelo oficial do WhatsApp.
  // Relido na .81 (upstream 1.81, #2526): `midias` nasce vazia no POST, o PATCH remove pela lista que fica (conferida, e o arquivo sai do bucket só depois da linha) e o upload é a rota /midias. O espelho ganhou `imagens`: a lista inteira por endereço, baixada e conferida pelos bytes, com o nome tirado do conteúdo (repetir não empilha), e as mesmas auditorias.
  // Relido na .86 (upstream 1.88, #3244, 0729; 1.87, #2833): a resposta nova nasce no TOPO (`ordem`, um passo acima da primeira) e a mídia pode ser áudio. O espelho grava a `ordem` das novas no topo, na ordem do pedido; as imagens seguem conferidas pelo farejador da imagem (áudio fica na tela).
  { rota: "app/api/v1/message-templates/route.ts", espelho: "lib/implantacao/mensagens.ts", impressao: "226ed030286395c3" },
  { rota: "app/api/v1/message-templates/[id]/route.ts", espelho: "lib/implantacao/mensagens.ts", impressao: "44224debb3afb3b5" },
  { rota: "app/api/v1/message-templates/[id]/midias/route.ts", espelho: "lib/implantacao/mensagens.ts", impressao: "be84b4352353620c" },
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
  { rota: "app/api/v1/admin/cobranca/planos/route.ts", espelho: "lib/planos-mia/garantir-planos.ts", impressao: "349bad9b1a55ec10" },
  { rota: "app/api/v1/admin/cobranca/planos/[id]/route.ts", espelho: "lib/planos-mia/garantir-planos.ts", impressao: "79549ecc4a6b4987" },
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
  impressao: "11a835066dd98199",
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

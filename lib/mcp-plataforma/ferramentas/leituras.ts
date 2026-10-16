/**
 * As LEITURAS de apoio da implantação: o que o agente implantador consulta para
 * não trabalhar às cegas.
 *
 * Poucas e largas, de propósito. Vinte leituras minúsculas ("listar etapas",
 * "ver etapa", "listar campos") fariam o modelo gastar dez chamadas para
 * entender um funil; aqui uma chamada devolve o funil inteiro. O que é grande
 * (o catálogo, o prompt de um agente, o grafo de um follow-up) tem leitura
 * própria ou vem só quando é pedido.
 *
 * Nenhuma delas exige operação do token: ler é livre.
 */
import { z } from "zod";

import { lerTextoDoAvisoForaDoHorario } from "@/lib/agent-engine/agent/aviso-fora-do-horario";
import { LEAD_STAGES } from "@/lib/agent-engine/agent/lead-state";
import { CATEGORIAS_DE_TIPO, LOCAIS_DE_TIPO } from "@/lib/agenda/tipos-de-agendamento";
import { DIRECOES_DO_SILENCIO } from "@/lib/automation/gatilhos-de-tempo";
import { escolherVersoesDaTela } from "@/lib/ai/agents/versoes-da-tela";
import { estadoDoAgente } from "@/lib/ai/agents/no-ar";
import { DEFAULT_VISIBILITY_MODE } from "@/lib/auth/types";
import { lerGuardarHistorico } from "@/lib/channels/acervo-do-historico";
import { conexaoGuardaHistorico } from "@/lib/channels/conexao-guarda-historico";
import { nomeDoCanal } from "@/lib/channels/estado";
import { STATUS_SAUDAVEL } from "@/lib/channels/health";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { horizonteDoModeloMs, MODELOS_DE_FOLLOWUP, ROTULO_DO_SEGMENTO, toquesDoModelo } from "@/lib/followup/modelos";
import { carregaEtapasCitadas } from "@/lib/followup/etapas-citadas";
import { rascunhoDoFluxo } from "@/lib/followup/rascunho";
import { acharPorNomeOuId } from "@/lib/implantacao/base";
import { lerAgentes, lerCamadaClinica, lerVersoes, limiarDeSentimentoDo, pendenciasDePublicacao } from "@/lib/implantacao/agente";
import { lerTipos } from "@/lib/implantacao/agenda";
import { lerConexoesDeBancoExterno, retratoDaConexao } from "@/lib/implantacao/banco-externo";
import { diasDaProspeccaoDe, lerAjustesDosCanais, lerCanais, lerPausasAgendadas } from "@/lib/implantacao/canal";
import { iaDecideLigadaNa } from "@/lib/implantacao/empresa";
import { lerFontes, retratoDaFonte } from "@/lib/implantacao/fonte-de-formulario";
import { retratoDosPlanos } from "@/lib/implantacao/planos-de-tarefa";
import { lerRegras } from "@/lib/implantacao/automacoes";
import { CONFIGURACAO_DOS_GATILHOS_DE_OBRIGACAO, modelosDeObrigacaoParaOAgente } from "@/lib/implantacao/obrigacoes";
import { capacidadesOferecidas, catalogoServido, pacotesLigados } from "@/lib/implantacao/capacidades";
import { lerConvites, lerMembros } from "@/lib/implantacao/equipe";
import { GATILHOS_COM_MOTOR, lerFluxos, nosDoGrafo } from "@/lib/implantacao/followup";
import { lerDocumentoDaMemoria } from "@/lib/implantacao/memoria";
import { lerModelosOficiais, lerRespostasProntas } from "@/lib/implantacao/mensagens";
import { retratoDosRoteadores } from "@/lib/implantacao/roteador";
import { EXPLICACAO_DO_PASSO, ROTULO_DO_PASSO } from "@/lib/leads/agent-mapping";
import { lerTodasAsPaginas } from "@/lib/leitura/todas-as-paginas";
import { configAssinatura } from "@/lib/messaging/assinatura";
import { PACOTES } from "@/lib/mcp/tools/pacotes";
import { TETO_TOOLS_POR_AGENTE } from "@/lib/mcp/tools/selecao-por-pacote";
import { MOEDAS_SERVIDAS } from "@/lib/money";
import { PACOTES as PACOTES_DE_FUNIL } from "@/lib/onboarding/pacotes-de-funil";
import { COLUNAS_DO_PRODUTO } from "@/lib/schemas/produtos";
import { ROUTING_MODES, routingConfigSchema } from "@/lib/schemas/routing";
import { colegasPodemMexerNaAgendaLigado, meetAbertoLigado } from "@/lib/schemas/settings";
import { ROLES } from "@/lib/schemas/team";
import {
  ACOES_QUE_REGRAVAM_O_LEAD,
  GATILHOS_DO_TRIGGER_DE_LEAD,
  GATILHOS_OFERECIDOS,
  MENSAGEM_DO_LACO_DE_LEAD,
} from "@/lib/schemas/webhooks";
import { PALETA_DE_ETIQUETAS } from "@/lib/tags/cor-da-etiqueta";
import { FUSOS_OFERECIDOS } from "@/lib/tempo/fusos";

import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

/** Quantas páginas de 1000 produtos `plataforma_ver_catalogo` lê antes de dizer que cortou. */
const PAGINAS_DO_CATALOGO = 10;

const SECOES_DE_MODELO = [
  "funis",
  "followup",
  "capacidades_do_agente",
  "automacoes",
  "agenda",
  "etiquetas",
  "empresa",
  // os tipos de documentos e obrigações por segmento (docs/fork/obrigacoes.md)
  "obrigacoes",
] as const;

const SECOES_DE_CONFIGURACAO = [
  "etiquetas",
  "memoria",
  "conhecimento",
  "followups",
  "automacoes",
  "agenda",
  "equipe",
  "canais",
  "atendimento",
  "mensagens",
  // upstream 1.74 a 1.80
  "planos_de_tarefa",
  "fontes_de_formulario",
  "banco_externo",
] as const;

/** O formato de cada ação de automação, para o modelo montar `acoes` sem adivinhar. */
const ACOES_DE_AUTOMACAO = [
  { type: "create_or_move_lead", o_que_faz: "Cria o negócio ou o move para uma etapa.", config: '{ "pipeline_id": "<id do funil>", "stage_id": "<id da etapa>", "quando_em_outro_funil": "recusar" | "abrir_novo_card" (opcional) }' },
  {
    type: "add_tag",
    o_que_faz:
      'Põe etiquetas no negócio (o padrão) ou no contato do negócio (`destino: "contato"`, preservando as que o contato já tem; negócio sem contato é ignorado). O filtro de etiquetas do Inbox lê a do contato.',
    config: '{ "tags": ["Etiqueta"], "destino": "card" | "contato" (opcional, padrão "card") }',
  },
  { type: "assign_owner", o_que_faz: "Define o responsável.", config: '{ "user_id": "<id da pessoa da equipe>" }' },
  { type: "create_task", o_que_faz: "Cria uma tarefa para a equipe. Nunca fala com o cliente.", config: '{ "titulo": "Ligar para {{contact.name}}", "vence_em_dias": 1, "atribuir_a": "dono_do_lead" | { "usuario_id": "<id>" }, "prioridade": "low" | "medium" | "high" | "urgent" }' },
  {
    type: "apply_task_plan",
    o_que_faz:
      "Aplica um PLANO DE TAREFAS ao negócio: cria de uma vez, na ordem, todas as tarefas do plano, e só uma vez por negócio (repetir a regra não duplica). Nunca fala com o cliente.",
    config: '{ "plano_id": "<id do plano, de plataforma_garantir_planos_de_tarefa>" }',
  },
  {
    type: "start_message_flow",
    o_que_faz:
      'Inscreve o contato num follow-up publicado (o padrão) ou, com `surface: "atendimento"` (upstream 1.81), inicia um FLUXO DE ATENDIMENTO publicado: a automação abre o atendimento e a primeira pergunta sai quando o cliente responder.',
    config: '{ "flow_pointer_id": "<id do fluxo>", "surface": "followup" | "atendimento" (opcional, padrão "followup") }',
  },
  {
    type: "send_email",
    o_que_faz:
      "Manda um E-MAIL (upstream 1.81) pelo servidor de e-mail da instalação: para o contato do negócio, para o responsável do negócio ou para um endereço fixo. " +
      "MANDA PARA FORA. Contato bloqueado ou que recusou comunicação não recebe. Na empresa de demonstração não sai e a regra com ele não liga.",
    config:
      '{ "destinatario": "contato" | "dono_do_lead" | "fixo", "email_fixo": "<só com fixo>", "assunto": "Sua visita a {{destino}}", "corpo": "Olá, {{primeiro_nome}}!", "formato": "texto" | "html" (opcional) } ' +
      "(as mesmas marcações da mensagem de WhatsApp)",
  },
  {
    type: "send_whatsapp_message",
    o_que_faz: "Manda um texto fixo pelo WhatsApp. FALA COM O CLIENTE.",
    config:
      '{ "channel_session_id": "<id do número>", "template": "Olá, {{primeiro_nome}}! Recebemos seu pedido de {{servico}}." } ' +
      "(marcações: {{nome}}, {{primeiro_nome}}, {{telefone}}, {{email}}, e a CHAVE de qualquer campo do funil, ex. {{servico}}, que é o campo que o formulário de captação mandou)",
  },
  { type: "send_ai_message", o_que_faz: "O agente escreve e manda uma mensagem. FALA COM O CLIENTE.", config: '{ "agent_id": "<id do agente publicado>", "channel_session_id": "<id do número>", "instruction": "o que dizer" }' },
  { type: "notify_group", o_que_faz: "Avisa o grupo de WhatsApp da equipe (o grupo que a plataforma escolheu para o cliente).", config: '{ "template": "Novo lead: {{contact.name}}" }' },
  {
    type: "call_webhook",
    o_que_faz: "Chama um endereço de outro sistema (ERP, faturamento, planilha de comissão). MANDA DADO PARA FORA.",
    config:
      '{ "url": "https://...", "include_owner": false } (o segredo, se houver, é posto por uma pessoa na tela). ' +
      "`include_owner: true` põe no corpo o responsável do compromisso ou do negócio (tipo, id e nome, sem e-mail). O negócio no corpo traz o motivo da perda e a data de fechamento.",
  },
  {
    type: "ai_decide",
    o_que_faz:
      'O passo "a IA decide": a IA lê a instrução, a mensagem, os dados do negócio e as etiquetas, e escolhe UMA das opções; a ação da opção escolhida roda pelo caminho de sempre. ' +
      "Resposta fora da lista não executa nada. GASTA IA a cada execução (custo das automações, dentro do teto mensal da empresa): a regra só é aceita com `custo_de_token: true`. " +
      "E-mail, telefone, nome do contato e CPF não vão para a IA; o texto da mensagem e os campos do negócio vão.",
    config:
      '{ "custo_de_token": true, "instrucao": "Se a pessoa pediu orçamento, etiquete; se reclamou, crie tarefa urgente.", "opcoes": [ ' +
      '{ "id": "orcamento", "rotulo": "Pediu orçamento", "acao": { "type": "add_tag", "config": { "tags": ["Orçamento"] } } }, ' +
      '{ "id": "reclamacao", "rotulo": "Reclamou", "acao": { "type": "create_task", "config": { "titulo": "Ligar para {{contact.name}}", "vence_em_dias": 0, "atribuir_a": "dono_do_lead", "prioridade": "urgent" } } } ] } ' +
      "(de 2 a 6 opções, `id` único em cada; a ação de uma opção é qualquer uma das outras desta lista, nunca outro ai_decide)",
  },
];

export const FERRAMENTAS_DE_LEITURA: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_listar_modelos",
    description:
      "Os MODELOS e VOCABULÁRIOS que as ferramentas de implantação aceitam, para montar os pedidos sem adivinhar: " +
      "funis prontos por tipo de negócio (com o passo do agente em cada etapa), modelos de follow-up por segmento (com o id para instalar), " +
      "pacotes de capacidade do agente (e as capacidades de cada um), gatilhos e ações de automação (com o formato de cada `config`), " +
      "categorias e locais dos tipos de agendamento, a paleta de cores das etiquetas, fusos, moedas e papéis, e os tipos de documentos e obrigações por segmento. " +
      "QUANDO USAR: antes de plataforma_garantir_funil, plataforma_garantir_followup, plataforma_garantir_agente e plataforma_garantir_automacao. " +
      "Peça só as seções de que precisa em `secoes`: a resposta inteira é grande. Não depende de cliente nenhum.",
    inputSchema: {
      secoes: z
        .array(z.enum(SECOES_DE_MODELO))
        .min(1)
        .max(SECOES_DE_MODELO.length)
        .optional()
        .describe(`Quais seções devolver: ${SECOES_DE_MODELO.join(", ")}. Sem isto, devolve todas.`),
    },
    exemplo: { secoes: ["funis", "followup"] },
    operacao: null,
    handler: async (_ctx, args) => {
      const pedidas = new Set((args.secoes as string[] | undefined) ?? SECOES_DE_MODELO);
      const r: Record<string, unknown> = {};

      if (pedidas.has("funis")) {
        r.funis = {
          passos_do_agente: LEAD_STAGES.map((p) => ({
            passo: p,
            rotulo: ROTULO_DO_PASSO[p],
            quando_o_agente_move_para_ca: EXPLICACAO_DO_PASSO[p],
          })),
          como_usar:
            "Cada etapa de um funil pode declarar UM passo: é para lá que o agente move o negócio quando a conversa chega naquele ponto. " +
            '`passo: "won"` faz da etapa a de ganho e `passo: "lost"` a de perda (todo funil precisa das duas). `passo: null` é etapa que só pessoas movem.',
          modelos: PACOTES_DE_FUNIL.map((p) => ({
            id: p.id,
            para: p.comoSeApresenta,
            nome_do_funil: p.proposta.nome,
            etapas: p.proposta.etapas,
          })),
        };
      }

      if (pedidas.has("followup")) {
        r.followup = {
          como_usar:
            "Instale com plataforma_garantir_followup informando `modelo` (o id). O fluxo nasce RASCUNHO, com os textos do modelo; " +
            "ajuste os textos pelo id do nó (`textos`), publique com plataforma_publicar_followup e arme no agente com plataforma_garantir_agente (`followups`). " +
            "Nenhum modelo mexe no negócio: para o fluxo mover o card ou gravar etiqueta (ex.: quem não respondeu a nenhum toque), acrescente as caixas com `mover_no_funil` e `etiquetar`, " +
            'antes do nó em que isso deve acontecer (o fim «sem resposta» dos modelos é o nó "fim-esgotou").',
          gatilho_de_silencio:
            "Três ajustes além de `silencio_minutos`: `silencio_maximo_minutos` (o fluxo só começa enquanto o silêncio for recente), " +
            "`pausa_para_recomecar_minutos` (quanto esperar antes de recomeçar para quem já passou pelo fluxo) e `pausa_conta_do_ultimo_envio` (de onde a pausa conta).",
          gatilhos_com_motor: GATILHOS_COM_MOTOR,
          modelos: MODELOS_DE_FOLLOWUP.map((m) => ({
            id: m.id,
            segmento: ROTULO_DO_SEGMENTO[m.nicho],
            nome: m.nome,
            jornada: m.jornada,
            resumo: m.resumo,
            o_que_dispara: m.oQueDispara,
            pede_etapa_do_funil: m.pedeEtapa,
            mensagens: toquesDoModelo(m.grafo),
            acompanha_por_horas: Math.round(horizonteDoModeloMs(m.grafo) / 3_600_000),
            quando_humano_assume: m.handoffPolicy,
          })),
        };
      }

      if (pedidas.has("capacidades_do_agente")) {
        const catalogo = catalogoServido();
        r.capacidades_do_agente = {
          como_usar:
            `Em plataforma_garantir_agente, \`pacotes\` liga as capacidades de cada pacote que não são críticas. ` +
            `As críticas (efeito que não dá para desfazer) entram uma a uma, em \`capacidades\`. Um agente aceita até ${TETO_TOOLS_POR_AGENTE} capacidades. ` +
            "Esta é a lista da instalação; a que vale para um cliente (módulos e modo de venda) aparece em plataforma_ver_agentes.",
          pacotes: PACOTES.map((p) => ({
            id: p.id,
            rotulo: p.rotulo,
            o_que_o_agente_passa_a_fazer: p.explicacao,
            capacidades: catalogo
              .filter((c) => c.pacotes.includes(p.id) && c.marcavel)
              .map((c) => ({ id: c.id, rotulo: c.rotulo, risco: c.risco, entra_pelo_pacote: c.risco !== "critico" })),
          })),
        };
      }

      if (pedidas.has("automacoes")) {
        r.automacoes = {
          como_usar:
            "plataforma_garantir_automacao cria a regra DESLIGADA; plataforma_ligar_automacao a liga. " +
            "Os ids de funil, etapa, número, agente, fluxo e pessoa vêm das leituras (plataforma_ver_funis, plataforma_ver_agentes, plataforma_ver_configuracao).",
          gatilhos: GATILHOS_OFERECIDOS,
          // Upstream 1.71 (#2211): ganho, perda, reabertura e troca de responsável.
          gatilhos_de_desfecho_do_negocio: {
            quais: GATILHOS_DO_TRIGGER_DE_LEAD,
            quando_disparam:
              "Quando um negócio que JÁ EXISTE é ganho (lead.won), perdido (lead.lost), reaberto (lead.reopened) ou troca de responsável (lead.assigned), por qualquer caminho: " +
              "arrastar o card, o botão Ganhou/Perdeu, mover em lote, o fechamento feito pela IA ou outra automação. Criar o negócio já ganho, já perdido ou já com responsável NÃO dispara.",
            acoes_proibidas: ACOES_QUE_REGRAVAM_O_LEAD,
            // O veto vale também dentro das opções de um `ai_decide` (o upstream
            // descobre as ações-alvo antes de conferir o laço).
            tambem_dentro_do_ai_decide: true,
            por_que: MENSAGEM_DO_LACO_DE_LEAD,
            uso_tipico: 'Avisar outro sistema: { "type": "call_webhook", "config": { "url": "https://...", "include_owner": true } }.',
            // Upstream 1.81 (#2769, #2787): a continuação do ganho.
            excecao_do_ganho:
              "No `lead.won`, `create_or_move_lead` declarado na regra e apontando para OUTRO funil é aceito: o negócio ganho fica GANHO e nasce um card novo no funil de destino " +
              "(o pós-venda), com o conteúdo do negócio e sem duplicar se a regra rodar de novo. Para o MESMO funil, a ação recusa.",
          },
          // Upstream 1.81 (#2812): o contato ganhou telefone.
          gatilhos_de_contato: {
            "contact.phone_added":
              "Quando a ficha de um contato que estava SEM telefone passa a ter um (informado pelo cliente, pela equipe ou por integração). " +
              "Serve para a primeira mensagem de WhatsApp a quem chegou por e-mail ou formulário sem número.",
          },
          gatilhos_que_pedem_configuracao: {
            "lead.date_field_due":
              '{ "pipeline_id": "<id do funil>", "campo": "<chave do campo de data do funil>", "dias": 1 } (dias ATÉ a data; negativo = depois dela)',
            "lead.silent_for":
              `{ "dias": 3, "direcao": ${DIRECOES_DO_SILENCIO.map((d) => `"${d}"`).join(" | ")}, "pipeline_id": "<opcional>", "proteger_pela_agenda": true }`,
            "lead.stage_stale": '{ "dias": 7, "pipeline_id": "<opcional>", "stage_id": "<opcional>", "proteger_pela_agenda": true }',
            "lead.created":
              '{ "webhook_source_id": "<opcional: id de uma fonte de formulário>" } (com a fonte, a regra vale só para o negócio que chegou por ela; sem, vale para todo negócio criado)',
            // documentos e obrigações: os cinco gatilhos `obrigacao.*`
            ...CONFIGURACAO_DOS_GATILHOS_DE_OBRIGACAO,
          },
          condicoes:
            '[{ "field": "lead.tags", "op": "eq" | "neq" | "contains", "value": "texto" }]. `field` é um caminho no contexto do evento: ' +
            "`lead.<coluna>` (o negócio), `contact.<coluna>` (o contato) ou `event.<campo>` (o que o evento trouxe). Em lista (etiquetas), `contains` exige a etiqueta inteira, sem diferenciar maiúsculas.",
          acoes: ACOES_DE_AUTOMACAO,
        };
      }

      if (pedidas.has("obrigacoes")) {
        r.obrigacoes = modelosDeObrigacaoParaOAgente();
      }

      if (pedidas.has("agenda")) {
        r.agenda = {
          categorias: CATEGORIAS_DE_TIPO,
          locais: LOCAIS_DE_TIPO.map((l) => ({
            id: l,
            significa: { in_person: "presencial", phone: "por telefone", whatsapp: "pelo WhatsApp", video_link: "link de vídeo", google_meet: "Google Meet (exige a conta Google de quem atende conectada)" }[l],
          })),
          dias_da_semana: "0 = domingo, 1 = segunda, ... 6 = sábado",
        };
      }

      if (pedidas.has("etiquetas")) {
        r.etiquetas = {
          paleta_recomendada: PALETA_DE_ETIQUETAS,
          como_usar: "A cor é `#rrggbb`. A paleta foi escolhida para as cores se distinguirem entre si, inclusive para quem tem daltonismo.",
        };
      }

      if (pedidas.has("empresa")) {
        r.empresa = {
          fusos: FUSOS_OFERECIDOS.map((f) => f.codigo),
          moedas: MOEDAS_SERVIDAS,
          modos_de_venda: { b2b: "vende para empresas (o cadastro pede empresa, cargo e setor)", b2c: "vende para pessoas" },
          // A lista é a do upstream (`ROUTING_MODES`): modo novo aparece aqui sozinho.
          modos_de_distribuicao: ROUTING_MODES.map((modo) => ({
            modo,
            significa:
              ({
                manual: "alguém assume cada conversa",
                round_robin: "rodízio entre quem está de plantão",
                load: "vai para quem está com menos conversas abertas; no empate, o rodízio decide",
              } as Record<string, string>)[modo] ?? "veja Configurações › Atendimento",
          })),
          papeis_da_equipe: ROLES.map((papel) => ({
            papel,
            significa: { viewer: "só vê", agent: "atende", manager: "gerencia (configura funil, agenda, automações)", admin: "administra a empresa" }[papel],
          })),
        };
      }

      return r;
    },
  },

  {
    name: "plataforma_ver_funis",
    description:
      "Os funis de um cliente, inteiros: nome, se é o padrão, as etapas na ordem (id, nome, ganho/perda, passo do agente, probabilidade, " +
      "prazo esperado, cor), os campos personalizados, os motivos de perda e de ganho e o vocabulário. " +
      "QUANDO USAR: antes de plataforma_garantir_funil (para ver o que existe e não duplicar), e sempre que precisar do id de um funil ou etapa " +
      "(automações e follow-ups pedem esses ids). Com `funil`, devolve só aquele.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      funil: z.string().trim().min(1).max(120).optional().describe("Nome ou id de um funil. Sem isto, devolve todos."),
      incluir_arquivados: z.boolean().optional().describe("Inclui funis e etapas arquivados. Padrão: não."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO },
    operacao: null,
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const arquivados = args.incluir_arquivados === true;
      const { data: funis, error } = await c.admin
        .from("crm_pipelines")
        .select("id, name, slug, description, is_default, is_client_pipeline, is_archived, position, vocabulary, settings")
        .eq("organization_id", c.orgId)
        .order("position", { ascending: true });
      if (error) throw new Error(`não consegui ler os funis: ${error.message}`);
      let lista = ((funis ?? []) as Array<Record<string, unknown>>).filter((f) => arquivados || f.is_archived !== true);
      if (typeof args.funil === "string") {
        lista = [
          acharPorNomeOuId(lista as Array<{ id: string; name: string }>, args.funil, (f) => f.name, {
            singular: "o funil",
            comoListar: "Chame sem `funil` para ver todos.",
          }) as unknown as Record<string, unknown>,
        ];
      }
      const { data: etapas, error: etapasErr } = await c.admin
        .from("crm_stages")
        .select("id, pipeline_id, name, slug, position, is_won, is_lost, is_archived, win_probability, agent_stage_hint, avisar_na_central, expected_duration_hours, color")
        .eq("organization_id", c.orgId)
        .order("position", { ascending: true });
      if (etapasErr) throw new Error(`não consegui ler as etapas: ${etapasErr.message}`);
      const todas = (etapas ?? []) as Array<Record<string, unknown>>;

      return {
        funis: lista.map((f) => {
          const settings = (f.settings as Record<string, unknown> | null) ?? {};
          return {
            id: f.id,
            nome: f.name,
            descricao: f.description ?? null,
            padrao: f.is_default === true,
            funil_de_clientes: f.is_client_pipeline === true,
            arquivado: f.is_archived === true,
            etapas: todas
              .filter((e) => e.pipeline_id === f.id && (arquivados || e.is_archived !== true))
              .map((e) => ({
                id: e.id,
                nome: e.name,
                passo: e.agent_stage_hint ?? null,
                ganho: e.is_won === true,
                perda: e.is_lost === true,
                probabilidade: e.win_probability ?? null,
                prazo_esperado_horas: e.expected_duration_hours === null ? null : Number(e.expected_duration_hours),
                cor: e.color ?? null,
                avisar_na_central: e.avisar_na_central === true,
                ...(e.is_archived === true ? { arquivada: true } : {}),
              })),
            campos: Array.isArray(settings.fields) ? settings.fields : [],
            motivos_de_perda: Array.isArray(settings.lost_reasons) ? settings.lost_reasons : [],
            motivos_de_ganho: Array.isArray(settings.won_reasons) ? settings.won_reasons : [],
            motivo_de_ganho_obrigatorio: settings.won_reason_required === true,
            reabertura: settings.reabertura ?? "mesmo_registro",
            vocabulario: f.vocabulary ?? {},
          };
        }),
      };
    },
  },

  {
    name: "plataforma_ver_agentes",
    description:
      "Os agentes de IA de um cliente: situação (no ar, pausado, rascunho), versão publicada, rascunho pendente, pacotes ligados, " +
      "funis e materiais autorizados, follow-ups armados, número, limiar de sentimento, e o que FALTA PARA PUBLICAR (com quem resolve: você, uma pessoa na tela, ou a plataforma). " +
      "Com `agente`, devolve também o PROMPT e a configuração inteira da versão vigente (o rascunho, se houver; senão a publicada), com o horário de atendimento e o aviso de fora do horário. " +
      "Devolve a passagem por assunto jurídico de cada agente e, da EMPRESA, se o bloqueio de afirmação clínica está ligado (`seguranca_da_empresa`). " +
      "Devolve ainda os ROTEADORES de intenção: o número, se está ligado, o agente reserva e cada intenção com o agente e o funil de destino. " +
      "QUANDO USAR: antes de plataforma_garantir_agente e de plataforma_garantir_roteador, e antes de publicar ou ligar. " +
      "Devolve ainda as capacidades que a tela oferece a ESTE cliente (módulos e modo de venda mudam a lista) quando `com_capacidades` é verdadeiro.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      agente: z.string().trim().min(1).max(120).optional().describe("Nome ou id de um agente, para ver o prompt e a configuração inteira."),
      com_capacidades: z.boolean().optional().describe("Devolve a lista de capacidades oferecidas a este cliente. Padrão: não."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, agente: "Bia" },
    operacao: null,
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const todos = (await lerAgentes(c.admin, c.orgId)).filter((a) => !a.archived_at);
      const numeros = await listSelectableChannels(c.admin, c.orgId);
      const oferecidas = await capacidadesOferecidas(c.admin, c.orgId);
      const fluxos = await lerFluxos(c.admin, c.orgId);
      const alvoUnico =
        typeof args.agente === "string"
          ? acharPorNomeOuId(todos, args.agente, (a) => a.name, {
              singular: "o agente",
              comoListar: "Chame sem `agente` para ver todos, ou crie com plataforma_garantir_agente.",
            })
          : null;

      const agentes = [];
      for (const agente of alvoUnico ? [alvoUnico] : todos) {
        const versoes = await lerVersoes(c.admin, c.orgId, agente.id);
        const tela = escolherVersoesDaTela(versoes, agente.published_version_id);
        const base = tela.base;
        const numero = base ? numeros.find((n) => n.id === base.channel_session_id) : undefined;
        const followup = (base?.followup as { enabled?: boolean; flow_pointer_ids?: string[]; send_window?: unknown } | null) ?? null;
        const horario = (base?.trigger_config as { filters?: { business_hours?: unknown } } | null)?.filters?.business_hours ?? null;
        const estado = estadoDoAgente(agente);
        agentes.push({
          id: agente.id,
          nome: agente.name,
          descricao: agente.description,
          prioridade: agente.priority,
          // Do cadastro, não da versão: vale na hora (upstream 1.71, #2216).
          limiar_de_sentimento: limiarDeSentimentoDo(agente),
          formato: agente.kind === "mcp_agent" ? "atual" : "antigo (editado só pela tela)",
          situacao: estado === "no_ar" ? "no ar" : agente.paused_at ? "pausado" : "rascunho",
          versao_publicada: tela.published?.version_number ?? null,
          rascunho_pendente: tela.draft?.version_number ?? null,
          numero: numero ? { id: numero.id, nome: numero.display_name, telefone: numero.phone_number, conectado: numero.status === STATUS_SAUDAVEL } : null,
          pacotes_ligados: base ? pacotesLigados(oferecidas, (base.tool_ids as string[] | null) ?? []) : [],
          capacidades: base ? ((base.tool_ids as string[] | null) ?? []) : [],
          funis_autorizados: base ? ((base.pipeline_ids as string[] | null) ?? []) : [],
          materiais: base ? ((base.knowledge_source_ids as string[] | null) ?? []) : [],
          // Da versão vigente (0616, #2156): ligada quando a coluna não diz o contrário.
          passagem_por_assunto_juridico: base ? base.handoff_legal_enabled !== false : null,
          followups_armados: (followup?.enabled ? (followup.flow_pointer_ids ?? []) : []).map(
            (id) => fluxos.find((f) => f.id === id)?.name ?? id,
          ),
          falta_para_publicar: tela.draft ? await pendenciasDePublicacao(c.admin, c.orgId, tela.draft, numeros) : [],
          ...(alvoUnico && base
            ? {
                versao_vigente: {
                  numero: base.version_number,
                  situacao: base.status === "draft" ? "rascunho" : "publicada",
                  prompt: base.system_prompt,
                  palavras_de_passagem: base.handoff_keywords,
                  passagem_para_humano: base.handoff_tool_enabled,
                  passagem_por_assunto_juridico: base.handoff_legal_enabled !== false,
                  casos: base.cases_enabled,
                  dividir_mensagens: base.split_messages,
                  tamanho_da_mensagem: base.split_max_chars,
                  espera_por_rajada_ms: base.inbound_debounce_ms ?? null,
                  horario_de_atendimento: horario,
                  // O texto como o motor o lê (upstream 1.72, #1926): null = não avisa.
                  aviso_fora_do_horario: lerTextoDoAvisoForaDoHorario(base.trigger_config),
                  janela_dos_followups: followup?.send_window ?? null,
                  max_passos: base.max_steps,
                  ia: "definida pela plataforma",
                },
              }
            : {}),
        });
      }

      return {
        como_o_sistema_escolhe_quem_atende:
          "Uma organização pode ter vários agentes. Responde a mensagem o agente cuja versão publicada aponta para o número em que ela chegou; " +
          "com mais de um no mesmo número, o de maior prioridade (no empate, o mais antigo), a não ser que exista um roteador LIGADO naquele número, que escolhe pela intenção " +
          "(plataforma_garantir_roteador e plataforma_ligar_roteador; veja `roteadores` abaixo).",
        agentes,
        // A camada da EMPRESA, que vale para todos os agentes (upstream 1.74, #2321).
        seguranca_da_empresa: {
          bloqueio_de_afirmacao_clinica: await lerCamadaClinica(c.admin, c.orgId),
        },
        // Os roteadores de intenção, com o agente e o destino de cada intenção
        // pelo nome. Leitura que falha não derruba a dos agentes: diz que não leu.
        ...(await retratoDosRoteadores(c.admin, c.orgId).then(
          (roteadores) => ({ roteadores }),
          (err: unknown) => ({ roteadores_nao_lidos: err instanceof Error ? err.message : "erro desconhecido" }),
        )),
        numeros_conectados: numeros.map((n) => ({ id: n.id, nome: n.display_name, telefone: n.phone_number, conectado: n.status === STATUS_SAUDAVEL })),
        ...(args.com_capacidades === true
          ? {
              capacidades_oferecidas: oferecidas.map((x) => ({
                id: x.id,
                rotulo: x.rotulo,
                risco: x.risco,
                pacotes: x.pacotes,
                ...(x.marcavel ? {} : { nao_se_liga: x.motivo_nao_marcavel }),
              })),
            }
          : {}),
      };
    },
  },

  {
    name: "plataforma_ver_catalogo",
    description:
      "Os produtos e serviços do catálogo de um cliente: código, nome, descrição, marca, categoria, preço em centavos, moeda, estoque e se está ativo. " +
      "QUANDO USAR: para conferir o que plataforma_garantir_produtos gravou, ou para achar o código de um produto antes de atualizá-lo. " +
      "Devolve até 200 por chamada; use `busca` para filtrar por parte do nome, do código ou da marca, e `pular` para a página seguinte.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      busca: z.string().trim().min(1).max(120).optional().describe("Parte do nome, do código ou da marca."),
      pular: z.number().int().min(0).max(100_000).optional().describe("Quantos produtos pular (paginação). Padrão: 0."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, busca: "plano" },
    operacao: null,
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const pular = typeof args.pular === "number" ? args.pular : 0;
      // PAGINADO. O `.limit(5000)` que estava aqui devolvia no máximo 1000
      // produtos (o teto do PostgREST): num catálogo maior, `total` dizia 1000, a
      // busca só olhava os 1000 primeiros por nome e o resto não tinha página
      // que alcançasse. Agora lê até 10 mil (o mesmo teto da busca de produtos
      // do agente, `lib/mcp/tools/comercio.ts`) e, acima disso, DIZ que cortou.
      const lido = await lerTodasAsPaginas<Record<string, unknown>>(
        (de, ate, pedirContagem) =>
          c.admin
            .from("catalog_products")
            .select(COLUNAS_DO_PRODUTO, pedirContagem ? { count: "exact" } : undefined)
            .eq("organization_id", c.orgId)
            .order("nome")
            // `id` desempata nomes iguais: paginar por `range` só é correto
            // sobre uma ordem única.
            .order("id")
            .range(de, ate),
        { paginasMaximas: PAGINAS_DO_CATALOGO },
      );
      if (lido.erro) throw new Error(`não consegui ler o catálogo: ${lido.erro}`);
      // O filtro é em memória de propósito: é a busca de quem confere o que
      // gravou, e o catálogo de um cliente tem centenas de itens, não milhões.
      const termo = typeof args.busca === "string" ? args.busca.toLowerCase() : "";
      const todos = lido.linhas.filter(
        (p) =>
          termo === "" ||
          [p.nome, p.codigo, p.marca].some((v) => typeof v === "string" && v.toLowerCase().includes(termo)),
      );
      const pagina = todos.slice(pular, pular + 200);
      return {
        total: todos.length,
        devolvidos: pagina.length,
        ...(pular + pagina.length < todos.length ? { proxima_pagina: { pular: pular + pagina.length } } : {}),
        // O catálogo passou do teto de leitura: `total` e a busca cobrem só os
        // primeiros por nome, e quem lê precisa saber que há mais.
        ...(lido.truncado
          ? {
              catalogo_cortado: true,
              aviso:
                `O catálogo tem mais produtos do que esta leitura alcança (${lido.total ?? "mais de " + lido.linhas.length} no banco, ` +
                `${lido.linhas.length} lidos, em ordem de nome). A busca e o total acima cobrem só os lidos.`,
            }
          : {}),
        produtos: pagina.map((p) => ({
          codigo: p.codigo,
          nome: p.nome,
          descricao: p.descricao ?? null,
          marca: p.marca ?? null,
          categoria: p.categoria ?? null,
          preco_cents: Number(p.preco_cents),
          moeda: p.moeda,
          custo_cents: p.custo_cents === null ? null : Number(p.custo_cents),
          controla_estoque: p.controla_estoque,
          quantidade: p.quantidade,
          ativo: p.ativo,
          origem: p.origem,
        })),
      };
    },
  },

  {
    name: "plataforma_ver_configuracao",
    description:
      "O conteúdo do que já está configurado num cliente, por seção: `etiquetas` (o vocabulário com as cores), `memoria` (as regras da casa e as anotações), " +
      "`conhecimento` (os materiais e a situação da indexação), `followups` (os fluxos e se estão publicados), `automacoes` (as regras, com gatilho e ações), " +
      "`agenda` (os tipos de agendamento e a jornada de cada pessoa), `equipe` (membros com id e e-mail, e convites), `canais` (os números com id e situação), " +
      "`atendimento` (a distribuição e o freio do passo \"a IA decide\"), `mensagens` (respostas prontas e modelos oficiais), " +
      "`planos_de_tarefa` (as sequências de tarefa com os passos), `fontes_de_formulario` (destino, perguntas, endereço de captação e a autorização de IA, sem o segredo) " +
      "e `banco_externo` (as conexões, só com o nome e a coluna do cliente; nunca endereço, usuário ou senha). " +
      "Em `canais`, cada número traz também os dias da prospecção, se guarda o histórico, se está pausado e as pausas agendadas. " +
      "QUANDO USAR: para ler antes de alterar, e para achar ids (de pessoa, de número, de fluxo) que outras ferramentas pedem. " +
      "Peça só as seções de que precisa: a resposta inteira é grande.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      secoes: z
        .array(z.enum(SECOES_DE_CONFIGURACAO))
        .min(1)
        .max(SECOES_DE_CONFIGURACAO.length)
        .describe(`Quais seções devolver: ${SECOES_DE_CONFIGURACAO.join(", ")}.`),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, secoes: ["equipe", "canais"] },
    operacao: null,
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      const pedidas = new Set(args.secoes as string[]);
      const r: Record<string, unknown> = {};

      if (pedidas.has("etiquetas")) {
        const lista = Array.isArray(org.settings.tags) ? (org.settings.tags as unknown[]) : [];
        r.etiquetas = lista.map((e) =>
          typeof e === "string"
            ? { nome: e, cor: null, descricao: null }
            : {
                nome: (e as { tag?: string }).tag ?? "",
                cor: (e as { cor?: string }).cor ?? null,
                descricao: (e as { descricao?: string }).descricao ?? null,
              },
        );
      }

      if (pedidas.has("memoria")) {
        const documento = await lerDocumentoDaMemoria(c);
        const { data, error } = await c.admin
          .from("org_memory_entries")
          .select("id, title, body, source, created_at")
          .eq("organization_id", c.orgId)
          .eq("status", "active")
          .order("created_at", { ascending: true });
        if (error) throw new Error(`não consegui ler as anotações: ${error.message}`);
        r.memoria = {
          documento: documento ? { versao: documento.versao, conteudo: documento.conteudo } : null,
          anotacoes: ((data ?? []) as Array<{ title: string; body: string; source: string }>).map((a) => ({
            titulo: a.title,
            corpo: a.body,
            origem: a.source,
          })),
        };
      }

      if (pedidas.has("conhecimento")) {
        const { data, error } = await c.admin
          .from("ai_knowledge_sources")
          .select("id, name, source_type, is_active, last_index_status, last_index_error, chunks_count")
          .eq("organization_id", c.orgId)
          .eq("is_active", true)
          .order("name");
        if (error) throw new Error(`não consegui ler os materiais: ${error.message}`);
        r.conhecimento = ((data ?? []) as Array<Record<string, unknown>>).map((m) => ({
          id: m.id,
          nome: m.name,
          tipo: m.source_type,
          indexacao: m.last_index_status ?? "aguardando",
          erro_da_indexacao: m.last_index_error ?? null,
          trechos: m.chunks_count ?? 0,
        }));
      }

      if (pedidas.has("followups")) {
        r.followups = (await lerFluxos(c.admin, c.orgId)).map((f) => ({
          id: f.id,
          nome: f.name,
          situacao: f.status === "active" ? "publicado" : f.status === "disabled" ? "desligado" : "rascunho",
          gatilho: f.trigger_config ?? { kind: "manual" },
          quando_humano_assume: f.handoff_policy,
        }));
      }

      if (pedidas.has("automacoes")) {
        r.automacoes = (await lerRegras(c.admin, c.orgId)).map((x) => ({
          id: x.id,
          nome: x.name,
          ligada: x.is_active,
          gatilho: x.trigger_event,
          condicoes: x.conditions,
          // O segredo cifrado do webhook não sai: é credencial.
          acoes: Array.isArray(x.actions)
            ? x.actions.map((a) => {
                const acao = a as { type?: string; config?: Record<string, unknown> };
                const { secret_enc: _fora, ...config } = acao.config ?? {};
                return { type: acao.type, config, ...(_fora !== undefined ? { tem_segredo: true } : {}) };
              })
            : [],
          configuracao_do_gatilho: x.trigger_config ?? {},
        }));
      }

      if (pedidas.has("agenda")) {
        const membros = await lerMembros(c.admin, c.orgId);
        const { data: jornadas, error } = await c.admin
          .from("attendant_availability")
          .select("user_id, is_available, capacity, schedule")
          .eq("organization_id", c.orgId);
        if (error) throw new Error(`não consegui ler as jornadas: ${error.message}`);
        r.agenda = {
          tipos: (await lerTipos(c.admin, c.orgId)).map((t) => ({
            id: t.id,
            nome: t.name,
            slug: t.slug,
            categoria: t.category,
            duracao_minutos: t.duration_minutes,
            local: t.location_kind,
            ativo: t.is_active !== false,
            exige_confirmacao: t.requires_confirmation === true,
            lembrete_ligado: t.reminder_enabled === true,
            lembrete_minutos_antes: t.reminder_minutes_before ?? null,
            // .81: o número que manda o lembrete (upstream v1.83). null = automático.
            canal_do_lembrete_id: (t.reminder_channel_session_id as string | null | undefined) ?? null,
            preco_padrao_cents: t.default_price_cents === null || t.default_price_cents === undefined ? null : Number(t.default_price_cents),
          })),
          jornadas: ((jornadas ?? []) as Array<{ user_id: string; is_available: boolean; capacity: number; schedule: { timezone?: string; windows?: Array<{ dow: number; start: string; end: string }> } | null }>).map((j) => ({
            pessoa: membros.find((m) => m.user_id === j.user_id)?.email ?? j.user_id,
            disponivel: j.is_available,
            capacidade: j.capacity,
            fuso: j.schedule?.timezone ?? null,
            janelas: (j.schedule?.windows ?? []).map((w) => ({ dia: w.dow, inicio: w.start, fim: w.end })),
          })),
        };
      }

      if (pedidas.has("equipe")) {
        r.equipe = {
          membros: (await lerMembros(c.admin, c.orgId)).map((m) => ({
            user_id: m.user_id,
            email: m.email,
            nome: m.nome,
            papel: m.papel,
            ativo: m.ativo,
          })),
          convites: await lerConvites(c.admin, c.orgId),
        };
      }

      if (pedidas.has("canais")) {
        const canais = await lerCanais(c.admin, c.orgId);
        const ajustes = await lerAjustesDosCanais(c.admin, c.orgId);
        const pausas = await lerPausasAgendadas(c.admin, c.orgId, canais);
        r.canais = canais.map((s) => ({
          id: s.id,
          nome: nomeDoCanal(s),
          telefone: s.phone_number,
          conectado: s.status === STATUS_SAUDAVEL,
          situacao: s.status,
          // Pausado pela pessoa (ou por uma janela agendada): nada entra no inbox nem sai.
          pausado: (s.metadata as { disabled?: unknown } | null)?.disabled === true,
          // Os ajustes do upstream 1.74 a 1.80 (plataforma_configurar_canal).
          dias_da_prospeccao: diasDaProspeccaoDe(ajustes.get(s.id)),
          guardar_historico: conexaoGuardaHistorico(s.provider) ? lerGuardarHistorico(s.metadata) : null,
          pausas_agendadas: pausas.filter((a) => a.todos_os_numeros || a.numero_id === s.id).map((a) => ({ id: a.id, inicio: a.inicio, fim: a.fim, situacao: a.situacao, todos_os_numeros: a.todos_os_numeros })),
        }));
      }

      if (pedidas.has("planos_de_tarefa")) {
        const membros = await lerMembros(c.admin, c.orgId);
        r.planos_de_tarefa = retratoDosPlanos(org.settings, membros);
      }

      if (pedidas.has("fontes_de_formulario")) {
        const fontes = await lerFontes(c);
        const { data: funis, error: funisErr } = await c.admin.from("crm_pipelines").select("id, name").eq("organization_id", c.orgId);
        if (funisErr) throw new Error(`não consegui ler os funis: ${funisErr.message}`);
        const { data: etapas, error: etapasErr } = await c.admin.from("crm_stages").select("id, name, pipeline_id").eq("organization_id", c.orgId);
        if (etapasErr) throw new Error(`não consegui ler as etapas: ${etapasErr.message}`);
        const funisComEtapas = ((funis ?? []) as Array<{ id: string; name: string }>).map((f) => ({
          ...f,
          etapas: ((etapas ?? []) as Array<{ id: string; name: string; pipeline_id: string }>).filter((e) => e.pipeline_id === f.id),
        }));
        // Sem o segredo: só o fato de haver um (`tem_assinatura`).
        r.fontes_de_formulario = fontes.map((f) =>
          retratoDaFonte(f, funisComEtapas, { pipeline_id: f.default_pipeline_id, stage_id: f.default_stage_id }),
        );
      }

      if (pedidas.has("banco_externo")) {
        const conexoes = await lerConexoesDeBancoExterno(c);
        r.banco_externo =
          conexoes === null
            ? { modulo_ligado: false, conexoes: [] }
            : { modulo_ligado: true, conexoes: conexoes.map(retratoDaConexao) };
      }

      if (pedidas.has("atendimento")) {
        const routing = routingConfigSchema.catch(routingConfigSchema.parse({})).parse(org.settings.routing ?? {});
        // A mesma leitura que o envio faz (upstream 1.70, #2079).
        const assinatura = configAssinatura(org.settings);
        r.atendimento = {
          modo: routing.mode,
          visibilidade: (org.settings.visibility_mode as string | undefined) ?? DEFAULT_VISIBILITY_MODE,
          devolver_para_a_ia_apos_minutos: routing.handoff_return_after_minutes,
          conversa_fica_com_quem_atendeu: routing.conversation_stays_with_attendant,
          // null = o padrão de 60 minutos (upstream 1.70, #2005).
          ia_espera_apos_resposta_pelo_celular_minutos: routing.manual_reply_silence_minutes,
          assinatura: { atendentes: assinatura.humanos, ia: assinatura.ia, nome_da_ia: assinatura.nomeIa },
          // O freio do passo "a IA decide" das automações (upstream 1.76, #2367).
          ia_decide_nas_automacoes: iaDecideLigadaNa(org.settings),
          // .81: as duas opções da agenda do upstream (1.80 #978, 1.81 #2063).
          colegas_podem_mexer_na_agenda: colegasPodemMexerNaAgendaLigado(org.settings),
          google_meet_com_acesso_aberto: meetAbertoLigado(org.settings),
        };
      }

      if (pedidas.has("mensagens")) {
        r.mensagens = {
          respostas_prontas: (await lerRespostasProntas(c.admin, c.orgId)).map((x) => ({
            titulo: x.title,
            texto: x.body,
            atalho: x.shortcut,
            // .81: quantas imagens vão junto (o caminho no bucket privado não sai).
            imagens: (x.midias ?? []).length,
          })),
          modelos_oficiais: (await lerModelosOficiais(c.admin, c.orgId)).map((m) => ({
            nome: m.name,
            idioma: m.language,
            situacao: m.status,
            categoria: m.category,
            motivo_da_reprovacao: m.rejected_reason,
          })),
        };
      }

      return r;
    },
  },

  {
    name: "plataforma_ver_followup",
    description:
      "Um fluxo de follow-up por dentro: o gatilho, cada nó do rascunho (id, tipo, rótulo), com o TEXTO das mensagens, os minutos das esperas, " +
      "a etapa de destino das caixas de mover e as etiquetas das caixas de etiquetar, e as setas entre os nós. " +
      "QUANDO USAR: antes de ajustar um fluxo com plataforma_garantir_followup (`textos`, `esperas`, `mover_no_funil` e `etiquetar` pedem o id do nó).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      fluxo: z.string().trim().min(1).max(120).describe("Nome ou id do fluxo."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, fluxo: "Retomada · voltar a quem parou de responder" },
    operacao: null,
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const fluxo = acharPorNomeOuId(await lerFluxos(c.admin, c.orgId), String(args.fluxo), (f) => f.name, {
        singular: "o fluxo de follow-up",
        comoListar: "Veja os fluxos em plataforma_ver_configuracao, seção followups.",
      });
      const rascunho = await rascunhoDoFluxo(c.admin, fluxo, c.orgId);
      // O destino de uma caixa de mover é guardado como id: o nome vem do banco,
      // pela mesma leitura que a publicação usa. Se ela falhar, o id basta.
      const citadas = rascunho ? await carregaEtapasCitadas(c.admin, c.orgId, rascunho.nodes) : null;
      const nomeDaEtapa = citadas?.ok ? (id: string) => citadas.etapas.get(id)?.nome ?? null : undefined;
      return {
        id: fluxo.id,
        nome: fluxo.name,
        situacao: fluxo.status === "active" ? "publicado" : fluxo.status === "disabled" ? "desligado" : "rascunho",
        gatilho: fluxo.trigger_config ?? { kind: "manual" },
        quando_humano_assume: fluxo.handoff_policy,
        nos: nosDoGrafo(rascunho, nomeDaEtapa),
        // Por onde o fluxo anda: é o que diz ANTES de qual nó uma caixa cabe.
        setas: (rascunho?.edges ?? []).map((e) => ({
          de: e.source,
          para: e.target,
          quando: e.condition.type === "always" ? "sempre" : e.condition.type === "branch" ? `ramo ${e.condition.branch_id}` : JSON.stringify(e.condition),
        })),
      };
    },
  },
];

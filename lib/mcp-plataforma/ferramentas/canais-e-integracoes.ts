/**
 * As ferramentas dos AJUSTES DE CONEXÃO e das INTEGRAÇÕES que chegaram do
 * upstream 1.74 a 1.80: os dias da prospecção, guardar o histórico e a pausa
 * agendada de um número; a fonte de formulário (perguntas e autorização de IA
 * na captação); e o cliente nas conversas de uma conexão de banco externo.
 *
 * As três são montagem (`implantar_configuracao`): nenhuma faz o sistema mandar
 * mensagem a ninguém. E nenhuma recebe ou devolve credencial: o token e o
 * número da conexão, o segredo da fonte e a senha do banco externo ficam com a
 * pessoa, na tela. As operações moram em `lib/implantacao/canal.ts`,
 * `lib/implantacao/fonte-de-formulario.ts` e `lib/implantacao/banco-externo.ts`.
 */
import { z } from "zod";

import { configurarBancoExterno, type PedidoDeBancoExterno } from "@/lib/implantacao/banco-externo";
import { configurarCanal, type PedidoDeCanal } from "@/lib/implantacao/canal";
import { garantirFonteDeFormulario, TETO_DE_PERGUNTAS, type PedidoDeFonte } from "@/lib/implantacao/fonte-de-formulario";
import { configurarServidorMcpExterno, type PedidoDoServidorExterno } from "@/lib/implantacao/servidor-mcp-externo";
import { recusar } from "@/lib/mcp-plataforma/recusa";
import { hostDoEndpoint } from "@/lib/mcp/servidor-externo/registro";
import { fonteSchema, MAX_FONTES, MODOS_DE_FONTES } from "@/lib/external-db/fontes";
import { TIPOS_DE_IDENTIFICADOR } from "@/lib/external-db/schemas";

import type { FerramentaDePlataforma } from "../tipos";
import { alvo, DIA_DA_SEMANA, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

const TIPOS_DE_PERGUNTA = ["text", "textarea", "number", "currency", "select", "checkbox"] as const;

export const FERRAMENTAS_DE_CANAIS_E_INTEGRACOES: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_configurar_canal",
    description:
      "Ajusta uma CONEXÃO (número de WhatsApp) de um cliente: " +
      "`nome_interno` (o nome que só a equipe vê; o público no provedor não muda), " +
      "`dias_da_prospeccao` (em que dias da semana a prospecção pode fazer a PRIMEIRA abordagem, dentro da janela de disparo do número; resposta e disparo em massa não mudam), " +
      "`guardar_historico` (só para número conectado por QR Code: o canal passa a guardar o histórico do número; nasce desligado) e " +
      "`pausa_agendada` (uma janela de manutenção de até 24 horas em que o número, ou todos os números da empresa, fica pausado e volta sozinho no fim; a mensagem que chega é guardada e volta à fila na retomada), " +
      "com `ajustar_pausa_agendada` para corrigir os horários de uma que ainda não começou e `cancelar_pausa_agendada` para desmarcar. " +
      "Só o que VEIO muda; o que veio igual responde `ja_estava`, e a pausa igual a uma já marcada não é marcada de novo. " +
      "A hora da pausa pode vir sem fuso (\"2026-10-20T23:00\", na hora da empresa) ou com ele. " +
      "ATENÇÃO: desligar `guardar_historico` num número que já guarda pode apagar o que o canal guardou, e por isso pede `confirmo_apagar_historico_guardado: true`. " +
      "Ligar num número já pareado guarda daqui em diante e reinicia a conexão por alguns segundos. " +
      "O QUE NÃO FAZ: não conecta, não reconecta nem desconecta número, não recebe nem devolve token, credencial ou número de telefone, não pausa AGORA (a pausa manual é com a pessoa, em Conexões) " +
      "e não mexe no ritmo de envio (intervalos, janelas, teto diário), que fica na tela Conexões › Proteção de envio.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      canal: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe("A conexão: id, nome ou telefone (de plataforma_ver_configuracao, seção canais). Obrigatório, menos para a pausa de todos os números."),
      dias_da_prospeccao: z
        .array(DIA_DA_SEMANA)
        .min(1)
        .max(7)
        .optional()
        .describe("Os dias em que a prospecção pode abordar: 0 (domingo) a 6 (sábado). Ex.: [1, 2, 3, 4, 5]. Sem escolha, valem todos os dias."),
      guardar_historico: z
        .boolean()
        .optional()
        .describe(
          "Guardar o histórico do número no canal (só conexão por QR Code). O histórico anterior (cerca de 1 ano) só vem se estiver ligado NA vinculação; " +
            "ele fica no servidor do canal, fora da anonimização do CRM, e não aparece no inbox.",
        ),
      confirmo_apagar_historico_guardado: z
        .boolean()
        .optional()
        .describe("Confirmação escrita para DESLIGAR `guardar_historico` num número que já guarda: desligar pode apagar o que o canal guardou."),
      pausa_agendada: z
        .object({
          inicio: z.string().trim().min(10).max(40).describe('Quando a pausa começa: "AAAA-MM-DDTHH:MM" na hora da empresa, ou com o fuso. Tem de ser no futuro.'),
          fim: z.string().trim().min(10).max(40).describe("Quando a pausa termina e o número volta sozinho. No máximo 24 horas depois do início."),
          todos_os_numeros: z.boolean().optional().describe("true pausa TODOS os números da empresa na janela (e aí `canal` não é preciso)."),
        })
        .strict()
        .optional()
        .describe("Uma janela de manutenção: o sistema pausa no início e retoma no fim. Nada sai pelo número pausado, nem resposta da IA, nem follow-up, nem automação."),
      cancelar_pausa_agendada: z
        .string()
        .uuid()
        .optional()
        .describe("O id de uma pausa agendada (de plataforma_ver_configuracao, seção canais) para cancelar. O que ela já pausou continua pausado."),
      // .81 — upstream 1.81: corrigir a hora de uma pausa que ainda não começou, e o nome interno.
      ajustar_pausa_agendada: z
        .object({
          id: z.string().uuid().describe("O id da pausa agendada (plataforma_ver_configuracao, seção canais)."),
          inicio: z.string().trim().min(10).max(40).describe('O novo início, "AAAA-MM-DDTHH:MM" na hora da empresa ou com o fuso. No futuro.'),
          fim: z.string().trim().min(10).max(40).describe("O novo fim. No máximo 24 horas depois do início."),
        })
        .strict()
        .optional()
        .describe("Corrige os dois horários de uma pausa agendada que AINDA NÃO começou (em andamento ou encerrada não se ajusta)."),
      nome_interno: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe('O nome da conexão que só a equipe vê (ex.: "WA | Recepção"). O nome público no provedor não muda.'),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      canal: "Recepção",
      dias_da_prospeccao: [1, 2, 3, 4, 5],
      pausa_agendada: { inicio: "2026-11-20T23:00", fim: "2026-11-21T02:00" },
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { organization_id: _org, ...pedido } = args;
      const { c, org } = await alvo(ctx, args);
      const p = pedido as PedidoDeCanal;
      if (
        p.dias_da_prospeccao === undefined &&
        p.guardar_historico === undefined &&
        p.pausa_agendada === undefined &&
        p.cancelar_pausa_agendada === undefined &&
        p.ajustar_pausa_agendada === undefined &&
        p.nome_interno === undefined
      ) {
        recusar(
          "Informe ao menos um ajuste: `dias_da_prospeccao`, `guardar_historico`, `pausa_agendada`, `ajustar_pausa_agendada`, `cancelar_pausa_agendada` ou `nome_interno`. " +
            'Ex.: { "canal": "Recepção", "dias_da_prospeccao": [1, 2, 3, 4, 5] }',
        );
      }
      return configurarCanal(c, org.timezone, p);
    },
  },

  {
    name: "plataforma_garantir_fonte_de_formulario",
    description:
      "Cria ou ajusta uma FONTE DE FORMULÁRIO de um cliente: a entrada por onde o formulário do site (ou outro sistema) põe contato e negócio no CRM, num funil e numa etapa, sem ninguém digitar. " +
      "Ajusta também as PERGUNTAS do formulário (até 20: chave, texto, tipo e se é obrigatória; as respostas viram campos do negócio e a tela gera o HTML do formulário a partir delas), " +
      "o mapeamento dos nomes de campo que o sistema de fora manda, o endereço para onde a pessoa vai depois de enviar, e a AUTORIZAÇÃO DE IA NA CAPTAÇÃO " +
      "(o contato novo que chega com o envio completo e com o consentimento explícito para atendimento automatizado fica autorizado para a IA) " +
      "e a ATUALIZAÇÃO DO CARD NO REENVIO (o envio que repete o `external_id` de um card que esta fonte criou atualiza o card, em vez de ser descartado como reenvio). " +
      "GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é o NOME da fonte. Só o que VEIO muda; `perguntas` é a lista completa. " +
      "A resposta traz o caminho do endereço de captação (e o endereço inteiro quando a instalação o conhece), que uma pessoa põe no formulário do site. " +
      "ATENÇÃO: a fonte nasce LIGADA, como na tela (todo envio para o endereço vira contato); a autorização de IA e a atualização do card no reenvio só ligam com a ASSINATURA da fonte, que é credencial e é posta por uma pessoa na tela. " +
      "O QUE NÃO FAZ: não recebe nem devolve o segredo da assinatura, não liga nem desliga a fonte, não apaga fonte e não cria a regra de automação do formulário " +
      "(para isso, plataforma_garantir_automacao com o gatilho lead.created e `configuracao_do_gatilho.webhook_source_id`).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      nome: z.string().trim().min(1).max(120).describe('O nome da fonte (ex.: "Formulário do site"). É a chave: chamar de novo com o mesmo nome ajusta a mesma fonte.'),
      fonte_id: z.string().uuid().optional().describe("O id de uma fonte que já existe. Só é preciso para RENOMEAR."),
      destino: z
        .object({
          funil: z.string().trim().min(1).max(120).describe("Nome (ou id) do funil que recebe os contatos."),
          etapa: z.string().trim().min(1).max(120).describe("Nome (ou id) da etapa em que o negócio entra."),
        })
        .strict()
        .optional()
        .describe("Onde o contato do formulário entra. Obrigatório para criar."),
      perguntas: z
        .array(
          z
            .object({
              chave: z.string().trim().min(1).max(40).describe('A chave do campo (ex.: "servico"): letra minúscula no começo, só letras minúsculas, números e _. Vira o campo do negócio e a marcação {{servico}} das mensagens.'),
              pergunta: z.string().trim().min(1).max(120).describe("O texto da pergunta, como a pessoa lê no formulário."),
              tipo: z.enum(TIPOS_DE_PERGUNTA).describe('"text", "textarea", "number", "currency" (valor em reais), "select" (lista, com `opcoes`) ou "checkbox".'),
              obrigatoria: z.boolean().optional().describe("A pessoa tem de responder para enviar. Padrão: não."),
              opcoes: z.array(z.string().trim().min(1).max(100)).max(30).optional().describe('As opções da lista (só no tipo "select").'),
            })
            .strict(),
        )
        .max(TETO_DE_PERGUNTAS)
        .optional()
        .describe(`As perguntas extras do formulário, além de nome, telefone e e-mail (que todo formulário tem). Lista completa, na ordem, até ${TETO_DE_PERGUNTAS}.`),
      mapeamento: z
        .object({
          nome: z.array(z.string().trim().min(1).max(80)).max(10).optional().describe('Os nomes de campo que trazem o nome (ex.: ["full_name"]).'),
          telefone: z.array(z.string().trim().min(1).max(80)).max(10).optional().describe("Os nomes de campo que trazem o telefone."),
          email: z.array(z.string().trim().min(1).max(80)).max(10).optional().describe("Os nomes de campo que trazem o e-mail."),
        })
        .strict()
        .optional()
        .describe("Só quando o sistema de fora manda nome, telefone e e-mail com outros nomes de campo. Substitui o mapeamento que existe."),
      endereco_de_retorno: z
        .string()
        .url()
        .max(2000)
        .nullable()
        .optional()
        .describe("Para onde a pessoa vai depois de enviar o formulário (ex.: a página de obrigado do site). null tira."),
      autorizar_ia_na_captura: z
        .boolean()
        .optional()
        .describe(
          "Autoriza o atendimento por IA do contato novo que chega com o envio completo e o consentimento explícito para atendimento automatizado. " +
            "Exige a assinatura da fonte (posta por uma pessoa na tela); o integrador manda o aceite separado da política de privacidade e um `external_id` por envio. Nasce desligada.",
        ),
      // .82 — upstream 1.84 (0683, #2316).
      atualizar_card_no_reenvio: z
        .boolean()
        .optional()
        .describe(
          "Quando o sistema de fora manda de novo um envio com o mesmo `external_id` de um card que ESTA fonte criou: true ATUALIZA o card (os campos novos entram, o nome do card acompanha o nome enviado " +
            "e o campo reservado `stage` move o card para a etapa pedida); false (o padrão) descarta o envio como reenvio, sem tocar no card. " +
            "Não alcança card criado por outra fonte, card sem origem registrada nem card de contato anonimizado. Exige a assinatura da fonte; fonte nova não nasce com ela. " +
            "Ligada, a correção feita à mão num campo do card pode ser sobrescrita pelo próximo envio da integração.",
        ),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      nome: "Formulário do site",
      destino: { funil: "Agendamentos", etapa: "Novo contato" },
      perguntas: [
        { chave: "servico", pergunta: "Qual serviço você procura?", tipo: "select", obrigatoria: true, opcoes: ["Avaliação", "Limpeza"] },
        { chave: "melhor_horario", pergunta: "Qual o melhor horário para falar com você?", tipo: "text" },
      ],
      endereco_de_retorno: "https://exemplo.invalid/obrigado",
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return garantirFonteDeFormulario(c, pedido as unknown as PedidoDeFonte);
    },
  },

  {
    name: "plataforma_configurar_banco_externo",
    description:
      "Ajusta, numa conexão de BANCO EXTERNO de um cliente (o banco de dados de outro sistema dele, que o agente consulta), as FONTES LIBERADAS (`fontes_liberadas`: " +
      "quais tabelas e colunas o agente pode ler) e o CLIENTE NAS CONVERSAS (`cliente_nas_conversas`): " +
      "qual coluna das tabelas guarda o telefone ou o e-mail de quem está conversando. Com ela escolhida, durante a conversa de atendimento o agente lê SÓ as linhas daquela pessoa. " +
      "Sem ela, o agente lê as tabelas sem esse recorte. Chamar de novo com o mesmo pedido responde `ja_estava`. " +
      "ATENÇÃO: o banco externo é módulo da INSTALAÇÃO; com ele desligado, a recusa diz isso. A conexão tem de existir: veja em plataforma_ver_configuracao, seção banco_externo. " +
      "O QUE NÃO FAZ: não cria, não testa e não apaga conexão, não lê nem devolve endereço, usuário, senha ou o texto de conexão do banco (é credencial do cliente, posta por uma pessoa na tela Dados externos), " +
      "e não confere no banco do cliente se a coluna existe.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      conexao: z.string().trim().min(1).max(120).describe("O nome (ou id) de uma conexão de banco externo que JÁ existe."),
      cliente_nas_conversas: z
        .object({
          coluna: z.string().trim().min(1).max(128).describe('O nome da coluna, nas tabelas do banco do cliente, que guarda o telefone ou o e-mail do cliente (ex.: "telefone_cliente").'),
          tipo: z.enum(TIPOS_DE_IDENTIFICADOR).describe('"phone" se a coluna guarda o telefone, "email" se guarda o e-mail.'),
        })
        .strict()
        .nullable()
        .optional()
        .describe("A coluna e o tipo, sempre juntos. null tira o recorte. Ausente: fica como está."),
      // .81 — as fontes liberadas do upstream (0618).
      fontes_liberadas: z
        .object({
          modo: z.enum(MODOS_DE_FONTES).describe('"list": o agente lê só as tabelas da lista. "all": qualquer tabela que o usuário do banco enxerga.'),
          fontes: z
            .array(fonteSchema)
            .max(MAX_FONTES)
            .optional()
            .describe(
              'A lista INTEIRA (substitui a gravada): [{ "schema": "public", "tabela": "pedidos", "colunas": ["numero", "status"], "descricao": "Pedidos do cliente" }]. ' +
                "`colunas: null` libera todas as colunas da tabela. Só NOMES de tabela e coluna: nada de credencial.",
            ),
        })
        .strict()
        .optional()
        .describe(
          "O que o agente, o MCP externo e a grade podem LER do banco do cliente. Conexão criada depois da 0618 nasce em \"list\" vazia: nada é lido até alguém liberar.",
        ),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      conexao: "ERP da clínica",
      cliente_nas_conversas: { coluna: "telefone_paciente", tipo: "phone" },
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      if (pedido.cliente_nas_conversas === undefined && pedido.fontes_liberadas === undefined) {
        recusar(
          "Informe ao menos um ajuste: `cliente_nas_conversas` ou `fontes_liberadas`. " +
            'Ex.: { "conexao": "ERP da clínica", "fontes_liberadas": { "modo": "list", "fontes": [{ "schema": "public", "tabela": "pedidos", "colunas": null, "descricao": "" }] } }',
        );
      }
      return configurarBancoExterno(c, pedido as unknown as PedidoDeBancoExterno);
    },
  },

  // .81 — upstream v1.83 (#2147, #2948): o servidor MCP externo da empresa.
  {
    name: "plataforma_configurar_servidor_mcp_externo",
    description:
      "Cadastra (ou tira) o SERVIDOR MCP EXTERNO de um cliente: o endereço e a chave do sistema de fora dele (o ERP, a plataforma de pedidos) que a IA da empresa pode consultar. " +
      "É o mesmo cadastro da tela Configurações › Servidor MCP externo, que só o dono da instalação faz. " +
      "A chave é gravada CIFRADA e nunca volta: a resposta traz só os quatro últimos caracteres. O endereço precisa ser https público (rede interna, localhost e segredo colado no endereço são recusados). " +
      "Cadastrar NÃO liga nada no agente: a IA só usa as ferramentas do servidor que forem escolhidas em plataforma_garantir_agente (`servidor_mcp_externo`). " +
      "Chamar de novo com o mesmo endereço e a mesma chave responde `ja_estava`; `apagar: true` tira o servidor. " +
      "ATENÇÃO: a empresa de demonstração é recusada (nada sai dela, e o servidor externo é rede para o sistema de outra empresa). " +
      "O QUE NÃO FAZ: não fala com o servidor (a lista do que ele oferece é lida pela tela ou pelo editor do agente), não escolhe ferramenta no agente e não devolve a chave.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      endereco: z.string().trim().min(8).max(500).optional().describe("O endereço https do servidor MCP do sistema do cliente. Vai junto com `chave`."),
      chave: z.string().trim().min(1).max(500).optional().describe("A chave de acesso que o sistema do cliente deu. Entra cifrada; nunca volta."),
      apagar: z.boolean().optional().describe("true tira o endereço e a chave: a IA deixa de alcançar o servidor."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, endereco: "https://erp.example.com/mcp", chave: "chave-de-exemplo-1234" },
    operacao: "implantar_configuracao",
    // A chave NUNCA vai para a trilha, e o endereço vai só como host (pode trazer
    // caminho de terceiro): a mesma forma da auditoria da tela.
    redigirParaAuditoria: (args) => ({
      organization_id: args.organization_id,
      endereco: typeof args.endereco === "string" ? hostDoEndpoint(args.endereco) : null,
      chave: typeof args.chave === "string" && args.chave ? "[redigida]" : null,
      apagar: args.apagar === true,
    }),
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return configurarServidorMcpExterno(c, org, pedido as PedidoDoServidorExterno);
    },
  },
];

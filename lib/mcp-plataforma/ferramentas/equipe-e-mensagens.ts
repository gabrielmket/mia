/**
 * As ferramentas de EQUIPE e de MENSAGENS PRONTAS. As operações moram em
 * `lib/implantacao/equipe.ts` e `lib/implantacao/mensagens.ts`.
 */
import { z } from "zod";

import { convidarPessoas, TETO_DE_CONVITES } from "@/lib/implantacao/equipe";
import {
  garantirRespostasProntas,
  submeterModeloOficial,
  TETO_DE_RESPOSTAS,
  type ModeloPedido,
  type RespostaPedida,
} from "@/lib/implantacao/mensagens";
import { ROLES } from "@/lib/schemas/team";

import type { FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

export const FERRAMENTAS_DE_EQUIPE_E_MENSAGENS: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_convidar_pessoas",
    description:
      "CONVIDA pessoas para a equipe de um cliente, cada uma com um papel. ATENÇÃO: esta ferramenta MANDA UM E-MAIL de convite para cada endereço, " +
      "e quem aceita passa a ler as conversas e os dados dos clientes daquela empresa. Confirme os e-mails e os papéis com o humano antes de chamar. " +
      "Papéis: viewer (só vê), agent (atende), manager (gerencia: funil, agenda, automações), admin (administra a empresa). " +
      `Até ${TETO_DE_CONVITES} pessoas por chamada. ` +
      "REPETIR NÃO REENVIA: quem já é da equipe é pulado (`ja_e_membro`), e quem já tem convite pendente com o mesmo papel não recebe outro e-mail (`ja_convidado`), " +
      "a não ser com `reenviar: true`. " +
      "A pessoa só entra na equipe quando ACEITA o convite, pelo link do e-mail: até lá ela não aparece como membro, e não dá para definir a jornada dela. " +
      "Se o e-mail não sair (instalação sem envio de e-mail), o convite existe mesmo assim e a resposta avisa: o link fica copiável na tela Equipe (/app/team). " +
      "ATENÇÃO: plataforma_criar_cliente NÃO convida o dono informado em `owner_email`. Convide-o aqui, com o papel admin. " +
      "Se o banco não gravar o convite de alguém, essa pessoa volta com `nao_gravou`, nenhum e-mail sai para ela e as outras do pedido seguem. " +
      "FUNCIONA NA EMPRESA DE DEMONSTRAÇÃO, como em qualquer empresa: é o jeito de dar acesso à demonstração a quem ainda não tem login, " +
      "e a resposta avisa que quem aceitar vai ver dados fictícios. O convite é a única coisa que sai de uma demonstração. " +
      "O QUE NÃO FAZ: não cria usuário nem senha, não muda o papel de quem já é membro e não revoga convite (isso é pela tela Equipe).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      pessoas: z
        .array(
          z
            .object({
              email: z.string().email().describe("O e-mail de quem vai receber o convite."),
              papel: z.enum(ROLES).describe("O papel na equipe: viewer, agent, manager ou admin."),
            })
            .strict(),
        )
        .min(1)
        .max(TETO_DE_CONVITES),
      reenviar: z.boolean().optional().describe("true manda o e-mail de novo para quem já tem convite pendente. Padrão: falso."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      pessoas: [
        { email: "dona@exemplo.invalid", papel: "admin" },
        { email: "recepcao@exemplo.invalid", papel: "agent" },
      ],
    },
    operacao: "convidar_equipe",
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      return convidarPessoas(c, org, {
        pessoas: args.pessoas as Array<{ email: string; papel: string }>,
        reenviar: args.reenviar === true,
      });
    },
  },

  {
    name: "plataforma_garantir_respostas_prontas",
    description:
      "Cria ou ajusta as RESPOSTAS PRONTAS de um cliente: textos que a equipe insere na conversa pelo atalho, sem digitar (boas-vindas, endereço, formas de pagamento). " +
      "São as compartilhadas da empresa, que todo atendente vê. Não saem para ninguém sozinhas: é o atendente que escolhe usar. " +
      `Até ${TETO_DE_RESPOSTAS} por chamada. GARANTIR quer dizer: pode ser chamada de novo sem duplicar. A chave é o TÍTULO. ` +
      "NÃO CONFUNDA com modelo oficial do WhatsApp, que é submetido à Meta: esse é plataforma_submeter_modelo_whatsapp.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      respostas: z
        .array(
          z
            .object({
              titulo: z.string().trim().min(1).max(80).describe("Como o atendente acha a resposta na lista."),
              texto: z.string().trim().min(1).max(4096).describe("O texto que entra na conversa."),
              atalho: z.string().trim().min(1).max(40).nullable().optional().describe('O atalho para inserir (ex.: "endereco").'),
            })
            .strict(),
        )
        .min(1)
        .max(TETO_DE_RESPOSTAS),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      respostas: [{ titulo: "Endereço", texto: "Ficamos na Rua das Flores, 100, Centro. Há estacionamento ao lado.", atalho: "endereco" }],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { c } = await alvo(ctx, args);
      const respostas = await garantirRespostasProntas(c, args.respostas as RespostaPedida[]);
      return {
        criadas: respostas.filter((r) => r.desfecho === "criou").length,
        atualizadas: respostas.filter((r) => r.desfecho === "atualizou").length,
        ja_estavam: respostas.filter((r) => r.desfecho === "ja_estava").length,
        respostas,
      };
    },
  },

  {
    name: "plataforma_submeter_modelo_whatsapp",
    description:
      "SUBMETE À META um MODELO OFICIAL de mensagem do WhatsApp de um cliente: o texto aprovado que o sistema usa para falar com alguém FORA da janela de 24 horas. " +
      "ATENÇÃO: é um ato que fala em nome da marca do cliente. Uma reprovação pesa na conta inteira dele: confirme o texto com o humano antes. " +
      "SÓ FUNCIONA se a empresa tem o NÚMERO OFICIAL dela conectado. Sem ele a ferramenta recusa e explica: conectar é com uma pessoa, em Conexões. " +
      "Empresa com número por QR Code não usa modelo oficial. " +
      "O modelo nasce PENDENTE: quem aprova é a Meta, e a situação muda sozinha. Chamar de novo com o mesmo nome e idioma NÃO reenvia: responde `ja_existia`, com a situação atual. " +
      "O nome usa só minúsculas, números e sublinhado. Cada variável do texto ({{1}}, {{2}}) precisa de um exemplo, na ordem. " +
      "O QUE NÃO FAZ: não cria modelo com cabeçalho de imagem, vídeo ou documento (a amostra vai por upload, na tela Configurações › Modelos), não edita nem apaga modelo.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      nome: z
        .string()
        .min(1)
        .max(512)
        .regex(/^[a-z0-9_]+$/, 'só letras minúsculas, números e sublinhado (ex.: "lembrete_de_consulta")')
        .describe("O nome técnico do modelo na Meta."),
      idioma: z.string().min(2).max(10).optional().describe('O idioma do modelo. Padrão: "pt_BR".'),
      categoria: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).describe("MARKETING (oferta, novidade), UTILITY (aviso de algo que a pessoa pediu) ou AUTHENTICATION (código)."),
      texto: z.string().min(1).max(1024).describe("O corpo da mensagem, com {{1}}, {{2}} nos lugares que mudam."),
      exemplos: z.array(z.string().max(200)).max(10).optional().describe("Um exemplo para cada variável, na ordem."),
      botoes: z.array(z.string().min(1).max(25)).max(3).optional().describe('Botões de resposta rápida (até 3). Um botão de sair ("Parar promoções") ajuda na aprovação.'),
      cabecalho: z.string().max(60).optional().describe("Texto curto no topo. Sem variável."),
      rodape: z.string().max(60).optional().describe("Texto curto no fim. Sem variável."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      nome: "lembrete_de_avaliacao",
      categoria: "UTILITY",
      texto: "Olá, {{1}}! Passando para lembrar da sua avaliação amanhã, às {{2}}.",
      exemplos: ["Maria", "14h30"],
    },
    operacao: "colocar_no_ar",
    handler: async (ctx, args) => {
      const { c, org } = await alvo(ctx, args);
      const { organization_id: _org, ...pedido } = args;
      return submeterModeloOficial(c, org, pedido as unknown as ModeloPedido);
    },
  },
];

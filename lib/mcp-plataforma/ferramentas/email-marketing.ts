/**
 * FORK MIA (.89) — as ferramentas do DISPARO DE E-MAIL MARKETING
 * (docs/fork/email-marketing.md). Regra da casa: toda função nova entra no MCP
 * na mesma versão. São nove:
 *
 *   plataforma_ver_email_marketing          leitura: o retrato da configuração
 *   plataforma_verificar_dominio_de_email   `implantar_configuracao`: cadastra o domínio
 *                                           na Amazon e confere os seis registros
 *   plataforma_configurar_email_marketing   `implantar_configuracao`: remetentes,
 *                                           "responder para", rodapé, ritmo e janela
 *   plataforma_garantir_segmentos           `implantar_configuracao`: os segmentos salvos
 *   plataforma_garantir_modelos_de_email    `implantar_configuracao`: os modelos do segmento
 *   plataforma_importar_consentimentos      `importar_consentimentos`: aceites com data e origem
 *   plataforma_importar_supressao           `implantar_configuracao`: descadastros da ferramenta anterior
 *   plataforma_criar_campanha_de_email      `criar_campanha_de_email`: RASCUNHO e TESTE
 *   plataforma_ver_campanhas_de_email       leitura: as campanhas e os resultados
 *
 * ⚠️ O MCP NUNCA DISPARA. Confirmar o envio é só pela tela, com a declaração da
 * base legal assinada por uma pessoa da empresa (`confirmarCampanha`, que este
 * arquivo não importa: `tests/unit/mcp-de-implantacao-email-marketing.test.ts`
 * confere isso no código-fonte). O teste daqui vai SÓ para e-mails da equipe do
 * cliente (ou de quem criou o token): um token vazado não manda e-mail com o
 * domínio do cliente para endereço de fora.
 *
 * Cada escrita reusa a função da tela (`lib/email-marketing/*`), com a mesma
 * validação. A empresa de demonstração não manda nada: o teste é recusado no
 * código e no banco (9064).
 */
import { z } from "zod";

import { lerMembros } from "@/lib/implantacao/equipe";
import { blocosSchema, fraseDaConferencia, reservasSchema } from "@/lib/email-marketing/blocos";
import {
  blocosDoModelo,
  conferirCampanha,
  criarRascunho,
  editarRascunho,
  enviarTeste,
  lerCampanha,
  listarCampanhas,
  andamentoDaCampanha,
  RecusaDaCampanha,
} from "@/lib/email-marketing/campanhas";
import {
  configuracaoSchema,
  garantirRemetente,
  gravarConfiguracao,
  remetenteSchema,
  verificarDominio,
} from "@/lib/email-marketing/configuracao";
import { importarAceites } from "@/lib/email-marketing/consentimentos";
import { recorteSchema } from "@/lib/email-marketing/recorte";
import { MAXIMO_DE_ENDERECOS_NO_TESTE, MODULO_EMAIL_MARKETING } from "@/lib/email-marketing/regras";
import { resultadosDaCampanha } from "@/lib/email-marketing/resultados";
import { retratoDaConfiguracao } from "@/lib/email-marketing/retrato";
import {
  garantirModelos,
  garantirSegmento,
  listarModelos,
  listarSegmentos,
  segmentoSchema,
  SEGMENTOS_DE_NEGOCIO,
  type SegmentoDeNegocio,
} from "@/lib/email-marketing/segmentos-e-modelos";
import { importarSupressao } from "@/lib/email-marketing/supressao";
import { Recusa } from "@/lib/mcp-plataforma/recusa";

import type { ContextoDaFerramenta, FerramentaDePlataforma } from "../tipos";
import { alvo, ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

export const OPERACAO_IMPORTAR_CONSENTIMENTOS = "importar_consentimentos";
export const OPERACAO_CRIAR_CAMPANHA_DE_EMAIL = "criar_campanha_de_email";

/** A recusa do domínio vira a recusa que ensina: o texto vai inteiro para o modelo. */
async function semRecusaCrua<T>(fazer: () => Promise<T>): Promise<T> {
  try {
    return await fazer();
  } catch (e) {
    if (e instanceof RecusaDaCampanha) throw new Recusa(e.message);
    throw e;
  }
}

/** Os e-mails para os quais o TESTE do MCP pode ir: a equipe do cliente e quem criou o token. */
async function enderecosDaEquipe(ctx: ContextoDaFerramenta, orgId: string): Promise<Set<string>> {
  const membros = await lerMembros(ctx.admin, orgId);
  const saida = new Set(
    membros.filter((m) => m.ativo && m.email).map((m) => m.email!.toLowerCase()),
  );
  try {
    const { data } = await ctx.admin.auth.admin.getUserById(ctx.autorUserId);
    const email = data?.user?.email?.trim().toLowerCase();
    if (email) saida.add(email);
  } catch {
    // Sem o e-mail de quem criou o token, vale só a equipe.
  }
  return saida;
}

const SEGMENTO_DE_NEGOCIO = z.enum(SEGMENTOS_DE_NEGOCIO);

const RECORTE_DE_EXEMPLO = { com_alguma_tag: ["cliente"] };

export const FERRAMENTAS_DE_EMAIL_MARKETING: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_email_marketing",
    description:
      "O RETRATO do e-mail marketing de um cliente: se o módulo está contratado, se a Amazon está ligada no servidor (só sim ou não, nunca a chave), " +
      'o domínio e os seis registros de DNS (3 DKIM, MX e SPF do subdomínio de retorno, DMARC) com o que falta, os remetentes, o "responder para", ' +
      "o rodapé obrigatório, o ritmo, a janela, o degrau do aquecimento (14 degraus), a saúde dos últimos 30 dias (rejeição e reclamação), " +
      "o preço por e-mail, o saldo, o tamanho da lista de supressão, os textos de consentimento e as PENDÊNCIAS para o primeiro envio. " +
      "QUANDO USAR: no começo e no fim da implantação do e-mail, e para dizer ao cliente o que falta.",
    inputSchema: { organization_id: ORGANIZACAO },
    exemplo: { organization_id: ORG_DE_EXEMPLO },
    operacao: null,
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      const retrato = await retratoDaConfiguracao(ctx.admin, org.id);
      const [segmentos, modelos] = await Promise.all([
        listarSegmentos(ctx.admin, org.id),
        listarModelos(ctx.admin, org.id),
      ]);
      return {
        ...retrato,
        segmentos: segmentos.map((s) => ({ id: s.id, nome: s.nome, base_legal: s.base_legal })),
        modelos,
        como_seguir:
          "Libere o módulo com plataforma_liberar_modulo (modulo email_marketing), o preço com plataforma_definir_preco (preco_por_email_cents), " +
          "o domínio com plataforma_verificar_dominio_de_email, remetentes e rodapé com plataforma_configurar_email_marketing. " +
          "A campanha nasce em rascunho com plataforma_criar_campanha_de_email; o envio é SÓ pela tela.",
      };
    },
  },
  {
    name: "plataforma_verificar_dominio_de_email",
    description:
      "Cadastra o DOMÍNIO de envio do cliente na Amazon (uma vez) e confere no DNS os seis registros: três CNAME de DKIM, o MX e o SPF do subdomínio " +
      'de retorno (padrão "envio") e o DMARC. Devolve a tabela para quem cuida do DNS do cliente copiar, com o que já está certo. ' +
      'Rodar de novo só confere (é o botão "Conferir agora" da tela). Recusa provedor gratuito (gmail.com, hotmail.com...): o domínio tem de ser da empresa. ' +
      "Sem os seis registros o envio fica travado. QUANDO USAR: depois de liberar o módulo; rode de novo depois que o cliente publicar os registros. " +
      "O QUE NÃO FAZ: não publica nada no DNS do cliente (quem publica é quem cuida do domínio) e não manda e-mail nenhum.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      dominio: z
        .string()
        .trim()
        .min(3)
        .max(253)
        .optional()
        .describe(
          "O domínio da empresa, como exemplo.com.br. Ausente: confere o domínio já cadastrado.",
        ),
      subdominio_de_retorno: z
        .string()
        .trim()
        .regex(/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/)
        .optional()
        .describe('O subdomínio do MAIL FROM (o retorno das rejeições). Padrão: "envio".'),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, dominio: "exemplo.com.br" },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      const r = await semRecusaCrua(() =>
        verificarDominio(ctx.admin, {
          organizationId: org.id,
          dominio: (args.dominio as string | undefined) ?? null,
          subdominioDeRetorno: (args.subdominio_de_retorno as string | undefined) ?? null,
        }),
      );
      return {
        dominio: r.dominio.dominio,
        verificado: r.verificado,
        cadastrado_na_amazon_agora: r.criouAgora,
        registros: r.registros.map((x) => ({
          tipo: x.tipo,
          nome: x.nome,
          nome_no_painel: x.nomeCurto,
          valor: x.valor,
          para: x.para,
          ok: x.ok,
        })),
        faltam: r.registros.filter((x) => !x.ok).map((x) => x.id),
        proximo_passo: r.verificado
          ? "Domínio verificado. Cadastre os remetentes e o rodapé com plataforma_configurar_email_marketing."
          : "Mande a tabela a quem cuida do DNS do cliente e rode esta ferramenta de novo depois que publicarem (o DNS pode levar algumas horas).",
      };
    },
  },
  {
    name: "plataforma_configurar_email_marketing",
    description:
      "Grava a CONFIGURAÇÃO do e-mail marketing: os remetentes (nome de exibição e a parte antes do @, no domínio verificado; um é o padrão), " +
      'o "responder para" (vazio: o e-mail da marca), o RODAPÉ obrigatório (razão social, CNPJ, endereço, por que a pessoa recebe e a política de ' +
      "privacidade, ou a página padrão, que é RASCUNHO PARA REVISÃO JURÍDICA), o ritmo por hora, a janela de envio e só dias úteis. " +
      "Campo ausente fica como está; rodar de novo com o mesmo pedido não muda nada. Sem rodapé completo o envio fica travado. " +
      "O QUE NÃO FAZ: não cadastra o domínio (é plataforma_verificar_dominio_de_email) e não envia nada.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      configuracao: configuracaoSchema
        .optional()
        .describe("Os campos da configuração (todos opcionais)."),
      remetentes: z
        .array(remetenteSchema)
        .max(10)
        .optional()
        .describe(
          'Os remetentes, ex.: [{"nome": "Equipe Exemplo", "local": "contato", "padrao": true}].',
        ),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      configuracao: {
        rodape_razao_social: "Exemplo Comércio LTDA",
        rodape_cnpj: "00.000.000/0001-00",
        rodape_endereco: "Rua Exemplo, 100 · Cidade Exemplo",
        rodape_motivo: "Você recebe porque se cadastrou para receber novidades.",
        rodape_usar_privacidade_padrao: true,
        ritmo_por_hora: 300,
      },
      remetentes: [{ nome: "Equipe Exemplo", local: "contato", padrao: true }],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      const config = args.configuracao as z.infer<typeof configuracaoSchema> | undefined;
      if (config && Object.keys(config).length > 0) {
        await semRecusaCrua(() => gravarConfiguracao(ctx.admin, org.id, config, ctx.autorUserId));
      }
      const remetentes = [];
      for (const r of (args.remetentes as Array<z.infer<typeof remetenteSchema>> | undefined) ??
        []) {
        remetentes.push({
          local: r.local,
          ...(await semRecusaCrua(() => garantirRemetente(ctx.admin, org.id, r, ctx.autorUserId))),
        });
      }
      const retrato = await retratoDaConfiguracao(ctx.admin, org.id);
      return {
        remetentes,
        rodape_completo: retrato.rodape_completo,
        pronto_para_enviar: retrato.pronto_para_enviar,
        pendencias: retrato.pendencias,
      };
    },
  },
  {
    name: "plataforma_garantir_segmentos",
    description:
      "Garante os SEGMENTOS SALVOS do e-mail (o recorte do público com a base legal), pelo nome: cria, atualiza ou diz que já estava. " +
      "O recorte é o mesmo filtro do Broadcast (com_todas_tags, com_alguma_tag, sem_tags, funis, etapas, responsaveis, situacoes_do_negocio, " +
      'sem_interacao_ha_dias, com_interacao_ha_dias, cadastrado_de/ate, origens) mais a empresa do contato (empresa: "com", "sem" ou o id) e uma campanha anterior ' +
      "(campanha_anterior: campanha_id e comportamento) " +
      "(quem clicou, abriu, recebeu e não abriu, ou recebeu). Base legal: consent (padrão, só quem tem o aceite registrado) ou " +
      "legitimate_interest (só clientes com compra nos últimos 24 meses, e exige a referência da avaliação, lia_ref). " +
      "A elegibilidade é refeita na hora de cada envio: o segmento não guarda lista de pessoas. " +
      "O QUE NÃO FAZ: não cria campanha e não manda nada.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      segmentos: z
        .array(segmentoSchema)
        .min(1)
        .max(30)
        .describe(
          'Os segmentos, ex.: [{"nome": "Clientes", "recorte": {"com_alguma_tag": ["cliente"]}, "base_legal": "consent"}].',
        ),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      segmentos: [{ nome: "Clientes", recorte: RECORTE_DE_EXEMPLO, base_legal: "consent" }],
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      const saida = [];
      for (const s of args.segmentos as Array<z.infer<typeof segmentoSchema>>) {
        const dados = { ...s, recorte: recorteSchema.parse(s.recorte) };
        saida.push({
          nome: s.nome,
          ...(await semRecusaCrua(() =>
            garantirSegmento(ctx.admin, org.id, dados, ctx.autorUserId),
          )),
        });
      }
      return { segmentos: saida };
    },
  },
  {
    name: "plataforma_garantir_modelos_de_email",
    description:
      "Garante os MODELOS de e-mail da empresa: os do catálogo por segmento de negócio (" +
      SEGMENTOS_DE_NEGOCIO.join(", ") +
      ") e, se quiser, modelos escritos à parte (chave, nome, assunto, pré-cabeçalho e blocos: titulo, texto, imagem, botao, divisor). " +
      "Pela chave: cria, atualiza ou diz que já estava. O QUE NÃO FAZ: o modelo é só o ponto de partida de uma campanha; ele não envia nada.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      segmentos: z
        .array(SEGMENTO_DE_NEGOCIO)
        .max(SEGMENTOS_DE_NEGOCIO.length)
        .optional()
        .describe('Os do catálogo, ex.: ["geral", "saude"].'),
      modelos: z
        .array(
          z
            .object({
              chave: z
                .string()
                .trim()
                .regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
              nome: z.string().trim().min(1).max(120),
              segmento_de_negocio: z.string().trim().max(40).nullable().optional(),
              assunto: z.string().max(200).optional(),
              pre_cabecalho: z.string().max(200).optional(),
              blocos: blocosSchema,
            })
            .strict(),
        )
        .max(20)
        .optional()
        .describe(
          "Modelos escritos à parte, além dos do catálogo: chave, nome, assunto, pré-cabeçalho e blocos.",
        ),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, segmentos: ["geral"] },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      const segmentos = (args.segmentos as SegmentoDeNegocio[] | undefined) ?? [];
      const modelos = ((args.modelos as Array<Record<string, unknown>> | undefined) ?? []).map(
        (m) => ({
          chave: String(m.chave),
          nome: String(m.nome),
          segmento_de_negocio: (m.segmento_de_negocio as string | null | undefined) ?? null,
          assunto: String(m.assunto ?? ""),
          pre_cabecalho: String(m.pre_cabecalho ?? ""),
          blocos: m.blocos as z.infer<typeof blocosSchema>,
        }),
      );
      if (segmentos.length === 0 && modelos.length === 0) {
        throw new Recusa(
          'Diga os segmentos do catálogo (ex.: "segmentos": ["geral"]) ou escreva modelos em "modelos".',
        );
      }
      return {
        modelos: await semRecusaCrua(() =>
          garantirModelos(ctx.admin, org.id, { segmentos, modelos }, ctx.autorUserId),
        ),
      };
    },
  },
  {
    name: "plataforma_importar_consentimentos",
    description:
      "Importa ACEITES de e-mail marketing de outra ferramenta, uma linha por pessoa: e-mail, data do aceite, ORIGEM (obrigatória: de onde veio), " +
      "versão do texto aceito e evidência. Grava o aceite no contato com aquele e-mail (contato que não existe não é criado) e um registro para " +
      "cada um. Quem está na lista de supressão continua fora (descadastro não volta por importação). " +
      "ATENÇÃO: aceite importado LIBERA o envio para a pessoa; só importe aceite que a empresa consegue provar. O QUE NÃO FAZ: não cria contato e não manda e-mail.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      linhas: z
        .array(
          z
            .object({
              email: z.string().trim().min(3).max(254).describe("O e-mail do contato que aceitou."),
              data: z.string().trim().min(8).max(40).describe("AAAA-MM-DD ou ISO."),
              origem: z.string().trim().min(1).max(200),
              versao: z.string().trim().max(30).nullable().optional(),
              evidencia: z.string().trim().max(500).nullable().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(5000)
        .describe("Uma linha por aceite, até 5000 por chamada."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      linhas: [
        {
          email: "pessoa@exemplo.invalid",
          data: "2026-05-10",
          origem: "Formulário do site",
          evidencia: "Registro do formulário de 10/05",
        },
      ],
    },
    operacao: OPERACAO_IMPORTAR_CONSENTIMENTOS,
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      const linhas = args.linhas as Array<{
        email: string;
        data: string;
        origem: string;
        versao?: string | null;
        evidencia?: string | null;
      }>;
      return semRecusaCrua(() =>
        importarAceites(ctx.admin, {
          organizationId: org.id,
          linhas: linhas.map((l) => ({
            email: l.email,
            data: l.data,
            origem: l.origem,
            versao: l.versao ?? null,
            evidencia: l.evidencia ?? null,
          })),
          registradoPor: ctx.autorUserId,
          porta: "plataforma",
          empresaNome: org.display_name,
          requestId: ctx.requestId,
        }),
      );
    },
  },
  {
    name: "plataforma_importar_supressao",
    description:
      'Importa a LISTA DE SUPRESSÃO da ferramenta anterior (descadastros, rejeições): cada endereço entra como "importada" e nunca mais recebe ' +
      'e-mail marketing desta empresa, mesmo com aceite. Só acrescenta (a lista não encolhe por aqui); o endereço repetido conta como "já estava". ' +
      "QUANDO USAR: antes da primeira campanha de quem já mandava e-mail por outra ferramenta. O QUE NÃO FAZ: não tira ninguém da lista (só a própria pessoa volta).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      enderecos: z
        .array(z.string().trim().min(3).max(254))
        .min(1)
        .max(20000)
        .describe("Os endereços que não podem mais receber, até 20 mil por chamada."),
      de_onde: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .describe('De onde veio a lista, ex.: "Descadastros da ferramenta anterior".'),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      enderecos: ["saiu@exemplo.invalid"],
      de_onde: "Descadastros da ferramenta anterior",
    },
    operacao: "implantar_configuracao",
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      return semRecusaCrua(() =>
        importarSupressao(ctx.admin, {
          organizationId: org.id,
          enderecos: args.enderecos as string[],
          deOnde: String(args.de_onde),
          criadoPor: ctx.autorUserId,
        }),
      );
    },
  },
  {
    name: "plataforma_criar_campanha_de_email",
    description:
      "Cria uma campanha de e-mail em RASCUNHO (de um modelo, de um segmento ou com o conteúdo escrito aqui) e, se pedir, manda o TESTE da versão " +
      "atual para até 5 e-mails DA EQUIPE do cliente (ou de quem criou o token), com [TESTE] no assunto e sem cobrar. Devolve a conferência: " +
      "quantas pessoas recebem, quantas ficam de fora e por quê, o plano dia a dia, o custo, o saldo e o que trava. " +
      "Com `campanha_id`, edita o rascunho existente em vez de criar. " +
      "O QUE NÃO FAZ: NÃO DISPARA. O envio de verdade é só pela tela da campanha (Broadcast → E-mail), com a declaração da base legal assinada por uma pessoa da empresa. " +
      "Na empresa de demonstração o teste é recusado.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      campanha_id: z
        .string()
        .uuid()
        .optional()
        .describe("Para editar um rascunho existente (de plataforma_ver_campanhas_de_email)."),
      nome: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe("O nome da campanha (obrigatório ao criar)."),
      modelo: z
        .string()
        .trim()
        .max(64)
        .optional()
        .describe("A chave de um modelo (de plataforma_ver_email_marketing)."),
      segmento_id: z
        .string()
        .uuid()
        .optional()
        .describe("Um segmento salvo: traz o recorte e a base legal."),
      recorte: recorteSchema
        .optional()
        .describe(
          'O público, no formato de plataforma_garantir_segmentos (ex.: {"com_alguma_tag": ["cliente"]}). Ausente: o do segmento.',
        ),
      base_legal: z
        .enum(["consent", "legitimate_interest"])
        .optional()
        .describe(
          "consent (só quem tem o aceite registrado) ou legitimate_interest (clientes dos últimos 24 meses, exige lia_ref). Ausente: a do segmento, ou consent.",
        ),
      lia_ref: z
        .string()
        .trim()
        .max(120)
        .nullable()
        .optional()
        .describe("A referência da avaliação de interesse legítimo (LIA)."),
      remetente_id: z
        .string()
        .uuid()
        .nullable()
        .optional()
        .describe("O remetente (de plataforma_ver_email_marketing). Ausente: o padrão."),
      assunto: z
        .string()
        .max(200)
        .optional()
        .describe(
          "O assunto. Aceita os campos do CRM, como {{primeiro_nome}}. Ausente: o do modelo.",
        ),
      pre_cabecalho: z
        .string()
        .max(200)
        .optional()
        .describe("O texto que aparece depois do assunto na caixa de entrada."),
      blocos: blocosSchema
        .optional()
        .describe(
          'O corpo em blocos: {"tipo": "titulo"|"texto", "texto"}, {"tipo": "imagem", "url", "alt"}, {"tipo": "botao", "texto", "url"} ou {"tipo": "divisor"}, cada um com "id".',
        ),
      reservas: reservasSchema
        .optional()
        .describe(
          'O texto reserva de cada campo do CRM quando faltar o dado, ex.: {"primeiro_nome": "cliente"}.',
        ),
      teste_para: z
        .array(z.string().trim().min(3).max(254))
        .max(MAXIMO_DE_ENDERECOS_NO_TESTE)
        .optional()
        .describe("Até 5 e-mails da equipe do cliente para receber o teste."),
    },
    exemplo: {
      organization_id: ORG_DE_EXEMPLO,
      nome: "Novidades de novembro",
      modelo: "novidades-do-mes",
      segmento_id: "00000000-0000-4000-8000-0000000000aa",
    },
    operacao: OPERACAO_CRIAR_CAMPANHA_DE_EMAIL,
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      return semRecusaCrua(async () => {
        // O teste vai só para a equipe: conferido ANTES de gravar qualquer coisa.
        const para = ((args.teste_para as string[] | undefined) ?? [])
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);
        if (para.length > 0) {
          const daEquipe = await enderecosDaEquipe(ctx, org.id);
          const fora = para.filter((e) => !daEquipe.has(e));
          if (fora.length > 0) {
            throw new Recusa(
              `Pelo MCP, o teste vai só para e-mails da equipe do cliente ou de quem criou o token. Fora da equipe: ${fora.join(", ")}. ` +
                "Convide a pessoa com plataforma_convidar_pessoas, ou mande o teste pela tela da campanha. Nada foi gravado.",
            );
          }
        }
        const doModelo = args.modelo
          ? await blocosDoModelo(ctx.admin, org.id, String(args.modelo))
          : null;
        if (args.modelo && !doModelo)
          throw new Recusa(
            "Modelo não encontrado nesta empresa. Veja os modelos em plataforma_ver_email_marketing.",
          );
        const segmento = args.segmento_id
          ? (await listarSegmentos(ctx.admin, org.id)).find((s) => s.id === args.segmento_id)
          : null;
        if (args.segmento_id && !segmento)
          throw new Recusa(
            "Segmento não encontrado nesta empresa. Veja os segmentos em plataforma_ver_email_marketing.",
          );
        const recorte = args.recorte ? recorteSchema.parse(args.recorte) : segmento?.recorte;
        const conteudo = {
          ...(args.remetente_id !== undefined
            ? { remetente_id: args.remetente_id as string | null }
            : {}),
          ...(args.assunto !== undefined || doModelo
            ? { assunto: (args.assunto as string | undefined) ?? doModelo?.assunto ?? "" }
            : {}),
          ...(args.pre_cabecalho !== undefined || doModelo
            ? {
                pre_cabecalho:
                  (args.pre_cabecalho as string | undefined) ?? doModelo?.pre_cabecalho ?? "",
              }
            : {}),
          ...(args.blocos !== undefined || doModelo
            ? {
                blocos:
                  (args.blocos as z.infer<typeof blocosSchema> | undefined) ??
                  doModelo?.blocos ??
                  [],
              }
            : {}),
          ...(args.reservas !== undefined
            ? { reservas: args.reservas as Record<string, string> }
            : {}),
          ...(recorte ? { recorte } : {}),
          ...(segmento ? { segmento_id: segmento.id } : {}),
          ...(args.base_legal !== undefined || segmento
            ? {
                base_legal:
                  (args.base_legal as "consent" | "legitimate_interest" | undefined) ??
                  segmento?.base_legal ??
                  "consent",
              }
            : {}),
          ...(args.lia_ref !== undefined || segmento
            ? { lia_ref: (args.lia_ref as string | null | undefined) ?? segmento?.lia_ref ?? null }
            : {}),
        };
        let campanha;
        if (args.campanha_id) {
          const existente = await lerCampanha(ctx.admin, org.id, String(args.campanha_id));
          if (!existente)
            throw new Recusa(
              "Campanha não encontrada nesta empresa. Veja as campanhas em plataforma_ver_campanhas_de_email.",
            );
          campanha = await editarRascunho(ctx.admin, org.id, existente.id, {
            ...(args.nome ? { nome: String(args.nome) } : {}),
            ...conteudo,
          });
        } else {
          if (!args.nome) throw new Recusa('Diga o nome da campanha em "nome".');
          campanha = await criarRascunho(ctx.admin, {
            organizationId: org.id,
            autorId: ctx.autorUserId,
            origem: "mcp",
            dados: { nome: String(args.nome), ...conteudo },
          });
        }

        let teste: {
          versao: number;
          enviados: string[];
          recusados: Array<{ para: string; erro: string }>;
        } | null = null;
        if (para.length > 0) {
          teste = await enviarTeste(ctx.admin, {
            organizationId: org.id,
            campanhaId: campanha.id,
            para,
            autorId: ctx.autorUserId,
          });
          campanha = (await lerCampanha(ctx.admin, org.id, campanha.id)) ?? campanha;
        }

        const conf = await conferirCampanha(ctx.admin, org.id, campanha, { semDns: true });
        return {
          campanha: {
            id: campanha.id,
            nome: campanha.nome,
            status: campanha.status,
            versao: campanha.versao,
            teste_da_versao_atual: campanha.teste_versao === campanha.versao,
          },
          teste,
          conferencia: {
            recebem: conf.total,
            no_recorte: conf.publico.contagem.noRecorte,
            fora_por_motivo: conf.publico.contagem.foraPorMotivo,
            sem_dado: conf.semDado,
            conteudo: conf.conteudo.map((i) => ({
              nivel: i.nivel,
              frase: fraseDaConferencia(i.titulo, i.valores),
              detalhe: fraseDaConferencia(i.detalhe, i.valores),
            })),
            plano: conf.plano,
            preco_por_email_cents: conf.precoCents,
            custo_cents: conf.custoCents,
            saldo_cents: conf.saldoCents,
            travas: conf.travas.map((t) => t.texto),
          },
          como_enviar:
            "O MCP não dispara. Quem envia é uma pessoa da empresa (gestor ou acima), na tela Broadcast → a campanha → Enviar, " +
            "confirmando a base legal. Endereço da campanha: /app/broadcast/email/" +
            campanha.id,
        };
      });
    },
  },
  {
    name: "plataforma_ver_campanhas_de_email",
    description:
      "As CAMPANHAS de e-mail de um cliente, das mais novas: nome, situação (rascunho, agendada, enviando, pausada, concluída, cancelada), por que pausou, " +
      "o andamento e, com `campanha_id`, os RESULTADOS: enviados, entregues, aberturas (estimativa, só de quem aceitou a medição), cliques únicos " +
      "(sem robô), descadastros, rejeições, reclamações, o cobrado e os cliques por link. Só leitura.",
    inputSchema: {
      organization_id: ORGANIZACAO,
      campanha_id: z.string().uuid().optional().describe("Para ver os resultados de uma campanha."),
      limite: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Quantas campanhas na lista. Padrão: 30."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO },
    operacao: null,
    handler: async (ctx, args) => {
      const { org } = await alvo(ctx, args);
      if (args.campanha_id) {
        const c = await lerCampanha(ctx.admin, org.id, String(args.campanha_id));
        if (!c) throw new Recusa("Campanha não encontrada nesta empresa.");
        const r = await resultadosDaCampanha(ctx.admin, org.id, c.id);
        return {
          campanha: {
            id: c.id,
            nome: c.nome,
            status: c.status,
            motivo_da_pausa: c.motivo_da_pausa,
            origem: c.origem,
          },
          resultados: r,
        };
      }
      const campanhas = await listarCampanhas(
        ctx.admin,
        org.id,
        (args.limite as number | undefined) ?? 30,
      );
      const linhas = await Promise.all(
        campanhas.map(async (c) => ({
          id: c.id,
          nome: c.nome,
          status: c.status,
          base_legal: c.base_legal,
          origem: c.origem,
          agendada_para: c.agendada_para,
          total_previsto: c.total_previsto,
          motivo_da_pausa: c.motivo_da_pausa,
          andamento:
            c.status === "rascunho" ? null : await andamentoDaCampanha(ctx.admin, org.id, c.id),
        })),
      );
      return { modulo: MODULO_EMAIL_MARKETING, campanhas: linhas };
    },
  },
];

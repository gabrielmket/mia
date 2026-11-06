/**
 * FORK MIA (.101) · O RAIO-X DO ATENDIMENTO NO MCP DE PLATAFORMA (protótipo
 * aprovado em 04/11/2026; docs/fork/raio-x-do-atendimento.md). Quatro, e a
 * escrita exige a operação `gerir_raio_x`:
 *
 *   plataforma_criar_raio_x     cadastra; devolve o link de conexão (48 h) e a mensagem pronta
 *   plataforma_ver_raio_x       leitura: a lista, ou a situação, o andamento, o relatório e a evolução
 *   plataforma_publicar_raio_x  revisa o rascunho e gera (ou revoga) o link do dono
 *   plataforma_encerrar_raio_x  desconecta e agenda a exclusão das conversas
 *
 * A quarta existe porque a revisão (decisão 10) e o link do dono não cabem nas
 * três do protótipo: "ver" é leitura, e "criar" e "encerrar" são as pontas do
 * ciclo. Publicar é o passo do meio, e o mais sensível (é o que o dono vê).
 *
 * Tudo passa por `lib/raio-x/acoes.ts`, o mesmo caminho da tela.
 *
 * FORK MIA (.102) · o raio-X do CLIENTE ATIVO (protótipo de 05/11/2026): o
 * criar aceita a `fonte` "conversas_da_mia", o `organization_id` e os
 * `numeros` da conta; o ver mostra a fonte e o aceite (nome completo, e-mail
 * mascarado, data e versão do termo) e, com `organization_id` sem
 * `raio_x_id`, o que dá para ler daquela conta (os números com os ids, o
 * período, a estimativa e se a empresa conta como cliente ativo). Nenhuma
 * ferramenta nova: são as mesmas quatro.
 *
 * FORK MIA (.105) · a quinta, `plataforma_reler_raio_x`: lê de novo um
 * raio-X pronto que segue conectado (o 1º real fechou com 0 conversas antes de
 * o histórico chegar). E o ver, com `raio_x_id`, diz o `aparelho`: a etapa da
 * sessão no leitor e quantas conversas ele mostra agora.
 *
 * FORK MIA (.106) · o raio-X GRÁTIS POR CADASTRO: o ver mostra a ORIGEM (Time,
 * cadastro grátis, avulsa, mensal), a CONTA de quem se cadastrou (nome, e-mail e
 * WhatsApp mascarados) e os PEDIDOS de nova análise; e a sexta,
 * `plataforma_precos_do_raio_x`, vê e define o preço da nova análise (112).
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { organizacaoDaImplantacao } from "@/lib/implantacao/base";
import { maskEmail, maskPhone } from "@/lib/lgpd/mask";
import {
  acaoCriar,
  acaoEncerrar,
  acaoGerarLinkDoDono,
  acaoLerDeNovo,
  acaoRevisar,
  acaoRevogarLinkDoDono,
  acaoVer,
  acaoVerAparelho,
  fraseDaRecusa,
} from "@/lib/raio-x/acoes";
import { listarRaioX, type LinhaDoRelatorio } from "@/lib/raio-x/banco";
import { definirPreco, lerPrecos, type LinhaDoPedido } from "@/lib/raio-x/pedidos";
import { contaParaORaioX } from "@/lib/raio-x/conta";
import { reaisParaLer } from "@/lib/raio-x/custo";
import { FONTES, NUMEROS_POR_RAIO_X, QUEM_ATENDE, SEGMENTOS, TIPOS } from "@/lib/raio-x/regras";
import { ROTULO_DO_INDICADOR } from "@/lib/raio-x/comparacao";

import { recusar } from "../recusa";
import type { FerramentaDePlataforma } from "../tipos";

const OPERACAO = "gerir_raio_x";

/** O relatório como o MCP mostra: os números somados, sem os trechos inteiros. */
function resumoDoRelatorio(r: LinhaDoRelatorio, comMia: boolean) {
  const d = r.dados;
  return {
    id: r.id,
    sequencia: r.sequencia,
    situacao: r.situacao,
    periodo: { inicio: r.periodo_inicio, fim: r.periodo_fim, competencia: r.competencia },
    criado_em: r.created_at,
    revisado_em: r.revisado_em,
    criterios_versao: r.criterios_versao,
    parcial: r.parcial,
    conversas: d.numeros.conversas,
    mensagens: d.numeros.mensagens,
    audios_transcritos: d.numeros.audiosTranscritos,
    primeira_resposta: {
      mediana_min: d.tempo.medianaPrimeiraRespostaMin,
      com_a_loja_aberta_min: d.tempo.medianaComALojaAbertaMin,
      com_a_loja_fechada_min: d.tempo.medianaComALojaFechadaMin,
      proporcao_com_a_loja_fechada: d.tempo.proporcaoComALojaFechada,
    },
    sem_resposta: d.tempo.semResposta,
    sumiram_sem_retorno: d.tempo.sumicosSemRetorno,
    origem: d.origem.map((o) => ({ origem: o.rotulo, conversas: o.conversas })),
    assuntos: d.assuntos.map((a) => ({ assunto: a.rotulo, proporcao: Math.round(a.proporcao * 1000) / 1000 })),
    desfechos: d.desfechos.map((x) => ({ desfecho: x.rotulo, conversas: x.conversas })),
    nota: d.notas,
    recomendacoes: d.recomendacoes.map((x) => ({ codigo: x.codigo, valores: x.valores })),
    exemplos: { boas: d.exemplos.bons.map((e) => `Cliente ${e.ordem}`), ruins: d.exemplos.ruins.map((e) => `Cliente ${e.ordem}`) },
    fonte: d.fonte ?? "conexao",
    // FORK MIA (.102): o cliente ativo tem o bloco próprio no lugar do "o que a MIA resolveria".
    ...(d.clienteAtivo
      ? {
          cliente_ativo: {
            numeros: d.clienteAtivo.numeros,
            quem_respondeu_primeiro: d.clienteAtivo.quemRespondeu,
            depois_da_passagem: d.clienteAtivo.passagem,
            no_que_virou: d.clienteAtivo.funil,
            onde_ainda_da_para_ganhar: d.clienteAtivo.ondeGanhar.map((x) => ({ codigo: x.codigo, valores: x.valores })),
          },
        }
      : comMia
        ? { o_que_a_mia_resolveria: d.mia }
        : {}),
    analise: d.analise,
    custo: { reais: reaisParaLer(Number(r.custo_centavos)), usd_centavos: Math.round(Number(r.custo_usd_centavos) * 100) / 100 },
    evolucao: r.comparacao
      ? {
          anterior_id: r.comparacao.anteriorId,
          anterior_em: r.comparacao.anteriorEm,
          melhorou: r.comparacao.melhorou,
          piorou: r.comparacao.piorou,
          criterios_iguais: r.comparacao.criteriosIguais,
          linhas: r.comparacao.linhas.map((l) => ({
            indicador: ROTULO_DO_INDICADOR[l.indicador],
            antes: l.anterior,
            agora: l.agora,
            direcao: l.direcao,
            aviso: l.aviso,
          })),
        }
      : null,
    notas_da_time: r.notas_da_time,
  };
}

/** FORK MIA (.106): o pedido de nova análise como o MCP mostra (sem link de pagamento nem referência do Asaas). */
function resumoDoPedido(p: LinhaDoPedido) {
  return {
    id: p.id,
    tipo: p.tipo,
    situacao: p.situacao,
    reais: p.valor_centavos === null ? null : reaisParaLer(p.valor_centavos),
    criado_em: p.created_at,
    pago_em: p.pago_em,
    cancelado_em: p.cancelado_em,
    raio_x_do_pedido: p.raio_x_id,
    erro: p.erro,
  };
}

export const FERRAMENTAS_DO_RAIO_X: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_criar_raio_x",
    description:
      "Cadastra o RAIO-X DO ATENDIMENTO de uma empresa e devolve o link, que vale 48 horas, e a mensagem pronta para mandar ao dono. Duas FONTES (`fonte`): " +
      "\"conexao\" (o padrão) para quem ainda NÃO é cliente da MIA (é a isca comercial): o link é de conexão e o dono conecta o WhatsApp; " +
      "\"conversas_da_mia\" para CLIENTE ATIVO (a empresa opera e está em dia, em teste ou isenta; a demonstração também entra): nada é conectado e o leitor não é usado, o link é só de AUTORIZAÇÃO, e o raio-X lê as conversas que a conta já tem nos `numeros` escolhidos (`channel_session_id`, inclusive da API oficial), no período escolhido e nunca antes da primeira conversa da conta; exige `organization_id` e `numeros` (veja os números, o período e a estimativa com plataforma_ver_raio_x e o `organization_id`), e o `whatsapp` sai do primeiro número. O relatório do cliente ativo soma quem respondeu primeiro, a espera depois da passagem para a equipe, no que virou no funil da conta e onde ainda dá para ganhar. " +
      "Na conexão: " +
      "O dono abre o link sem login, aceita o termo (fica registrado com nome, data, hora e versão) e conecta o WhatsApp comercial pelo código de 8 letras, com o QR como alternativa. O sistema lê só para leitura as conversas 1:1 do período, transcreve os áudios e gera o relatório em RASCUNHO. " +
      "`segmento` muda o que o relatório procura nas conversas; o horário comercial separa o que chegou com a loja aberta e fechada; `tipo` unico desconecta 7 dias depois do relatório e mensal fica conectado e gera um relatório no dia 1 de cada mês; `teto_centavos` é o teto de custo da análise (padrão 4000 = R$ 40). " +
      "ANTES DE criar pela conexão, confira com o dono que o número é o aplicativo do WhatsApp (comum ou Business): número na API oficial não conecta assim (no cliente ativo, entra). O QUE NÃO FAZ: não manda a mensagem a ninguém (quem manda é a Time), não lê nada antes do aceite (o dono aceita com nome completo e e-mail) e não envia mensagem nenhuma pela conta.",
    inputSchema: {
      fonte: z.enum(FONTES).optional().describe("De onde vêm as conversas: conexao (padrão, quem ainda não é cliente) ou conversas_da_mia (cliente ativo)."),
      empresa: z.string().trim().min(1).max(120).describe("O nome da empresa, como vai no relatório."),
      segmento: z.enum(SEGMENTOS).describe("O segmento: revenda_de_veiculos, clinica_odontologica, clinica_de_estetica, academia, imobiliaria, loja_e_varejo ou outro."),
      whatsapp: z
        .string()
        .trim()
        .min(8)
        .max(32)
        .optional()
        .describe("Na conexão (obrigatório): o WhatsApp COMERCIAL que vai ser lido. Do Brasil, com DDD: (31) 90000-1101; de fora, com +. No cliente ativo, ignorado."),
      numeros: z
        .array(z.string().uuid())
        .max(NUMEROS_POR_RAIO_X)
        .optional()
        .describe("No cliente ativo (obrigatório): os ids dos números da conta (channel_session_id) a ler, de plataforma_ver_raio_x com o organization_id."),
      responsavel_nome: z.string().trim().max(120).nullable().optional().describe("Quem autoriza (o dono ou responsável). Vai na mensagem pronta."),
      responsavel_contato: z.string().trim().max(160).nullable().optional().describe("WhatsApp ou e-mail de quem autoriza, para a Time mandar o link."),
      quem_atende: z.enum(QUEM_ATENDE).optional().describe("Quem atende hoje: humano (pessoas da loja), agente (automático) ou misto. Padrão humano."),
      periodo_dias: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional().describe("Quantos dias de conversa ler: 30, 60 ou 90 (padrão 90; o WhatsApp entrega cerca de 3 meses)."),
      tipo: z.enum(TIPOS).optional().describe("unico (diagnóstico) ou mensal (acompanhamento). Padrão unico."),
      abre: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("Abre às, de segunda a sexta (HH:MM). Padrão 08:00."),
      fecha: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("Fecha às, de segunda a sexta (HH:MM). Padrão 18:00."),
      sabado_ate: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional().describe("Até que horas abre no sábado (HH:MM); null = não abre. Padrão 13:00."),
      organization_id: z
        .string()
        .uuid()
        .nullable()
        .optional()
        .describe("A empresa da MIA. Obrigatório no cliente ativo (conversas_da_mia); na conexão, opcional (dá para ligar depois pela tela)."),
      teto_centavos: z.number().int().min(500).max(50000).optional().describe("O teto de custo da análise, em centavos de real. Padrão 4000 (R$ 40)."),
    },
    exemplo: {
      empresa: "Garagem Modelo Veículos",
      segmento: "revenda_de_veiculos",
      whatsapp: "(31) 90000-1101",
      responsavel_nome: "Ricardo Exemplo",
      periodo_dias: 90,
      tipo: "unico",
    },
    operacao: OPERACAO,
    // O contato de quem autoriza é pessoa: fica fora da trilha.
    redigirParaAuditoria: (args) => ({ ...args, responsavel_nome: args.responsavel_nome ? "[redigido]" : null, responsavel_contato: args.responsavel_contato ? "[redigido]" : null }),
    // (os `numeros` são ids de canal da EMPRESA, não de pessoa: ficam.)
    handler: async (ctx, args) => {
      // A empresa da MIA, quando vem, existe: a recusa ensina a achar o id certo.
      if (typeof args.organization_id === "string") await organizacaoDaImplantacao(ctx.admin, args.organization_id);
      const r = await acaoCriar(ctx.admin, args, ctx.autorUserId, "mcp_plataforma");
      if (!r.ok) recusar(fraseDaRecusa(r));
      void audit({
        action: "raio_x.criado",
        actorUserId: ctx.autorUserId,
        actingAsPlatformAdmin: true,
        resourceType: "mia_raio_x",
        resourceId: r.id,
        requestId: ctx.requestId,
        metadata: { via: "mcp", token_id: ctx.tokenId, fonte: r.fonte },
      });
      return { raio_x_id: r.id, empresa: r.empresa, fonte: r.fonte, link: r.link, link_vale_ate: r.expiraEm, mensagem_pronta: r.mensagem };
    },
  },
  {
    name: "plataforma_ver_raio_x",
    description:
      "Os raio-X do atendimento. Sem `raio_x_id`: a lista (empresa, FONTE, situação, andamento, se há relatório e se é o 2º da mesma empresa). Com `raio_x_id`: a fonte, a situação (aguardando o dono, conectando, lendo, analisando, pronto, encerrado), o andamento da leitura, o ACEITE (nome completo, e-mail mascarado, data e hora, versão do termo), o link vigente (de conexão ou, no cliente ativo, de autorização), o custo medido e o teto, " +
      "os relatórios com os números (velocidade da primeira resposta com a loja aberta e fechada, sem resposta, sumiram sem retorno, origem, assuntos, desfecho, nota nos cinco critérios, recomendações e o bloco do que a MIA resolveria), a EVOLUÇÃO em proporção desde o raio-X anterior da mesma empresa, e os links do dono. " +
      "Os clientes aparecem só por número de ordem, nunca por telefone ou nome; os trechos de conversa ficam na tela de Admin. " +
      "FORK MIA (.102): com `organization_id` e sem `raio_x_id`, o que dá para ler daquela CONTA para o raio-X do cliente ativo: se ela conta como cliente ativo, os números de WhatsApp com o id (channel_session_id), se são da API oficial e as mensagens no período, o período (os N dias inteiros antes de hoje, nunca antes da primeira conversa), o segmento e o horário da conta, quem administra e a estimativa de custo; e os raio-X dessa empresa. No relatório do cliente ativo, quem respondeu primeiro, a espera depois da passagem, no que virou e onde ainda dá para ganhar. " +
      "FORK MIA (.106): a ORIGEM de cada raio-X (time = criado pela Time, com revisão; cadastro_gratis = a pessoa se cadastrou no site ou em /raio-x/gratis e o relatório foi direto para ela; avulsa e mensal = a nova análise paga na área), a CONTA de quem se cadastrou (nome, e-mail e WhatsApp da pessoa mascarados, e se o lead entrou no CRM da Time), quando o relatório foi entregue, se fechou sem histórico (a grátis não contou), os PEDIDOS de nova análise (interesse, aguardando o pagamento, pago, cancelado) e, na lista, o preço da nova análise.",
    inputSchema: {
      raio_x_id: z.string().uuid().optional().describe("Só este raio-X, com o detalhe e os relatórios."),
      organization_id: z.string().uuid().optional().describe("Sem raio_x_id: o que dá para ler desta conta da MIA para o raio-X do cliente ativo, e os raio-X dela."),
      periodo_dias: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional().describe("Com organization_id: o período da estimativa (30, 60 ou 90 dias; padrão 60)."),
    },
    exemplo: {},
    operacao: null,
    handler: async (ctx, args) => {
      if (typeof args.raio_x_id !== "string") {
        const orgId = typeof args.organization_id === "string" ? args.organization_id : null;
        if (orgId) await organizacaoDaImplantacao(ctx.admin, orgId);
        const lista = (await listarRaioX(ctx.admin)).filter((x) => !orgId || x.organizationId === orgId);
        const conta = orgId ? await contaParaORaioX(ctx.admin, orgId, typeof args.periodo_dias === "number" ? args.periodo_dias : 60) : null;
        return {
          ...(conta
            ? {
                conta: {
                  empresa: conta.empresa,
                  cliente_ativo: conta.ativo.ativo,
                  situacao_na_cobranca: conta.ativo.situacao,
                  demonstracao: conta.ativo.demonstracao,
                  cliente_desde: conta.clienteDesde,
                  segmento_da_conta: conta.segmento,
                  horario_da_conta: conta.horario,
                  quem_administra: conta.responsavel ? { nome: conta.responsavel.nome, email: maskEmail(conta.responsavel.email) } : null,
                  numeros: conta.numeros.map((n) => ({ channel_session_id: n.id, rotulo: n.rotulo, api_oficial: n.oficial, arquivado: n.arquivado, mensagens_no_periodo: n.mensagens })),
                  periodo: conta.periodo,
                  estimativa: {
                    conversas: conta.estimativa.conversas,
                    audios_sem_transcricao: conta.estimativa.audios,
                    reais: reaisParaLer(conta.estimativa.totalCentavos),
                    analise: reaisParaLer(conta.estimativa.analiseCentavos),
                    audios: reaisParaLer(conta.estimativa.audiosCentavos),
                  },
                },
              }
            : {}),
          // FORK MIA (.106): o preço da nova análise do cadastro (vazio = só interesse).
          precos_da_nova_analise: (await lerPrecos(ctx.admin)).map((p) => ({ tipo: p.tipo, reais: reaisParaLer(Number(p.valor_centavos)), ativo: p.ativo })),
          raio_x: lista.map((x) => ({
            id: x.id,
            fonte: x.fonte,
            origem: x.origemNaLista ?? "time",
            conta: x.conta ? { nome: x.conta.nome, email: maskEmail(x.conta.email), whatsapp: maskPhone(x.conta.telefone) } : null,
            relatorio_entregue_em: x.entregueEm ?? null,
            sem_historico_em: x.semHistoricoEm ?? null,
            numeros: x.numeros,
            empresa: x.empresa,
            segmento: x.segmento,
            whatsapp: x.whatsappParaLer,
            tipo: x.tipo,
            situacao: x.situacao,
            andamento_pct: x.andamento,
            link_de_conexao_vivo: x.linkVivo,
            ultimo_relatorio: x.ultimoRelatorio,
            anterior_da_mesma_empresa: x.anterior,
            custo: reaisParaLer(x.custoCentavos),
            criado_em: x.criadoEm,
          })),
        };
      }
      const d = await acaoVer(ctx.admin, args.raio_x_id);
      if (!d) recusar(`raio-X não encontrado: ${args.raio_x_id}. Veja a lista com plataforma_ver_raio_x, sem o id.`);
      // FORK MIA (.105): o que o leitor vê AGORA no WhatsApp conectado (só a contagem).
      const aparelho = await acaoVerAparelho(ctx.admin, args.raio_x_id);
      return {
        aparelho: aparelho ? { etapa: aparelho.estado, conversas_agora: aparelho.conversas, mais_de_mil: aparelho.mais } : null,
        raio_x: d.raioX,
        fonte: d.raioX.fonte,
        // FORK MIA (.106): de onde veio, quem se cadastrou (mascarado) e os pedidos.
        origem: d.origem,
        conta: d.conta
          ? {
              nome: d.conta.nome,
              email: maskEmail(d.conta.email),
              whatsapp: maskPhone(d.conta.telefone),
              lead_no_crm_da_time: d.conta.crmLeadId ? { lead_id: d.conta.crmLeadId, enviado_em: d.conta.crmEnviadoEm } : { erro: d.conta.crmErro ?? "ainda_nao" },
            }
          : null,
        relatorio_entregue_em: d.entregueEm,
        sem_historico_em: d.semHistoricoEm,
        pedidos: d.pedidos.map(resumoDoPedido),
        conexao: d.conexao ? { link: d.conexao.link, vale_ate: d.conexao.expiraEm, vivo: d.conexao.vivo, mensagem_pronta: d.conexao.mensagem } : null,
        // FORK MIA (.102): o e-mail de quem aceitou é dado de pessoa: sai mascarado (a tela de Admin mostra inteiro).
        aceite: d.aceite ? { ...d.aceite, email: maskEmail(d.aceite.email) } : null,
        andamento_da_analise: d.analiseDaConta,
        andamento: d.andamento,
        custo: { reais: reaisParaLer(d.custo.centavos), teto: reaisParaLer(d.custo.tetoCentavos), usd_centavos: d.custo.usdCentavos },
        relatorios: d.relatorios.map((r) => resumoDoRelatorio(r, true)),
        links_do_dono: d.links.map((l) => ({ id: l.id, relatorio_id: l.relatorioId, url: l.url, situacao: l.situacao, vale_ate: l.validoAte, acessos: l.acessos })),
      };
    },
  },
  {
    name: "plataforma_publicar_raio_x",
    description:
      "Publica o relatório do raio-X para o DONO: marca o rascunho como REVISADO (com as anotações da Time, que o dono não vê) e gera o link do dono, que abre sem login, vale 7, 30 ou 90 dias (`dias`, padrão 30) e pode ser revogado. Sem `relatorio_id`, o relatório mais novo. Com `revogar_link_id`, só revoga aquele link. " +
      "O link do dono mostra os números, os pontos a melhorar, a evolução e o próximo passo; não mostra o custo da análise, as anotações da Time nem o bloco do que a MIA resolveria. " +
      "ANTES DE publicar, alguém da Time precisa ter LIDO o relatório (os trechos de conversa estão na tela de Admin): a classificação automática erra às vezes, e o dono não pode receber um número errado. O QUE NÃO FAZ: não manda o link a ninguém (quem manda é a Time).",
    inputSchema: {
      raio_x_id: z.string().uuid().describe("O raio-X."),
      relatorio_id: z.string().uuid().optional().describe("O relatório; sem ele, o mais novo do raio-X."),
      notas: z.string().max(4000).optional().describe("As anotações da revisão (só a Time vê)."),
      dias: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional().describe("Validade do link do dono: 7, 30 ou 90 dias. Padrão 30."),
      revogar_link_id: z.string().uuid().optional().describe("Em vez de publicar, revoga este link do dono."),
    },
    exemplo: { raio_x_id: "00000000-0000-4000-8000-000000000101", dias: 30, notas: "Conferi as dez conversas de exemplo." },
    operacao: OPERACAO,
    handler: async (ctx, args) => {
      const raioXId = String(args.raio_x_id);
      if (typeof args.revogar_link_id === "string") {
        const r = await acaoRevogarLinkDoDono(ctx.admin, raioXId, args.revogar_link_id, ctx.autorUserId);
        if (!r.ok) recusar(fraseDaRecusa(r));
        void audit({
          action: "raio_x.link_do_dono_revogado",
          actorUserId: ctx.autorUserId,
          actingAsPlatformAdmin: true,
          resourceType: "mia_raio_x_links",
          resourceId: r.link.id,
          requestId: ctx.requestId,
          metadata: { raio_x_id: raioXId, via: "mcp", token_id: ctx.tokenId },
        });
        return { revogado: true, link: { id: r.link.id, situacao: r.link.situacao } };
      }
      const relatorioId = typeof args.relatorio_id === "string" ? args.relatorio_id : null;
      const revisado = await acaoRevisar(ctx.admin, raioXId, relatorioId, ctx.autorUserId, typeof args.notas === "string" ? args.notas : null);
      if (!revisado.ok) recusar(fraseDaRecusa(revisado));
      if (!revisado.jaEstava) {
        void audit({
          action: "raio_x.relatorio_revisado",
          actorUserId: ctx.autorUserId,
          actingAsPlatformAdmin: true,
          resourceType: "mia_raio_x",
          resourceId: raioXId,
          requestId: ctx.requestId,
          metadata: { relatorio_id: revisado.relatorioId, via: "mcp", token_id: ctx.tokenId },
        });
      }
      const link = await acaoGerarLinkDoDono(ctx.admin, raioXId, revisado.relatorioId, args.dias, ctx.autorUserId, "mcp_plataforma");
      if (!link.ok) recusar(fraseDaRecusa(link));
      void audit({
        action: "raio_x.link_do_dono_gerado",
        actorUserId: ctx.autorUserId,
        actingAsPlatformAdmin: true,
        resourceType: "mia_raio_x_links",
        resourceId: link.link.id,
        requestId: ctx.requestId,
        metadata: { raio_x_id: raioXId, relatorio_id: link.relatorioId, valido_ate: link.link.validoAte, via: "mcp", token_id: ctx.tokenId },
      });
      return { relatorio_id: link.relatorioId, revisado: true, link_do_dono: { id: link.link.id, url: link.link.url, vale_ate: link.link.validoAte } };
    },
  },
  {
    name: "plataforma_encerrar_raio_x",
    description:
      "Encerra um raio-X: derruba a conexão agora (o aparelho \"Raio-X Time Company\" sai da lista de Aparelhos conectados do dono e a sessão do leitor é apagada, com o histórico que ela guardou), para a leitura e a análise e agenda a exclusão das conversas lidas para daqui a 30 dias (ou o prazo do relatório, se vier antes). " +
      "O relatório, o aceite do termo e o custo FICAM guardados, sem telefone de cliente, para comparar com o próximo raio-X da mesma empresa. No diagnóstico único a conexão já cai sozinha 7 dias depois do relatório; encerrar serve para antecipar, ou para parar o acompanhamento mensal. " +
      "O QUE NÃO FAZ: não apaga o relatório nem revoga os links do dono (revogue com plataforma_publicar_raio_x e `revogar_link_id`).",
    inputSchema: {
      raio_x_id: z.string().uuid().describe("O raio-X a encerrar."),
    },
    exemplo: { raio_x_id: "00000000-0000-4000-8000-000000000101" },
    operacao: OPERACAO,
    handler: async (ctx, args) => {
      const raioXId = String(args.raio_x_id);
      const r = await acaoEncerrar(ctx.admin, raioXId, ctx.autorUserId);
      if (!r.ok) recusar(fraseDaRecusa(r));
      if (!r.jaEstava) {
        void audit({
          action: "raio_x.encerrado",
          actorUserId: ctx.autorUserId,
          actingAsPlatformAdmin: true,
          resourceType: "mia_raio_x",
          resourceId: raioXId,
          requestId: ctx.requestId,
          metadata: { falha_no_leitor: r.falhaNoLeitor, apagar_conversas_em: r.apagarConversasEm, via: "mcp", token_id: ctx.tokenId },
        });
      }
      return {
        encerrado: true,
        ja_estava: r.jaEstava,
        desconectou: r.desconectou,
        aviso: r.falhaNoLeitor ? "O leitor não respondeu ao desconectar: o dono pode tirar o aparelho em WhatsApp › Aparelhos conectados." : null,
        conversas_apagam_em: r.apagarConversasEm,
      };
    },
  },
  // FORK MIA (.105) · ler de novo.
  {
    name: "plataforma_reler_raio_x",
    description:
      "Lê DE NOVO um raio-X pronto cujo WhatsApp continua conectado (pela conexão; o diagnóstico único fica conectado 7 dias depois do relatório): o rascunho deste período sai e a leitura volta ao começo, esperando o histórico do aparelho, e depois vem a análise e um rascunho novo. " +
      "Serve quando a leitura fechou antes de o histórico chegar (o relatório veio com 0 ou poucas conversas). ANTES DE reler, veja em plataforma_ver_raio_x o `aparelho.conversas_agora`: se o leitor ainda mostra 0 conversas, reler não adianta. " +
      "O QUE NÃO FAZ: não relê raio-X do cliente ativo, desconectado, encerrado, ainda em andamento, nem período cujo relatório já foi revisado (aí é encerrar e criar outro); não pede nada ao dono; não envia mensagem. As conversas já guardadas não se repetem e a análise já feita é reaproveitada.",
    inputSchema: {
      raio_x_id: z.string().uuid().describe("O raio-X a ler de novo."),
    },
    exemplo: { raio_x_id: "00000000-0000-4000-8000-000000000101" },
    operacao: OPERACAO,
    handler: async (ctx, args) => {
      const raioXId = String(args.raio_x_id);
      const r = await acaoLerDeNovo(ctx.admin, raioXId);
      if (!r.ok) recusar(fraseDaRecusa(r));
      void audit({
        action: "raio_x.relido",
        actorUserId: ctx.autorUserId,
        actingAsPlatformAdmin: true,
        resourceType: "mia_raio_x",
        resourceId: raioXId,
        requestId: ctx.requestId,
        metadata: { rascunhos_descartados: r.descartados, via: "mcp", token_id: ctx.tokenId },
      });
      return {
        relendo: true,
        rascunhos_descartados: r.descartados,
        proximo: "A leitura recomeça na próxima rodada do agendador (a cada minuto). Acompanhe com plataforma_ver_raio_x.",
      };
    },
  },
  // FORK MIA (.106) · o preço da nova análise do raio-X por cadastro.
  {
    name: "plataforma_precos_do_raio_x",
    description:
      "Vê e define o PREÇO da NOVA ANÁLISE do raio-X por cadastro (a primeira é sempre grátis). Dois tipos: avulsa (uma análise dos últimos 30 dias, paga uma vez, cobrança única no Asaas da MIA) e mensal (assinatura: uma análise todo dia 1, com a evolução). " +
      "Sem `tipo`: só mostra os preços. Com `tipo` e `valor_centavos` (de 500 a 1000000, isto é, de R$ 5 a R$ 10 mil): define o preço; `ativo` false guarda o preço sem vender; `valor_centavos` null tira o preço. " +
      "Sem preço ativo, quem pede a nova análise na área vira INTERESSE (o lead no CRM da Time e o aviso dizem que a pessoa quer, e a equipe fala com ela). Com preço, a área cria a cobrança (avulsa) ou a assinatura (mensal) no Asaas e manda a pessoa para a fatura (Pix, boleto ou cartão). " +
      "ANTES DE definir, confira o custo medido dos raio-X (plataforma_ver_raio_x, o custo de cada um) e se o Asaas da MIA já está em produção: com a chave de teste, a cobrança sai no sandbox. O QUE NÃO FAZ: não cria cobrança, não cobra ninguém e não muda pedido que já existe (o pedido guarda o valor de quando foi feito).",
    inputSchema: {
      tipo: z.enum(["avulsa", "mensal"]).optional().describe("O tipo cujo preço muda: avulsa ou mensal. Sem ele, só mostra os preços."),
      valor_centavos: z.number().int().min(500).max(1_000_000).nullable().optional().describe("O preço em centavos de real (7900 = R$ 79). null tira o preço do tipo."),
      ativo: z.boolean().optional().describe("false guarda o preço sem vender (o pedido vira interesse). Padrão true."),
    },
    exemplo: { tipo: "avulsa", valor_centavos: 7900, ativo: true },
    operacao: OPERACAO,
    handler: async (ctx, args) => {
      const mostrar = (precos: Awaited<ReturnType<typeof lerPrecos>>) =>
        (["avulsa", "mensal"] as const).map((tipo) => {
          const p = precos.find((x) => x.tipo === tipo);
          return { tipo, reais: p ? reaisParaLer(Number(p.valor_centavos)) : null, valor_centavos: p ? Number(p.valor_centavos) : null, vendendo: Boolean(p?.ativo) };
        });
      if (typeof args.tipo !== "string") return { precos: mostrar(await lerPrecos(ctx.admin)) };
      if (args.valor_centavos === undefined) recusar("Para mudar o preço, mande valor_centavos (ou null para tirar o preço).");
      const r = await definirPreco(ctx.admin, { tipo: args.tipo, valor_centavos: args.valor_centavos, ...(typeof args.ativo === "boolean" ? { ativo: args.ativo } : {}) }, ctx.autorUserId);
      if (!r.ok) recusar(`Confira os campos: ${r.campos.join(", ")}.`);
      void audit({
        action: "raio_x.precos_alterados",
        actorUserId: ctx.autorUserId,
        actingAsPlatformAdmin: true,
        resourceType: "mia_raio_x_precos",
        resourceId: null,
        requestId: ctx.requestId,
        metadata: { via: "mcp", token_id: ctx.tokenId, tipo: args.tipo, valor_centavos: args.valor_centavos, ativo: args.ativo ?? true },
      });
      return { definido: true, precos: mostrar(r.precos) };
    },
  },
];

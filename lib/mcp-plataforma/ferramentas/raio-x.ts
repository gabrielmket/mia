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
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { organizacaoDaImplantacao } from "@/lib/implantacao/base";
import {
  acaoCriar,
  acaoEncerrar,
  acaoGerarLinkDoDono,
  acaoRevisar,
  acaoRevogarLinkDoDono,
  acaoVer,
  fraseDaRecusa,
} from "@/lib/raio-x/acoes";
import { listarRaioX, type LinhaDoRelatorio } from "@/lib/raio-x/banco";
import { reaisParaLer } from "@/lib/raio-x/custo";
import { QUEM_ATENDE, SEGMENTOS, TIPOS } from "@/lib/raio-x/regras";
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
    ...(comMia ? { o_que_a_mia_resolveria: d.mia } : {}),
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

export const FERRAMENTAS_DO_RAIO_X: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_criar_raio_x",
    description:
      "Cadastra o RAIO-X DO ATENDIMENTO de uma empresa (que NÃO precisa ser cliente da MIA: é a isca comercial) e devolve o link de conexão, que vale 48 horas, e a mensagem pronta para mandar ao dono. " +
      "O dono abre o link sem login, aceita o termo (fica registrado com nome, data, hora e versão) e conecta o WhatsApp comercial pelo código de 8 letras, com o QR como alternativa. O sistema lê só para leitura as conversas 1:1 do período, transcreve os áudios e gera o relatório em RASCUNHO. " +
      "`segmento` muda o que o relatório procura nas conversas; o horário comercial separa o que chegou com a loja aberta e fechada; `tipo` unico desconecta 7 dias depois do relatório e mensal fica conectado e gera um relatório no dia 1 de cada mês; `teto_centavos` é o teto de custo da análise (padrão 4000 = R$ 40). " +
      "ANTES DE criar, confira com o dono que o número é o aplicativo do WhatsApp (comum ou Business): número na API oficial não conecta assim. O QUE NÃO FAZ: não manda a mensagem a ninguém (quem manda é a Time) e não lê nada antes do aceite.",
    inputSchema: {
      empresa: z.string().trim().min(1).max(120).describe("O nome da empresa, como vai no relatório."),
      segmento: z.enum(SEGMENTOS).describe("O segmento: revenda_de_veiculos, clinica_odontologica, clinica_de_estetica, academia, imobiliaria, loja_e_varejo ou outro."),
      whatsapp: z.string().trim().min(8).max(32).describe("O WhatsApp COMERCIAL que vai ser lido. Do Brasil, com DDD: (31) 90000-1101; de fora, com +."),
      responsavel_nome: z.string().trim().max(120).nullable().optional().describe("Quem autoriza (o dono ou responsável). Vai na mensagem pronta."),
      responsavel_contato: z.string().trim().max(160).nullable().optional().describe("WhatsApp ou e-mail de quem autoriza, para a Time mandar o link."),
      quem_atende: z.enum(QUEM_ATENDE).optional().describe("Quem atende hoje: humano (pessoas da loja), agente (automático) ou misto. Padrão humano."),
      periodo_dias: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional().describe("Quantos dias de conversa ler: 30, 60 ou 90 (padrão 90; o WhatsApp entrega cerca de 3 meses)."),
      tipo: z.enum(TIPOS).optional().describe("unico (diagnóstico) ou mensal (acompanhamento). Padrão unico."),
      abre: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("Abre às, de segunda a sexta (HH:MM). Padrão 08:00."),
      fecha: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("Fecha às, de segunda a sexta (HH:MM). Padrão 18:00."),
      sabado_ate: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional().describe("Até que horas abre no sábado (HH:MM); null = não abre. Padrão 13:00."),
      organization_id: z.string().uuid().nullable().optional().describe("A empresa da MIA, quando ela já é cliente (opcional; dá para ligar depois pela tela)."),
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
        metadata: { via: "mcp", token_id: ctx.tokenId },
      });
      return { raio_x_id: r.id, empresa: r.empresa, link: r.link, link_vale_ate: r.expiraEm, mensagem_pronta: r.mensagem };
    },
  },
  {
    name: "plataforma_ver_raio_x",
    description:
      "Os raio-X do atendimento. Sem `raio_x_id`: a lista (empresa, situação, andamento, se há relatório e se é o 2º da mesma empresa). Com `raio_x_id`: a situação da conexão (aguardando o dono, conectando, lendo, analisando, pronto, encerrado), o andamento da leitura, o aceite, o link de conexão vigente, o custo medido e o teto, " +
      "os relatórios com os números (velocidade da primeira resposta com a loja aberta e fechada, sem resposta, sumiram sem retorno, origem, assuntos, desfecho, nota nos cinco critérios, recomendações e o bloco do que a MIA resolveria), a EVOLUÇÃO em proporção desde o raio-X anterior da mesma empresa, e os links do dono. " +
      "Os clientes aparecem só por número de ordem, nunca por telefone ou nome; os trechos de conversa ficam na tela de Admin.",
    inputSchema: {
      raio_x_id: z.string().uuid().optional().describe("Só este raio-X, com o detalhe e os relatórios."),
    },
    exemplo: {},
    operacao: null,
    handler: async (ctx, args) => {
      if (typeof args.raio_x_id !== "string") {
        const lista = await listarRaioX(ctx.admin);
        return {
          raio_x: lista.map((x) => ({
            id: x.id,
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
      return {
        raio_x: d.raioX,
        conexao: d.conexao ? { link: d.conexao.link, vale_ate: d.conexao.expiraEm, vivo: d.conexao.vivo, mensagem_pronta: d.conexao.mensagem } : null,
        aceite: d.aceite,
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
];

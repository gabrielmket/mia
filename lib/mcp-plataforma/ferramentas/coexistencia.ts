/**
 * FORK MIA (S3) · A COEXISTÊNCIA DO WHATSAPP NO MCP DE PLATAFORMA
 * (docs/fork/coexistencia.md; tabela em docs/fork/mcp-de-implantacao.md).
 *
 *   plataforma_ver_coexistencia          leitura: a chave da empresa e os números pelo app
 *   plataforma_ligar_coexistencia        `colocar_no_ar`: liga ou desliga a chave (com ela, a empresa
 *                                        conecta pela API o número do app e a IA passa a atender
 *                                        por ele; é a régua das ferramentas que "ligam" algo)
 *   plataforma_ver_sincronizacao_do_app  leitura: os dois pedidos (contatos e histórico) por número
 *
 * FORA, de propósito: conectar o número (é credencial e acesso, e só a janela
 * da Meta no navegador do cliente faz) e pedir a sincronização de novo (não
 * existe por desenho: a Meta aceita uma vez só por conexão).
 *
 * A regra mora em `lib/channels/meta/coexistencia/` (`ligar.ts`, `leitura.ts`),
 * a mesma da tela de /admin/meta; aqui só a forma do pedido.
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { configuracaoDaJanela } from "@/lib/channels/meta/coexistencia/janela";
import { estadoDaCoexistencia, type NumeroPeloApp } from "@/lib/channels/meta/coexistencia/leitura";
import { ligarCoexistencia } from "@/lib/channels/meta/coexistencia/ligar";
import { organizacaoDaImplantacao } from "@/lib/implantacao/base";

import { recusar } from "../recusa";
import type { FerramentaDePlataforma } from "../tipos";
import { ORGANIZACAO, ORG_DE_EXEMPLO } from "./comum";

/**
 * S4: o estado em uma palavra, como a tela mostra. `de_volta` é o número que
 * saiu do ar e voltou (`ACCOUNT_RECONNECTED`) no MESMO ciclo: mesma sessão,
 * mesmos contatos, conversas e cartões.
 */
export function situacaoDoNumero(n: Pick<NumeroPeloApp, "estado" | "voltouEm">): "no_ar" | "de_volta" | "fora_do_ar" | "encerrada" {
  if (n.estado === "no_ar") return n.voltouEm ? "de_volta" : "no_ar";
  return n.estado;
}

function numeroResumido(n: NumeroPeloApp) {
  return {
    conexao_id: n.conexaoId,
    numero: n.phoneNumber ?? n.phoneNumberId,
    estado: n.estado,
    situacao: situacaoDoNumero(n),
    aberta_por: n.abertaPor,
    conectada_em: n.conectadaEm,
    fora_do_ar_motivo: n.foraDoArMotivo,
    fora_do_ar_iniciado_por: n.foraDoArIniciadoPor,
    fora_do_ar_em: n.foraDoArEm,
    voltou_em: n.voltouEm,
    ultimo_aviso_da_meta_em: n.ultimoEventoEm,
  };
}

export const FERRAMENTAS_DA_COEXISTENCIA: readonly FerramentaDePlataforma[] = [
  {
    name: "plataforma_ver_coexistencia",
    description:
      "Mostra a COEXISTÊNCIA DO WHATSAPP de um cliente: o mesmo número no app WhatsApp Business do celular e na MIA. " +
      "Traz a chave da empresa (`ligada`: com ela, a tela Conexões › API Oficial (Meta) mostra o botão \"Conectar pelo app WhatsApp Business\"; " +
      "nasce desligada), quem mudou e quando, se a instalação tem o app da Meta configurado para abrir a janela (`janela_configurada`, e o que falta no ambiente), " +
      "e os números conectados pelo app, com o estado (`no_ar`, `fora_do_ar`, `encerrada`) e a `situacao` (`no_ar`, `de_volta` = saiu do ar e voltou no mesmo ciclo, " +
      "`fora_do_ar`, `encerrada`), a data da conexão, quando saiu do ar e por quê (`fora_do_ar_motivo`, o código da Meta: ACCOUNT_DISCONNECTED = o dono desconectou no app, " +
      "BUSINESS_DOWNGRADE, CHANGE_NUMBER, COMPANION_INACTIVITY = aparelho conectado parado ~30 dias, PRIMARY_INACTIVITY = celular sem abrir o app ~14 dias, " +
      "USER_RE_REGISTERED, ACCOUNT_OFFBOARDED; `fora_do_ar_iniciado_por` USER ou SYSTEM) e quando voltou (`voltou_em`). " +
      "Fora do ar, nada sai pela MIA por esse número; para voltar, o dono abre o app e conecta de novo pela tela (conectar é credencial, fica fora do MCP). " +
      "Para os contatos e o histórico que a Meta mandou: plataforma_ver_sincronizacao_do_app. Para ligar a chave: plataforma_ligar_coexistencia.",
    inputSchema: { organization_id: ORGANIZACAO },
    exemplo: { organization_id: ORG_DE_EXEMPLO },
    operacao: null,
    handler: async (ctx, args) => {
      const org = await organizacaoDaImplantacao(ctx.admin, String(args.organization_id));
      const estado = await estadoDaCoexistencia(ctx.admin, org.id);
      const janela = configuracaoDaJanela();
      return {
        empresa: org.display_name,
        ligada: estado.chave.ligada,
        mudada_por_user_id: estado.chave.mudadaPor,
        mudada_em: estado.chave.mudadaEm,
        janela_configurada: janela.ok,
        falta_no_ambiente: janela.ok ? [] : janela.faltaNoAmbiente,
        numeros_pelo_app: estado.numeros.map(numeroResumido),
        ...(org.demonstracao
          ? { aviso: "Empresa de demonstração: não conecta número de verdade (a migration 9010 recusa canal vivo nela)." }
          : {}),
      };
    },
  },

  {
    name: "plataforma_ligar_coexistencia",
    description:
      "LIGA ou DESLIGA a chave da COEXISTÊNCIA DO WHATSAPP de um cliente. Ligada, a tela Conexões › API Oficial (Meta) do cliente passa a mostrar " +
      "\"Conectar pelo app WhatsApp Business\", com o aviso de limites e custos; quem conecta é o próprio cliente, pela janela da Meta, com o celular na mão. " +
      "Chamar de novo com o mesmo valor responde `ja_estava` e não muda quem ligou nem quando. " +
      "DESLIGAR não derruba o número já conectado: só esconde o botão (a resposta lista os números que continuam; tirá-los é pelo app ou por Conexões). " +
      "Recusa: empresa que não está operando e empresa de demonstração (a migration 9010 não deixa nascer canal vivo nela). " +
      "O QUE NÃO FAZ: não conecta número e não pede a sincronização (a Meta aceita uma vez só, logo depois da conexão).",
    inputSchema: {
      organization_id: ORGANIZACAO,
      ligada: z.boolean().describe("true liga (mostra o botão), false desliga (esconde o botão; o número conectado continua)."),
    },
    exemplo: { organization_id: ORG_DE_EXEMPLO, ligada: true },
    operacao: "colocar_no_ar",
    handler: async (ctx, args) => {
      const org = await organizacaoDaImplantacao(ctx.admin, String(args.organization_id));
      if (typeof args.ligada !== "boolean") recusar("Informe `ligada`: true para ligar, false para desligar.");
      const ligada = args.ligada === true;
      const r = await ligarCoexistencia(ctx.admin, { organizationId: org.id, ligada, userId: ctx.autorUserId });
      if (!r.ok) recusar(r.mensagem);
      if (!r.jaEstava) {
        const organizationId = org.id;
        void audit({
          action: "platform.coexistencia_alterada",
          actorUserId: ctx.autorUserId,
          organizationId,
          resourceType: "organization",
          resourceId: organizationId,
          requestId: ctx.requestId,
          metadata: { ligada, via: "mcp_plataforma", numeros_que_continuam: r.numerosQueContinuam.length },
        });
      }
      return {
        empresa: org.display_name,
        ligada: r.chave.ligada,
        ja_estava: r.jaEstava,
        mudada_em: r.chave.mudadaEm,
        ...(r.numerosQueContinuam.length > 0
          ? {
              numeros_que_continuam: r.numerosQueContinuam,
              aviso: "O botão sumiu, mas estes números continuam conectados pelo app: para tirá-los, é pelo app ou por Conexões.",
            }
          : {}),
      };
    },
  },

  {
    name: "plataforma_ver_sincronizacao_do_app",
    description:
      "Mostra a SINCRONIZAÇÃO DO APP WhatsApp Business de cada número que o cliente conectou pela coexistência: os dois pedidos que a MIA faz à Meta " +
      "logo depois da conexão (`contatos` e `historico`, até 180 dias), cada um UMA vez só e até 24 horas depois da conexão (`prazo_da_sincronizacao`). " +
      "Por pedido: o estado (`pedindo`, `pedida`, `em_andamento`, `concluida`, `falhou`, `recusada_pelo_dono` = o dono não compartilhou o histórico, " +
      "`sem_resposta` = a MIA pediu e não soube se a Meta aceitou, `prazo_vencido`), quando foi pedido e respondido, o `request_id` da Meta (para o suporte dela), " +
      "o código e o título do erro, o progresso e a fase do histórico, e as contagens (contatos, conversas criadas, mensagens novas e já existentes, mídias, lotes que desistiram). " +
      "Só contagens: nenhum nome, telefone de contato ou texto de conversa. NÃO existe pedir de novo: a Meta só aceita outra vez se o cliente desconectar no app e conectar de novo.",
    inputSchema: { organization_id: ORGANIZACAO },
    exemplo: { organization_id: ORG_DE_EXEMPLO },
    operacao: null,
    handler: async (ctx, args) => {
      const org = await organizacaoDaImplantacao(ctx.admin, String(args.organization_id));
      const estado = await estadoDaCoexistencia(ctx.admin, org.id);
      return {
        empresa: org.display_name,
        numeros: estado.numeros.map((n) => ({
          ...numeroResumido(n),
          prazo_da_sincronizacao: n.prazoDaSincronizacao,
          pedidos: n.pedidos.map((p) => ({
            tipo: p.tipo,
            estado: p.estado,
            pedida_em: p.pedidaEm,
            respondida_em: p.respondidaEm,
            concluida_em: p.concluidaEm,
            request_id: p.requestId,
            erro_codigo: p.erroCodigo,
            erro_titulo: p.erroTitulo,
            progresso: p.progresso,
            fase: p.fase,
            contatos_recebidos: p.contatosRecebidos,
            conversas_recebidas: p.conversasRecebidas,
            mensagens_recebidas: p.mensagensRecebidas,
            mensagens_existentes: p.mensagensExistentes,
            midias_guardadas: p.midiasGuardadas,
            lotes_com_falha: p.lotesComFalha,
          })),
        })),
        ...(estado.numeros.length === 0 ? { aviso: "Nenhum número conectado pelo app WhatsApp Business nesta empresa." } : {}),
      };
    },
  },
];

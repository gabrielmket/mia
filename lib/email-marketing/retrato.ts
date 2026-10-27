/**
 * FORK MIA (.89) — O RETRATO da configuração do disparo de e-mail de uma
 * empresa: o que a tela de Configurações mostra e o que
 * `plataforma_ver_email_marketing` devolve. Um retrato, dois leitores: a tela e
 * o MCP dizem a mesma coisa sobre o mesmo cliente.
 *
 * Só leitura, e NUNCA leva segredo: da Amazon, só "ligado" e o nome do que falta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerSaldoDaCarteira } from "@/lib/carteira/ler-saldo";

import {
  estadoDoModulo,
  lerConfiguracao,
  lerEmpresa,
  lerPrecoPorEmail,
  lerRemetentes,
} from "./banco";
import { registrosDoDominio } from "./dominio";
import { versoesDoTexto } from "./consentimentos";
import {
  DEGRAUS_DO_AQUECIMENTO,
  LIMITE_DA_AMAZON_RECLAMACAO_PCT,
  LIMITE_DA_AMAZON_REJEICAO_PCT,
  TRAVA_RECLAMACAO_PCT,
  TRAVA_REJEICAO_PCT,
} from "./regras";
import { taxasDoEnvio, tetoDoDegrau, type NumerosDoDia } from "./ritmo";
import { MARCA_DE_RASCUNHO, TEXTO_PADRAO_DE_PRIVACIDADE, comEmpresa } from "./textos-padrao";

async function quantas(
  consulta: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const { count, error } = await consulta;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** A saúde dos últimos 30 dias, de todas as campanhas da empresa. */
export async function saudeDosUltimos30Dias(
  db: SupabaseClient,
  orgId: string,
  agora = new Date(),
): Promise<NumerosDoDia & { rejeicaoPct: number; reclamacaoPct: number }> {
  const desde = new Date(agora.getTime() - 30 * 86_400_000).toISOString();
  const base = () =>
    db
      .from("mia_email_destinatarios")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("enviado_em", desde);
  const [enviados, entregues, rejeicoes, reclamacoes] = await Promise.all([
    quantas(base().in("status", ["enviado", "entregue", "rejeitado", "reclamacao"])),
    quantas(base().in("status", ["entregue", "reclamacao"])),
    quantas(base().eq("status", "rejeitado")),
    quantas(base().eq("status", "reclamacao")),
  ]);
  const n = { enviados, entregues, rejeicoes, reclamacoes };
  return { ...n, ...taxasDoEnvio(n) };
}

export async function retratoDaConfiguracao(db: SupabaseClient, orgId: string) {
  const empresa = await lerEmpresa(db, orgId);
  const [estado, config, remetentes, preco, saldo, saude, supressao, versoes] = await Promise.all([
    estadoDoModulo(db, orgId),
    lerConfiguracao(db, empresa),
    lerRemetentes(db, orgId),
    lerPrecoPorEmail(db, orgId),
    lerSaldoDaCarteira(db, orgId),
    saudeDosUltimos30Dias(db, orgId),
    quantas(
      db
        .from("campaign_suppressions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("tipo_de_endereco", "email"),
    ),
    versoesDoTexto(db, orgId),
  ]);
  const d = estado.dominio;
  const registros = d
    ? registrosDoDominio({
        dominio: d.dominio,
        dkimTokens: d.dkimTokens,
        subdominioDeRetorno: d.subdominioDeRetorno,
        regiao: d.regiao,
      }).map((r) => ({
        ...r,
        ok: d.registros[r.id] === true,
      }))
    : [];
  return {
    empresa: {
      id: empresa.id,
      nome: empresa.nome,
      demonstracao: empresa.demonstracao,
      fuso: empresa.fuso,
    },
    modulo: { contratado: estado.contratado },
    amazon: {
      configurado: estado.amazon.configurado,
      falta: estado.amazon.falta,
      regiao: estado.amazon.regiao,
    },
    preco: { por_email_cents: preco.cents, padrao: preco.padrao, origem: preco.origem },
    saldo_cents: saldo.saldo_cents,
    dominio: d
      ? {
          dominio: d.dominio,
          subdominio_de_retorno: d.subdominioDeRetorno,
          verificado: d.verificado,
          faltam: d.faltam,
          registros,
          conferido_em: d.conferidoEm,
          verificado_em: d.verificadoEm,
          erro: d.erro,
        }
      : null,
    remetentes,
    responder_para: config.responderPara,
    rodape: config.rodape,
    rodape_completo: estado.rodapeCompleto,
    privacidade_padrao: {
      marca: MARCA_DE_RASCUNHO,
      texto: TEXTO_PADRAO_DE_PRIVACIDADE.map((p) => comEmpresa(p, empresa.nome)),
    },
    ritmo_por_hora: config.ritmoPorHora,
    janela: [config.janelaInicio, config.janelaFim] as [number, number],
    so_dias_uteis: config.soDiasUteis,
    aquecimento: {
      degrau: d?.degrau ?? 0,
      degraus: [...DEGRAUS_DO_AQUECIMENTO],
      teto_do_proximo_dia: tetoDoDegrau(d?.degrau ?? 0, 0),
      ultimo_dia_de_envio: d?.ultimoDiaDeEnvio ?? null,
      concluido: (d?.degrau ?? 0) >= DEGRAUS_DO_AQUECIMENTO.length,
    },
    saude_30_dias: {
      ...saude,
      trava: { rejeicao_pct: TRAVA_REJEICAO_PCT, reclamacao_pct: TRAVA_RECLAMACAO_PCT },
      limite_da_amazon: {
        rejeicao_pct: LIMITE_DA_AMAZON_REJEICAO_PCT,
        reclamacao_pct: LIMITE_DA_AMAZON_RECLAMACAO_PCT,
      },
    },
    supressao_total: supressao,
    textos_de_consentimento: versoes,
    pronto_para_enviar: estado.prontoParaEnviar,
    pendencias: estado.pendencias,
  };
}

export type RetratoDaConfiguracao = Awaited<ReturnType<typeof retratoDaConfiguracao>>;

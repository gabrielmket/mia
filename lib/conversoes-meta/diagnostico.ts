/**
 * FORK MIA — o DIAGNÓSTICO da Meta: "a Meta está recebendo?", em seis conferências.
 *
 * Até aqui só o Google Ads tinha diagnóstico (`lerDiagnosticoGoogle`, do
 * upstream); a Meta falhava em silêncio. Aqui juntam-se duas fontes:
 *
 *   · o que a META responde agora (`conferirConexaoNaMeta`): o token é aceito,
 *     o destino de conversões existe e o token o alcança, o que o token pode;
 *   · o que o LIVRO-RAZÃO sabe: há quanto tempo a Meta aceitou um envio, e o que
 *     ela recusou nos últimos 7 dias, com o motivo.
 *
 * Nenhum evento é enviado por um diagnóstico: as três perguntas à Meta são de
 * leitura. E o token nunca sai daqui: nem no retorno, nem em log.
 *
 * ── Evidência vence inferência ──────────────────────────────────────────────
 *
 * A Meta não diz "este token pode enviar para este destino" numa leitura. O que
 * dá para ler é a lista de permissões do token, e um token gerado dentro do
 * próprio destino de conversões envia sem aparecer nela. Por isso um envio
 * ACEITO nos últimos 7 dias conta mais que a lista: se a Meta aceitou, o token
 * pode.
 *
 * Quem decide a FRASE de cada caso é `./diagnostico-frases.ts` (puro): a tela
 * traduz por ali, e a ferramenta do MCP lê o mesmo texto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerCredencial } from "@/lib/plataformas-de-anuncio/credenciais";
import {
  conferirConexaoNaMeta,
  PERMISSOES_DE_ENVIO,
  type ConexaoNaMeta,
} from "@/lib/plataformas-de-anuncio/meta/diagnostico-de-conversoes";

import {
  DETALHE_DO_CASO,
  SAUDE_DO_CASO,
  TITULO_DO_CASO,
  type CasoDoDiagnostico,
  type SaudeDoItem,
  type VereditoDoDiagnostico,
} from "./diagnostico-frases";
import { rotuloDoEnvioDaMeta } from "./rotulo";

const DIA_MS = 24 * 60 * 60 * 1000;

export interface ItemDoDiagnosticoDaMeta {
  /** A pergunta que o item responde. Estável: a tela usa como chave. */
  chave: "conexao" | "token" | "destino" | "permissao" | "ultimo_envio" | "recusados" | "modo_de_teste";
  caso: CasoDoDiagnostico;
  saude: SaudeDoItem;
  /** O dado variável do item, que não se traduz: o nome do destino, a frase da Meta. */
  dado: string | null;
  /** Só em `ultimo_envio`: quando, qual evento e de qual negócio. */
  ultimo?: { em: string; evento: string; negocio: string | null; leadId: string };
  /** Só em `recusados`: quantos, e os motivos agrupados (a resposta da Meta). */
  recusados?: { total: number; motivos: Array<{ motivo: string; quantos: number }> };
}

export interface DiagnosticoDaMeta {
  itens: ItemDoDiagnosticoDaMeta[];
  veredito: VereditoDoDiagnostico;
  testadoEm: string;
}

function item(
  chave: ItemDoDiagnosticoDaMeta["chave"],
  caso: CasoDoDiagnostico,
  dado: string | null = null,
  extra: Partial<Pick<ItemDoDiagnosticoDaMeta, "ultimo" | "recusados">> = {},
): ItemDoDiagnosticoDaMeta {
  return { chave, caso, saude: SAUDE_DO_CASO[caso], dado, ...extra };
}


/** O que a Meta respondeu, nos três itens que dependem dela. */
function itensDaMeta(conexao: ConexaoNaMeta, datasetId: string, aceitouHaPouco: boolean): ItemDoDiagnosticoDaMeta[] {
  const itens: ItemDoDiagnosticoDaMeta[] = [];

  if (conexao.token.estado === "aceito") itens.push(item("token", "token_aceito"));
  else if (conexao.token.estado === "recusado") itens.push(item("token", "token_recusado", conexao.token.detalhe));
  else itens.push(item("token", "token_nao_conferido", conexao.token.detalhe));

  const d = conexao.destino;
  if (d.estado === "encontrado") {
    itens.push(item("destino", "destino_encontrado", d.nome ? `"${d.nome}" · ${datasetId}` : datasetId));
  } else if (d.estado === "nao_encontrado") itens.push(item("destino", "destino_nao_encontrado", d.detalhe));
  else if (d.estado === "sem_acesso") itens.push(item("destino", "destino_sem_acesso", d.detalhe));
  else itens.push(item("destino", "destino_nao_conferido", d.detalhe));

  if (d.estado !== "encontrado") {
    itens.push(item("permissao", "permissao_nao_conferida"));
  } else if (
    aceitouHaPouco ||
    (conexao.permissoes.estado === "lidas" &&
      conexao.permissoes.concedidas.some((p) => (PERMISSOES_DE_ENVIO as readonly string[]).includes(p)))
  ) {
    itens.push(item("permissao", "permissao_de_envio"));
  } else if (conexao.permissoes.estado === "lidas") {
    itens.push(
      item("permissao", "permissao_nao_listada", conexao.permissoes.concedidas.slice(0, 12).join(", ") || null),
    );
  } else {
    itens.push(item("permissao", "permissao_nao_conferida"));
  }

  return itens;
}

/**
 * Roda o diagnóstico. LANÇA quando o livro-razão não pôde ser lido: banco
 * indisponível não é "zero recusas".
 *
 * `conferir` existe para o teste trocar a ida à Meta por um dublê.
 */
export async function diagnosticarConexaoDaMeta(
  admin: SupabaseClient,
  organizationId: string,
  opcoes: { agora?: Date; conferir?: typeof conferirConexaoNaMeta } = {},
): Promise<DiagnosticoDaMeta> {
  const agora = opcoes.agora ?? new Date();
  const conferir = opcoes.conferir ?? conferirConexaoNaMeta;
  const semana = new Date(agora.getTime() - 7 * DIA_MS).toISOString();

  const [credencial, ultimo, recusas, teste] = await Promise.all([
    lerCredencial(admin, organizationId, "meta_ads"),
    admin
      .from("ad_conversion_dispatches")
      .select("lead_id, event_name, meta_event_name, attempted_at, crm_leads(title)")
      .eq("organization_id", organizationId)
      .eq("platform", "meta_ads")
      .eq("status", "sent")
      .order("attempted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("ad_conversion_dispatches")
      .select("detail, attempted_at")
      .eq("organization_id", organizationId)
      .eq("platform", "meta_ads")
      .eq("status", "error")
      .gte("attempted_at", semana)
      .order("attempted_at", { ascending: false })
      .limit(200),
    // O código de teste é lido à parte: com a conexão pausada `lerCredencial`
    // não o devolve, e o aviso de modo de teste vale do mesmo jeito.
    admin
      .from("ad_platform_connections")
      .select("test_event_code")
      .eq("organization_id", organizationId)
      .eq("platform", "meta_ads")
      .maybeSingle(),
  ]);
  if (ultimo.error || recusas.error) throw new Error("Não foi possível ler o histórico de envios da Meta.");

  const ultimoEnvio = ultimo.data as {
    lead_id: string;
    event_name: string;
    meta_event_name: string | null;
    attempted_at: string;
    crm_leads: { title: string | null } | Array<{ title: string | null }> | null;
  } | null;
  const idadeDoUltimo = ultimoEnvio ? agora.getTime() - Date.parse(ultimoEnvio.attempted_at) : null;

  const itens: ItemDoDiagnosticoDaMeta[] = [];

  if (!credencial.ok) {
    const caso: CasoDoDiagnostico =
      credencial.motivo === "conexao_desabilitada"
        ? "conexao_pausada"
        : credencial.motivo === "sem_conexao"
          ? "sem_conexao"
          : credencial.motivo;
    itens.push(item("conexao", caso));
  } else {
    const conexao = await conferir({
      datasetId: credencial.credencial.datasetId,
      accessToken: credencial.credencial.accessToken,
    });
    itens.push(
      ...itensDaMeta(conexao, credencial.credencial.datasetId, idadeDoUltimo !== null && idadeDoUltimo <= 7 * DIA_MS),
    );
  }

  if (ultimoEnvio && idadeDoUltimo !== null) {
    const negocio = Array.isArray(ultimoEnvio.crm_leads) ? ultimoEnvio.crm_leads[0] : ultimoEnvio.crm_leads;
    itens.push(
      item("ultimo_envio", idadeDoUltimo > 14 * DIA_MS ? "ultimo_envio_antigo" : "ultimo_envio_aceito", null, {
        ultimo: {
          em: ultimoEnvio.attempted_at,
          evento: rotuloDoEnvioDaMeta(ultimoEnvio.event_name, ultimoEnvio.meta_event_name) ?? ultimoEnvio.event_name,
          negocio: negocio?.title ?? null,
          leadId: ultimoEnvio.lead_id,
        },
      }),
    );
  } else {
    itens.push(item("ultimo_envio", "nenhum_envio_aceito"));
  }

  const linhas = (recusas.data ?? []) as Array<{ detail: string | null }>;
  if (linhas.length === 0) {
    itens.push(item("recusados", "sem_recusados"));
  } else {
    const porMotivo = new Map<string, number>();
    for (const l of linhas) {
      const motivo = (l.detail ?? "").trim().slice(0, 160) || "sem motivo informado pela plataforma";
      porMotivo.set(motivo, (porMotivo.get(motivo) ?? 0) + 1);
    }
    itens.push(
      item("recusados", "com_recusados", null, {
        recusados: {
          total: linhas.length,
          motivos: [...porMotivo.entries()]
            .map(([motivo, quantos]) => ({ motivo, quantos }))
            .sort((a, b) => b.quantos - a.quantos)
            .slice(0, 5),
        },
      }),
    );
  }

  const codigoDeTeste = (teste.data as { test_event_code: string | null } | null)?.test_event_code?.trim();
  if (codigoDeTeste) itens.push(item("modo_de_teste", "modo_de_teste"));

  const daConexao = itens.filter((i) => ["conexao", "token", "destino", "permissao"].includes(i.chave));
  const veredito: VereditoDoDiagnostico = daConexao.some((i) => i.saude === "problema")
    ? "com_problema"
    : daConexao.length > 0 && daConexao.every((i) => i.saude === "ok")
      ? "em_ordem"
      : "com_atencao";

  return { itens, veredito, testadoEm: agora.toISOString() };
}

/** O diagnóstico em frases, para quem não tem tela (a ferramenta do MCP). */
export function diagnosticoEmFrases(d: DiagnosticoDaMeta): Array<{
  item: string;
  saude: SaudeDoItem;
  titulo: string;
  detalhe: string;
  dado: string | null;
}> {
  return d.itens.map((i) => ({
    item: i.chave,
    saude: i.saude,
    titulo:
      i.chave === "recusados" && i.recusados
        ? `${TITULO_DO_CASO[i.caso]}: ${i.recusados.total}`
        : TITULO_DO_CASO[i.caso],
    detalhe: DETALHE_DO_CASO[i.caso],
    dado:
      i.dado ??
      (i.ultimo
        ? `${i.ultimo.evento} · ${i.ultimo.em}${i.ultimo.negocio ? ` · ${i.ultimo.negocio}` : ""}`
        : i.recusados
          ? i.recusados.motivos.map((m) => `${m.quantos} · ${m.motivo}`).join("; ")
          : null),
  }));
}

/**
 * FORK MIA (.101) · AS AÇÕES DO RAIO-X, num lugar só para a TELA (rotas de
 * `/api/v1/admin/raio-x`) e o MCP de plataforma (`plataforma_*_raio_x`): um
 * segundo jeito de criar ou encerrar divergiria do primeiro no primeiro
 * conserto. Cada ação devolve o resultado e o EFEITO que quem chama audita.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  andamentoDaLeitura,
  criarLinkDoDono,
  criarRaioX,
  desconectarAgora,
  encerrarRaioX,
  gastoDoRaioX,
  gerarOutroLinkDeConexao,
  lerLinksDoDono,
  lerRaioX,
  lerRelatorio,
  lerRelatorios,
  ligarEmpresaDaMia,
  linkDeConexaoAtual,
  mensagemPronta,
  mudarTeto,
  podeConectar,
  revisarRelatorio,
  revogarLinkDoDono,
  ultimoAceite,
  validadeDoLinkDoDono,
  type LinhaDoRaioX,
  type LinhaDoRelatorio,
  type LinkDoDono,
} from "./banco";
import { TETO_MAXIMO_CENTAVOS, TETO_MINIMO_CENTAVOS, validarNovoRaioX, whatsappParaLer } from "./regras";
import { ROTULO_DO_SEGMENTO } from "./segmentos";
import type { Segmento } from "./regras";

export type Via = "tela" | "mcp_plataforma";

export type Recusa =
  | { ok: false; motivo: "invalido"; campos: string[] }
  | { ok: false; motivo: "nao_encontrado" }
  | { ok: false; motivo: "empresa_inexistente" }
  | { ok: false; motivo: "ja_conectado" }
  | { ok: false; motivo: "encerrado" }
  | { ok: false; motivo: "nao_revisado" }
  | { ok: false; motivo: "relatorio_de_outro_raio_x" };

// ─── Criar ──────────────────────────────────────────────────────────────────

export async function acaoCriar(
  admin: SupabaseClient,
  bruto: unknown,
  ator: string | null,
  via: Via,
): Promise<{ ok: true; id: string; empresa: string; link: string; expiraEm: string; mensagem: string } | Recusa> {
  const v = validarNovoRaioX(bruto);
  if (!v.ok) return { ok: false, motivo: "invalido", campos: v.campos };
  if (v.valor.organization_id) {
    const { data, error } = await admin.from("organizations").select("id").eq("id", v.valor.organization_id).maybeSingle();
    if (error || !data) return { ok: false, motivo: "empresa_inexistente" };
  }
  const criado = await criarRaioX(admin, v.valor, ator, via);
  return {
    ok: true,
    id: criado.raioX.id,
    empresa: criado.raioX.empresa,
    link: criado.link,
    expiraEm: criado.raioX.conexao_expira_em ?? "",
    mensagem: criado.mensagem,
  };
}

// ─── Ver ────────────────────────────────────────────────────────────────────

export interface DetalheDoRaioX {
  raioX: {
    id: string;
    empresa: string;
    segmento: Segmento;
    segmentoRotulo: string;
    whatsapp: string;
    whatsappParaLer: string;
    responsavelNome: string | null;
    responsavelContato: string | null;
    quemAtende: string;
    periodoDias: number;
    tipo: "unico" | "mensal";
    horario: { abre: string; fecha: string; sabadoAte: string | null };
    organizationId: string | null;
    tetoCentavos: number;
    situacao: LinhaDoRaioX["situacao"];
    criadoEm: string;
    criadoVia: string;
    conectadoEm: string | null;
    numeroConectado: string | null;
    numeroDiferente: boolean;
    desconectarEm: string | null;
    desconectadoEm: string | null;
    apagarConversasEm: string | null;
    conversasApagadasEm: string | null;
    encerradoEm: string | null;
    ciclo: number;
    periodoInicio: string | null;
    periodoFim: string | null;
  };
  /** O link de conexão vigente, quando ainda deixa conectar. */
  conexao: { link: string; expiraEm: string | null; vivo: boolean; mensagem: string } | null;
  aceite: { nome: string; aceito_em: string; termo_versao: string } | null;
  andamento: {
    percentual: number | null;
    fase: string | null;
    conversasLidas: number;
    mensagensLidas: number;
    conversasEstimadas: number;
    erro: string | null;
  };
  custo: { centavos: number; usdCentavos: number; tetoCentavos: number };
  relatorios: LinhaDoRelatorio[];
  links: LinkDoDono[];
}

export async function acaoVer(admin: SupabaseClient, id: string): Promise<DetalheDoRaioX | null> {
  const r = await lerRaioX(admin, id);
  if (!r) return null;
  const [aceite, relatorios, custo] = await Promise.all([ultimoAceite(admin, id), lerRelatorios(admin, id), gastoDoRaioX(admin, id)]);
  const links = await lerLinksDoDono(admin, relatorios.map((x) => x.id));
  const leitura = r.leitura as { fase?: string; conversas_lidas?: number; mensagens_lidas?: number; total?: number; erro?: string | null };
  const vivo = podeConectar(r);
  const conexao = r.situacao === "aguardando" || r.situacao === "conectando"
    ? (() => {
        const atual = linkDeConexaoAtual(r);
        return { link: atual.link, expiraEm: r.conexao_expira_em, vivo, mensagem: mensagemPronta(r, atual.link) };
      })()
    : null;
  return {
    raioX: {
      id: r.id,
      empresa: r.empresa,
      segmento: r.segmento as Segmento,
      segmentoRotulo: ROTULO_DO_SEGMENTO[r.segmento as Segmento] ?? r.segmento,
      whatsapp: r.whatsapp,
      whatsappParaLer: whatsappParaLer(r.whatsapp),
      responsavelNome: r.responsavel_nome,
      responsavelContato: r.responsavel_contato,
      quemAtende: r.quem_atende,
      periodoDias: r.periodo_dias,
      tipo: r.tipo,
      horario: { abre: r.abre.slice(0, 5), fecha: r.fecha.slice(0, 5), sabadoAte: r.sabado_ate ? r.sabado_ate.slice(0, 5) : null },
      organizationId: r.organization_id,
      tetoCentavos: r.teto_centavos,
      situacao: r.situacao,
      criadoEm: r.created_at,
      criadoVia: r.criado_via,
      conectadoEm: r.conectado_em,
      numeroConectado: r.numero_conectado,
      numeroDiferente: leitura.erro === "numero_diferente",
      desconectarEm: r.desconectar_em,
      desconectadoEm: r.desconectado_em,
      apagarConversasEm: r.apagar_conversas_em,
      conversasApagadasEm: r.conversas_apagadas_em,
      encerradoEm: r.encerrado_em,
      ciclo: r.ciclo,
      periodoInicio: r.periodo_inicio,
      periodoFim: r.periodo_fim,
    },
    conexao,
    aceite,
    andamento: {
      percentual: andamentoDaLeitura(r),
      fase: leitura.fase ?? null,
      conversasLidas: Number(leitura.conversas_lidas) || 0,
      mensagensLidas: Number(leitura.mensagens_lidas) || 0,
      conversasEstimadas: Number(leitura.total) || 0,
      erro: leitura.erro ?? null,
    },
    custo: { centavos: Math.round(custo.centavos * 100) / 100, usdCentavos: Math.round(custo.usdCentavos * 100) / 100, tetoCentavos: r.teto_centavos },
    relatorios,
    links,
  };
}

// ─── Mudar ──────────────────────────────────────────────────────────────────

export async function acaoAlterar(
  admin: SupabaseClient,
  id: string,
  bruto: unknown,
): Promise<{ ok: true; mudou: string[] } | Recusa> {
  const r = await lerRaioX(admin, id);
  if (!r) return { ok: false, motivo: "nao_encontrado" };
  const corpo = (bruto ?? {}) as { organization_id?: unknown; teto_centavos?: unknown };
  const mudou: string[] = [];
  if ("organization_id" in corpo) {
    const org = corpo.organization_id === null || corpo.organization_id === "" ? null : String(corpo.organization_id);
    if (org !== null && !/^[0-9a-f-]{36}$/i.test(org)) return { ok: false, motivo: "invalido", campos: ["organization_id"] };
    if (!(await ligarEmpresaDaMia(admin, id, org))) return { ok: false, motivo: "empresa_inexistente" };
    mudou.push("organization_id");
  }
  if ("teto_centavos" in corpo) {
    const teto = Number(corpo.teto_centavos);
    if (!Number.isInteger(teto) || teto < TETO_MINIMO_CENTAVOS || teto > TETO_MAXIMO_CENTAVOS) {
      return { ok: false, motivo: "invalido", campos: ["teto_centavos"] };
    }
    await mudarTeto(admin, id, teto);
    mudou.push("teto_centavos");
  }
  return { ok: true, mudou };
}

export async function acaoGerarOutroLink(
  admin: SupabaseClient,
  id: string,
): Promise<{ ok: true; link: string; expiraEm: string; mensagem: string } | Recusa> {
  const r = await lerRaioX(admin, id);
  if (!r) return { ok: false, motivo: "nao_encontrado" };
  const g = await gerarOutroLinkDeConexao(admin, r);
  if (!g.ok) return { ok: false, motivo: g.motivo };
  return { ok: true, link: g.link, expiraEm: g.expiraEm, mensagem: g.mensagem };
}

async function relatorioDoRaioX(admin: SupabaseClient, raioXId: string, relatorioId: string | null): Promise<LinhaDoRelatorio | Recusa> {
  if (relatorioId) {
    const rel = await lerRelatorio(admin, relatorioId);
    if (!rel) return { ok: false, motivo: "nao_encontrado" };
    if (rel.raio_x_id !== raioXId) return { ok: false, motivo: "relatorio_de_outro_raio_x" };
    return rel;
  }
  const [ultimo] = await lerRelatorios(admin, raioXId);
  return ultimo ?? { ok: false, motivo: "nao_encontrado" };
}

const ehRecusa = (x: unknown): x is Recusa => Boolean(x && typeof x === "object" && (x as { ok?: unknown }).ok === false);

/** A Time revisou o rascunho (decisão 10). Sem `relatorio_id`, o mais novo. */
export async function acaoRevisar(
  admin: SupabaseClient,
  raioXId: string,
  relatorioId: string | null,
  ator: string | null,
  notas: string | null,
): Promise<{ ok: true; relatorioId: string; jaEstava: boolean } | Recusa> {
  const rel = await relatorioDoRaioX(admin, raioXId, relatorioId);
  if (ehRecusa(rel)) return rel;
  if (rel.situacao === "revisado" && !notas) return { ok: true, relatorioId: rel.id, jaEstava: true };
  const feito = await revisarRelatorio(admin, rel.id, ator, notas ?? rel.notas_da_time);
  if (!feito) return { ok: false, motivo: "nao_encontrado" };
  return { ok: true, relatorioId: rel.id, jaEstava: rel.situacao === "revisado" };
}

/** O link do dono: só de relatório revisado. Sem `relatorio_id`, o mais novo. */
export async function acaoGerarLinkDoDono(
  admin: SupabaseClient,
  raioXId: string,
  relatorioId: string | null,
  diasBrutos: unknown,
  ator: string | null,
  via: Via,
): Promise<{ ok: true; link: LinkDoDono; relatorioId: string } | Recusa> {
  const rel = await relatorioDoRaioX(admin, raioXId, relatorioId);
  if (ehRecusa(rel)) return rel;
  const r = await criarLinkDoDono(admin, rel, validadeDoLinkDoDono(diasBrutos), ator, via);
  if (!r.ok) return { ok: false, motivo: "nao_revisado" };
  return { ok: true, link: r.link, relatorioId: rel.id };
}

export async function acaoRevogarLinkDoDono(
  admin: SupabaseClient,
  raioXId: string,
  linkId: string,
  ator: string | null,
): Promise<{ ok: true; link: LinkDoDono } | Recusa> {
  const { data, error } = await admin.from("mia_raio_x_links").select("id, relatorio_id").eq("id", linkId).maybeSingle();
  if (error || !data) return { ok: false, motivo: "nao_encontrado" };
  const rel = await lerRelatorio(admin, (data as { relatorio_id: string }).relatorio_id);
  if (!rel || rel.raio_x_id !== raioXId) return { ok: false, motivo: "relatorio_de_outro_raio_x" };
  const revogado = await revogarLinkDoDono(admin, linkId, ator);
  if (!revogado) return { ok: false, motivo: "nao_encontrado" };
  return { ok: true, link: revogado };
}

export async function acaoDesconectar(
  admin: SupabaseClient,
  id: string,
): Promise<{ ok: true; desconectou: boolean; falhaNoLeitor: boolean; apagarConversasEm: string | null } | Recusa> {
  const r = await lerRaioX(admin, id);
  if (!r) return { ok: false, motivo: "nao_encontrado" };
  if (r.situacao === "encerrado") return { ok: false, motivo: "encerrado" };
  const d = await desconectarAgora(admin, r);
  const depois = await lerRaioX(admin, id);
  return { ok: true, ...d, apagarConversasEm: depois?.apagar_conversas_em ?? null };
}

export async function acaoEncerrar(
  admin: SupabaseClient,
  id: string,
  ator: string | null,
): Promise<{ ok: true; desconectou: boolean; falhaNoLeitor: boolean; apagarConversasEm: string; jaEstava: boolean } | Recusa> {
  const r = await lerRaioX(admin, id);
  if (!r) return { ok: false, motivo: "nao_encontrado" };
  if (r.situacao === "encerrado") {
    return { ok: true, desconectou: false, falhaNoLeitor: false, apagarConversasEm: r.apagar_conversas_em ?? "", jaEstava: true };
  }
  const e = await encerrarRaioX(admin, r, ator);
  return { ok: true, ...e, jaEstava: false };
}

/** A frase de cada recusa, para a rota e o MCP dizerem o mesmo. */
export function fraseDaRecusa(r: Recusa): string {
  switch (r.motivo) {
    case "invalido":
      return `Confira os campos: ${r.campos.join(", ")}.`;
    case "nao_encontrado":
      return "Raio-X ou relatório não encontrado.";
    case "empresa_inexistente":
      return "A empresa da MIA informada não existe.";
    case "ja_conectado":
      return "O WhatsApp já está conectado: não há link novo a gerar.";
    case "encerrado":
      return "Este raio-X está encerrado.";
    case "nao_revisado":
      return "O relatório ainda é rascunho: alguém da Time precisa revisá-lo antes de gerar o link do dono.";
    case "relatorio_de_outro_raio_x":
      return "Esse relatório não é deste raio-X.";
  }
}

export function statusDaRecusa(r: Recusa): number {
  if (r.motivo === "nao_encontrado") return 404;
  if (r.motivo === "invalido" || r.motivo === "empresa_inexistente") return 400;
  return 409;
}

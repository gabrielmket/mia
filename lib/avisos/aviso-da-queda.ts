/**
 * FORK MIA (MIA-48) — O AVISO DA QUEDA E DA VOLTA DO NÚMERO NO GRUPO DO CLIENTE.
 *
 * ─── Por que existe ────────────────────────────────────────────────────────
 *
 * Quando o WhatsApp de um cliente caía, só o grupo INTERNO ficava sabendo, pelo
 * report da plataforma (`report-da-plataforma.ts`). O cliente não sabia que a IA
 * tinha parado de responder e descobria quando um consumidor reclamava. Aqui o
 * número de avisos manda UM recado no grupo daquele cliente (o mesmo destino do
 * aviso da passagem, `destinoDoAviso`) com o passo a passo para reconectar pelo
 * QR, e um recado curto quando o número volta.
 *
 * ─── Quem chama ────────────────────────────────────────────────────────────
 *
 * O cron `report-da-plataforma`, de minuto em minuto, ANTES da saída "sem grupo
 * de report": o aviso ao cliente não depende de a plataforma ter escolhido o
 * grupo interno. O report interno segue igual, com o mesmo texto e a mesma
 * frequência: este arquivo não escreve nas chaves dele (`canal_caiu:<sessão>`).
 *
 * ─── A detecção é a mesma do report, com dois recortes ─────────────────────
 *
 * Caído = não arquivado, `status` diferente de `WORKING` e diferente de
 * `STARTING` (o estado de todo boot). Para o CLIENTE, mais dois recortes:
 *
 *  - só o número pareado por QR que já teve telefone. O passo a passo é o do
 *    QR, e a linha morta sem telefone é QR que ninguém leu (#3416), não queda.
 *  - a queda precisa durar `ESPERA_ANTES_DE_AVISAR_MIN`. O reinício do
 *    contêiner deixa a sessão `STOPPED` por um minuto até o vigia do worker
 *    religá-la (`session-reconciler`); sem a espera, cada deploy renderia um
 *    "caiu" e um "voltou" no grupo de todos os clientes. O relógio é nosso
 *    (`numero_do_cliente_fora:<sessão>`), e não `last_status_change_at`, porque
 *    a ingestão regrava essa coluna a cada evento de status.
 *
 * ─── A trava anti-ruído é a do report ──────────────────────────────────────
 *
 * `jaAvisou` com chave por SESSÃO (`numero_do_cliente_caiu:<sessão>`): um aviso
 * por queda por dia, por mais que o cron rode. A volta só sai quando houve
 * queda avisada (`numero_do_cliente_voltou:<sessão>` mais antiga que a queda,
 * ou ausente): sem queda avisada, sem volta avisada.
 *
 * ─── Os cuidados ───────────────────────────────────────────────────────────
 *
 *  - O número de AVISOS caído não gera recado a cliente nenhum: é o report
 *    interno que trata dele. E, enquanto ele estiver fora, os avisos que sairiam
 *    por ele esperam (nada é marcado, então saem quando ele voltar).
 *  - A chave é por cliente (`settings.aviso_da_queda_do_numero`) e vem LIGADA:
 *    só o `false` gravado desliga. Sem grupo configurado, não há aviso.
 *  - Empresa parada (suspensa, redigida) não recebe recado (`ehOperante`).
 *
 * ⚠️ Nada aqui lança. Este passo roda no mesmo cron que o backup e o report
 * interno, e um vigia que derruba a rodada leva os outros avisos junto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdapter } from "@/lib/channels";
import { PROVIDER_EM_QUE_O_NUMERO_E_A_CONEXAO } from "@/lib/channels/capabilities";
import { STATUS_SAUDAVEL } from "@/lib/channels/health";
import { resolveSessionRef } from "@/lib/channels/session-ref";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { ehOperante } from "@/lib/organizacao/operante";

import { avisoDaQuedaLigado } from "./chave-do-aviso-da-queda";
import { destinoDoAviso, lerGrupoDeAvisos } from "./destino-do-aviso";
import { jaAvisou, marcarEnviado } from "./report-da-plataforma";


/** As chaves em `platform_avisos_enviados`, uma de cada por sessão. */
export const PREFIXO_DAS_CHAVES = "numero_do_cliente_";
export const chaveDaQueda = (sessaoId: string) => `${PREFIXO_DAS_CHAVES}caiu:${sessaoId}`;
export const chaveDaVolta = (sessaoId: string) => `${PREFIXO_DAS_CHAVES}voltou:${sessaoId}`;
export const chaveDeForaDesde = (sessaoId: string) => `${PREFIXO_DAS_CHAVES}fora:${sessaoId}`;

/** Uma vez por dia enquanto a queda durar, como o report interno. */
export const JANELA_DA_QUEDA_HORAS = 24;

/** Quanto a queda precisa durar antes de virar recado ao cliente. */
export const ESPERA_ANTES_DE_AVISAR_MIN = 10;

/** Teto de sessões caídas lidas por rodada. */
const TETO_DE_SESSOES = 200;

export interface NumeroDoAviso {
  display_name: string | null;
  phone_number: string | null;
}

/** Os 4 últimos dígitos: o cliente reconhece o número sem o telefone inteiro no grupo. */
export function finalDoTelefone(telefone: string | null): string | null {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  return digitos.length >= 4 ? digitos.slice(-4) : null;
}

/** "Recepção (final 0002)", ou só "final 0002" quando o número não tem nome. */
export function rotuloDoNumero(n: NumeroDoAviso): string {
  // O apelido do CANAL (não é nome de contato): vazio = o número não tem nome.
  const nome = typeof n.display_name === "string" ? n.display_name.trim() : "";
  const final = finalDoTelefone(n.phone_number);
  if (nome && final) return `${nome} (final ${final})`;
  if (final) return `final ${final}`;
  return nome || "sem nome";
}

export function textoDaQueda(n: NumeroDoAviso): string {
  return [
    "⚠️ *Um número de WhatsApp de vocês caiu*",
    "",
    `*Número:* ${rotuloDoNumero(n)}`,
    "",
    "Enquanto ele estiver desconectado, a IA não recebe nem responde as mensagens que chegam nele.",
    "",
    "*Como reconectar pelo QR Code:*",
    `1. Abra ${env.NEXT_PUBLIC_APP_URL}/app/connections`,
    "2. No cartão desse número, clique em *Reconectar*. Vai aparecer um QR Code.",
    "3. No celular desse número, abra o WhatsApp e toque em *Dispositivos conectados* › *Conectar dispositivo*.",
    "4. Aponte a câmera para o QR Code da tela e espere aparecer *Conectado!*",
    "",
    "Se o QR Code expirar antes, clique em *Gerar novo QR*. Quando o número voltar, avisamos aqui.",
  ].join("\n");
}

export function textoDaVolta(n: NumeroDoAviso): string {
  return [
    "✅ *O número de WhatsApp voltou*",
    "",
    `*Número:* ${rotuloDoNumero(n)}`,
    "",
    "Ele está conectado de novo e a IA voltou a receber e responder as mensagens que chegam nele. Não precisa fazer mais nada.",
  ].join("\n");
}

interface LinhaDaSessao {
  id: string;
  organization_id: string;
  display_name: string | null;
  phone_number: string | null;
  status: string | null;
  provider: string | null;
  e_numero_de_avisos: boolean | null;
}

const COLUNAS = "id, organization_id, display_name, phone_number, status, provider, e_numero_de_avisos";

interface Marca {
  chave: string;
  enviado_em: string;
}

/** A queda deste número vira recado ao cliente? (o recorte do topo do arquivo) */
function numeroDoCliente(s: LinhaDaSessao): boolean {
  return (
    s.e_numero_de_avisos !== true &&
    s.provider === PROVIDER_EM_QUE_O_NUMERO_E_A_CONEXAO &&
    finalDoTelefone(s.phone_number) !== null
  );
}

/** Houve queda avisada e a volta dela ainda não foi dada? */
function voltaPendente(marcas: Map<string, number>, sessaoId: string): boolean {
  const queda = marcas.get(chaveDaQueda(sessaoId));
  const volta = marcas.get(chaveDaVolta(sessaoId));
  return queda !== undefined && (volta === undefined || volta < queda);
}

function caido(status: string | null): boolean {
  return status !== STATUS_SAUDAVEL && status !== "STARTING";
}

async function apagarMarca(admin: SupabaseClient, chave: string): Promise<void> {
  try {
    await admin.from("platform_avisos_enviados").delete().eq("chave", chave);
  } catch {
    // Sobrar a marca só faz a próxima queda deste número contar a espera do
    // começo da anterior: avisa alguns minutos antes, nunca em dobro.
  }
}

type Envio = "saiu" | "sem_destino" | "falhou" | "esperar_numero_de_avisos";

/**
 * O envio ao grupo DESTE cliente. O destino vem de `destinoDoAviso` com a
 * organização da sessão que caiu: é o que garante que o recado da Academia Alfa
 * não vai para o grupo da Academia Beta.
 */
async function enviarAoGrupo(
  admin: SupabaseClient,
  organizationId: string,
  texto: string,
  numeroDeAvisosDePe: boolean,
): Promise<Envio> {
  try {
    const { data: org } = await admin
      .from("organizations")
      .select("status, settings")
      .eq("id", organizationId)
      .maybeSingle();
    const linha = org as { status?: string | null; settings?: unknown } | null;
    if (!linha || !ehOperante(linha.status)) return "sem_destino";
    if (!lerGrupoDeAvisos(linha.settings) || !avisoDaQuedaLigado(linha.settings)) return "sem_destino";

    const destino = await destinoDoAviso(admin, organizationId);
    if (!destino.ok) return "sem_destino";
    // O número da plataforma fora do ar: o recado espera ele voltar (sem marcar).
    if (destino.via !== "empresa" && !numeroDeAvisosDePe) return "esperar_numero_de_avisos";

    await getAdapter(destino.sessao.provider).send({
      organizationId,
      sessionRef: resolveSessionRef(destino.sessao),
      to: destino.chatId,
      kind: "text",
      body: texto,
    });
    return "saiu";
  } catch (err) {
    logger.warn("[aviso-da-queda] o grupo do cliente não recebeu", {
      organizationId,
      detail: err instanceof Error ? err.message : "erro",
    });
    return "falhou";
  }
}

export interface DesfechoDoAvisoDaQueda {
  quedas: string[];
  voltas: string[];
}

/**
 * Uma rodada: avisa as quedas novas e as voltas pendentes. Devolve as chaves
 * dos recados que saíram.
 */
export async function avisarQuedasEVoltas(
  admin: SupabaseClient,
  agora: Date = new Date(),
): Promise<DesfechoDoAvisoDaQueda> {
  const desfecho: DesfechoDoAvisoDaQueda = { quedas: [], voltas: [] };
  try {
    const [{ data: marcasBrutas }, { data: caidasBrutas }, { data: doAviso }] = await Promise.all([
      admin
        .from("platform_avisos_enviados")
        .select("chave, enviado_em")
        .like("chave", `${PREFIXO_DAS_CHAVES}%`),
      admin
        .from("channel_sessions")
        .select(COLUNAS)
        .is("archived_at", null)
        .neq("status", STATUS_SAUDAVEL)
        .limit(TETO_DE_SESSOES),
      admin.from("channel_sessions").select("status").eq("e_numero_de_avisos", true).maybeSingle(),
    ]);
    const marcas = new Map(((marcasBrutas ?? []) as Marca[]).map((m) => [m.chave, new Date(m.enviado_em).getTime()]));
    const numeroDeAvisosDePe = (doAviso as { status?: string | null } | null)?.status === STATUS_SAUDAVEL;

    // ── As quedas ──────────────────────────────────────────────────────────
    for (const s of (caidasBrutas ?? []) as LinhaDaSessao[]) {
      if (!caido(s.status) || !numeroDoCliente(s)) continue;

      const fora = chaveDeForaDesde(s.id);
      const foraDesde = marcas.get(fora);
      if (foraDesde === undefined) {
        await marcarEnviado(admin, fora, { organization_id: s.organization_id, status: s.status });
        continue;
      }
      if (agora.getTime() - foraDesde < ESPERA_ANTES_DE_AVISAR_MIN * 60 * 1000) continue;

      const chave = chaveDaQueda(s.id);
      if (await jaAvisou(admin, chave, JANELA_DA_QUEDA_HORAS)) continue;

      const envio = await enviarAoGrupo(admin, s.organization_id, textoDaQueda(s), numeroDeAvisosDePe);
      if (envio !== "saiu") continue;
      await marcarEnviado(admin, chave, { organization_id: s.organization_id, status: s.status });
      desfecho.quedas.push(chave);
    }

    // ── As voltas ──────────────────────────────────────────────────────────
    //
    // Só as sessões com algo pendente: a volta a avisar (queda avisada mais
    // nova que a última volta) e o relógio da queda a zerar. A marca da queda
    // fica para sempre (é a trava), e perguntar por toda sessão que já caiu um
    // dia faria a lista crescer a cada mês.
    const pendentes = new Set<string>();
    for (const chave of marcas.keys()) {
      const id = chave.slice(chave.indexOf(":") + 1);
      if (chave === chaveDeForaDesde(id) || voltaPendente(marcas, id)) pendentes.add(id);
    }
    if (pendentes.size === 0) return desfecho;

    const { data: deVoltaBrutas } = await admin
      .from("channel_sessions")
      .select(COLUNAS)
      .in("id", [...pendentes])
      .eq("status", STATUS_SAUDAVEL)
      .is("archived_at", null);

    for (const s of (deVoltaBrutas ?? []) as LinhaDaSessao[]) {
      if (marcas.has(chaveDeForaDesde(s.id))) await apagarMarca(admin, chaveDeForaDesde(s.id));
      if (!voltaPendente(marcas, s.id)) continue;

      const chave = chaveDaVolta(s.id);
      const envio = await enviarAoGrupo(admin, s.organization_id, textoDaVolta(s), numeroDeAvisosDePe);
      if (envio === "falhou" || envio === "esperar_numero_de_avisos") continue;
      // Sem destino (chave desligada, grupo tirado, empresa parada) a volta é
      // dada por fechada sem recado: senão ela sairia dias depois, quando
      // alguém religasse a chave, falando de uma queda que ninguém lembra.
      await marcarEnviado(admin, chave, { organization_id: s.organization_id, enviada: envio === "saiu" });
      if (envio === "saiu") desfecho.voltas.push(chave);
    }
  } catch (err) {
    logger.warn("[aviso-da-queda] a rodada parou no meio", {
      detail: err instanceof Error ? err.message : "erro",
    });
  }
  return desfecho;
}

export interface EstadoDoAvisoDaQueda {
  /** A chave como gravada: `false` só quando alguém desligou. */
  ligada: boolean;
  /** Há grupo de avisos configurado? Sem ele, ligada não manda nada. */
  grupo_configurado: boolean;
  /** Ligada E com grupo: é o que o cron vai fazer na próxima queda. */
  vai_avisar: boolean;
  ultimo_aviso_de_queda: { em: string; numero: string } | null;
  ultimo_aviso_de_volta: { em: string; numero: string } | null;
}

/**
 * O estado para a leitura do MCP (`plataforma_ver_cliente`). Leitura que falha
 * devolve os últimos avisos como `null`, sem derrubar o retrato.
 */
export async function estadoDoAvisoDaQueda(
  admin: SupabaseClient,
  organizationId: string,
  settings: unknown,
): Promise<EstadoDoAvisoDaQueda> {
  const ligada = avisoDaQuedaLigado(settings);
  const grupo = lerGrupoDeAvisos(settings) !== null;
  const estado: EstadoDoAvisoDaQueda = {
    ligada,
    grupo_configurado: grupo,
    vai_avisar: ligada && grupo,
    ultimo_aviso_de_queda: null,
    ultimo_aviso_de_volta: null,
  };
  try {
    const { data: sessoes } = await admin
      .from("channel_sessions")
      .select("id, display_name, phone_number")
      .eq("organization_id", organizationId);
    const lista = (sessoes ?? []) as Array<{ id: string } & NumeroDoAviso>;
    if (lista.length === 0) return estado;

    const porChave = new Map<string, { id: string } & NumeroDoAviso>();
    for (const s of lista) {
      porChave.set(chaveDaQueda(s.id), s);
      porChave.set(chaveDaVolta(s.id), s);
    }
    const { data: marcas } = await admin
      .from("platform_avisos_enviados")
      .select("chave, enviado_em, detalhe")
      .in("chave", [...porChave.keys()]);

    for (const m of (marcas ?? []) as Array<Marca & { detalhe?: { enviada?: boolean } | null }>) {
      const s = porChave.get(m.chave);
      if (!s) continue;
      const item = { em: m.enviado_em, numero: rotuloDoNumero(s) };
      if (m.chave === chaveDaQueda(s.id)) {
        if (!estado.ultimo_aviso_de_queda || item.em > estado.ultimo_aviso_de_queda.em) estado.ultimo_aviso_de_queda = item;
      } else if (m.detalhe?.enviada !== false) {
        if (!estado.ultimo_aviso_de_volta || item.em > estado.ultimo_aviso_de_volta.em) estado.ultimo_aviso_de_volta = item;
      }
    }
  } catch {
    // O retrato sai sem os últimos avisos.
  }
  return estado;
}

/**
 * FORK MIA (.62) — QUANDO A LEITURA PARA, OS ADMINISTRADORES FICAM SABENDO.
 *
 * ─── O defeito ─────────────────────────────────────────────────────────────
 *
 * Até a .61, token vencido, permissão retirada ou Página removida viravam uma
 * linha vermelha no histórico da aba Formulários de leads, e mais nada. Quem
 * não abrisse a aba descobria dias depois, pelo "não chegou lead nenhum".
 *
 * ─── A regra ───────────────────────────────────────────────────────────────
 *
 *   · 3 leituras com erro SEGUIDAS (15 minutos) viram UM aviso na Central de
 *     avisos (`agent_inbox_items`), com o motivo em linguagem simples e o que
 *     fazer, e um push no celular de cada administrador da empresa;
 *   · o motivo que passa sozinho (a Meta fora do ar, cota, gravação que caiu)
 *     espera 12 seguidas (1 hora): avisar de madrugada que a Meta piscou ensina
 *     a ignorar o aviso que importa;
 *   · UMA vez por problema: enquanto o motivo for o mesmo, ninguém é avisado de
 *     novo (`aviso_de_falha_motivo`, migration 9005, e o índice único
 *     `uq_mia_aviso_de_leitura_da_meta_aberto` no banco). Motivo DIFERENTE é
 *     outro problema: o aviso antigo fecha e um novo abre;
 *   · a primeira leitura que dá certo FECHA o aviso sozinha. Aviso que não fecha
 *     ensina que a Central mostra coisa velha (mesma regra de
 *     `lib/channels/health.ts`).
 *
 * Formulário desligado, importação desligada ou Página que mudou de dono também
 * fecham o aviso: não há mais leitura para voltar a funcionar.
 *
 * ─── Por que a Central, e não um aviso só nosso ────────────────────────────
 *
 * É o lugar em que o sistema já avisa quando algo pede gente (canal caído,
 * crédito de IA, caso parado), e o push no celular sai pelo mesmo
 * `web_push` que avisa as mensagens. O aviso nasce `other` com `ref_kind`
 * próprio (a lista de `kind` é do upstream e não se redefine); o botão dele
 * leva à aba dos formulários (`lib/ai/inbox-destino.ts`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { logger } from "@/lib/logger";
import { truncar, type PushPayload } from "@/lib/notifications/push_payload";
import { enviarPushAoUsuario } from "@/lib/notifications/web_push";

import { MENSAGEM_DO_MOTIVO } from "./mensagens";
import type { StatusDaLeitura } from "./motivos";
import type { OrigemDoAcesso } from "./paginas";

/** O `ref_kind` do aviso na Central; `ref_id` é a linha do formulário. */
export const REF_KIND_DO_AVISO = "mia_leads_da_meta_formulario";

/** Onde o aviso leva: a aba dos formulários, onde mora o conserto. */
export const DESTINO_DO_AVISO = "/app/settings/meta-ads?aba=formularios";

export const FALHAS_PARA_AVISAR = 3;
export const FALHAS_PARA_AVISAR_SE_PASSA_SOZINHO = 12;

/** Motivos que se resolvem sem ninguém fazer nada. */
const PASSA_SOZINHO = new Set(["transitorio", "limite_de_chamadas", "erro_ao_gravar"]);

/**
 * Motivos cujo conserto é no token ou no Gerenciador de Negócios. Quando a
 * empresa lê pela conexão da PLATAFORMA, quem conserta é o suporte, e o aviso
 * diz isso em vez de mandar gerar um token que a empresa não tem.
 */
const CONSERTO_NO_TOKEN = new Set([
  "token_invalido",
  "permissao_insuficiente",
  "pagina_nao_atribuida",
  "sem_token_da_pagina",
]);

const FRASE_DA_PLATAFORMA =
  "Esta empresa lê as Páginas pela conexão da plataforma: avise o suporte para resolver.";
const FRASE_DA_ESPERA =
  "Os leads ficam guardados na Meta por até 90 dias e entram sozinhos quando a leitura voltar.";
const MOTIVO_DESCONHECIDO = "A leitura deste formulário na Meta está falhando.";

/** Quantas falhas seguidas este motivo espera antes de avisar. */
export function falhasParaAvisar(motivo: string | null): number {
  return motivo && PASSA_SOZINHO.has(motivo)
    ? FALHAS_PARA_AVISAR_SE_PASSA_SOZINHO
    : FALHAS_PARA_AVISAR;
}

export type AcaoDoAviso = "nada" | "avisar" | "trocar" | "limpar";

/**
 * O que fazer com o aviso depois desta leitura. Pura.
 *
 * `falhasSeguidas` já conta esta leitura. `motivoJaAvisado` é o que está em
 * `aviso_de_falha_motivo` (nulo = nenhum aviso aberto).
 */
export function decidirAviso(e: {
  status: StatusDaLeitura;
  motivo: string | null;
  falhasSeguidas: number;
  motivoJaAvisado: string | null;
}): AcaoDoAviso {
  if (e.status !== "erro") return e.motivoJaAvisado ? "limpar" : "nada";
  if (e.falhasSeguidas < falhasParaAvisar(e.motivo)) return "nada";
  const motivo = e.motivo ?? "desconhecido";
  if (e.motivoJaAvisado === motivo) return "nada";
  return e.motivoJaAvisado ? "trocar" : "avisar";
}

/** O título do aviso na Central. O nome do formulário não é dado pessoal. */
export function tituloDoAviso(formulario: { form_name: string | null; form_id: string }): string {
  const nome = (formulario.form_name ?? formulario.form_id).slice(0, 120);
  return `Os leads do formulário "${nome}" pararam de chegar`;
}

/** O corpo: o motivo e o que fazer, e a garantia de que nada se perde. */
export function corpoDoAviso(motivo: string | null, origem: OrigemDoAcesso | null): string {
  const partes = [(motivo && MENSAGEM_DO_MOTIVO[motivo]) || MOTIVO_DESCONHECIDO];
  if (origem === "plataforma" && motivo && CONSERTO_NO_TOKEN.has(motivo)) {
    partes.push(FRASE_DA_PLATAFORMA);
  }
  partes.push(FRASE_DA_ESPERA);
  return partes.join(" ");
}

/**
 * Abre o aviso na Central. Devolve `false` quando já havia um aberto para este
 * formulário (o índice único da 9005 recusou): outra rodada chegou antes, e
 * avisar de novo seria o ruído que a regra existe para impedir.
 */
export async function abrirAviso(
  admin: SupabaseClient,
  formulario: { id: string; organization_id: string; form_name: string | null; form_id: string },
  motivo: string | null,
  origem: OrigemDoAcesso | null,
): Promise<boolean> {
  const { error } = await admin.from("agent_inbox_items").insert({
    organization_id: formulario.organization_id,
    kind: "other",
    severity: "critical",
    title: tituloDoAviso(formulario),
    body: corpoDoAviso(motivo, origem),
    ref_kind: REF_KIND_DO_AVISO,
    ref_id: formulario.id,
  });
  if (!error) return true;
  if (error.code !== "23505") {
    logger.error("[leads-da-meta] aviso de falha não aberto na Central", {
      formulario_id: formulario.id,
      organization_id: formulario.organization_id,
      detalhe: error.message.slice(0, 200),
    });
  }
  return false;
}

/**
 * Fecha os avisos abertos desta empresa: de UM formulário, de uma lista, ou de
 * todos (sem `formularioIds`). Só os DESTE `ref_kind`: fechar por organização
 * apagaria o aviso de canal caído, que segue valendo.
 */
export async function fecharAvisos(
  admin: SupabaseClient,
  organizationId: string,
  formularioIds?: readonly string[],
): Promise<void> {
  if (formularioIds && formularioIds.length === 0) return;
  let consulta = admin
    .from("agent_inbox_items")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("ref_kind", REF_KIND_DO_AVISO)
    .neq("status", "resolved");
  if (formularioIds) consulta = consulta.in("ref_id", [...formularioIds]);
  const { error } = await consulta;
  if (error) {
    logger.warn("[leads-da-meta] aviso de falha não fechado", {
      organization_id: organizationId,
      detalhe: error.message.slice(0, 200),
    });
  }
}

/**
 * Fecha os avisos de formulários que já não são lidos (desligados pela empresa,
 * ou pelo banco quando a Página mudou de dono). Chamada pela rodada a cada
 * volta, com a lista dos formulários ATIVOS da empresa.
 */
export async function fecharAvisosSemLeitura(
  admin: SupabaseClient,
  organizationId: string,
  ativos: readonly string[],
): Promise<void> {
  const { data, error } = await admin
    .from("agent_inbox_items")
    .select("ref_id")
    .eq("organization_id", organizationId)
    .eq("ref_kind", REF_KIND_DO_AVISO)
    .neq("status", "resolved");
  if (error || !data) return;
  const vivos = new Set(ativos);
  const orfaos = (data as Array<{ ref_id: string | null }>)
    .map((l) => l.ref_id)
    .filter((id): id is string => Boolean(id) && !vivos.has(id as string));
  if (orfaos.length > 0) await fecharAvisos(admin, organizationId, orfaos);
}

/** As colunas que zeram o aviso e o contador (formulário desligado ou religado). */
export const SEM_AVISO_DE_FALHA = {
  falhas_seguidas: 0,
  aviso_de_falha_motivo: null,
  aviso_de_falha_em: null,
} as const;

export interface AvisoNovo {
  formName: string;
  motivo: string | null;
}

/**
 * O push no celular dos ADMINISTRADORES da empresa, um só por rodada mesmo
 * que mais de um formulário tenha parado (token vencido para a empresa
 * inteira derruba todos de uma vez, e três pushes iguais seguidos são ruído).
 *
 * Texto no idioma da ORGANIZAÇÃO, como `push-dos-avisos.ts`: ninguém está
 * logado quando o push sai. Nunca lança: o aviso na Central já foi aberto, e o
 * push é o atalho até ele.
 */
export async function avisarAdministradores(
  admin: SupabaseClient,
  organizationId: string,
  avisos: readonly AvisoNovo[],
): Promise<number> {
  if (avisos.length === 0) return 0;
  try {
    const [{ data: membros }, { data: org }] = await Promise.all([
      admin
        .from("user_organizations")
        .select("user_id")
        .eq("organization_id", organizationId)
        .eq("role", "admin")
        .is("revoked_at", null),
      admin.from("organizations").select("locale").eq("id", organizationId).maybeSingle(),
    ]);
    const idioma = normalizarIdioma((org as { locale?: string | null } | null)?.locale ?? null);
    const nomes = avisos.map((a) => `"${a.formName}"`).join(", ");
    const primeiro = avisos[0]!;
    const payload: PushPayload = {
      title: traduzir("Os leads da Meta pararam de chegar", idioma),
      body: truncar(
        `${nomes}: ${traduzir((primeiro.motivo && MENSAGEM_DO_MOTIVO[primeiro.motivo]) || MOTIVO_DESCONHECIDO, idioma)}`,
      ),
      tag: `leads-da-meta:${organizationId}`,
      href: DESTINO_DO_AVISO,
    };
    let enviados = 0;
    for (const m of (membros ?? []) as Array<{ user_id: string }>) {
      const r = await enviarPushAoUsuario(organizationId, m.user_id, payload);
      enviados += r.sent;
    }
    return enviados;
  } catch (erro) {
    logger.warn("[leads-da-meta] push do aviso de falha não saiu", {
      organization_id: organizationId,
      detalhe: erro instanceof Error ? erro.message.slice(0, 200) : String(erro),
    });
    return 0;
  }
}

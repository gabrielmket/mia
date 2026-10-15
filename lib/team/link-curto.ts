/**
 * FORK MIA (9023) — O LINK CURTO DO CONVITE DE EQUIPE.
 *
 * ── Por que existe ────────────────────────────────────────────────────────
 *
 * O link do convite é `/team/accept-invite/<token>`, e o token é o convite
 * inteiro assinado (`lib/auth/invite-token.ts`): mais de 300 caracteres. Colado
 * no WhatsApp para a pessoa convidada, vira um bloco ilegível. O link curto é
 * `/c/<código>`, e cai no MESMO aceite.
 *
 * ── O código ──────────────────────────────────────────────────────────────
 *
 * 12 caracteres sorteados (`randomInt`, uniforme) de um alfabeto de 31 sem os
 * que se confundem lidos ou digitados (`0`/`o`, `1`/`l`/`i`): 31^12 ≈ 7,9·10^17,
 * cerca de 59 bits. A conta que fecha o tamanho: com mil convites vivos ao mesmo
 * tempo, um atacante que varra 60 códigos por hora (o teto por IP da rota) de
 * DEZ MIL IPs durante os 15 dias de validade faz ~2·10^8 tentativas, e a chance
 * de acertar algum convite é ~3·10^-7. Sem o teto (instalação sem proxy, onde o
 * IP não chega: ver `lib/auth/rate-limit.ts`), mil tentativas por segundo nos
 * mesmos 15 dias dão ~2·10^-6. Com 10 caracteres a segunda conta subiria para
 * ~2·10^-3, que já não é desprezível para um link que dá acesso a uma empresa.
 *
 * ── Onde mora ─────────────────────────────────────────────────────────────
 *
 * Só o HASH, na linha do convite (`team_invites.codigo_curto_hash`, migration
 * 9023, índice único). O código cru nunca é gravado, nem na auditoria. O hash é
 * um HMAC-SHA256 com o segredo do servidor (a mesma cadeia do token do convite):
 * a coluna é legível por gerente e administrador da empresa pela RLS do upstream
 * (0238), e um SHA-256 puro de 59 bits poderia ser quebrado fora do servidor por
 * quem a lesse. Com o segredo, o valor não serve para nada fora daqui.
 *
 * Como o código cru não fica guardado, "copiar o link de novo" é GERAR um código
 * novo, que substitui o anterior na mesma coluna: o link anterior deixa de valer.
 *
 * ── Quando morre ──────────────────────────────────────────────────────────
 *
 * Junto com o convite. Aceito ou revogado (inclusive a revogação em massa quando
 * a empresa vira demonstração, 9010): o gatilho da 9023 zera o hash na mesma
 * escrita. Vencido: a resolução confere `expires_at`. Reenviado: o reenvio gera
 * código novo (o e-mail novo leva o link novo).
 *
 * ── O que a rota curta NÃO faz ────────────────────────────────────────────
 *
 * Não aceita nada. Ela só resolve o código e redireciona para a página de aceite
 * de sempre, que no GET também não aceita: quem aceita é o botão (server action).
 * O Outlook, o Hotmail e o WhatsApp abrem o link sozinhos para conferir ou montar
 * a prévia, e essa visita não pode gastar o convite (a mesma lição do PR #2183
 * do upstream, no `/auth/confirm`).
 */
import { createHmac, randomInt } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import type { AuthRateLimits } from "@/lib/auth/rate-limit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { statusConvite, type StatusConvite } from "@/lib/team/convite-status";
// Só o TIPO: `convites.ts` importa este módulo, e um import de valor fecharia o ciclo.
import type { ConviteDeTime } from "@/lib/team/convites";

/** Sem `0`, `1`, `i`, `l` e `o`: nada que se confunda lido no celular ou digitado. */
export const ALFABETO_DO_LINK_CURTO = "23456789abcdefghjkmnpqrstuvwxyz";
export const TAMANHO_DO_LINK_CURTO = 12;

/** A coluna da migration 9023. */
export const COLUNA_DO_LINK_CURTO = "codigo_curto_hash";

/** O caminho da rota curta (`app/c/[codigo]/page.tsx`). */
export const CAMINHO_DO_LINK_CURTO = "/c/";

/**
 * O teto da rota curta, por IP, com o limitador do login e do aceite
 * (`authRateLimited`). Balde próprio, com o mesmo número do aceite
 * (`AUTH_LIMITS.invite_accept`): quem abre o próprio convite gasta um aqui e um
 * lá. Mais apertado que isso pesaria em quem manda vários convites pelo
 * WhatsApp do mesmo celular, porque a prévia de cada link sai dali.
 */
export const ROTULO_DO_LIMITE_DO_LINK_CURTO = "invite_short_link";
export const LIMITE_DO_LINK_CURTO: AuthRateLimits = { ip: 60, windowSec: 3600 };

const FORMA_DO_CODIGO = new RegExp(`^[${ALFABETO_DO_LINK_CURTO}]{${TAMANHO_DO_LINK_CURTO}}$`);

/** As colunas que a tela lista (as de `GET /api/v1/team/invites`), sem o hash. */
const COLUNAS_DO_CONVITE =
  "id, organization_id, email, role, interface_settings, invited_by, inviter_name, email_dispatched, created_at, last_sent_at, resend_count, expires_at, accepted_at, revoked_at";

/**
 * O segredo do HMAC: a MESMA cadeia do token do convite (`lib/auth/invite-token.ts`).
 * Repetida aqui, e não importada, para não tocar no arquivo do upstream. Se um
 * dia as duas divergirem, nada quebra: o hash só precisa de um segredo do
 * servidor que não mude a cada deploy. Trocar o segredo invalida os links curtos
 * em aberto, como já invalida os links longos.
 */
function segredo(): string {
  return process.env.INVITE_TOKEN_SECRET ?? process.env.INTERNAL_SECRET ?? "dev-fallback";
}

export function gerarCodigoCurto(): string {
  let codigo = "";
  for (let i = 0; i < TAMANHO_DO_LINK_CURTO; i += 1) {
    codigo += ALFABETO_DO_LINK_CURTO.charAt(randomInt(ALFABETO_DO_LINK_CURTO.length));
  }
  return codigo;
}

/**
 * O código como veio na URL, ou `null` quando não tem a forma de um código.
 * Maiúscula vale (quem digita o link do celular), espaço nas pontas também.
 */
export function normalizarCodigoCurto(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const codigo = bruto.trim().toLowerCase();
  return FORMA_DO_CODIGO.test(codigo) ? codigo : null;
}

/** HMAC-SHA256 em hex (64 caracteres): a única forma que a coluna aceita. */
export function hashDoCodigoCurto(codigo: string): string {
  return createHmac("sha256", segredo()).update(`convite-curto:v1:${codigo}`).digest("hex");
}

export function enderecoDoLinkCurto(codigo: string): string {
  return `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}${CAMINHO_DO_LINK_CURTO}${codigo}`;
}

export interface LinkCurtoNovo {
  /** Vai no e-mail e na resposta, e em lugar nenhum mais. */
  codigo: string;
  /** Vai para a coluna. */
  hash: string;
  url: string;
}

export function novoLinkCurto(): LinkCurtoNovo {
  const codigo = gerarCodigoCurto();
  return { codigo, hash: hashDoCodigoCurto(codigo), url: enderecoDoLinkCurto(codigo) };
}

/**
 * O convite PENDENTE dono deste código, ou `null`.
 *
 * `null` para tudo que não serve, sem distinguir: código malformado, que não
 * existe, de convite vencido, aceito ou revogado. Quem está varrendo códigos não
 * pode aprender nada com a resposta. Erro do banco também vira `null` (com
 * registro no servidor, sem o código): é a mesma tela de "convite inválido", e
 * a pessoa tenta de novo.
 *
 * Só LÊ. Nenhuma escrita acontece aqui: abrir o link não muda o convite.
 */
export async function resolverLinkCurto(
  admin: SupabaseClient,
  bruto: unknown,
  agora: number = Date.now(),
): Promise<ConviteDeTime | null> {
  const codigo = normalizarCodigoCurto(bruto);
  if (!codigo) return null;
  const { data, error } = await admin
    .from("team_invites")
    .select(COLUNAS_DO_CONVITE)
    .eq(COLUNA_DO_LINK_CURTO, hashDoCodigoCurto(codigo))
    .is("accepted_at", null)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) {
    logger.warn("[team.link-curto] a resolução do link curto falhou no banco", {
      codigo_do_banco: error.code ?? null,
    });
    return null;
  }
  if (!data) return null;
  const convite = data as unknown as ConviteDeTime;
  return statusConvite(convite, agora) === "pendente" ? convite : null;
}

export type ResultadoDaTroca =
  | { ok: true; link_curto: string; expira_em: string }
  | { ok: false; motivo: "nao_encontrado" | Exclude<StatusConvite, "pendente"> | "mudou" };

/**
 * GERA um link curto novo para um convite pendente: grava o hash do código novo
 * na linha (o anterior deixa de valer) e audita `member.invite_link_created`,
 * com quem pediu e qual convite, sem o código.
 *
 * Usada pela ação "Copiar link do convite" da tela de Equipe
 * (`POST /api/v1/team/invites/[id]/link-curto`) e pelo MCP de plataforma
 * (`plataforma_convidar_pessoas` com `gerar_link`). Não manda e-mail e não muda
 * o prazo: convite vencido é recusado, e a saída é o Reenviar, que renova.
 *
 * `organizationId` vem da fonte confiável (a sessão, o token de plataforma),
 * nunca do corpo do pedido.
 */
export async function trocarLinkCurto(
  admin: SupabaseClient,
  params: {
    organizationId: string;
    conviteId: string;
    actorUserId: string;
    requestId: string;
    via: "tela" | "mcp_plataforma";
  },
): Promise<ResultadoDaTroca> {
  const { data: lida, error: erroDeLeitura } = await admin
    .from("team_invites")
    .select(COLUNAS_DO_CONVITE)
    .eq("organization_id", params.organizationId)
    .eq("id", params.conviteId)
    .maybeSingle();
  if (erroDeLeitura) throw new Error(`não consegui ler o convite: ${erroDeLeitura.message}`);
  if (!lida) return { ok: false, motivo: "nao_encontrado" };
  const convite = lida as unknown as ConviteDeTime;
  const status = statusConvite(convite);
  if (status !== "pendente") return { ok: false, motivo: status };

  const novo = novoLinkCurto();
  // A escrita repete as condições: um aceite ou uma revogação entre a leitura e
  // aqui não ganham um link novo. O prazo não precisa: link de convite vencido
  // nunca resolve (`resolverLinkCurto` confere `expires_at`).
  const { data: gravada, error: erroDeEscrita } = await admin
    .from("team_invites")
    .update({ [COLUNA_DO_LINK_CURTO]: novo.hash })
    .eq("organization_id", params.organizationId)
    .eq("id", params.conviteId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id, expires_at")
    .maybeSingle();
  if (erroDeEscrita) throw new Error(`não consegui gravar o link novo: ${erroDeEscrita.message}`);
  if (!gravada) return { ok: false, motivo: "mudou" };

  await audit({
    action: "member.invite_link_created",
    actorUserId: params.actorUserId,
    organizationId: params.organizationId,
    resourceType: "membership",
    resourceId: params.conviteId,
    requestId: params.requestId,
    // Sem o código e sem o hash: a trilha diz quem gerou e para qual convite.
    metadata: { role: convite.role, expires_at: convite.expires_at, via: params.via },
  });

  return { ok: true, link_curto: novo.url, expira_em: convite.expires_at };
}

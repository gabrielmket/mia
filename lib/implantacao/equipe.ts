/**
 * FORK MIA — a EQUIPE de um cliente: quem faz parte, quem foi convidado, e o
 * convite de uma pessoa nova.
 *
 * ── O caminho da tela que isto reusa ──────────────────────────────────────
 *
 * `emitirConvite` (`lib/team/convites.ts`), a função de
 * `POST /api/v1/team/invite`: assina o token, MANDA O E-MAIL de convite, audita
 * `member.invited` e grava a linha em `team_invites` (o que a tela de Equipe
 * lista e o que torna possível revogar). A pessoa só entra na empresa quando
 * aceita o convite pelo link.
 *
 * ── Por que esta operação tem chave própria no token ──────────────────────
 *
 * Convidar é a escrita que entrega dado de TERCEIRO: quem aceita passa a ler
 * as conversas dos clientes daquela empresa. E ela sai da plataforma: é um
 * e-mail para um endereço que o token escolheu.
 *
 * ── Repetir sem reenviar ──────────────────────────────────────────────────
 *
 * `emitirConvite` renova o convite pendente e manda o e-mail de novo. Numa
 * implantação que roda mais de uma vez isso viraria um e-mail por rodada. Aqui,
 * quem já é da equipe é pulado, e convite pendente com o MESMO papel e ainda
 * válido não é reenviado, a não ser com `reenviar: true`.
 *
 * ── A empresa de demonstração ─────────────────────────────────────────────
 *
 * Convite é e-mail, e a empresa de demonstração não manda nada para fora. O
 * roteador de e-mail e o banco já recusam; a ferramenta recusa antes, com a
 * frase da trava, para a resposta ser uma explicação e não um erro de banco.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { FRASE_DA_DEMONSTRACAO, ehRecusaDaDemonstracao, travaDaDemonstracao } from "@/lib/demonstracao/trava";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import { INTERFACE_COMPLETA, interfaceTemDestino } from "@/lib/navigation/interface";
import { ROLES, type Role } from "@/lib/schemas/team";
import { conviteEstaEmAberto, emitirConvite, statusConvite, type ConviteDeTime } from "@/lib/team/convites";

import type { Implantacao, OrganizacaoDaImplantacao } from "./base";

/** Quantas pessoas uma chamada convida. O mesmo teto da tela. */
export const TETO_DE_CONVITES = 20;

export interface Membro {
  user_id: string;
  email: string | null;
  nome: string | null;
  papel: string;
  ativo: boolean;
  entrou_em: string | null;
}

/**
 * Os membros da organização, com o e-mail de cada um.
 *
 * O schema `auth` não é alcançável pelo PostgREST: o e-mail vem da API de
 * administração do GoTrue, um usuário por vez, como em `GET /api/v1/team`. A
 * equipe de um cliente tem poucas pessoas.
 */
export async function lerMembros(admin: SupabaseClient, orgId: string): Promise<Membro[]> {
  const { data, error } = await admin
    .from("user_organizations")
    .select("user_id, role, accepted_at, revoked_at, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`não consegui ler a equipe: ${error.message}`);
  const linhas = (data ?? []) as Array<{ user_id: string; role: string; accepted_at: string | null; revoked_at: string | null }>;
  return Promise.all(
    linhas.map(async (m) => {
      let email: string | null = null;
      let nome: string | null = null;
      try {
        const { data: usuario } = await admin.auth.admin.getUserById(m.user_id);
        email = usuario?.user?.email?.trim().toLowerCase() ?? null;
        nome = (usuario?.user?.user_metadata?.full_name as string | undefined) ?? null;
      } catch {
        // Sem o e-mail a linha ainda diz papel e situação.
      }
      return { user_id: m.user_id, email, nome, papel: m.role, ativo: m.revoked_at === null, entrou_em: m.accepted_at };
    }),
  );
}

/** A pessoa da equipe por e-mail (ou id), ou a recusa que diz quem existe. */
export function acharMembro(membros: Membro[], referencia: string): Membro {
  const ref = referencia.trim().toLowerCase();
  const achado = membros.find((m) => m.ativo && (m.user_id === ref || m.email === ref));
  if (achado) return achado;
  const lista = membros.filter((m) => m.ativo).map((m) => m.email ?? m.user_id);
  throw new Recusa(
    `«${referencia}» não faz parte da equipe desta organização. ` +
      (lista.length > 0 ? `A equipe é: ${lista.join(", ")}. ` : "") +
      "Quem ainda não aceitou o convite não aparece: a pessoa entra na equipe quando aceita, pelo link do e-mail.",
  );
}

export interface ConviteLido {
  id: string;
  email: string;
  papel: string;
  situacao: string;
  email_enviado: boolean;
  expira_em: string;
}

export async function lerConvites(admin: SupabaseClient, orgId: string): Promise<ConviteLido[]> {
  const { data, error } = await admin
    .from("team_invites")
    .select("id, organization_id, email, role, interface_settings, invited_by, inviter_name, email_dispatched, created_at, last_sent_at, resend_count, expires_at, accepted_at, revoked_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`não consegui ler os convites: ${error.message}`);
  const agora = Date.now();
  return ((data ?? []) as ConviteDeTime[]).map((c) => ({
    id: c.id,
    email: c.email,
    papel: c.role,
    situacao: statusConvite(c, agora),
    email_enviado: c.email_dispatched,
    expira_em: c.expires_at,
  }));
}

export interface ConviteFeito {
  email: string;
  papel: string;
  desfecho: "convidou" | "reenviou" | "ja_convidado" | "ja_e_membro";
  email_enviado?: boolean;
  motivo_do_email?: string;
  expira_em?: string;
}

export async function convidarPessoas(
  c: Implantacao,
  org: OrganizacaoDaImplantacao,
  pedido: { pessoas: Array<{ email: string; papel: string }>; reenviar?: boolean },
): Promise<{ convites: ConviteFeito[]; avisos: string[] }> {
  // Falha fechada: se não der para confirmar que a empresa é de verdade, não sai e-mail.
  const trava = org.demonstracao ? { travado: true as const } : await travaDaDemonstracao(c.admin, c.orgId);
  if (trava.travado) {
    throw new Recusa(
      `${FRASE_DA_DEMONSTRACAO} Convite de equipe é um e-mail, então não é enviado. ` +
        "Para dar acesso à demonstração, quem opera a plataforma inclui a pessoa pelo script da empresa modelo (docs/fork/cliente-modelo.md).",
    );
  }

  for (const [i, p] of pedido.pessoas.entries()) {
    if (!(ROLES as readonly string[]).includes(p.papel)) {
      throw new Recusa(`pessoas[${i}].papel: «${p.papel}» não é um papel. Use um de: ${ROLES.join(", ")}.`);
    }
    if (!interfaceTemDestino(INTERFACE_COMPLETA, p.papel as Role)) {
      throw new Recusa(`pessoas[${i}].papel: o papel «${p.papel}» não tem nenhuma área para abrir.`);
    }
  }

  const membros = await lerMembros(c.admin, c.orgId);
  const emailsDaEquipe = new Set(membros.filter((m) => m.ativo && m.email).map((m) => m.email as string));

  const { data: pendentesBrutos, error } = await c.admin
    .from("team_invites")
    .select("id, organization_id, email, role, interface_settings, invited_by, inviter_name, email_dispatched, created_at, last_sent_at, resend_count, expires_at, accepted_at, revoked_at")
    .eq("organization_id", c.orgId);
  if (error) throw new Error(`não consegui ler os convites pendentes: ${error.message}`);
  const agora = Date.now();
  const pendentes = ((pendentesBrutos ?? []) as ConviteDeTime[]).filter(
    (x) => conviteEstaEmAberto(x, agora) && statusConvite(x, agora) === "pendente",
  );

  // Quem assina o convite: a pessoa que criou o token.
  let nomeDeQuemConvida = "A equipe da plataforma";
  try {
    const { data: autor } = await c.admin.auth.admin.getUserById(c.autorUserId);
    nomeDeQuemConvida =
      (autor?.user?.user_metadata?.full_name as string | undefined) ?? autor?.user?.email ?? nomeDeQuemConvida;
  } catch {
    // O nome é cortesia do e-mail; sem ele o convite sai com o padrão.
  }

  const convites: ConviteFeito[] = [];
  const avisos: string[] = [];
  for (const pessoa of pedido.pessoas) {
    const email = pessoa.email.trim().toLowerCase();
    if (emailsDaEquipe.has(email)) {
      convites.push({ email, papel: pessoa.papel, desfecho: "ja_e_membro" });
      continue;
    }
    const pendente = pendentes.find((x) => x.email === email);
    if (pendente && pendente.role === pessoa.papel && !pedido.reenviar) {
      convites.push({
        email,
        papel: pessoa.papel,
        desfecho: "ja_convidado",
        email_enviado: pendente.email_dispatched,
        expira_em: pendente.expires_at,
      });
      continue;
    }
    try {
      const emitido = await emitirConvite(c.admin, {
        email,
        role: pessoa.papel as Role,
        organizationId: c.orgId,
        orgName: org.display_name,
        inviterId: c.autorUserId,
        inviterName: nomeDeQuemConvida,
        requestId: c.requestId,
      });
      convites.push({
        email,
        papel: pessoa.papel,
        desfecho: emitido.renovado ? "reenviou" : "convidou",
        email_enviado: emitido.email_dispatched,
        ...(emitido.email_error ? { motivo_do_email: emitido.email_error } : {}),
        expira_em: emitido.convite.expires_at,
      });
      if (!emitido.email_dispatched) {
        avisos.push(
          `O convite de ${email} foi criado, mas o e-mail NÃO saiu (${emitido.email_error ?? "sem transporte de e-mail"}). ` +
            "Uma pessoa copia o link do convite na tela de Equipe (/app/team) e manda por outro canal.",
        );
      }
    } catch (err) {
      if (ehRecusaDaDemonstracao(err as { code?: string; message?: string })) {
        throw new Recusa(`${FRASE_DA_DEMONSTRACAO} Convite de equipe é um e-mail, então não é enviado.`);
      }
      throw err;
    }
  }
  return { convites, avisos };
}

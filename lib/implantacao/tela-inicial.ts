/**
 * FORK MIA (upstream 1.118, #4864, MIA-79) — a TELA INICIAL da empresa e de
 * cada pessoa: a porta que abre logo depois de entrar.
 *
 * É a chave `inicio` do mesmo jsonb do menu (`interface_settings`), na linha da
 * EMPRESA (`organizations`) e na do VÍNCULO (`user_organizations`). A do
 * vínculo vence a da empresa (`combinarInterfaces`), e nenhuma das duas abre
 * porta: `homeDaInterface` só obedece enquanto a porta estiver visível para a
 * pessoa; fora disso, a entrada volta à regra de sempre (Inbox, senão a
 * primeira área do menu).
 *
 * ── De onde vem cada regra (nenhuma é reescrita aqui) ─────────────────────
 *
 *   o formato e o vocabulário   `interfaceSettingsSchema` (só porta do catálogo)
 *   as opções oferecidas         as de `TelaInicialSelect`: o que a pessoa
 *                                enxerga, menos as portas essenciais. Na
 *                                empresa, o menu da própria empresa; na pessoa,
 *                                a interseção dela com a empresa
 *   a gravação da empresa        a de `atualizarInterfaceDaEmpresa`: troca só a
 *                                `inicio`, deixa o menu e a trava do Inbox
 *                                como estão, derruba o cache do menu de todos
 *                                (`invalidarOrg`), audita `org.interface_changed`
 *                                e publica `org.updated`
 *   a gravação da pessoa         a de `PATCH /api/v1/team/[user_id]/interface`:
 *                                só vínculo ativo e aceito, derruba o cache da
 *                                pessoa (`invalidarUsuario`) e audita
 *                                `team.interface_changed`
 *
 * O que NÃO faz: não mexe nas áreas do menu (o que aparece), não muda papel nem
 * permissão, e não fala com ninguém de fora da empresa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { invalidarOrg, invalidarUsuario } from "@/lib/auth/cache-curto";
import type { Role } from "@/lib/auth/types";
import { Recusa } from "@/lib/mcp-plataforma/recusa";
import {
  combinarInterfaces,
  destinosDaInterface,
  essencial,
  interfaceSettingsSchema,
  lerInterface,
  type InterfaceSettings,
} from "@/lib/navigation/interface";
import type { createAdminClient } from "@/lib/supabase/admin";

import type { Desfecho, Implantacao } from "./base";
import { acharMembro, lerMembros } from "./equipe";

/** O papel com que a tela da EMPRESA monta as opções: quem a edita é administrador. */
const PAPEL_DE_QUEM_ADMINISTRA: Role = "admin";

export interface OpcaoDeTelaInicial {
  tela: string;
  rotulo: string;
}

/** As portas que a tela ofereceria no seletor "Tela inicial" (as essenciais ficam de fora). */
export function opcoesDeTelaInicial(visiveis: unknown, papel: Role): OpcaoDeTelaInicial[] {
  return destinosDaInterface(visiveis, false, papel)
    .filter((d) => !essencial(d, papel))
    .map((d) => ({ tela: d.href, rotulo: d.label }));
}

function papelDoVinculo(role: string): Role {
  return (["viewer", "agent", "ai_operator", "manager", "admin"] as const).includes(role as Role)
    ? (role as Role)
    : "viewer";
}

function comInicio(settings: InterfaceSettings, tela: string | null): InterfaceSettings {
  const { inicio: _anterior, ...resto } = settings;
  const novo = tela ? { ...resto, inicio: tela } : resto;
  // O MESMO schema da tela e da rota confere o que vai ser gravado.
  const conferido = interfaceSettingsSchema.safeParse(novo);
  if (!conferido.success) {
    throw new Recusa(`«${tela}» não é uma tela do menu. Os valores aceitos saem de \`opcoes\` em plataforma_ver_configuracao, seção equipe.`);
  }
  return conferido.data;
}

function recusarForaDasOpcoes(tela: string, opcoes: OpcaoDeTelaInicial[], quem: string): never {
  throw new Recusa(
    `A tela «${tela}» não está no menu ${quem}, e a entrada nunca abre tela que a pessoa não enxerga (voltaria ao padrão). ` +
      (opcoes.length > 0
        ? `As opções são: ${opcoes.map((o) => `${o.tela} (${o.rotulo})`).join(", ")}. `
        : "") +
      "Para oferecer outra, primeiro a área precisa aparecer no menu (Configurações › Empresa › Menu lateral).",
  );
}

/** O que a leitura devolve: a tela da empresa, as opções e a escolha de cada pessoa. */
export interface TelasIniciais {
  da_empresa: string | null;
  opcoes_da_empresa: OpcaoDeTelaInicial[];
  por_pessoa: Map<string, string | null>;
}

export async function lerTelasIniciais(admin: SupabaseClient, orgId: string): Promise<TelasIniciais> {
  const [org, vinculos] = await Promise.all([
    admin.from("organizations").select("interface_settings").eq("id", orgId).maybeSingle(),
    admin.from("user_organizations").select("user_id, interface_settings").eq("organization_id", orgId),
  ]);
  if (org.error) throw new Error(`não consegui ler o menu da empresa: ${org.error.message}`);
  if (vinculos.error) throw new Error(`não consegui ler o menu da equipe: ${vinculos.error.message}`);
  const daEmpresa = (org.data as { interface_settings?: unknown } | null)?.interface_settings ?? null;
  const porPessoa = new Map<string, string | null>();
  for (const v of (vinculos.data ?? []) as Array<{ user_id: string; interface_settings: unknown }>) {
    porPessoa.set(v.user_id, lerInterface(v.interface_settings).settings.inicio ?? null);
  }
  return {
    da_empresa: lerInterface(daEmpresa).settings.inicio ?? null,
    opcoes_da_empresa: opcoesDeTelaInicial(daEmpresa, PAPEL_DE_QUEM_ADMINISTRA),
    por_pessoa: porPessoa,
  };
}

export interface PedidoDeTelaInicial {
  /** Um href do catálogo (ex.: "/app/kanban"), ou `null` para voltar ao padrão. */
  tela: string | null;
  /** E-mail ou id de uma pessoa da equipe. Ausente = a tela da EMPRESA. */
  pessoa?: string;
}

export interface TelaInicialDefinida {
  desfecho: Desfecho;
  de: "empresa" | "pessoa";
  pessoa?: { user_id: string; email: string | null };
  tela_inicial: string | null;
  opcoes: OpcaoDeTelaInicial[];
  aviso?: string;
}

export async function definirTelaInicial(c: Implantacao, pedido: PedidoDeTelaInicial): Promise<TelaInicialDefinida> {
  const tela = pedido.tela?.trim() || null;
  const admin = c.admin as ReturnType<typeof createAdminClient>;
  return pedido.pessoa === undefined
    ? definirDaEmpresa(admin, c, tela)
    : definirDaPessoa(admin, c, tela, pedido.pessoa);
}

async function definirDaEmpresa(
  // Tipado pela fábrica do cliente admin: a cerca `escrita-em-organizations-usa-cliente-admin`
  // só aceita escrita em `organizations` de um cliente que seja admin PELO TIPO.
  admin: ReturnType<typeof createAdminClient>,
  c: Implantacao,
  tela: string | null,
): Promise<TelaInicialDefinida> {
  // Comparar e trocar pelo `updated_at`, como `mudarSettingsDaOrganizacao`: o
  // menu e a trava do Inbox moram no mesmo jsonb, e outra escrita no meio não
  // pode ser desfeita por esta.
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    const { data, error } = await admin
      .from("organizations")
      .select("interface_settings, updated_at")
      .eq("id", c.orgId)
      .maybeSingle();
    if (error) throw new Error(`não consegui ler o menu da empresa: ${error.message}`);
    if (!data) throw new Recusa(`Não existe organização com o id ${c.orgId}.`);
    const linha = data as { interface_settings: unknown; updated_at: string };
    const atual = lerInterface(linha.interface_settings).settings;
    const opcoes = opcoesDeTelaInicial(atual, PAPEL_DE_QUEM_ADMINISTRA);
    if (tela && !opcoes.some((o) => o.tela === tela)) recusarForaDasOpcoes(tela, opcoes, "da empresa");
    if ((atual.inicio ?? null) === tela) {
      return { desfecho: "ja_estava", de: "empresa", tela_inicial: tela, opcoes };
    }
    const novo = comInicio(atual, tela);

    invalidarOrg(c.orgId);
    const { data: gravado, error: erroDaEscrita } = await admin
      .from("organizations")
      .update({ interface_settings: novo })
      .eq("id", c.orgId)
      .eq("updated_at", linha.updated_at)
      .select("id");
    if (erroDaEscrita) throw new Error(`não consegui gravar a tela inicial da empresa: ${erroDaEscrita.message}`);
    if (((gravado ?? []) as unknown[]).length === 0) continue;
    invalidarOrg(c.orgId);

    await audit({
      action: "org.interface_changed",
      organizationId: c.orgId,
      actorUserId: c.autorUserId,
      resourceType: "organization",
      resourceId: c.orgId,
      requestId: c.requestId,
      metadata: { fields_changed: ["interface_settings"], interface_settings: novo, via: "mcp_plataforma" },
    });
    // O mesmo evento da tela: quem escuta "a empresa mudou" não descobre recarregando.
    const { error: erroDoEvento } = await admin.rpc("emit_event", {
      p_event_type: "org.updated",
      p_entity_kind: "organization",
      p_entity_id: c.orgId,
      p_payload: { organization_id: c.orgId },
      p_metadata: { request_id: c.requestId },
      p_organization_id: c.orgId,
    });
    if (erroDoEvento) console.error("[definirTelaInicial] emit_event failed", erroDoEvento.message);

    return {
      desfecho: "atualizou",
      de: "empresa",
      tela_inicial: tela,
      opcoes,
      aviso:
        "Vale para quem não escolheu a própria tela inicial (a da pessoa vence a da empresa) e a partir da próxima entrada. " +
        "Quem não enxerga a área continua entrando pelo padrão.",
    };
  }
  throw new Error("o menu da empresa mudou várias vezes seguidas enquanto eu gravava. Chame de novo.");
}

async function definirDaPessoa(
  admin: ReturnType<typeof createAdminClient>,
  c: Implantacao,
  tela: string | null,
  referencia: string,
): Promise<TelaInicialDefinida> {
  const membro = acharMembro(await lerMembros(c.admin, c.orgId), referencia);
  if (!membro.entrou_em) {
    throw new Recusa(`«${referencia}» ainda não aceitou o convite: a tela inicial se escolhe depois que a pessoa entra na equipe.`);
  }
  const [{ data: org, error: erroDaEmpresa }, { data: vinculo, error: erroDoVinculo }] = await Promise.all([
    admin.from("organizations").select("interface_settings").eq("id", c.orgId).maybeSingle(),
    admin
      .from("user_organizations")
      .select("id, role, interface_settings")
      .eq("organization_id", c.orgId)
      .eq("user_id", membro.user_id)
      .is("revoked_at", null)
      .not("accepted_at", "is", null)
      .maybeSingle(),
  ]);
  if (erroDaEmpresa) throw new Error(`não consegui ler o menu da empresa: ${erroDaEmpresa.message}`);
  if (erroDoVinculo) throw new Error(`não consegui ler o vínculo da pessoa: ${erroDoVinculo.message}`);
  if (!vinculo) throw new Recusa(`«${referencia}» não tem vínculo ativo nesta empresa.`);
  const v = vinculo as { id: string; role: string; interface_settings: unknown };
  const papel = papelDoVinculo(v.role);
  const doVinculo = lerInterface(v.interface_settings).settings;
  // As opções da pessoa são a INTERSEÇÃO com a empresa, como no diálogo da Equipe.
  const opcoes = opcoesDeTelaInicial(
    combinarInterfaces((org as { interface_settings?: unknown } | null)?.interface_settings ?? null, doVinculo),
    papel,
  );
  const pessoa = { user_id: membro.user_id, email: membro.email };
  if (tela && !opcoes.some((o) => o.tela === tela)) recusarForaDasOpcoes(tela, opcoes, `de ${membro.email ?? membro.user_id}`);
  if ((doVinculo.inicio ?? null) === tela) {
    return { desfecho: "ja_estava", de: "pessoa", pessoa, tela_inicial: tela, opcoes };
  }
  const novo = comInicio(doVinculo, tela);

  invalidarUsuario(membro.user_id);
  const { data: gravado, error } = await admin
    .from("user_organizations")
    .update({ interface_settings: novo })
    .eq("organization_id", c.orgId)
    .eq("user_id", membro.user_id)
    .eq("role", v.role)
    .is("revoked_at", null)
    .not("accepted_at", "is", null)
    .select("id");
  if (error) throw new Error(`não consegui gravar a tela inicial da pessoa: ${error.message}`);
  if (((gravado ?? []) as unknown[]).length === 0) {
    throw new Recusa("O vínculo da pessoa mudou enquanto eu gravava (papel ou acesso). Leia a equipe de novo e chame outra vez.");
  }
  invalidarUsuario(membro.user_id);

  await audit({
    action: "team.interface_changed",
    organizationId: c.orgId,
    actorUserId: c.autorUserId,
    resourceType: "membership",
    resourceId: v.id,
    requestId: c.requestId,
    metadata: { user_id: membro.user_id, interface_settings: novo, via: "mcp_plataforma" },
  });

  return {
    desfecho: "atualizou",
    de: "pessoa",
    pessoa,
    tela_inicial: tela,
    opcoes,
    aviso: tela
      ? "Vale a partir da próxima entrada da pessoa e vence a tela inicial da empresa."
      : "A pessoa volta a entrar pela tela inicial da empresa (ou pelo padrão, se a empresa não escolheu).",
  };
}

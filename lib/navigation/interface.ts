/** Apresentação por vínculo. Nunca é autorização de página, API ou ação. */
import { z } from "zod";
import { ROLE_RANK, type Role } from "@/lib/auth/types";
import { NAV_CATALOG, type NavMetadata, type NavDestinationId } from "./catalogo";
import { moduloDaTela } from "@/lib/modulos/catalogo";
import {
  mostraEmpresas,
  TELA_DE_EMPRESAS,
  type ModoDeVenda,
} from "@/lib/empresas/modo-de-venda";

const ids = NAV_CATALOG.map((d) => d.href);
export const interfaceSettingsSchema = z
  .object({
    preset: z.enum(["completa", "simplificada"]),
    destinos: z
      .array(z.enum(ids as [NavDestinationId, ...NavDestinationId[]]))
      .min(1)
      .max(ids.length)
      .transform((values) => ids.filter((id) => values.includes(id)))
      .optional(),
  })
  .strict();
export type InterfaceSettings = z.infer<typeof interfaceSettingsSchema>;
export const INTERFACE_COMPLETA: InterfaceSettings = { preset: "completa" };
const SIMPLIFICADA: readonly NavDestinationId[] = [
  "/app/inbox",
  "/app/agenda",
  "/app/kanban",
  "/app/contacts",
  "/app/tasks",
  "/app/connections",
];
/** Portas pessoais e recuperação administrativa não são removíveis. Atualização
 * e administração de plataforma têm consumidores próprios com seus gates atuais. */
export const PORTAS_ESSENCIAIS = [
  "/app/settings/profile",
  "/app/settings/security",
  "/app/team",
] as const;
export function essencial(d: NavMetadata, role: Role | null, platform = false): boolean {
  return (
    d.href === PORTAS_ESSENCIAIS[0] ||
    d.href === PORTAS_ESSENCIAIS[1] ||
    (d.href === PORTAS_ESSENCIAIS[2] && (platform || role === "admin"))
  );
}
export function canSee(
  d: Pick<NavMetadata, "href" | "minRole" | "somentePlataforma">,
  platform: boolean,
  role: Role | null,
): boolean {
  // Destino de plataforma não tem papel de tenant que alcance: o admin do
  // cliente é o dono do negócio dele, não da operação da plataforma.
  if (d.somentePlataforma) return platform;
  return platform || (!!role && ROLE_RANK[role] >= ROLE_RANK[d.minRole ?? "viewer"]);
}
export function permitidos(platform: boolean, role: Role | null): NavMetadata[] {
  return NAV_CATALOG.filter((d) => canSee(d, platform, role));
}
/** Leitura tolera versões antigas/removidas sem lançar no layout. */
export function lerInterface(raw: unknown): {
  settings: InterfaceSettings;
  needsAdjustment: boolean;
} {
  if (raw == null) return { settings: INTERFACE_COMPLETA, needsAdjustment: false };
  if (typeof raw !== "object") return { settings: INTERFACE_COMPLETA, needsAdjustment: true };
  const value = raw as Record<string, unknown>;
  const destinos = Array.isArray(value.destinos)
    ? ids.filter((id) => (value.destinos as unknown[]).includes(id))
    : undefined;
  const parsed = interfaceSettingsSchema.safeParse({
    preset: value.preset,
    ...(destinos ? { destinos } : {}),
  });
  if (!parsed.success) return { settings: INTERFACE_COMPLETA, needsAdjustment: true };
  return {
    settings: parsed.data,
    needsAdjustment: !!destinos && destinos.length !== (value.destinos as unknown[]).length,
  };
}
export function destinosDaInterface(
  raw: unknown,
  platform: boolean,
  role: Role | null,
  /**
   * O que a organização CONTRATOU. `undefined` = não se sabe, e aí nada é
   * escondido: a rota é que recusa, e sumir com a tela de quem pagou por não
   * ter carregado uma lista seria trocar um erro visível por um invisível.
   */
  modulos?: string[],
  /**
   * B2B ou B2C (item C2). `undefined` = não se sabe, e aí NADA some — mesma
   * regra dos módulos, pelo mesmo motivo: esconder por não ter carregado o
   * valor tiraria uma tela em uso, e "sumiu" é a mudança que o usuário não
   * reporta, ele só deixa de achar.
   *
   * ⚠️ Insumo de MENU, nunca de autorização: as rotas de `/api/v1/empresas`
   * continuam atendendo uma organização B2C que as chame. O modo esconde a
   * porta, não tranca — tratar preferência de tela como permissão é o que
   * transforma "não uso isso" em "perdi meus dados".
   */
  modoDeVenda?: ModoDeVenda,
): NavMetadata[] {
  const { settings } = lerInterface(raw);
  const allowed = permitidos(platform, role);
  const chosen =
    settings.destinos ?? (settings.preset === "simplificada" ? SIMPLIFICADA : undefined);
  const contratados = modulos ? new Set(modulos) : null;
  const semEmpresas = modoDeVenda !== undefined && !mostraEmpresas(modoDeVenda);
  return allowed.filter((d) => {
    // Admin de plataforma continua vendo: é ele quem configura o modo, e
    // precisa achar a tela para conferir o que o cliente vê — a mesma regra
    // que os módulos já aplicam logo abaixo.
    if (semEmpresas && d.href === TELA_DE_EMPRESAS && !platform) return false;
    if (contratados) {
      const exigido = moduloDaTela(d.href);
      // Admin de plataforma enxerga tudo: é ele quem libera, e precisa achar a
      // tela para conferir o que o cliente vê.
      if (exigido && !contratados.has(exigido) && !platform) return false;
    }
    return essencial(d, role, platform) || !chosen || chosen.includes(d.href as NavDestinationId);
  });
}
export function interfaceTemDestino(
  settings: InterfaceSettings,
  role: Role,
  platform = false,
): boolean {
  return destinosDaInterface(settings, platform, role).some((d) => !essencial(d, role, platform));
}
export function homeDaInterface(raw: unknown, platform: boolean, role: Role | null): string {
  const visible = destinosDaInterface(raw, platform, role);
  return (
    visible.find((d) => d.href === "/app/inbox")?.href ??
    visible.find((d) => !essencial(d, role, platform))?.href ??
    "/app/settings/profile"
  );
}

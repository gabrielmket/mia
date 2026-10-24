/**
 * FORK MIA (.88) — O MAPA DAS TELAS que o assistente conhece.
 *
 * Não existe uma segunda lista: é o catálogo de navegação (`NAV_CATALOG`, a
 * única lista de destinos do app). Cada tela já tem nome, descrição e o papel
 * mínimo, e é daí que saem o "onde fica", o "Me leva lá" e o "quem pode".
 * Tela nova que entra no catálogo entra no assistente sem ninguém lembrar.
 *
 * O que a pessoa ABRE sai de `destinosDaInterface`, a mesma régua do menu:
 * papel, interface por vínculo e módulo. O que ela NÃO abre continua conhecido,
 * para o assistente poder dizer "essa tela é do administrador" em vez de fingir
 * que ela não existe.
 *
 * Módulo PURO.
 */
import { ROLE_RANK, ROTULO_DO_PAPEL, type Role } from "@/lib/auth/types";
import { NAV_CATALOG, NAV_GROUPS, type NavMetadata } from "@/lib/navigation/catalogo";
import { destinosDaInterface } from "@/lib/navigation/interface";

export interface TelaConhecida {
  href: string;
  rotulo: string;
  descricao: string;
  grupo: string;
  /** O papel mínimo para abrir; `viewer` quando a tela não declara. */
  papelMinimo: Role;
  /** A pessoa que perguntou abre esta tela? */
  abre: boolean;
}

const TODAS: readonly NavMetadata[] = NAV_CATALOG as readonly NavMetadata[];

function rotuloDoGrupo(id: string): string {
  return NAV_GROUPS.find((g) => g.id === id)?.label ?? id;
}

/**
 * As telas do catálogo, marcadas com o que esta pessoa abre. As que são só da
 * plataforma (custo da IA) não aparecem: não são do negócio do cliente.
 */
export function telasParaOPapel(entrada: {
  papel: Role;
  interfaceSettings?: unknown;
  modulos?: string[];
}): TelaConhecida[] {
  const abertas = new Set(
    destinosDaInterface(entrada.interfaceSettings, false, entrada.papel, entrada.modulos).map((d) => d.href),
  );
  return TODAS.filter((d) => !d.somentePlataforma).map((d) => ({
    href: d.href,
    rotulo: d.label,
    descricao: d.description,
    grupo: rotuloDoGrupo(d.group),
    papelMinimo: d.minRole ?? "viewer",
    abre: abertas.has(d.href),
  }));
}

/** A porta do catálogo de um caminho (`/app/kanban/abc` → Funis), pelo prefixo mais longo. */
export function destinoDaTela(caminho: string | null | undefined): NavMetadata | null {
  if (!caminho) return null;
  let melhor: NavMetadata | null = null;
  for (const d of TODAS) {
    if (caminho === d.href || caminho.startsWith(`${d.href}/`)) {
      if (!melhor || d.href.length > melhor.href.length) melhor = d;
    }
  }
  return melhor;
}

/** O nome da tela de um caminho (`/app/kanban/abc` → "Funis"). */
export function rotuloDaTela(caminho: string | null | undefined): string | null {
  return destinoDaTela(caminho)?.label ?? null;
}

/** Quem pode abrir a tela, em português: "o administrador", "gestor ou administrador". */
export function quemAbre(papelMinimo: Role): string {
  if (ROLE_RANK[papelMinimo] >= ROLE_RANK.admin) return ROTULO_DO_PAPEL.admin;
  if (ROLE_RANK[papelMinimo] >= ROLE_RANK.manager) return `${ROTULO_DO_PAPEL.manager} ou ${ROTULO_DO_PAPEL.admin}`;
  return "toda a equipe";
}

/** Palavras de busca: minúsculas, sem acento, sem as de ligação. */
export function palavras(texto: string): string[] {
  const vazias = new Set([
    "como", "onde", "fica", "faco", "fazer", "para", "pra", "uma", "um", "o", "a", "os", "as", "de", "do", "da",
    "dos", "das", "no", "na", "nos", "nas", "eu", "meu", "minha", "que", "e", "em", "com", "por", "se", "qual",
    "quais", "tem", "ter", "ver", "vejo", "posso", "consigo", "mudar", "configurar", "configuro", "sistema",
  ]);
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3 && !vazias.has(p));
}

/** Quantas palavras da busca aparecem no texto (com prefixo de 5 letras: "conexao" casa "conexoes"). */
export function pontuar(busca: string[], texto: string): number {
  const alvo = palavras(texto);
  let pontos = 0;
  for (const p of busca) {
    const raiz = p.slice(0, Math.min(5, p.length));
    if (alvo.some((a) => a === p || a.startsWith(raiz))) pontos += 1;
  }
  return pontos;
}

/** As telas que mais casam com a pergunta, da mais para a menos parecida. */
export function buscarTelas(telas: readonly TelaConhecida[], pergunta: string, limite = 4): TelaConhecida[] {
  const busca = palavras(pergunta);
  if (busca.length === 0) return [];
  return telas
    .map((t) => ({ t, pontos: pontuar(busca, `${t.rotulo} ${t.rotulo} ${t.descricao} ${t.grupo}`) }))
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, limite)
    .map((x) => x.t);
}

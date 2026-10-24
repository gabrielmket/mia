/**
 * FORK MIA (.89) — O CLIQUE DE ROBÔ, e a abertura que é só estimativa.
 *
 * Filtros de segurança de empresa (e alguns provedores) abrem TODOS os links de
 * um e-mail logo que ele chega, para conferir se algum é perigoso. Contar esses
 * cliques faria uma campanha parecer um sucesso na primeira hora. A regra do
 * protótipo: o clique de robô de segurança (todos os links no primeiro minuto
 * depois de entregue) é descartado. O clique fica gravado (é o que aconteceu),
 * marcado `robo`, e sai das contas.
 *
 * A ABERTURA é sempre estimativa: o Apple Mail e alguns filtros abrem as imagens
 * sozinhos (conta a mais) e muita gente bloqueia imagens (conta a menos). Só é
 * medida em quem consentiu com o aviso de medição. Para decidir, use cliques.
 */
import { JANELA_DO_ROBO_SEGUNDOS } from "./regras";

/** Agentes de navegação de filtros de segurança conhecidos. */
const AGENTES_DE_ROBO = [
  /barracuda/i,
  /mimecast/i,
  /proofpoint/i,
  /symantec/i,
  /trend ?micro/i,
  /forcepoint/i,
  /sophos/i,
  /fortinet|fortiguard/i,
  /cisco|ironport/i,
  /microsoft office protection|safelinks|bingpreview/i,
  /googleimageproxy/i,
  /\bbot\b|crawler|spider|preview/i,
  /^python-requests|^curl\/|^wget\//i,
];

export function ehAgenteDeRobo(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").trim();
  if (!ua) return true;
  return AGENTES_DE_ROBO.some((r) => r.test(ua));
}

export interface CliqueVisto {
  linkId: string;
  clicadoEm: string;
}

/**
 * Os cliques deste destinatário no primeiro minuto depois de entregue cobrem
 * TODOS os links da campanha? Então foram de robô.
 */
export function cliquesDoPrimeiroMinutoSaoDeRobo(entrada: {
  cliques: readonly CliqueVisto[];
  totalDeLinks: number;
  entregueEm: string | null;
}): boolean {
  if (!entrada.entregueEm || entrada.totalDeLinks <= 0) return false;
  const inicio = Date.parse(entrada.entregueEm);
  const fim = inicio + JANELA_DO_ROBO_SEGUNDOS * 1000;
  const noMinuto = new Set(
    entrada.cliques
      .filter((c) => {
        const t = Date.parse(c.clicadoEm);
        return t >= inicio - 5_000 && t <= fim;
      })
      .map((c) => c.linkId),
  );
  return noMinuto.size >= entrada.totalDeLinks;
}

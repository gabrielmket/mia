/**
 * FORK MIA (.89) — o DNS: o domínio de quem recebe aceita e-mail?
 *
 * É o motivo "E-mail inválido" da conferência: `ana@example.con` tem forma de
 * endereço e o domínio não existe. Perguntar antes evita a rejeição, que conta
 * contra a reputação da conta inteira.
 *
 * A pergunta falha ABERTA: se o DNS não responder a tempo (ou responder com
 * outro erro que não "não existe"), o endereço conta como válido. Tirar alguém
 * da lista por um soluço do resolvedor seria pior que uma rejeição a mais, que
 * a Amazon devolve e a supressão aprende.
 */
import { promises as dnsPromises } from "node:dns";

import type { ResolvedoresDeDns } from "./dominio";
import { PROVEDORES_GRATUITOS } from "./regras";

export const DNS_DO_SISTEMA: ResolvedoresDeDns = {
  resolveCname: (n) => dnsPromises.resolveCname(n),
  resolveMx: (n) => dnsPromises.resolveMx(n),
  resolveTxt: (n) => dnsPromises.resolveTxt(n),
};

/** Os grandes provedores recebem e-mail: não vale perguntar ao DNS por eles. */
const SABIDAMENTE_RECEBEM = new Set<string>(PROVEDORES_GRATUITOS);

const NAO_EXISTE = new Set(["ENOTFOUND", "ENODATA", "ENODOMAIN", "NXDOMAIN"]);

async function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rejeitar) => {
        relogio = setTimeout(
          () => rejeitar(Object.assign(new Error("prazo"), { code: "ETIMEOUT" })),
          ms,
        );
      }),
    ]);
  } finally {
    if (relogio) clearTimeout(relogio);
  }
}

/**
 * Para cada domínio, se ele recebe e-mail: tem MX, ou (sem MX) tem endereço
 * (a regra antiga do SMTP). Pergunta a no máximo 10 domínios ao mesmo tempo.
 */
export async function dominiosQueRecebem(
  dominios: Iterable<string>,
  opcoes: {
    dns?: Pick<ResolvedoresDeDns, "resolveMx">;
    prazoMs?: number;
    resolve4?: (n: string) => Promise<string[]>;
  } = {},
): Promise<Map<string, boolean>> {
  const dns = opcoes.dns ?? DNS_DO_SISTEMA;
  const resolve4 = opcoes.resolve4 ?? ((n: string) => dnsPromises.resolve4(n));
  const prazo = opcoes.prazoMs ?? 3000;
  const saida = new Map<string, boolean>();
  const fila = [...new Set([...dominios].map((d) => d.trim().toLowerCase()).filter(Boolean))];
  for (const d of fila) if (SABIDAMENTE_RECEBEM.has(d)) saida.set(d, true);
  const perguntar = fila.filter((d) => !saida.has(d));

  async function um(d: string): Promise<void> {
    try {
      const mx = await comPrazo(dns.resolveMx(d), prazo);
      if (mx.length > 0) {
        // `0 .` é o "não recebe e-mail" declarado (RFC 7505).
        saida.set(d, !mx.every((m) => m.exchange === "" || m.exchange === "."));
        return;
      }
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      if (!NAO_EXISTE.has(code)) {
        saida.set(d, true);
        return;
      }
    }
    try {
      const a = await comPrazo(resolve4(d), prazo);
      saida.set(d, a.length > 0);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      saida.set(d, !NAO_EXISTE.has(code));
    }
  }

  for (let i = 0; i < perguntar.length; i += 10) {
    await Promise.all(perguntar.slice(i, i + 10).map(um));
  }
  return saida;
}

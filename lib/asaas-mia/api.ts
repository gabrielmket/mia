/**
 * FORK MIA (.96) · O CLIENTE HTTP DO ASAAS DA MIA (as cobranças do passo do
 * pagamento e da área de cobrança).
 *
 * É o molde de `lib/cobranca/provedores/asaas.ts` (o adaptador do upstream) e de
 * `lib/carteira/compra-pelo-asaas.ts` (.90), com as mesmas regras:
 *   - a chave do Asaas é a da tela de Cobrança (`chaveDoProvedor("asaas")`), lida
 *     a CADA chamada, e vai SÓ no cabeçalho `access_token`: nunca em URL, log,
 *     erro ou auditoria;
 *   - o modo e a base saem do prefixo da chave; a chave de produção nunca vai ao
 *     dublê em loopback do e2e (`baseDeTesteDaCobranca`);
 *   - toda falha sai como `ErroDoProvedor` com o status HTTP e o `code` do Asaas
 *     (`erroDoAsaas`), NUNCA a `description` nem o corpo, que ecoam dado do
 *     pagador (e, no cartão, poderiam ecoar o que foi digitado);
 *   - o Asaas não tem chave de idempotência: GET, PUT e DELETE repetem em 429,
 *     5xx e rede; POST repete só em 429, e o do cartão nunca repete;
 *   - toda resposta passa por Zod lendo só o que é usado.
 *
 * O CORPO DE UMA CHAMADA NUNCA É REGISTRADO: nem no log, nem no erro, nem no
 * Sentry. É o que deixa o cartão passar por aqui sem deixar rastro
 * (`./cartao.ts`, e a prova em `tests/unit/cartao-fora-dos-registros.test.ts`).
 */
import type { z } from "zod";

import { chaveDoProvedor } from "@/lib/cobranca/configuracao";
import { ASAAS_API_BASE, erroDoAsaas, modoDaChaveAsaas } from "@/lib/cobranca/provedores/asaas";
import { baseDeTesteDaCobranca } from "@/lib/cobranca/provedores/base-de-teste";
import { ErroDoProvedor } from "@/lib/cobranca/provedores/contrato";
import { logger } from "@/lib/logger";

export interface DependenciasDoAsaasDaMia {
  fetch?: typeof fetch;
  /** A chave em claro, lida a cada chamada. Padrão: a gravada na tela de Cobrança. */
  lerChave?: () => Promise<string | null>;
  agora?: () => Date;
  esperar?: (ms: number) => Promise<void>;
  /** A base do dublê (loopback). Padrão: `baseDeTesteDaCobranca()`. */
  baseDeTeste?: string | null;
}

export type Metodo = "GET" | "POST" | "PUT" | "DELETE";

const TENTATIVAS = 3;
const ESPERA_MAXIMA_MS = 5_000;
const TEMPO_LIMITE_MS = 20_000;

export interface ApiDoAsaas {
  credencial(): Promise<{ chave: string; base: string; modo: "teste" | "producao" }>;
  /**
   * `repetir: false` desliga TODA repetição (o pagamento com cartão: repetir um
   * POST que caiu na rede poderia cobrar duas vezes).
   */
  chamar(metodo: Metodo, caminho: string, corpo?: Record<string, unknown>, opcoes?: { repetir?: boolean }): Promise<unknown>;
  ler<T>(schema: z.ZodType<T>, dados: unknown): T;
  /** Link do Asaas que vira href ou botão: só https (http só no dublê em loopback). */
  linkSeguro(u: string | null | undefined): string | null;
  agora(): Date;
  readonly loopback: boolean;
}

export function apiDoAsaas(deps: DependenciasDoAsaasDaMia = {}): ApiDoAsaas {
  const buscar = deps.fetch ?? fetch;
  const teste = deps.baseDeTeste === undefined ? baseDeTesteDaCobranca() : deps.baseDeTeste;
  const esperar = deps.esperar ?? ((ms: number) => new Promise<void>((pronto) => setTimeout(pronto, ms)));
  const agora = deps.agora ?? (() => new Date());

  async function credencial() {
    const chave = await (deps.lerChave ?? (() => chaveDoProvedor("asaas")))();
    const modo = chave === null ? null : modoDaChaveAsaas(chave);
    if (chave === null || modo === null) throw new ErroDoProvedor(null, "sem_chave", false, true);
    if (teste === null) return { chave, base: ASAAS_API_BASE[modo], modo };
    if (modo === "producao") throw new ErroDoProvedor(null, "chave_real_fora_do_asaas", false, true);
    return { chave, base: `${teste.replace(/\/+$/, "")}/v3`, modo };
  }

  async function chamar(
    metodo: Metodo,
    caminho: string,
    corpo?: Record<string, unknown>,
    opcoes: { repetir?: boolean } = {},
  ): Promise<unknown> {
    const { chave, base } = await credencial();
    const headers: Record<string, string> = {
      access_token: chave,
      accept: "application/json",
      "user-agent": "cobranca-da-mia/1",
    };
    const body = corpo === undefined ? undefined : JSON.stringify(corpo);
    if (body !== undefined) headers["content-type"] = "application/json";
    for (let tentativa = 1; ; tentativa += 1) {
      let erro: ErroDoProvedor;
      let pedida: string | null = null;
      try {
        const r = await buscar(`${base}${caminho}`, {
          method: metodo,
          headers,
          body,
          cache: "no-store",
          signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        });
        if (r.ok) {
          const texto = await r.text().catch(() => "");
          if (texto.trim() === "") return {};
          try {
            return JSON.parse(texto) as unknown;
          } catch {
            // A mensagem do JSON.parse cita o texto: ela nunca sai daqui.
            throw new ErroDoProvedor(r.status, "resposta_invalida", false);
          }
        }
        erro = erroDoAsaas(r.status, await r.json().catch(() => null));
        pedida = r.headers.get("retry-after");
      } catch (e) {
        if (e instanceof ErroDoProvedor) throw e;
        // Rede, tempo esgotado: o erro do fetch nunca sobe (nem a mensagem dele).
        erro = new ErroDoProvedor(null, "sem_resposta", true);
      }
      const repetivel =
        opcoes.repetir !== false && (metodo === "POST" ? erro.status === 429 : erro.transitorio);
      if (!(tentativa < TENTATIVAS && repetivel)) throw erro;
      logger.warn("asaas_mia.nova_tentativa", { status: erro.status, codigo: erro.codigo, tentativa });
      const ms = pedida !== null && /^\d+$/.test(pedida) ? Number(pedida) * 1000 : 500 * 2 ** (tentativa - 1);
      await esperar(Math.min(ms, ESPERA_MAXIMA_MS));
    }
  }

  function ler<T>(schema: z.ZodType<T>, dados: unknown): T {
    const lido = schema.safeParse(dados);
    if (!lido.success) throw new ErroDoProvedor(200, "resposta_invalida", false);
    return lido.data;
  }

  function linkSeguro(u: string | null | undefined): string | null {
    if (!u || !URL.canParse(u)) return null;
    const esquema = new URL(u).protocol;
    return esquema === "https:" || (esquema === "http:" && teste !== null) ? u : null;
  }

  return { credencial, chamar, ler, linkSeguro, agora, loopback: teste !== null };
}

/** O código do erro para log e tela: só o `code` do Asaas (já filtrado), nunca texto livre. */
export function codigoDoErro(e: unknown): string {
  return e instanceof ErroDoProvedor ? e.codigo : "fora_do_asaas";
}

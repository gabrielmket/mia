/**
 * FORK MIA (.96) · "PREENCHER PELO CNPJ" E "BUSCAR" O CEP, no cadastro e no
 * passo do pagamento.
 *
 * O CNPJ usa a consulta da Receita que o sistema JÁ TEM: o cliente da BrasilAPI
 * do upstream (`lib/brasil-api/client.ts`, o mesmo do Vendas B2B e de
 * `consultarReceita`), e o mesmo mapeamento dos campos. Aqui não há empresa
 * ainda (o cadastro é anterior a ela): por isso não passa pela trava da
 * demonstração, e só devolve o que a nota precisa (razão social e endereço),
 * nunca o quadro de sócios.
 *
 * O CEP não tinha busca no sistema: vem da mesma BrasilAPI (`/cep/v2`), com o
 * mesmo `User-Agent` neutro que o cliente do upstream explica por que precisa.
 * Os dois nunca lançam.
 */
import { z } from "zod";

import { createBrasilApiClient, mapBrasilApiToCompanyFields, type BrasilApiClient } from "@/lib/brasil-api/client";

const BASE = "https://brasilapi.com.br/api";
const USER_AGENT = "self-hosted-crm/1.0";
const TEMPO_LIMITE_MS = 8_000;

export interface EnderecoAchado {
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
}

export type ResultadoDoCnpj =
  | { ok: true; razao_social: string | null; nome_fantasia: string | null; endereco: EnderecoAchado }
  | { ok: false; motivo: "cnpj_invalido" | "nao_encontrado" | "falhou" };

const limpo = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A razão social e o endereço do CNPJ, pela Receita (BrasilAPI). */
export async function consultarCnpjParaANota(
  cnpj: string,
  cliente: BrasilApiClient = createBrasilApiClient(),
): Promise<ResultadoDoCnpj> {
  const digitos = cnpj.replace(/\D/g, "");
  if (!/^\d{14}$/.test(digitos)) return { ok: false, motivo: "cnpj_invalido" };
  const r = await cliente.lookupCnpj(digitos);
  if (!r.ok) return { ok: false, motivo: r.code === "not_found" ? "nao_encontrado" : r.code === "invalid_cnpj" ? "cnpj_invalido" : "falhou" };
  const c = mapBrasilApiToCompanyFields(r.data);
  const cep = limpo(c.zip_code)?.replace(/\D/g, "") ?? null;
  return {
    ok: true,
    razao_social: limpo(c.legal_name),
    nome_fantasia: limpo(r.data.nome_fantasia),
    endereco: {
      cep: cep && cep.length === 8 ? cep : null,
      logradouro: limpo(c.street),
      numero: limpo(c.number),
      complemento: limpo(c.complement),
      bairro: limpo(c.district),
      cidade: limpo(c.city),
      uf: limpo(c.state)?.toUpperCase() ?? null,
    },
  };
}

const cepDaBrasilApi = z.object({
  cep: z.string().optional(),
  state: z.string().nullish(),
  city: z.string().nullish(),
  neighborhood: z.string().nullish(),
  street: z.string().nullish(),
});

export type ResultadoDoCep =
  | { ok: true; endereco: EnderecoAchado }
  | { ok: false; motivo: "cep_invalido" | "nao_encontrado" | "falhou" };

/** A rua, o bairro, a cidade e a UF do CEP (BrasilAPI). */
export async function consultarCep(cep: string, buscar: typeof fetch = fetch): Promise<ResultadoDoCep> {
  const digitos = cep.replace(/\D/g, "");
  if (!/^\d{8}$/.test(digitos)) return { ok: false, motivo: "cep_invalido" };
  try {
    const r = await buscar(`${BASE}/cep/v2/${digitos}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    if (r.status === 404) return { ok: false, motivo: "nao_encontrado" };
    if (!r.ok) return { ok: false, motivo: "falhou" };
    const lido = cepDaBrasilApi.safeParse(await r.json());
    if (!lido.success) return { ok: false, motivo: "falhou" };
    return {
      ok: true,
      endereco: {
        cep: digitos,
        logradouro: limpo(lido.data.street),
        numero: null,
        complemento: null,
        bairro: limpo(lido.data.neighborhood),
        cidade: limpo(lido.data.city),
        uf: limpo(lido.data.state)?.toUpperCase() ?? null,
      },
    };
  } catch {
    return { ok: false, motivo: "falhou" };
  }
}

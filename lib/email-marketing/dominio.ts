/**
 * FORK MIA (.89) — O DOMÍNIO DO REMETENTE e os SEIS registros de DNS.
 *
 * Gmail e Yahoo exigem de quem manda em volume: assinatura (DKIM), autorização
 * (SPF), política (DMARC) e um endereço de retorno para as rejeições. Sem os
 * seis, o e-mail vai para o spam ou volta — e por isso o envio TRAVA e diz qual
 * falta (decisão "Domínio verificado" do protótipo).
 *
 *   3 × CNAME  <token>._domainkey.<domínio>  →  <token>.dkim.amazonses.com
 *   MX         <retorno>.<domínio>           →  10 feedback-smtp.<região>.amazonses.com
 *   TXT        <retorno>.<domínio>           →  v=spf1 include:amazonses.com ~all
 *   TXT        _dmarc.<domínio>              →  v=DMARC1; p=none; rua=mailto:dmarc@<domínio>
 *
 * O DMARC com `p=none` basta para começar. Quem já tem um DMARC (qualquer
 * política) passa: o registro existe e começa com `v=DMARC1`.
 *
 * A conferência pergunta ao DNS público, registro por registro, e cruza com o
 * que a Amazon diz da identidade: o DNS diz "está publicado", a Amazon diz "eu
 * achei e assinei". Os resolvedores são injetados para o teste não ir à rede.
 */
import { PROVEDORES_GRATUITOS } from "./regras";

export type IdDoRegistro = "dkim1" | "dkim2" | "dkim3" | "mx" | "spf" | "dmarc";

export const IDS_DOS_REGISTROS: readonly IdDoRegistro[] = [
  "dkim1",
  "dkim2",
  "dkim3",
  "mx",
  "spf",
  "dmarc",
];

export interface RegistroDeDns {
  id: IdDoRegistro;
  tipo: "CNAME" | "MX" | "TXT";
  /** O nome completo. No painel do DNS, quase sempre só a parte antes do domínio. */
  nome: string;
  /** A parte que se digita no campo "nome" da maioria dos painéis. */
  nomeCurto: string;
  valor: string;
  para: string;
}

/** O formato do CHECK `mia_email_dominios_formato`. */
const FORMATO_DO_DOMINIO = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function normalizarDominio(bruto: string): string {
  return bruto
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

export function dominioComForma(dominio: string): boolean {
  return dominio.length <= 253 && FORMATO_DO_DOMINIO.test(dominio);
}

/** Remetente @gmail, @hotmail e afins não serve: o domínio tem de ser da empresa. */
export function ehProvedorGratuito(dominio: string): boolean {
  const d = normalizarDominio(dominio);
  return (PROVEDORES_GRATUITOS as readonly string[]).some((p) => d === p || d.endsWith(`.${p}`));
}

/** Por que este domínio não serve, ou `null`. A frase vai para a tela e para o MCP. */
export function recusaDoDominio(bruto: string): string | null {
  const d = normalizarDominio(bruto);
  if (!d) return "Escreva o domínio da empresa, como exemplo.com.br.";
  if (!dominioComForma(d))
    return "Isso não parece um domínio. Escreva só o domínio, como exemplo.com.br.";
  if (ehProvedorGratuito(d)) {
    return "Endereço de provedor gratuito (Gmail, Hotmail, Yahoo e afins) não serve de remetente. Use o domínio da empresa.";
  }
  return null;
}

/** Os seis registros que a empresa cola no DNS. */
export function registrosDoDominio(entrada: {
  dominio: string;
  dkimTokens: readonly string[];
  subdominioDeRetorno: string;
  regiao: string;
}): RegistroDeDns[] {
  const { dominio, subdominioDeRetorno: sub, regiao } = entrada;
  const tokens = [...entrada.dkimTokens];
  const dkim = [0, 1, 2].map((i): RegistroDeDns => {
    const token = tokens[i] ?? `token-${i + 1}-aparece-depois-de-criar-a-identidade`;
    return {
      id: `dkim${i + 1}` as IdDoRegistro,
      tipo: "CNAME",
      nome: `${token}._domainkey.${dominio}`,
      nomeCurto: `${token}._domainkey`,
      valor: `${token}.dkim.amazonses.com`,
      para: `Assinatura DKIM, ${i + 1} de 3`,
    };
  });
  return [
    ...dkim,
    {
      id: "mx",
      tipo: "MX",
      nome: `${sub}.${dominio}`,
      nomeCurto: sub,
      valor: `10 feedback-smtp.${regiao}.amazonses.com`,
      para: "Endereço de retorno: é por onde voltam as rejeições",
    },
    {
      id: "spf",
      tipo: "TXT",
      nome: `${sub}.${dominio}`,
      nomeCurto: sub,
      valor: "v=spf1 include:amazonses.com ~all",
      para: "SPF: autoriza a Amazon a enviar pelo domínio",
    },
    {
      id: "dmarc",
      tipo: "TXT",
      nome: `_dmarc.${dominio}`,
      nomeCurto: "_dmarc",
      valor: `v=DMARC1; p=none; rua=mailto:dmarc@${dominio}`,
      para: "DMARC: a política que o Gmail e o Yahoo exigem",
    },
  ];
}

export type SituacaoDosRegistros = Partial<Record<IdDoRegistro, boolean>>;

/** Verificado = os seis conferidos. Nenhum a menos. */
export function dominioVerificado(registros: SituacaoDosRegistros | null | undefined): boolean {
  return IDS_DOS_REGISTROS.every((id) => registros?.[id] === true);
}

export function registrosQueFaltam(
  registros: SituacaoDosRegistros | null | undefined,
): IdDoRegistro[] {
  return IDS_DOS_REGISTROS.filter((id) => registros?.[id] !== true);
}

/** O nome curto de quem falta, para a frase da trava ("falta DKIM, DMARC"). */
export function rotulosDoQueFalta(faltam: readonly IdDoRegistro[]): string[] {
  const curto: Record<IdDoRegistro, string> = {
    dkim1: "DKIM",
    dkim2: "DKIM",
    dkim3: "DKIM",
    mx: "retorno (MX)",
    spf: "SPF",
    dmarc: "DMARC",
  };
  return [...new Set(faltam.map((f) => curto[f]))];
}

/** Os resolvedores de DNS, no formato do `node:dns/promises`. */
export interface ResolvedoresDeDns {
  resolveCname: (nome: string) => Promise<string[]>;
  resolveMx: (nome: string) => Promise<Array<{ exchange: string; priority: number }>>;
  resolveTxt: (nome: string) => Promise<string[][]>;
}

async function tentar<T>(f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch {
    return null;
  }
}

const semPonto = (s: string) => s.trim().toLowerCase().replace(/\.$/, "");

/**
 * Confere os seis registros no DNS público.
 *
 * `identidade` é o que a Amazon disse (DKIM e retorno conferidos lá): o DKIM
 * conta quando o CNAME está publicado OU a Amazon já o confirmou — a Amazon
 * confere de hora em hora, e o DNS às vezes demora a propagar para o
 * resolvedor do servidor. O mesmo para o MX do retorno.
 */
export async function conferirRegistros(
  entrada: {
    dominio: string;
    dkimTokens: readonly string[];
    subdominioDeRetorno: string;
    regiao: string;
    identidade?: { dkimStatus: string | null; mailFromStatus: string | null } | null;
  },
  dns: ResolvedoresDeDns,
): Promise<Record<IdDoRegistro, boolean>> {
  const registros = registrosDoDominio(entrada);
  const dkimDaAmazon = entrada.identidade?.dkimStatus === "SUCCESS";
  const retornoDaAmazon = entrada.identidade?.mailFromStatus === "SUCCESS";
  const resultado = {} as Record<IdDoRegistro, boolean>;

  await Promise.all(
    registros.map(async (r) => {
      if (r.id === "dkim1" || r.id === "dkim2" || r.id === "dkim3") {
        const temToken = entrada.dkimTokens.length === 3;
        const cname = temToken ? await tentar(() => dns.resolveCname(r.nome)) : null;
        resultado[r.id] =
          temToken &&
          (dkimDaAmazon || (cname ?? []).some((c) => semPonto(c) === semPonto(r.valor)));
        return;
      }
      if (r.id === "mx") {
        const mx = await tentar(() => dns.resolveMx(r.nome));
        const esperado = r.valor.split(" ")[1]!;
        resultado.mx =
          retornoDaAmazon || (mx ?? []).some((m) => semPonto(m.exchange) === semPonto(esperado));
        return;
      }
      const txt = await tentar(() => dns.resolveTxt(r.nome));
      const linhas = (txt ?? []).map((partes) => partes.join("").trim());
      if (r.id === "spf") {
        resultado.spf = linhas.some(
          (l) => /^v=spf1\b/i.test(l) && /include:amazonses\.com/i.test(l),
        );
        return;
      }
      resultado.dmarc = linhas.some((l) => /^v=DMARC1\s*;/i.test(l) || /^v=DMARC1$/i.test(l));
    }),
  );
  return resultado;
}

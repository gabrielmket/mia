/**
 * FORK MIA (.89) — AS VARIÁVEIS do e-mail e o TEXTO RESERVA.
 *
 * O vocabulário é o do Inbox e das Campanhas do upstream
 * (`lib/campanhas/renderizador.ts`): `{{nome}}`, `{{primeiro_nome}}`,
 * `{{saudacao}}` e `{{contato.<campo>}}`. O e-mail acrescenta dois, nossos:
 * `{{empresa}}` (a empresa do contato, da empresa única) e `{{responsavel}}` (o
 * dono da carteira do contato).
 *
 * ── O texto reserva ──────────────────────────────────────────────────────────
 *
 * Variável sem dado não vira "Olá , tudo bem?". Ou a campanha tem um texto
 * reserva para ela ("Oi, cliente!"), ou a pessoa sem o dado fica de fora, e a
 * conferência antes de enviar diz quantas são (decisão do protótipo).
 *
 * `{{saudacao}}` nunca falta: sai do relógio da hora do envio.
 */
import { saudacaoDaHora } from "@/lib/campanhas/renderizador";

export const VARIAVEIS_DO_EMAIL = [
  { chave: "primeiro_nome", rotulo: "Primeiro nome", precisaDeDado: true },
  { chave: "nome", rotulo: "Nome completo", precisaDeDado: true },
  { chave: "saudacao", rotulo: "Bom dia, boa tarde ou boa noite", precisaDeDado: false },
  { chave: "empresa", rotulo: "Empresa do contato", precisaDeDado: true },
  { chave: "responsavel", rotulo: "Responsável pelo contato", precisaDeDado: true },
  { chave: "contato.cidade", rotulo: "Campo do contato: cidade", precisaDeDado: true },
] as const;

export interface ValoresDoContato {
  nome: string | null;
  empresa: string | null;
  responsavel: string | null;
  /** `contacts.custom_fields`, lido como propriedade própria. */
  campos: Readonly<Record<string, unknown>> | null;
}

/** Só palavra e ponto: o resto fica literal, como no Inbox. */
const TOKEN = /\{\{\s*([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)?)\s*\}\}/g;
const CHAVES_DE_PROTOTIPO = new Set(["__proto__", "constructor", "prototype"]);

function campo(campos: ValoresDoContato["campos"], nome: string): string | null {
  if (!campos || typeof campos !== "object" || CHAVES_DE_PROTOTIPO.has(nome)) return null;
  if (!Object.hasOwn(campos, nome)) return null;
  const v = campos[nome];
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const lista = v
      .filter((x) => typeof x === "string" || typeof x === "number")
      .map(String)
      .filter(Boolean);
    return lista.length ? lista.join(", ") : null;
  }
  return null;
}

/** O valor de uma variável para um contato, ou `null` quando ela não tem dado. */
export function valorDaVariavel(
  chave: string,
  v: ValoresDoContato,
  quando: { agora: Date; fuso: string },
): string | null | undefined {
  const nome = (v.nome ?? "").trim();
  switch (chave.toLowerCase()) {
    case "nome":
      return nome || null;
    case "primeiro_nome":
      return nome.split(/\s+/)[0] || null;
    case "saudacao":
      return saudacaoDaHora(quando.agora, quando.fuso);
    case "empresa":
      return (v.empresa ?? "").trim() || null;
    case "responsavel":
      return (v.responsavel ?? "").trim() || null;
    default: {
      const m = /^contato\.(?:custom_fields\.)?([a-zA-Z0-9_]+)$/i.exec(chave);
      if (m) return campo(v.campos, m[1]!);
      // `undefined` = não é variável: fica literal.
      return undefined;
    }
  }
}

/** As variáveis que um texto usa (em minúsculas). */
export function variaveisUsadas(texto: string): string[] {
  const vistas = new Set<string>();
  for (const m of texto.matchAll(TOKEN)) vistas.add(m[1]!.toLowerCase());
  return [...vistas];
}

export interface TextoComVariaveis {
  texto: string;
  /** Variáveis sem dado e sem texto reserva: a pessoa fica de fora. */
  faltando: string[];
}

/**
 * Troca as variáveis. `escapar` é a função do destino (HTML ou texto puro):
 * valor do cadastro entra como DADO, nunca como marcação.
 */
export function trocarVariaveis(
  modelo: string,
  v: ValoresDoContato,
  reservas: Readonly<Record<string, string>>,
  quando: { agora: Date; fuso: string },
  escapar: (s: string) => string = (s) => s,
): TextoComVariaveis {
  const faltando = new Set<string>();
  // O modelo é escapado ANTES (ele vem de quem escreveu a campanha) e os valores
  // DEPOIS, cada um: um nome com `<b>` aparece escrito, não em negrito.
  const partes: string[] = [];
  let ultimo = 0;
  for (const m of modelo.matchAll(TOKEN)) {
    const inicio = m.index ?? 0;
    partes.push(escapar(modelo.slice(ultimo, inicio)));
    ultimo = inicio + m[0].length;
    const chave = m[1]!.toLowerCase();
    const valor = valorDaVariavel(chave, v, quando);
    if (valor === undefined) {
      partes.push(escapar(m[0]));
      continue;
    }
    if (valor === null) {
      const reserva = (reservas[chave] ?? "").trim();
      if (reserva) partes.push(escapar(reserva));
      else {
        faltando.add(chave);
        partes.push(escapar(m[0]));
      }
      continue;
    }
    partes.push(escapar(valor));
  }
  partes.push(escapar(modelo.slice(ultimo)));
  return { texto: partes.join(""), faltando: [...faltando] };
}

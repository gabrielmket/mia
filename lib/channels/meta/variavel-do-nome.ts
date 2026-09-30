/**
 * FORK MIA — A ÚNICA VARIÁVEL DE MODELO QUE UM ENVIO SEM PESSOA NA TELA SABE PREENCHER.
 *
 * O passo de fluxo que manda um modelo aprovado (e o plano B da mensagem por IA)
 * roda no motor, sem ninguém para digitar valor. Até a .60 isso queria dizer que
 * modelo com QUALQUER variável era recusado. Agora uma variável tem fonte: o
 * primeiro nome do contato (`lib/contacts/primeiro-nome.ts`).
 *
 * ─── Qual variável ─────────────────────────────────────────────────────────
 *
 *  - modelo POSICIONAL: o `{{1}}` do corpo;
 *  - modelo NOMEADO (`parameter_format = NAMED`, que a Meta declara e o espelho
 *    guarda): o primeiro parâmetro nomeado do corpo, ex. `{{nome}}`.
 *
 * E só quando ela é a ÚNICA do modelo inteiro. Qualquer outra (um `{{2}}`, um
 * segundo nomeado, texto ou mídia no cabeçalho, sufixo de URL ou cupom em botão,
 * carrossel) continua recusada: o motor não tem de onde tirar esse valor, e
 * mandar o marcador cru ao cliente seria pior que não mandar.
 *
 * A chave devolvida é a de `slotKey`, a MESMA que o montador do envio
 * (`buildComponents`) e o renderizador do corpo (`renderTemplateBody`) leem:
 * nenhum formato novo de `components` nasce aqui.
 *
 * ─── Sem nome: quando o texto neutro pode entrar ───────────────────────────
 *
 * "Permitir" tem UMA definição, verificável e decidida por quem escreveu o
 * modelo: a AMOSTRA que ele registrou para essa variável na aprovação
 * (`example.body_text` no posicional, `example.body_text_named_params` no
 * nomeado) é o próprio texto neutro, "tudo bem" (sem diferença de caixa, acento
 * ou pontuação). Quem registrou "tudo bem" como exemplo declarou à Meta, e a nós,
 * que a frase fica de pé com ele; ex.: "Oi, {{1}}?" com amostra "tudo bem".
 *
 * Por que não decidir pelo corpo do texto: o formato mais comum, "Olá {{1}},
 * tudo bem?", viraria "Olá tudo bem, tudo bem?". Não há regra de texto que
 * separe isso com segurança, então fora da amostra o envio é PULADO com o motivo.
 */
import { slotKey } from "./build-components";
import type { TemplateContract } from "./template-contract";

/** O que vai no lugar do nome quando a amostra do modelo permite (ver o cabeçalho). */
export const TEXTO_NEUTRO_SEM_NOME = "tudo bem";

export type VariavelDoModelo =
  /** Modelo sem variável: sai como está. */
  | { tipo: "nenhuma" }
  /** A única variável é a do nome. `chave` endereça `values`; `marcador` é como o operador a vê. */
  | { tipo: "nome"; chave: string; marcador: string; aceitaNeutro: boolean }
  /** Tem variável que o motor não sabe preencher: recusar. */
  | { tipo: "outras" };

type Bruto = Record<string, unknown>;
const obj = (v: unknown): Bruto | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : null);

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A amostra registrada na aprovação para a variável `chave` do corpo, se houver. */
function amostraDoCorpo(components: unknown, nomeado: boolean, chave: string): string | null {
  const lista = Array.isArray(components) ? components : [];
  const corpo = lista.map(obj).find((c) => String(c?.type ?? "").toUpperCase() === "BODY");
  const exemplo = obj(corpo?.example);
  if (!exemplo) return null;
  if (nomeado) {
    const params = Array.isArray(exemplo.body_text_named_params) ? exemplo.body_text_named_params : [];
    const achado = params.map(obj).find((p) => p?.param_name === chave);
    return typeof achado?.example === "string" ? achado.example : null;
  }
  const linhas = exemplo.body_text;
  const primeira = Array.isArray(linhas) && Array.isArray(linhas[0]) ? (linhas[0] as unknown[]) : [];
  const valor = primeira[Number(chave) - 1];
  return typeof valor === "string" ? valor : null;
}

export function variavelDoModelo(contrato: TemplateContract, components: unknown): VariavelDoModelo {
  if (contrato.slots.length === 0) return { tipo: "nenhuma" };
  if (contrato.slots.length > 1) return { tipo: "outras" };
  const slot = contrato.slots[0]!;
  if (slot.address.kind !== "body" || slot.expects !== "text") return { tipo: "outras" };
  const nomeado = contrato.parameterFormat === "NAMED";
  // Posicional com uma variável só que não é o {{1}} é modelo malformado: a Meta
  // numera a partir de 1 e recusa lista com buraco.
  if (!nomeado && slot.key !== "1") return { tipo: "outras" };
  const amostra = amostraDoCorpo(components, nomeado, slot.key);
  return {
    tipo: "nome",
    chave: slotKey(slot.address, slot.key),
    marcador: `{{${slot.key}}}`,
    aceitaNeutro: amostra !== null && normalizar(amostra) === TEXTO_NEUTRO_SEM_NOME,
  };
}

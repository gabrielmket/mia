/**
 * FORK MIA (.89) — o texto de uma resposta do assistente da MIA, com o pouco de
 * formato que o modelo usa: **negrito** e listas com "- " (sub-item com dois
 * espaços antes). Antes o painel mostrava o texto cru, com os asteriscos à vista.
 *
 * Só isso, de propósito (regra 9 do prompt, lib/assistente/prompt.ts): título,
 * tabela, link e código ficam como texto. Tudo vira nó de texto do React, nunca
 * HTML, então nada do que o modelo escreve vira marcação.
 */
import type { ReactNode } from "react";

export interface ItemDaLista {
  texto: string;
  filhos: ItemDaLista[];
}

export type Bloco = { tipo: "paragrafo"; linhas: string[] } | { tipo: "lista"; itens: ItemDaLista[] };

const ITEM = /^(\s*)[-*•]\s+(.*)$/;
const TITULO = /^\s*#{1,6}\s+/;

/** O texto em parágrafos e listas. Puro, para o teste. */
export function blocosDoTexto(texto: string): Bloco[] {
  const blocos: Bloco[] = [];
  let paragrafo: string[] | null = null;
  // A lista aberta: a raiz e, por cima, o nível de cada item ainda aceitando filhos.
  let raiz: ItemDaLista[] | null = null;
  let pilha: Array<{ nivel: number; itens: ItemDaLista[] }> = [];

  const fecharParagrafo = () => {
    if (paragrafo && paragrafo.length) blocos.push({ tipo: "paragrafo", linhas: paragrafo });
    paragrafo = null;
  };
  const fecharLista = () => {
    if (raiz && raiz.length) blocos.push({ tipo: "lista", itens: raiz });
    raiz = null;
    pilha = [];
  };

  for (const bruta of texto.replace(/\r\n?/g, "\n").split("\n")) {
    const item = ITEM.exec(bruta);
    if (item) {
      fecharParagrafo();
      const nivel = Math.floor((item[1] ?? "").replace(/\t/g, "  ").length / 2);
      const novo: ItemDaLista = { texto: (item[2] ?? "").trim(), filhos: [] };
      if (!raiz) {
        raiz = [];
        pilha = [{ nivel: 0, itens: raiz }];
      }
      // Sobe até o nível do item (ou o mais raso que houver) e pendura nele.
      let topo = pilha[pilha.length - 1] ?? { nivel: 0, itens: raiz };
      while (pilha.length > 1 && topo.nivel > nivel) {
        pilha.pop();
        topo = pilha[pilha.length - 1] ?? { nivel: 0, itens: raiz };
      }
      const pai = topo.itens[topo.itens.length - 1];
      if (nivel > topo.nivel && pai) {
        pai.filhos.push(novo);
        pilha.push({ nivel, itens: pai.filhos });
      } else {
        topo.itens.push(novo);
      }
      continue;
    }
    const linha = bruta.replace(TITULO, "").trim();
    if (!linha) {
      fecharParagrafo();
      fecharLista();
      continue;
    }
    fecharLista();
    (paragrafo ??= []).push(linha);
  }
  fecharParagrafo();
  fecharLista();
  return blocos;
}

/** O negrito de uma linha: "**x**" vira <strong>; o resto fica texto. */
function emLinha(texto: string): ReactNode[] {
  return texto
    .split(/(\*\*[^*\n]+?\*\*)/g)
    .filter((parte) => parte !== "")
    .map((parte, i) =>
      parte.length > 4 && parte.startsWith("**") && parte.endsWith("**") ? (
        <strong key={i} className="font-semibold">
          {parte.slice(2, -2)}
        </strong>
      ) : (
        parte
      ),
    );
}

function Lista({ itens, nivel }: { itens: ItemDaLista[]; nivel: number }) {
  return (
    <ul className={nivel === 0 ? "list-disc space-y-0.5 pl-5" : "mt-0.5 list-[circle] space-y-0.5 pl-5"}>
      {itens.map((item, i) => (
        <li key={i}>
          {emLinha(item.texto)}
          {item.filhos.length ? <Lista itens={item.filhos} nivel={nivel + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

export function TextoDoAssistente({ texto }: { texto: string }) {
  const blocos = blocosDoTexto(texto);
  return (
    <div className="flex flex-col gap-1.5 break-words" data-testid="texto-do-assistente">
      {blocos.map((bloco, i) =>
        bloco.tipo === "lista" ? (
          <Lista key={i} itens={bloco.itens} nivel={0} />
        ) : (
          <p key={i}>
            {bloco.linhas.map((linha, j) => (
              <span key={j}>
                {j > 0 ? <br /> : null}
                {emLinha(linha)}
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}

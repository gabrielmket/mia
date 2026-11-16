"use client";
/**
 * FORK MIA (.109) · O BLOCO DE ITENS DO NEGÓCIO (telas 2 e 3 do protótipo,
 * docs/fork/produto-no-negocio.md).
 *
 * Busca no catálogo de Produtos enquanto a pessoa digita (a mesma rota que a
 * Proposta usa, `GET /api/v1/products?busca=`), põe o produto com o preço de lá
 * e deixa mexer em quantidade e desconto, que ficam no negócio. Os itens da
 * proposta enviada aparecem no mesmo bloco, com o número dela, e só mudam pela
 * própria proposta. Não há item digitado à mão (decisão 3): produto novo se
 * cadastra em Produtos.
 *
 * O bloco só mexe no RASCUNHO: quem grava é quem o monta (Salvar do formulário,
 * Confirmar da janela de ganho).
 */
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { formatCents, parseReaisToCents, simboloDaMoeda } from "@/lib/money";
import type { PalavraDoProduto } from "@/lib/produto-no-negocio/funil";
import {
  QUANTIDADE_MAXIMA,
  adicionarAoRascunho,
  centavosParaTexto,
  comQuantidade,
  quantidadeLegivel,
  rotuloDaProposta,
  somaDosItens,
  valorDoItem,
  type ItemDoNegocio,
  type ProdutoDoCatalogo,
} from "@/lib/produto-no-negocio/regras";
import { cn } from "@/lib/utils";

interface ProdutoDaBusca {
  id: string;
  codigo: string | null;
  nome: string;
  preco_cents: number;
  moeda: string;
  ativo: boolean;
}

/** Quantos produtos a lista mostra de uma vez: o resto aparece digitando. */
const NA_LISTA = 20;

const chaveDoItem = (it: ItemDoNegocio) => it.id ?? `novo:${it.productId}`;

export function BlocoDeItens({
  itens,
  onItens,
  palavra,
  moeda,
  desabilitado = false,
}: {
  itens: ItemDoNegocio[];
  onItens: (itens: ItemDoNegocio[]) => void;
  palavra: PalavraDoProduto;
  moeda: string;
  desabilitado?: boolean;
}) {
  const t = useT();
  const base = useId();
  const idDaBusca = `${base}-busca`;
  const idDaLista = `${base}-lista`;
  const entrada = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState("");
  const [aberta, setAberta] = useState(false);
  const [achados, setAchados] = useState<ProdutoDaBusca[]>([]);
  const [ativo, setAtivo] = useState(0);
  const [anuncio, setAnuncio] = useState("");
  // O texto de cada campo de desconto: "15," é digitação, não um valor.
  const [descontos, setDescontos] = useState<Record<string, string>>({});
  const [erros, setErros] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!aberta) return;
    const controller = new AbortController();
    const termo = texto.trim();
    const alvo = termo ? `/api/v1/products?busca=${encodeURIComponent(termo)}` : "/api/v1/products";
    const espera = setTimeout(() => {
      apiClient
        .get<{ data: ProdutoDaBusca[] }>(alvo, { signal: controller.signal })
        .then((r) => {
          if (controller.signal.aborted) return;
          // Só o que está à venda e na moeda do negócio entra na lista.
          setAchados((r.data ?? []).filter((p) => p.ativo && p.moeda === moeda).slice(0, NA_LISTA));
          setAtivo(0);
        })
        .catch(() => {
          if (!controller.signal.aborted) setAchados([]);
        });
    }, 200);
    return () => {
      clearTimeout(espera);
      controller.abort();
    };
  }, [texto, aberta, moeda]);

  const jaNoNegocio = useMemo(
    () => new Set(itens.filter((i) => i.origem === "negocio" && i.productId).map((i) => i.productId!)),
    [itens],
  );

  function adicionar(p: ProdutoDaBusca) {
    const produto: ProdutoDoCatalogo = { id: p.id, codigo: p.codigo, nome: p.nome, precoCents: Number(p.preco_cents), moeda: p.moeda };
    const proximos = adicionarAoRascunho(itens, produto);
    onItens(proximos);
    const item = proximos.find((i) => i.origem === "negocio" && i.productId === p.id);
    const soma = formatCents(somaDosItens(proximos), moeda);
    setAnuncio(
      jaNoNegocio.has(p.id) && item
        ? t("{nome}: quantidade {quantidade}. Soma {soma}.")
            .replace("{nome}", p.nome)
            .replace("{quantidade}", String(item.quantidade))
            .replace("{soma}", soma)
        : t("{nome} entrou. Soma {soma}.").replace("{nome}", p.nome).replace("{soma}", soma),
    );
    setTexto("");
    entrada.current?.focus();
  }

  function trocar(chave: string, novo: ItemDoNegocio | null, opcoes: { mantemTextoDoDesconto?: boolean } = {}) {
    // A quantidade pode ter encolhido o desconto: o campo volta a mostrar o valor do item.
    if (!opcoes.mantemTextoDoDesconto) {
      setDescontos((d) => {
        const { [chave]: _fora, ...resto } = d;
        return resto;
      });
    }
    onItens(
      novo === null
        ? itens.filter((i) => chaveDoItem(i) !== chave)
        : itens.map((i) => (chaveDoItem(i) === chave ? novo : i)),
    );
  }

  function erroDe(chave: string, msg: string) {
    setErros((e) => ({ ...e, [chave]: msg }));
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3" data-testid="bloco-de-itens">
      <div>
        <h3 className="text-sm font-semibold text-text">{palavra.P}</h3>
        <p className="text-xs text-text-muted">
          {t("Do catálogo de Produtos, com o preço de lá. Quantidade e desconto ficam neste negócio.")}
        </p>
      </div>

      <div className="relative">
        <label className="sr-only" htmlFor={idDaBusca}>
          {t("Buscar {produto} no catálogo").replace("{produto}", palavra.s)}
        </label>
        <input
          ref={entrada}
          id={idDaBusca}
          role="combobox"
          aria-expanded={aberta}
          aria-controls={idDaLista}
          aria-autocomplete="list"
          aria-activedescendant={aberta && achados[ativo] ? `${idDaLista}-${ativo}` : undefined}
          autoComplete="off"
          disabled={desabilitado}
          className="h-9 w-full rounded-md border border-border-strong bg-background px-3 text-base md:text-sm"
          placeholder={t("Buscar {produto} no catálogo pelo nome ou código").replace("{produto}", palavra.s)}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setAberta(true);
          }}
          onFocus={() => setAberta(true)}
          onClick={() => setAberta(true)}
          onBlur={() => setTimeout(() => setAberta(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!aberta) setAberta(true);
              else if (achados.length) setAtivo((a) => (a + 1) % achados.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              if (achados.length) setAtivo((a) => (a - 1 + achados.length) % achados.length);
            } else if (e.key === "Enter") {
              if (aberta && achados[ativo]) {
                e.preventDefault();
                adicionar(achados[ativo]);
              }
            } else if (e.key === "Escape") {
              if (aberta) {
                e.stopPropagation();
                setAberta(false);
              }
            }
          }}
        />
        {aberta && (
          <div
            id={idDaLista}
            role="listbox"
            aria-label={t("{produtos} do catálogo").replace("{produtos}", palavra.P)}
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-md border border-border-strong bg-surface p-1 shadow-md"
          >
            {achados.length === 0 ? (
              <p className="p-2 text-sm text-text-muted">
                {t("Nenhum {produto} com esse nome no catálogo. Quem é gestor cadastra em Produtos.").replace(
                  "{produto}",
                  palavra.s,
                )}
              </p>
            ) : (
              achados.map((p, i) => (
                <div
                  key={p.id}
                  id={`${idDaLista}-${i}`}
                  role="option"
                  aria-selected={i === ativo}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm",
                    i === ativo ? "bg-accent-soft" : "hover:bg-surface-elevated",
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => adicionar(p)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-text">{p.nome}</span>
                    <span className="text-xs text-text-muted">
                      {p.codigo ?? ""}
                      {jaNoNegocio.has(p.id) ? `${p.codigo ? " · " : ""}${t("já no negócio, soma 1 na quantidade")}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatCents(Number(p.preco_cents), p.moeda)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {itens.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-strong p-3 text-center text-sm text-text-muted">
          {t("Nenhum {produto} ainda. Busque acima pelo nome ou pelo código.").replace("{produto}", palavra.s)}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="itens-do-negocio">
          {itens.map((it) => {
            const chave = chaveDoItem(it);
            const proposta = rotuloDaProposta(it.proposta);
            const preco = formatCents(it.precoUnitarioCents, it.moeda);
            return (
              <li
                key={chave}
                className="grid grid-cols-1 items-center gap-x-3 gap-y-2 rounded-md border border-border bg-surface-elevated px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <b className="text-sm font-medium text-text">{it.nome}</b>
                    {proposta ? (
                      <span className="rounded-full bg-info-bg px-1.5 text-[11px] text-info-fg">
                        {t("da proposta {numero}").replace("{numero}", proposta)}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-text-muted">
                    {it.origem === "proposta"
                      ? `${quantidadeLegivel(it.quantidade)} × ${preco}${it.descontoCents ? ` · ${t("desconto")} ${formatCents(it.descontoCents, it.moeda)}` : ""}`
                      : `${it.codigo ? `${it.codigo} · ` : ""}${t("{preco} no catálogo").replace("{preco}", preco)}`}
                  </span>
                  {it.origem === "proposta" && it.proposta ? (
                    <span className="text-xs text-text-muted">
                      {t("muda pela")}{" "}
                      <Link className="text-accent underline underline-offset-2" href={`/app/proposals/${it.proposta.id}`}>
                        {t("proposta {numero}").replace("{numero}", proposta ?? "")}
                      </Link>
                    </span>
                  ) : null}
                </div>

                {it.origem === "proposta" ? (
                  <b className="text-right text-sm font-semibold tabular-nums">{formatCents(valorDoItem(it), it.moeda)}</b>
                ) : (
                  <div className="flex flex-wrap items-end justify-between gap-2.5 sm:justify-end">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-text-muted" id={`${base}-${chave}-q`}>
                        {t("Qtd")}
                      </span>
                      <div
                        className="inline-flex h-9 overflow-hidden rounded-md border border-border-strong bg-background"
                        role="group"
                        aria-labelledby={`${base}-${chave}-q`}
                      >
                        <button
                          type="button"
                          className="w-8 hover:bg-surface-elevated disabled:opacity-50"
                          disabled={desabilitado || it.quantidade <= 1}
                          aria-label={t("Diminuir a quantidade de {nome}").replace("{nome}", it.nome)}
                          onClick={() => trocar(chave, comQuantidade(it, it.quantidade - 1))}
                        >
                          −
                        </button>
                        <input
                          inputMode="numeric"
                          className="w-10 border-x border-border bg-transparent text-center tabular-nums"
                          aria-label={t("Quantidade de {nome}").replace("{nome}", it.nome)}
                          disabled={desabilitado}
                          value={String(it.quantidade)}
                          onChange={(e) => {
                            const v = e.target.value.trim();
                            const q = Number.parseInt(v, 10);
                            if (!/^\d+$/.test(v) || q < 1 || q > QUANTIDADE_MAXIMA) {
                              erroDe(chave, t("Quantidade de 1 a 99."));
                              return;
                            }
                            erroDe(chave, "");
                            trocar(chave, comQuantidade(it, q));
                          }}
                        />
                        <button
                          type="button"
                          className="w-8 hover:bg-surface-elevated disabled:opacity-50"
                          disabled={desabilitado || it.quantidade >= QUANTIDADE_MAXIMA}
                          aria-label={t("Aumentar a quantidade de {nome}").replace("{nome}", it.nome)}
                          onClick={() => trocar(chave, comQuantidade(it, it.quantidade + 1))}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <label className="text-xs text-text-muted" htmlFor={`${base}-${chave}-d`}>
                        {t("Desconto")} ({simboloDaMoeda(moeda)})
                      </label>
                      <input
                        id={`${base}-${chave}-d`}
                        inputMode="decimal"
                        placeholder="0,00"
                        disabled={desabilitado}
                        className="h-9 w-28 rounded-md border border-border-strong bg-background px-2 text-base tabular-nums md:text-sm"
                        value={descontos[chave] ?? (it.descontoCents ? centavosParaTexto(it.descontoCents) : "")}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDescontos((d) => ({ ...d, [chave]: v }));
                          const cents = v.trim() === "" ? 0 : parseReaisToCents(v, moeda);
                          if (cents === null) {
                            erroDe(chave, t("Desconto inválido. Use só números, como 150 ou 150,00."));
                            return;
                          }
                          if (cents > it.precoUnitarioCents * it.quantidade) {
                            erroDe(chave, t("O desconto não pode passar do valor do {produto}.").replace("{produto}", palavra.s));
                            return;
                          }
                          erroDe(chave, "");
                          trocar(chave, { ...it, descontoCents: cents }, { mantemTextoDoDesconto: true });
                        }}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-text-muted">{t("Subtotal")}</span>
                      <b className="min-w-24 text-right text-sm font-semibold leading-9 tabular-nums">
                        {formatCents(valorDoItem(it), it.moeda)}
                      </b>
                    </div>
                    <button
                      type="button"
                      className="h-9 w-9 rounded-md text-lg text-text-muted hover:bg-error-bg hover:text-error-fg disabled:opacity-50"
                      disabled={desabilitado}
                      aria-label={t("Tirar {nome}").replace("{nome}", it.nome)}
                      onClick={() => {
                        trocar(chave, null);
                        setAnuncio(t("{nome} saiu.").replace("{nome}", it.nome));
                        entrada.current?.focus();
                      }}
                    >
                      ×
                    </button>
                  </div>
                )}
                {erros[chave] ? <p className="text-xs text-error-fg sm:col-span-2">{erros[chave]}</p> : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-baseline justify-between gap-2 border-t border-dashed border-border-strong pt-2 text-sm text-text-muted">
        <span>{t("Soma dos {produtos}").replace("{produtos}", palavra.p)}</span>
        <b className="text-base tabular-nums text-text" data-testid="soma-dos-itens">
          {itens.length ? formatCents(somaDosItens(itens), moeda) : t("Sem valor")}
        </b>
      </div>
      <p className="sr-only" aria-live="polite">
        {anuncio}
      </p>
    </div>
  );
}

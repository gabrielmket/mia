"use client";
/**
 * FORK MIA (.109) · O CAMPO VALOR DO NEGÓCIO, que passa a ser a soma dos itens
 * (telas 2 e 3 do protótipo, docs/fork/produto-no-negocio.md).
 *
 * Somando, o campo é só leitura e diz de onde vem o número; "Digitar o valor à
 * mão" abre o campo, e a partir daí o valor não acompanha mais os itens até
 * alguém clicar "Usar a soma". O negócio de antes dos itens abre à mão, com a
 * frase própria dele: o valor que tinha continua valendo até alguém pedir.
 */
import { useId, useRef } from "react";

import { useT } from "@/hooks/i18n/useT";
import { formatCents, simboloDaMoeda } from "@/lib/money";
import type { PalavraDoProduto } from "@/lib/produto-no-negocio/funil";
import { digitarAMao, usarASoma, valorDigitado, type RascunhoDoNegocio } from "@/lib/produto-no-negocio/rascunho";
import { centavosParaTexto, somaEsperada } from "@/lib/produto-no-negocio/regras";

export function CampoDoValor({
  rascunho,
  onRascunho,
  palavra,
  moeda,
  desabilitado = false,
}: {
  rascunho: RascunhoDoNegocio;
  onRascunho: (r: RascunhoDoNegocio) => void;
  palavra: PalavraDoProduto;
  moeda: string;
  desabilitado?: boolean;
}) {
  const t = useT();
  const id = useId();
  const campo = useRef<HTMLInputElement>(null);
  const soma = somaEsperada(rascunho.itens);
  const invalido = rascunho.modo === "a_mao" && valorDigitado(rascunho, moeda) === undefined;
  const linkClasse = "text-accent underline underline-offset-2 disabled:opacity-50";

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        {t("Valor")} ({simboloDaMoeda(moeda)})
      </label>
      {rascunho.modo === "soma" ? (
        <>
          <input
            id={id}
            readOnly
            aria-describedby={`${id}-a`}
            className="h-9 w-full rounded-md border border-border-strong bg-surface-elevated px-3 text-base tabular-nums md:text-sm"
            value={centavosParaTexto(soma)}
            placeholder={t("Sem valor")}
            data-testid="valor-do-negocio"
          />
          <p className="text-xs text-text-muted" id={`${id}-a`}>
            {soma === null
              ? t("A soma aparece quando você escolher um {produto}.").replace("{produto}", palavra.s)
              : t("Soma dos {produtos}.").replace("{produtos}", palavra.p)}{" "}
            <button
              type="button"
              className={linkClasse}
              disabled={desabilitado}
              onClick={() => {
                onRascunho(digitarAMao(rascunho));
                setTimeout(() => {
                  campo.current?.focus();
                  campo.current?.select();
                }, 0);
              }}
            >
              {t("Digitar o valor à mão")}
            </button>
          </p>
        </>
      ) : (
        <>
          <input
            ref={campo}
            id={id}
            inputMode="decimal"
            placeholder="0,00"
            aria-describedby={`${id}-a`}
            aria-invalid={invalido || undefined}
            disabled={desabilitado}
            className="h-9 w-full rounded-md border border-border-strong bg-background px-3 text-base tabular-nums md:text-sm"
            value={rascunho.valorTexto}
            onChange={(e) => onRascunho({ ...rascunho, valorTexto: e.target.value })}
            data-testid="valor-do-negocio"
          />
          <div className="space-y-1 rounded-md border border-warning bg-warning-bg px-3 py-2 text-xs text-text" id={`${id}-a`}>
            {rascunho.antigo ? (
              <p>
                <b>{t("Negócio de antes dos {produtos}:").replace("{produtos}", palavra.p)}</b>{" "}
                {t("o valor foi digitado à mão e continua valendo até você pedir para somar.")}
              </p>
            ) : (
              <p>
                <b>{t("Digitado à mão:")}</b>{" "}
                {t("este valor não soma mais os {produtos}. Mudar um {produto} não muda este valor.")
                  .replace("{produtos}", palavra.p)
                  .replace("{produto}", palavra.s)}
              </p>
            )}
            {soma !== null ? (
              <p>
                {t("Soma dos {produtos} hoje:").replace("{produtos}", palavra.p)}{" "}
                <b className="tabular-nums">{formatCents(soma, moeda)}</b>.{" "}
                <button type="button" className={linkClasse} disabled={desabilitado} onClick={() => onRascunho(usarASoma(rascunho))}>
                  {t("Usar a soma")}
                </button>
              </p>
            ) : (
              <p>
                <button type="button" className={linkClasse} disabled={desabilitado} onClick={() => onRascunho(usarASoma(rascunho))}>
                  {t("Voltar a somar")}
                </button>
              </p>
            )}
          </div>
          {invalido ? <p className="text-xs text-error-fg">{t("Valor inválido")}</p> : null}
        </>
      )}
    </div>
  );
}

/**
 * O aviso do valor no campo errado (tela 2): com "Mostrar valor recorrente"
 * desligado, o negócio que tem valor no Valor recorrente (mensal) ganha este
 * aviso, com o botão que apaga o campo ao salvar. O que estava gravado continua
 * guardado até alguém decidir.
 */
export function AvisoDoValorRecorrente({
  valorCents,
  moeda,
  palavra,
  apagado,
  onApagar,
}: {
  valorCents: number;
  moeda: string;
  palavra: PalavraDoProduto;
  apagado: boolean;
  onApagar: () => void;
}) {
  const t = useT();
  if (apagado) {
    return (
      <div className="rounded-md border border-success bg-success-bg px-3 py-2 text-sm text-text">
        {t("O valor recorrente sai quando você salvar.")}
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-text" data-testid="aviso-do-valor-recorrente">
      <p>
        <b>{t("Valor no campo errado?")}</b>{" "}
        {t(
          "Este negócio tem {valor} em Valor recorrente (mensal), um campo que este funil não usa. Parece o valor do {produto}, digitado no lugar errado.",
        )
          .replace("{valor}", formatCents(valorCents, moeda))
          .replace("{produto}", palavra.s)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-border-strong bg-surface px-2.5 py-1 text-xs hover:bg-surface-elevated"
          onClick={onApagar}
        >
          {t("Apagar o valor recorrente")}
        </button>
        <span className="text-xs text-text-muted">
          {t("Escolha o {produto} acima e o valor certo vem da soma.").replace("{produto}", palavra.s)}
        </span>
      </div>
    </div>
  );
}

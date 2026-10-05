"use client";

/**
 * O CRÉDITO DA EMPRESA — e o extrato que o explica.
 *
 * Três decisões que a tela toma em voz alta:
 *
 *  1. "Sem preço acordado" NÃO é "ilimitado" nem "de graça". É o estado em que
 *     o disparo recusa, e dizer isso aqui evita a descoberta na hora errada —
 *     com a lista pronta e o dedo no botão.
 *  2. O número que interessa antes de disparar não é o saldo, é QUANTAS
 *     MENSAGENS ele cobre. Saldo em reais obriga a pessoa a dividir de cabeça.
 *  3. Nada aqui mostra o que a OPERAÇÃO paga pela mensagem. As duas contas não
 *     se encontram em tela nenhuma — ver `lib/ai/custo-e-da-plataforma.ts`.
 */
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useCarteira } from "@/hooks/useCarteira";
import { formatCentsBRL } from "@/lib/money";

const ROTULO_DO_TIPO: Record<string, string> = {
  credito: "Crédito",
  debito: "Consumo",
  estorno: "Estorno",
};

export function CarteiraDaEmpresa() {
  const t = useT();
  const tag = useTagDeIdioma();
  const { data, isLoading, error } = useCarteira();

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;
  if (error || !data) {
    return <p className="text-sm text-error-fg">{t("Não consegui carregar os créditos agora.")}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-md border border-border p-4">
        <p className="text-sm text-muted-foreground">{t("Saldo")}</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">
          {formatCentsBRL(data.saldo_cents)}
        </p>
        {data.saldo_truncado && (
          // O extrato passou do teto de leitura da rota: sem esta linha o
          // número acima se leria como o saldo, e ele é uma soma parcial.
          <p className="mt-2 text-sm text-warning-fg" data-testid="aviso-de-corte">
            {t("O extrato passou do limite de leitura: o saldo soma só os lançamentos mais recentes.")}
          </p>
        )}
        {data.preco_por_mensagem_cents === null ? (
          <p className="mt-2 text-sm text-warning-fg">
            {t("Ainda não há preço por mensagem acordado — fale com quem cuida da sua conta antes de programar um disparo.")}
          </p>
        ) : (
          /* Uma frase, uma chave: partir isto em três `t()` deixaria a ordem das
             palavras congelada no português, e a tradução sairia remontada
             errada. Convenção de {n} igual à do MergeDialog. */
          <p className="mt-2 text-sm text-muted-foreground">
            {t("Dá para {n} mensagens, a {preco} cada.")
              .replace("{n}", String(data.mensagens_que_cabem ?? 0))
              .replace("{preco}", formatCentsBRL(data.preco_por_mensagem_cents))}
          </p>
        )}
        {data.credito_acabando && (
          <p className="mt-2 text-sm text-warning-fg">{t("Seu crédito está acabando.")}</p>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">{t("Creditado")}</p>
          <p className="text-lg font-medium tabular-nums">{formatCentsBRL(data.creditado_cents)}</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">{t("Consumido")}</p>
          <p className="text-lg font-medium tabular-nums">{formatCentsBRL(data.debitado_cents)}</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">{t("Estornado")}</p>
          <p className="text-lg font-medium tabular-nums">{formatCentsBRL(data.estornado_cents)}</p>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">{t("Extrato")}</h2>
        {data.extrato.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Nenhum lançamento ainda.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">{t("Quando")}</th>
                  <th className="py-2 pr-3">{t("Tipo")}</th>
                  <th className="py-2 pr-3 text-right">{t("Valor")}</th>
                  <th className="py-2">{t("Observação")}</th>
                </tr>
              </thead>
              <tbody>
                {data.extrato.map((l) => (
                  <tr key={l.id} className="border-b border-border/60">
                    <td className="py-2 pr-3 tabular-nums">
                      {new Date(l.occurred_at).toLocaleDateString(tag)}
                    </td>
                    <td className="py-2 pr-3">{t(ROTULO_DO_TIPO[l.tipo] ?? l.tipo)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {l.tipo === "debito" ? "−" : "+"}
                      {formatCentsBRL(l.amount_cents)}
                    </td>
                    <td className="py-2 text-muted-foreground">{l.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.extrato_truncado && (
          <p className="text-xs text-muted-foreground">
            {t("Mostrando os lançamentos mais recentes. O saldo acima soma o extrato inteiro.")}
          </p>
        )}
      </section>
    </div>
  );
}

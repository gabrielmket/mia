"use client";

/**
 * A CARTEIRA DESTE CLIENTE — crédito, preço acordado e extrato.
 *
 * Fica no painel administrativo porque recarregar crédito e acordar preço são
 * decisões de NEGÓCIO, não configuração de quem usa o sistema. A mesma régua
 * que põe a credencial do provedor aqui e a credencial do cliente lá.
 *
 * Duas coisas que a tela DIZ, em vez de deixar subentendido:
 *
 *  - preço não definido não é "de graça". É "ninguém combinou", e o disparador
 *    recusa — porque supor zero mandaria mensagem paga sem cobrar, e supor um
 *    número cobraria o que ninguém acordou.
 *  - não há botão de apagar lançamento. Extrato que se edita não é extrato: um
 *    crédito errado se corrige com um estorno, que aparece para o cliente.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { formatCentsBRL, parseReaisToCents } from "@/lib/money";
import {
  useCarteiraDoTenant,
  useDefinirPrecoDoTenant,
  useLancarNaCarteira,
  type LinhaDoExtrato,
} from "@/hooks/useCarteiraDoTenant";

const ROTULO_DO_TIPO: Record<LinhaDoExtrato["tipo"], string> = {
  credito: "Crédito",
  debito: "Consumo",
  estorno: "Estorno",
};

export function CarteiraDoTenant({ organizationId }: { organizationId: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const { data, isLoading, error } = useCarteiraDoTenant(organizationId);
  const lancar = useLancarNaCarteira(organizationId);
  const definirPreco = useDefinirPrecoDoTenant(organizationId);

  const [valor, setValor] = useState("");
  const [nota, setNota] = useState("");
  const [preco, setPreco] = useState("");
  const [alerta, setAlerta] = useState("");

  if (isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (error || !data) {
    return <p className="text-sm text-error-fg">{t("Não consegui carregar a carteira agora.")}</p>;
  }

  const creditar = (tipo: "credito" | "estorno") => {
    const cents = parseReaisToCents(valor.trim());
    if (cents === null || cents <= 0) return;
    lancar.mutate(
      { tipo, amount_cents: cents, note: nota.trim() || undefined },
      { onSuccess: () => { setValor(""); setNota(""); } },
    );
  };

  const gravarPreco = () => {
    const precoCents = preco.trim() === "" ? null : parseReaisToCents(preco.trim());
    // Campo digitado que não vira número não pode virar "sem preço acordado" em
    // silêncio: seria desligar o disparador do cliente por causa de um typo.
    if (preco.trim() !== "" && precoCents === null) return;
    const alertaCents = alerta.trim() === "" ? null : parseReaisToCents(alerta.trim());
    if (alerta.trim() !== "" && alertaCents === null) return;
    definirPreco.mutate({ preco_por_mensagem_cents: precoCents, alerta_saldo_cents: alertaCents });
  };

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border p-4">
        <p className="text-sm text-text-muted">{t("Saldo do cliente")}</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">
          {formatCentsBRL(data.saldo_cents)}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          {t("Creditado")} {formatCentsBRL(data.creditado_cents)} · {t("Consumido")}{" "}
          {formatCentsBRL(data.debitado_cents)} · {t("Estornado")}{" "}
          {formatCentsBRL(data.estornado_cents)}
        </p>
        {data.saldo_truncado && (
          // O extrato passou do teto de leitura da rota: sem esta linha o
          // número acima se leria como o saldo, e ele é uma soma parcial.
          <p className="mt-2 text-sm text-warning-fg" data-testid="aviso-de-corte">
            {t("O extrato passou do limite de leitura: o saldo soma só os lançamentos mais recentes.")}
          </p>
        )}
        {data.credito_acabando && (
          <p className="mt-2 text-sm text-warning-fg">
            {t("O crédito deste cliente está abaixo do piso de aviso.")}
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-md border border-border p-4">
        <h3 className="text-sm font-medium">{t("Lançar na carteira")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="carteira-valor">{t("Valor (R$)")}</Label>
            <Input
              id="carteira-valor"
              inputMode="decimal"
              placeholder="0,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="carteira-nota">{t("Observação")}</Label>
            <Input
              id="carteira-nota"
              placeholder={t("ex.: pacote de 5.000 mensagens")}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => creditar("credito")} disabled={lancar.isPending || !valor.trim()}>
            {t("Creditar")}
          </Button>
          {/* Estorno é lançamento, não desfazer: ele SOMA ao saldo e fica
              visível no extrato do cliente, que é o que um contador faria. */}
          <Button
            variant="secondary"
            onClick={() => creditar("estorno")}
            disabled={lancar.isPending || !valor.trim()}
          >
            {t("Estornar")}
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-md border border-border p-4">
        <h3 className="text-sm font-medium">{t("Preço acordado")}</h3>
        <p className="text-xs text-text-muted">
          {data.preco_por_mensagem_cents === null
            ? t("Sem preço acordado — o disparador RECUSA até alguém definir, em vez de supor.")
            : `${t("Hoje:")} ${formatCentsBRL(data.preco_por_mensagem_cents)} ${t("por mensagem")}`}
        </p>
        {/* O CUSTO, ao lado do preço. Sem ele, "margem" é chute — e o chute
            mais caro é o de supor que a Meta dá mensagem de marketing de graça
            (o gratuito dela é de conversa de SERVIÇO, iniciada pelo cliente). */}
        {data.custo_da_meta_cents === null ? (
          <p className="text-xs text-warning-fg">
            {t("A tarifa da Meta não está cadastrada — sem ela não dá para saber se este preço dá lucro.")}
          </p>
        ) : (
          <p
            className={
              data.preco_por_mensagem_cents !== null &&
              data.preco_por_mensagem_cents < data.custo_da_meta_cents
                ? "text-xs text-error-fg"
                : "text-xs text-text-muted"
            }
          >
            {t("A Meta cobra")} {formatCentsBRL(data.custo_da_meta_cents)} {t("por mensagem")}
            {data.preco_por_mensagem_cents !== null
              ? data.preco_por_mensagem_cents < data.custo_da_meta_cents
                ? ` — ${t("este preço está ABAIXO do custo.")}`
                : ` — ${t("margem de")} ${formatCentsBRL(
                    data.preco_por_mensagem_cents - data.custo_da_meta_cents,
                  )} ${t("por mensagem")}.`
              : ""}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="carteira-preco">{t("Preço por mensagem (R$)")}</Label>
            <Input
              id="carteira-preco"
              inputMode="decimal"
              placeholder="0,12"
              value={preco}
              onChange={(e) => setPreco(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="carteira-alerta">{t("Avisar quando o saldo cair abaixo de (R$)")}</Label>
            <Input
              id="carteira-alerta"
              inputMode="decimal"
              placeholder="50,00"
              value={alerta}
              onChange={(e) => setAlerta(e.target.value)}
            />
          </div>
        </div>
        <Button onClick={gravarPreco} disabled={definirPreco.isPending}>
          {t("Salvar preço")}
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t("Extrato")}</h3>
        {data.extrato.length === 0 ? (
          <p className="text-sm text-text-muted">{t("Nenhum lançamento ainda.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted">
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
                    <td className="py-2 text-text-muted">{l.note ?? l.ref_kind ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

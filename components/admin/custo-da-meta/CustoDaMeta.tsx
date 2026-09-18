"use client";

/**
 * O QUE A META COBROU, POR CLIENTE.
 *
 * Fica no painel da plataforma, como o custo de IA: é o preço de CUSTO daquilo
 * que o cliente comprou, e mostrá-lo a ele seria mostrar a margem.
 *
 * ⚠️ A Meta manda a CATEGORIA e o valor em lugar nenhum — ela cobra por tabela,
 * que varia por país. Então o dinheiro desta tela é contagem × o preço que VOCÊ
 * cadastrou aqui. Categoria sem preço aparece como pendência, e nunca como
 * zero: zero se lê como "de graça".
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { CATEGORIAS_CONHECIDAS } from "@/lib/channels/meta/custo-da-conversa";
import { useCustoDaMeta, useSalvarPrecosDaMeta } from "@/hooks/useCustoDaMeta";

function emReais(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function CustoDaMeta() {
  const t = useT();
  const [mes, setMes] = useState<string | null>(null);
  const { data, isLoading, error } = useCustoDaMeta(mes);
  const salvar = useSalvarPrecosDaMeta();
  const [rascunho, setRascunho] = useState<Record<string, string>>({});

  if (isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (error || !data) {
    return <p className="text-sm text-error-fg">{t("Não consegui carregar o custo agora.")}</p>;
  }

  const precoDe = (categoria: string) => {
    const atual = data.precos.find((p) => p.categoria === categoria);
    return rascunho[categoria] ?? (atual ? String(atual.centavos_brl / 100) : "");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("Custo das mensagens (Meta)")}</h1>
        <p className="text-sm text-text-muted">
          {t(
            "A Meta informa a categoria de cada mensagem cobrada, e não o valor — ela cobra por tabela. O dinheiro abaixo é a contagem multiplicada pelos preços que você cadastrar.",
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("Preço por categoria")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            {CATEGORIAS_CONHECIDAS.map((c) => (
              <div key={c} className="space-y-1">
                <Label htmlFor={`preco-${c}`}>{c}</Label>
                <Input
                  id={`preco-${c}`}
                  inputMode="decimal"
                  placeholder="0,00"
                  value={precoDe(c)}
                  onChange={(e) => setRascunho((r) => ({ ...r, [c]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <Button
            disabled={salvar.isPending || Object.keys(rascunho).length === 0}
            onClick={() =>
              salvar.mutate(
                Object.entries(rascunho).map(([categoria, valor]) => ({
                  categoria,
                  // Vírgula é como se digita preço em português, e um `Number`
                  // direto viraria NaN — que o zod recusa com uma frase que não
                  // menciona a vírgula.
                  centavos_brl: Math.round(Number(valor.replace(",", ".")) * 100) || 0,
                })),
                { onSuccess: () => setRascunho({}) },
              )
            }
          >
            {t("Salvar preços")}
          </Button>
          <p className="text-xs text-text-muted">
            {t("Em reais por mensagem. A tabela vigente da Meta muda por país e por reajuste.")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t("Gasto em")} {data.mes}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              className="sm:w-40"
              placeholder="2026-09"
              value={mes ?? data.mes}
              onChange={(e) => setMes(e.target.value)}
            />
          </div>

          {data.truncado && (
            <p className="text-sm text-error-fg">
              {t("A leitura foi cortada — há mais mensagens no mês do que cabe nesta conta.")}
            </p>
          )}

          {data.clientes.length === 0 ? (
            <p className="text-sm text-text-muted">
              {t("Nenhuma mensagem cobrada neste mês.")}
            </p>
          ) : (
            data.clientes.map((c) => (
              <div key={c.organization_id} className="rounded-md border border-border p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-medium">{c.organizacao}</p>
                  <p className="font-medium">{emReais(c.totalCentavos)}</p>
                </div>
                <ul className="mt-2 space-y-1 text-sm text-text-muted">
                  {c.linhas.map((l) => (
                    <li key={l.categoria}>
                      {l.categoria}: {l.cobradas}
                      {l.totalCentavos === null
                        ? ` · ${t("sem preço cadastrado")}`
                        : ` · ${emReais(l.totalCentavos)}`}
                    </li>
                  ))}
                </ul>
                {c.semPreco.length > 0 && (
                  <p className="mt-2 text-sm text-error-fg">
                    {/* Pendência NOSSA, e a frase diz isso: o total está menor
                        que a realidade, e quem lê precisa saber antes de usar o
                        número numa conversa de preço. */}
                    {t("O total está incompleto: falta cadastrar o preço de")}{" "}
                    {c.semPreco.join(", ")}
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

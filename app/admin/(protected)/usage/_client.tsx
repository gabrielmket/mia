"use client";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminUsage } from "@/hooks/useAdminUsage";
import { UsageCharts } from "@/components/admin/usage/UsageCharts";
import { UsageTable } from "@/components/admin/usage/UsageTable";
import { NaturezaDoGasto } from "@/components/admin/usage/NaturezaDoGasto";
import { SaldoDoProvedorSecao } from "@/components/admin/usage/SaldoDoProvedor";
import { useT } from "@/hooks/i18n/useT";
// FORK MIA (MIA-44): "Este mês" e "Mês passado" ao lado das janelas de dias.
import {
  ATALHOS_DE_PERIODO,
  pedidoDoAtalho,
  type AtalhoDePeriodo,
} from "@/lib/ai/usage/atalhos-de-periodo";

export function UsageClient() {
  const t = useT();
  const [atalho, setAtalho] = useState<AtalhoDePeriodo>("30d");
  const pedido = pedidoDoAtalho(atalho);
  // No mês, `range` vai como o padrão e a rota o ignora: quem manda é `mes`.
  const range = pedido.tipo === "dias" ? (`${pedido.dias}d` as const) : "30d";
  const mes = pedido.tipo === "mes" ? pedido.mes : null;

  const { data, isLoading, isError } = useAdminUsage(range, undefined, mes);

  const usageData = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Uso & Custo")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Consumo de mensagens, conversas e AI por tenant")}
          </p>
        </div>

        {/* Range selector */}
        <Select value={atalho} onValueChange={(v) => setAtalho(v as AtalhoDePeriodo)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("Período")} />
          </SelectTrigger>
          <SelectContent>
            {ATALHOS_DE_PERIODO.map((opt) => (
              <SelectItem key={opt.valor} value={opt.valor}>
                {t(opt.rotulo)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Charts */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-56 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
          <Skeleton className="h-56 rounded-lg md:col-span-2" />
        </div>
      ) : isError || !usageData ? (
        <div className="flex items-center justify-center rounded-lg border py-12 text-sm text-muted-foreground">
          {t("Erro ao carregar dados de uso. Tente recarregar.")}
        </div>
      ) : (
        <>
          {/* Antes dos gráficos: a separação é a informação que decide preço.
              Ver lib/ai/custo/natureza.ts. */}
          <NaturezaDoGasto
            natureza={usageData.natureza}
            cotacao={usageData.cotacao}
            reais={usageData.reais}
            fatura={usageData.fatura}
          />
          <UsageCharts series={usageData.series} />
          <UsageTable tenants={usageData.tenants} range={range} mes={usageData.mes} />
        </>
      )}

      {/* Independe do período escolhido acima: saldo é estado da conta, não da janela. */}
      <SaldoDoProvedorSecao />
    </div>
  );
}

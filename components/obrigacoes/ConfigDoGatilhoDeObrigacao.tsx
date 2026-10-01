"use client";

/**
 * FORK MIA — a configuração dos cinco gatilhos de obrigação, no editor de
 * regras de automação (plugado em `app/app/webhooks/_components/RuleEditor.tsx`).
 *
 * Três coisas: o X (dias), nos gatilhos que o pedem; o filtro por TIPO de
 * obrigação (vazio = todos); e o que a regra alcançaria HOJE, para a pessoa
 * confiar na regra antes de ligar. A simulação é a mesma conta da varredura
 * (`/api/v1/obrigacoes/simular`), sem gravar nada.
 */
import { useMemo } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { useSimulacaoDoGatilho, useTiposDeObrigacao } from "@/hooks/obrigacoes/useObrigacoes";
import { diaPorExtenso } from "@/lib/obrigacoes/datas";
import {
  DIAS_MAX,
  DIAS_MIN,
  EXPLICACAO_DOS_GATILHOS_DE_OBRIGACAO,
  GATILHO_DOCUMENTO_NAO_ENVIADO,
  GATILHO_DOCUMENTO_RECEBIDO,
  MARCACOES_DA_OBRIGACAO,
  configDoGatilhoDeObrigacao,
  gatilhoPedeDias,
  type GatilhoDeObrigacao,
} from "@/lib/obrigacoes/gatilhos";

export interface RascunhoDoGatilhoDeObrigacao {
  dias: string;
  tipo: string;
}

export function ConfigDoGatilhoDeObrigacao({
  gatilho,
  valor,
  onChange,
}: {
  gatilho: GatilhoDeObrigacao;
  valor: RascunhoDoGatilhoDeObrigacao;
  onChange: (novo: RascunhoDoGatilhoDeObrigacao) => void;
}) {
  const t = useT();
  const catalogo = useTiposDeObrigacao();
  const pedeDias = gatilhoPedeDias(gatilho);
  const configValida =
    configDoGatilhoDeObrigacao(gatilho, {
      ...(pedeDias ? { dias: valor.dias.trim() === "" ? Number.NaN : Number(valor.dias) } : {}),
      tipo: valor.tipo,
    }) !== null;
  const simulacao = useSimulacaoDoGatilho(gatilho, pedeDias ? valor.dias : "", valor.tipo, configValida && gatilho !== GATILHO_DOCUMENTO_RECEBIDO);

  // Os nomes oferecidos no filtro: os do catálogo da empresa e os dos modelos, sem repetir.
  const nomes = useMemo(() => {
    const vistos = new Set<string>();
    const saida: string[] = [];
    for (const nome of [...(catalogo.data?.tipos ?? []), ...(catalogo.data?.modelos ?? [])].map((x) => x.nome)) {
      const chave = nome.toLowerCase();
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      saida.push(nome);
    }
    return saida.sort((a, b) => a.localeCompare(b));
  }, [catalogo.data]);

  return (
    <div className="space-y-3 rounded-sm border border-border p-3" data-testid="config-do-gatilho-de-obrigacao">
      <p className="text-sm text-muted-foreground">{t(EXPLICACAO_DOS_GATILHOS_DE_OBRIGACAO[gatilho])}</p>
      <div className="flex flex-wrap items-end gap-3">
        {pedeDias ? (
          <div className="w-40 space-y-1">
            <Label htmlFor="dias-da-obrigacao">
              {gatilho === GATILHO_DOCUMENTO_NAO_ENVIADO ? t("Pedido há X dias") : t("X dias antes")}
            </Label>
            <Input
              id="dias-da-obrigacao"
              type="number"
              inputMode="numeric"
              min={DIAS_MIN}
              max={DIAS_MAX}
              value={valor.dias}
              onChange={(e) => onChange({ ...valor, dias: e.target.value })}
            />
          </div>
        ) : null}
        <div className="flex-1 basis-52 space-y-1">
          <Label htmlFor="tipo-da-obrigacao">{t("Só para o tipo de obrigação")}</Label>
          <Input
            id="tipo-da-obrigacao"
            list="tipos-de-obrigacao"
            value={valor.tipo}
            maxLength={120}
            placeholder={t("Todos os tipos")}
            onChange={(e) => onChange({ ...valor, tipo: e.target.value })}
          />
          <datalist id="tipos-de-obrigacao">
            {nomes.map((nome) => (
              <option key={nome} value={nome} />
            ))}
          </datalist>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("Nos textos das ações você pode usar:")}{" "}
        {MARCACOES_DA_OBRIGACAO.map((m) => m.marcacao).join(", ")}.{" "}
        {t("A regra dispara uma vez por item e ciclo, às 9h do fuso da empresa.")}
      </p>

      {gatilho === GATILHO_DOCUMENTO_RECEBIDO ? (
        <p className="text-xs text-muted-foreground">
          {t("Este gatilho dispara na hora em que alguém marca um documento como recebido; não há o que simular.")}
        </p>
      ) : simulacao.data ? (
        <div className="rounded-sm bg-muted p-2 text-xs" data-testid="simulacao-do-gatilho">
          <p className="font-medium text-text">
            {t("Hoje")}, {diaPorExtenso(simulacao.data.hoje)}, {t("dispararia para")} {simulacao.data.dispara_hoje.length}{" "}
            {simulacao.data.dispara_hoje.length === 1 ? t("item") : t("itens")}.
          </p>
          {simulacao.data.dispara_hoje.length > 0 ? (
            <p className="mt-1 text-muted-foreground">
              {simulacao.data.dispara_hoje
                .slice(0, 8)
                .map((i) => i.nome)
                .join(" · ")}
              {simulacao.data.dispara_hoje.length > 8 ? ` · +${simulacao.data.dispara_hoje.length - 8}` : ""}
            </p>
          ) : null}
          {simulacao.data.segurados.length > 0 ? (
            <p className="mt-1 text-muted-foreground">
              {t("Segura, porque o cliente já mandou um arquivo que espera confirmação:")}{" "}
              {simulacao.data.segurados.map((i) => i.nome).join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

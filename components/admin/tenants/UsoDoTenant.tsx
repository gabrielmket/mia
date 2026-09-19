"use client";

/**
 * O QUE ESTE CLIENTE CONSUMIU — e quanto ele custa para servir.
 *
 * A aba existia marcada `disabled`. A diferença entre esta tela e o
 * `/admin/usage` geral não é o dado, é a PERGUNTA: lá se compara clientes
 * ("quem gasta mais"); aqui se responde sobre um ("está crescendo? o custo
 * acompanha?") — a conversa de renovação e de reajuste.
 *
 * Os dois lados do custo juntos, e é o ponto: separados, cada número parece
 * pequeno.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { useUsoDoTenant } from "@/hooks/useUsoDoTenant";

const JANELAS = [7, 30, 90] as const;

function emDolar(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "USD" });
}
function emReais(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function UsoDoTenant({ organizationId }: { organizationId: string }) {
  const t = useT();
  const [dias, setDias] = useState<number>(30);
  const { data, isLoading, error } = useUsoDoTenant(organizationId, dias);

  if (isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (error || !data) {
    return <p className="text-sm text-error-fg">{t("Não consegui carregar o uso agora.")}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {JANELAS.map((d) => (
          <Button
            key={d}
            variant={d === dias ? "default" : "secondary"}
            onClick={() => setDias(d)}
          >
            {d} {t("dias")}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Movimento")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              {t("Conversas")}: <strong>{data.conversas}</strong>
            </p>
            <p>
              {t("Mensagens")}: <strong>{data.mensagens}</strong>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Custo de IA")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <strong>{emDolar(data.ia.custo_usd_cents)}</strong>
            </p>
            <p className="text-text-muted">
              {data.ia.chamadas} {t("chamadas")} · {data.ia.tokens.toLocaleString()} {t("tokens")}
            </p>
            {data.ia.truncado && (
              <p className="text-error-fg">
                {/* Sem este aviso o número se lê como total e a conta fecha
                    menor que a realidade. */}
                {t("A leitura foi cortada — o custo real é maior.")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Custo das mensagens (Meta)")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <strong>{emReais(data.mensagens_cobradas.totalCentavos)}</strong>{" "}
            <span className="text-text-muted">
              · {data.mensagens_cobradas.total} {t("cobradas")}
            </span>
          </p>
          <ul className="space-y-0.5 text-text-muted">
            {data.mensagens_cobradas.linhas.map((l) => (
              <li key={l.categoria}>
                {l.categoria}: {l.cobradas}
                {l.totalCentavos === null
                  ? ` · ${t("sem preço cadastrado")}`
                  : ` · ${emReais(l.totalCentavos)}`}
              </li>
            ))}
          </ul>
          {data.mensagens_cobradas.semPreco.length > 0 && (
            <p className="text-error-fg">
              {t("O total está incompleto: falta cadastrar o preço de")}{" "}
              {data.mensagens_cobradas.semPreco.join(", ")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

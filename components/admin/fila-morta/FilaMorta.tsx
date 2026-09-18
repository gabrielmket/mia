"use client";

/**
 * A FILA MORTA — cada linha aqui é um lead que escreveu e não foi respondido.
 *
 * Agrupada pela CAUSA e não por job: eles morrem em rajada, todos pelo mesmo
 * motivo (o rate limit do provedor, a chave expirada, o número caído). Caso real
 * desta instalação: 49 jobs mortos em segundos, todos por TPM, e 49 alertas
 * idênticos na Central. Uma lista de 49 linhas iguais não é informação — é a
 * mesma informação 49 vezes.
 *
 * ⚠️ O botão devolve à fila, e isso tem consequência: o agente vai responder
 * AGORA mensagens que chegaram horas atrás. Certo quando a causa era transitória;
 * errado se uma pessoa já atendeu o lead no meio tempo. Por isso a tela diz
 * desde quando eles estão parados — é o dado que decide.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useFilaMorta, useReprocessar } from "@/hooks/useFilaMorta";

export function FilaMorta() {
  const t = useT();
  const tag = useTagDeIdioma();
  const { data, isLoading, error } = useFilaMorta();
  const reprocessar = useReprocessar();

  if (isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (error || !data) {
    return <p className="text-sm text-error-fg">{t("Não consegui carregar a fila agora.")}</p>;
  }

  if (data.total === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">{t("Trabalho parado")}</h1>
        <p className="text-sm text-text-muted">
          {t("Nada parado. Todo trabalho que entrou foi processado.")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Trabalho parado")}</h1>
        <p className="text-sm text-text-muted">
          {t("Cada um destes é um atendimento que não aconteceu. Agrupados pelo motivo da falha.")}
        </p>
        {data.truncado && (
          <p className="mt-1 text-sm text-error-fg">
            {/* Dizer que a lista foi cortada é obrigação: sem isso, "5.000" se lê
                como o total, e o operador conclui que resolveu tudo. */}
            {t("A lista foi cortada — há mais do que cabe nesta tela.")}
          </p>
        )}
      </div>

      {data.grupos.map((g) => (
        <Card key={g.assinatura}>
          <CardHeader>
            <CardTitle className="text-base">
              {g.quantidade} {g.quantidade === 1 ? t("parado") : t("parados")}
              {" · "}
              {g.organizacoes.join(", ")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">
              {g.exemplo ?? t("Sem motivo registrado.")}
            </p>
            <p className="text-sm text-text-muted">
              {t("Parado desde")} {new Date(g.maisAntigo).toLocaleString(tag)}
              {" · "}
              {g.tipos.join(", ")}
            </p>
            <Button
              disabled={reprocessar.isPending}
              onClick={() => reprocessar.mutate(g.ids)}
            >
              {t("Tentar de novo")} ({g.ids.length})
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

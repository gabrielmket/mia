"use client";

/**
 * O CÉREBRO PADRÃO DA INSTALAÇÃO.
 *
 * Quem escolhe é quem opera a plataforma. O cliente não vê e não troca — ele
 * comprou atendimento, não a tarefa de comparar `gpt-4.1` com `claude-sonnet`.
 *
 * A tela mostra o PREÇO ao lado de cada modelo porque essa é a decisão de
 * verdade sendo tomada aqui: o custo por conversa é nosso, e trocar de modelo é
 * mexer na margem de todos os clientes de uma vez.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { useModeloDeIa, useSalvarModeloDeIa } from "@/hooks/useModeloDeIa";

/** `Select` do Radix não aceita valor vazio; este é o "nenhum". */
const AUTOMATICO = "__automatico__";

function precoPorMilhao(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "USD" });
}

export function ModeloDeIa() {
  const t = useT();
  const { data, isLoading, error } = useModeloDeIa();
  const salvar = useSalvarModeloDeIa();
  const [escolhido, setEscolhido] = useState<string | null>(null);

  if (isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (error || !data) {
    return <p className="text-sm text-error-fg">{t("Não consegui carregar o catálogo de modelos agora.")}</p>;
  }

  const atual = data.escolha?.model_id
    ? `${data.escolha.provider}::${data.escolha.model_id}`
    : AUTOMATICO;
  const valor = escolhido ?? atual;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("Modelo de IA da plataforma")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-text-muted">
            {t(
              "Vale para todo cliente novo. Quem contrata não escolhe o modelo — assim como não escolhe a chave de IA: é engrenagem nossa, e a conta também.",
            )}
          </p>

          <div className="space-y-2">
            <Label htmlFor="modelo-de-ia">{t("Modelo")}</Label>
            <Select value={valor} onValueChange={setEscolhido}>
              <SelectTrigger id="modelo-de-ia" className="sm:w-[36rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTOMATICO}>
                  {t("Automático (o sistema escolhe pelo catálogo)")}
                </SelectItem>
                {data.modelos.map((m) => (
                  <SelectItem key={`${m.provider}::${m.model_id}`} value={`${m.provider}::${m.model_id}`}>
                    {`${m.provider} · ${m.display_name ?? m.model_id}`}
                    {m.input_price_per_million_cents !== null
                      ? ` · ${precoPorMilhao(m.input_price_per_million_cents)}/M`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-text-muted">
              {/* O requisito não é preferência: o agente opera por ferramentas,
                  e modelo sem tool calling responde texto plausível sem criar
                  lead nenhum — falha que ninguém percebe por semanas. */}
              {t("A lista traz só os modelos que sabem usar ferramentas — é o que o agente precisa para mexer no funil.")}
            </p>
          </div>

          <Button
            disabled={salvar.isPending || valor === atual}
            onClick={() => {
              const [provider, modelId] =
                valor === AUTOMATICO ? [null, null] : valor.split("::");
              salvar.mutate(
                { provider: provider ?? null, model_id: modelId ?? null },
                { onSuccess: () => setEscolhido(null) },
              );
            }}
          >
            {t("Salvar")}
          </Button>

          {data.escolha?.model_id && (
            <p className="text-sm text-text-muted">
              {t("Agentes já publicados continuam com o modelo que tinham — a troca vale para os próximos.")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

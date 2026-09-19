"use client";

/**
 * SEGMENTAR PELA ETAPA DO FUNIL.
 *
 * A tag do contato diz QUEM a pessoa é ("VIP", "revenda"); a etapa diz ONDE a
 * negociação dela está ("pediu orçamento", "proposta enviada"). É a segunda que
 * se quer segmentar numa campanha — e era a que não existia: filtrar por tag
 * exige que alguém tenha marcado a tag à mão, o que quase nunca acontece.
 *
 * ⚠️ Só negócio ABERTO entra. Quem já comprou e quem disse não continuam
 * registrados na etapa, e mandar oferta para eles é o disparo que gera
 * reclamação. A frase abaixo do seletor diz isso — é a diferença entre o
 * operador confiar no número e ser surpreendido por ele.
 */
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { usePipelines, usePipelineStages } from "@/hooks/webhooks/useWebhookSources";

/** `Select` do Radix não aceita valor vazio; este é o "não filtrar". */
const TODAS = "__todas__";

export function SeletorDeEtapas({
  funil,
  aoMudarFunil,
  etapas,
  aoMudarEtapas,
  disabled,
}: {
  funil: string | null;
  aoMudarFunil: (id: string | null) => void;
  etapas: string[];
  aoMudarEtapas: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const { data: funis } = usePipelines();
  const { data: quadro } = usePipelineStages(funil);

  const lista = funis?.data ?? [];
  const etapasDoFunil = quadro?.data?.stages ?? [];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="bc-funil">{t("Funil")}</Label>
        <Select
          value={funil ?? TODAS}
          disabled={disabled}
          onValueChange={(v) => {
            aoMudarFunil(v === TODAS ? null : v);
            // Trocar de funil limpa as etapas: elas são de OUTRO funil, e manter
            // a escolha faria a lista sair vazia sem a tela dizer por quê.
            aoMudarEtapas([]);
          }}
        >
          <SelectTrigger id="bc-funil">
            <SelectValue placeholder={t("Todos os contatos")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAS}>{t("Todos os contatos")}</SelectItem>
            {lista.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {funil && (
        <div className="space-y-1">
          <Label htmlFor="bc-etapa">{t("Etapa")}</Label>
          <Select
            value={etapas[0] ?? TODAS}
            disabled={disabled}
            onValueChange={(v) => aoMudarEtapas(v === TODAS ? [] : [v])}
          >
            <SelectTrigger id="bc-etapa">
              <SelectValue placeholder={t("Qualquer etapa")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>{t("Qualquer etapa")}</SelectItem>
              {etapasDoFunil.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t("Só quem tem negócio ABERTO nesta etapa. Ganhos e perdidos ficam de fora.")}
          </p>
        </div>
      )}
    </div>
  );
}

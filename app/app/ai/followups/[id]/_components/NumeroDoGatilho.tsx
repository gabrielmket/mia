"use client";

/**
 * FORK MIA — O NÚMERO QUE FAZ A ABORDAGEM no gatilho "Lead criado".
 *
 * A regra mora em `lib/followup/numero-do-gatilho.ts`; aqui só a escolha. Mora
 * num arquivo próprio para o `TriggerConfigControl` do upstream carregar só a
 * ligação (e a cerca `gatilhos-oferecidos-tem-motor` lê os `<SelectItem>` de lá
 * como tipos de gatilho: uma opção de número ali seria lida como gatilho).
 *
 * "Automático" é o comportamento de sempre, e é o valor vazio: sem o campo no
 * `trigger_config`. Um número escolhido que some da lista (excluído) continua
 * aparecendo como tal, em vez de o seletor mostrar "Automático" e mentir sobre o
 * que está gravado.
 */
import { useT } from "@/hooks/i18n/useT";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { channelLabel, useChannelSessions, type ChannelSession } from "@/hooks/channels/useChannelSessions";
import { ehNumeroPorQr } from "@/lib/broadcast/canais-do-disparo";
import { capabilitiesOf, transportaMensagem } from "@/lib/channels/capabilities";
import type { ChannelProvider } from "@/lib/channels/types";
import { STATUS_CONECTADO } from "@/lib/followup/numero-do-gatilho";

/** Valor do seletor para "sem número escolhido". Nunca vai para o banco. */
const NUMERO_AUTOMATICO = "__automatico__";

type Traduz = (texto: string) => string;

/** Oficial (modelo aprovado, janela de 24 h) ou por QR (texto livre, risco de bloqueio). */
function tipoDoNumero(provider: string | undefined, t: Traduz): string {
  if (ehNumeroPorQr(provider)) return t("Número por QR");
  if (transportaMensagem(provider) && capabilitiesOf(provider as ChannelProvider).requiresTemplates) {
    return t("Oficial");
  }
  return t("Outro canal");
}

/** "Nome · telefone · Oficial", e "· desconectado" quando o número não entrega agora. */
export function rotuloDoNumero(c: ChannelSession, t: Traduz): string {
  const nome = channelLabel(c, t);
  const partes = [nome];
  if (c.phone_number && c.phone_number !== nome) partes.push(c.phone_number);
  partes.push(tipoDoNumero(c.provider, t));
  if (c.status !== STATUS_CONECTADO) partes.push(t("desconectado"));
  return partes.join(" · ");
}

export function NumeroDoGatilho({
  valor,
  onChange,
}: {
  /** `channel_session_id` escolhido; `""` = automático. */
  valor: string;
  onChange: (channelSessionId: string) => void;
}) {
  const t = useT();
  const canais = useChannelSessions();
  const lista = canais.data ?? [];
  const escolhido = valor !== "" ? lista.find((c) => c.id === valor) : undefined;
  const excluido = valor !== "" && !canais.isLoading && !canais.isError && escolhido === undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor="trigger-lead-numero">{t("Número que faz a abordagem")}</Label>
      <Select
        value={valor === "" ? NUMERO_AUTOMATICO : valor}
        onValueChange={(v) => onChange(v === NUMERO_AUTOMATICO ? "" : v)}
        disabled={canais.isLoading}
      >
        <SelectTrigger id="trigger-lead-numero" data-testid="trigger-lead-numero">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NUMERO_AUTOMATICO}>{t("Automático (como hoje)")}</SelectItem>
          {lista.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {rotuloDoNumero(c, t)}
            </SelectItem>
          ))}
          {excluido && <SelectItem value={valor}>{t("Número excluído")}</SelectItem>}
        </SelectContent>
      </Select>
      {canais.isError && (
        <p className="text-xs text-error-fg">
          {t("Não consegui carregar os números da empresa. Recarregue a página.")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {valor === ""
          ? t(
              "Automático: sai pelo número da conversa mais recente com o contato ou, sem conversa, pelo número conectado mais antigo da empresa.",
            )
          : t(
              "O primeiro contato sai só por este número. Se ele estiver desconectado ou for excluído, o lead não entra no fluxo: o sistema não troca de número sozinho.",
            )}
      </p>
      {escolhido && escolhido.status !== STATUS_CONECTADO && (
        <p className="text-xs text-warning-fg">
          {t("Este número está desconectado agora. Enquanto ele não voltar, os leads novos não entram neste fluxo.")}
        </p>
      )}
      {excluido && (
        <p className="text-xs text-error-fg">
          {t("O número escolhido foi excluído. Escolha outro número ou volte para o automático.")}
        </p>
      )}
    </div>
  );
}

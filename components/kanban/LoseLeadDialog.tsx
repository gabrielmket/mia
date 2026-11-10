"use client";
import { useMemo, useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useLoseLead } from "@/hooks/kanban/useUpdateLead";
import { useMotivosDePerdaDoFunil } from "@/hooks/kanban/useMotivosDePerdaDoFunil";
import { rotuloDoMotivoDePerda } from "@/lib/schemas/leads";
import { OUTRO, motivoDePerdaAceito, opcoesDeMotivoDePerda } from "@/lib/leads/motivos-de-perda-do-funil";
// FORK MIA (.107): o detalhe do "Outro motivo" vira nota pela rota de notas que já existe.
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";

/**
 * FORK MIA (.107): grava o detalhe do "Outro motivo" como nota do negócio. A
 * perda já foi registrada: se a nota falhar, a perda fica e a pessoa é avisada.
 */
export async function anotarMotivoDaPerda(
  leadId: string,
  detalhe: string,
  t: (texto: string) => string,
): Promise<boolean> {
  try {
    await apiClient.post(`/api/v1/leads/${leadId}/notas`, { texto: `${t("Motivo da perda")}: ${detalhe}` });
    return true;
  } catch {
    toast.warning(t("O negócio foi marcado como perdido, mas o detalhe não entrou no histórico."));
    return false;
  }
}

interface LoseLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  /**
   * Modo CARD: perde UM negócio pela rota individual (`/leads/{id}/lose`).
   * Ausente no modo lote.
   */
  leadId?: string;
  /**
   * Modo LOTE (#2484 F2): recebe o motivo escolhido e quem chamou decide a
   * escrita — a `leads/bulk` que já sabe decidir o motivo da perda (#917). O
   * diálogo é o MESMO do card: uma segunda janela de motivo seria a mesma
   * pergunta com duas respostas possíveis, e o funil passaria a ter duas listas.
   */
  onConfirm?: (lostReason: string, detalhe?: string) => void | Promise<void>;
  /**
   * Modo LOTE: quem chamou informa se a escrita em lote está em voo. Este
   * diálogo não conhece a mutação de lote (`useBulkAction`) — então não pode
   * perguntar `isPending` a ela; sem este sinal o botão "Confirmar" ficaria
   * clicável durante a escrita e um segundo clique dobraria o lote.
   */
  submitting?: boolean;
  /** Depois de a perda gravar — para quem mora fora do quadro (ex.: painel da conversa) recarregar o que mostra. */
  onPerdido?: () => void;
  /** Motivos do funil quando o quadro não está em cache (painel da conversa); sem isto, lê do cache do quadro. */
  motivos?: string[];
}

const MAX_LEN = 500;

export function LoseLeadDialog({
  open,
  onOpenChange,
  leadId,
  pipelineId,
  onConfirm,
  submitting = false,
  onPerdido,
  motivos,
}: LoseLeadDialogProps) {
  const t = useT();
  const [reasonCode, setReasonCode] = useState<string>("");
  const [otherText, setOtherText] = useState("");
  const mutation = useLoseLead(pipelineId);
  // O diálogo vale para os DOIS modos: a escrita individual (card) ou a do
  // chamador (lote). "em voo" é a mutação individual OU o sinal externo.
  const emVoo = mutation.isPending || submitting;

  // O funil deste card manda na lista: o que ele tem cadastrado substitui o
  // padrão do produto — ver lib/leads/motivos-de-perda-do-funil.ts.
  const doQuadro = useMotivosDePerdaDoFunil(pipelineId);
  const cadastrados = motivos ?? doQuadro;
  const opcoes = useMemo(() => opcoesDeMotivoDePerda(cadastrados), [cadastrados]);
  const funilConfigurado = cadastrados.length > 0;

  const textoOutro = otherText.trim();
  // "OUTRO" VAZIO VALE `other` NOS DOIS CASOS — com funil configurado ou sem.
  //
  // ⚠️ `other` É CANÔNICO. `fn_validate_lost_reason_required` aceita
  // `v_canonical ∪ settings.lost_reasons`, e `v_canonical` traz `'other'`
  // (supabase/baseline.sql, `fn_validate_lost_reason_required`) — o servidor
  // aceita este valor em QUALQUER funil, configurado ou não. Exigir o detalhe
  // aqui quando o funil tem motivos cadastrados fazia de "Outro" um beco sem
  // saída: os únicos textos que passavam eram os que já são rádio na tela ao
  // lado, ou um código canônico em inglês que ninguém digita. E cadastrar um
  // motivo novo é admin-only (`app/actions/settings/updatePipelineConfig.ts`),
  // então um `agent` com uma perda fora da lista não tinha ação correta
  // nenhuma: ou gravava um motivo errado, ou não fechava o negócio.
  //
  // O que CONTINUA recusado antes do clique é o texto digitado fora de
  // canônico ∪ cadastrado — esse o trigger nega mesmo (FORK MIA .107: agora vira nota, abaixo),
  // com 22023, e é ele que a issue #918 pede para barrar na tela.
  //
  // ⚠️ A CHECAGEM VALE SEM FUNIL CONFIGURADO TAMBÉM. `fn_validate_lost_reason_
  // required` não tem caso especial para `settings.lost_reasons` ausente/vazio
  // — ele só amplia `v_canonical` com o que houver, e sem nada cadastrado o
  // conjunto aceito é SÓ o canônico (8 códigos em inglês). Um texto livre como
  // "Cliente mudou de ideia" nunca é um desses códigos, então SEMPRE batia com
  // 22023 `lost_reason_invalid` no clique — reproduzido em produção
  // (crm.fabrasoftware.com.br) com "Lead optou em outra solução". Gatear esta
  // checagem em `funilConfigurado` fazia a tela mentir: para o funil sem
  // motivos cadastrados (o caso comum, inclusive toda instalação nova), o
  // texto do "Detalhe" NUNCA era aceito pelo servidor, e a pessoa só descobria
  // depois de já ter clicado "Confirmar".
  //
  // FORK MIA (.107): o texto fora da lista NÃO bloqueia mais. Abrir "Outro" e
  // não conseguir registrar nada não fazia sentido (o dono do produto, 09/11/2026).
  // O motivo grava `other` (canônico, que o trigger aceita em qualquer funil), e o
  // texto vai para o histórico do negócio como NOTA, pela rota de notas que já
  // existe. O relatório "Por que perdemos" conta "Outro motivo"; quem abre o
  // negócio lê o porquê. Texto igual a um motivo da lista continua gravando o motivo.
  const detalheVaiParaNota =
    reasonCode === OUTRO &&
    textoOutro.length > 0 &&
    !motivoDePerdaAceito(textoOutro, cadastrados);

  const finalReason = reasonCode === OUTRO ? (detalheVaiParaNota ? OUTRO : textoOutro || OUTRO) : reasonCode;
  const detalhe = detalheVaiParaNota ? textoOutro : undefined;
  const disabled =
    !reasonCode ||
    finalReason.length === 0 ||
    finalReason.length > MAX_LEN ||
    emVoo;

  const handleSubmit = async () => {
    if (disabled) return;
    try {
      // Modo LOTE (#2484 F2): o motivo vai para quem chamou, que escreve pela
      // `leads/bulk`. Modo CARD: a rota individual. Sem `leadId` NEM `onConfirm`
      // não há escrita nenhuma a fazer — o `disabled` já cobre o caso de uso,
      // e este guarda evita um clique pendurado em arranjo inválido.
      if (onConfirm) {
        await onConfirm(finalReason, detalhe);
      } else if (leadId) {
        await mutation.mutateAsync({ leadId, lostReason: finalReason });
        // FORK MIA (.107): o detalhe do "Outro" vira nota no histórico do negócio.
        if (detalhe) await anotarMotivoDaPerda(leadId, detalhe, t);
      } else {
        return;
      }
      setReasonCode("");
      setOtherText("");
      onOpenChange(false);
      onPerdido?.();
    } catch {
      // error already toasted
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Marcar como perdido")}</DialogTitle>
          <DialogDescription>
            {t("Informe o motivo. Essa informação ajuda a melhorar o funil.")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Label>{t("Motivo")}</Label>
          {/* FORK MIA (.93): marcador do "Me mostra como" (lib/assistente/trilhas/catalogo.ts). */}
          <div className="grid grid-cols-1 gap-1.5" data-testid="motivo-da-perda">
            {opcoes.map((opcao) => (
              <label
                key={opcao.valor}
                className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
              >
                <input
                  type="radio"
                  name="lost-reason"
                  value={opcao.valor}
                  checked={reasonCode === opcao.valor}
                  onChange={(e) => setReasonCode(e.target.value)}
                />
                <span>{opcao.doFunil ? opcao.valor : t(rotuloDoMotivoDePerda(opcao.valor))}</span>
              </label>
            ))}
          </div>
          {reasonCode === OUTRO && (
            <div className="grid gap-1.5">
              <Label htmlFor="lost-reason-other">
                {t("Detalhe (opcional)")}
              </Label>
              <Textarea
                id="lost-reason-other"
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder={t("Ex: Cliente desistiu por X motivo")}
                maxLength={MAX_LEN}
                rows={3}
              />
              <div className="text-right text-[11px] text-muted-foreground tabular-nums">
                {otherText.length}/{MAX_LEN}
              </div>
              {/* FORK MIA (.107): o texto fora da lista vai para o histórico, sem recusa. */}
              {detalheVaiParaNota && (
                <p className="text-xs text-muted-foreground" data-testid="detalhe-vira-nota">
                  {t("O motivo fica como “Outro motivo” e este texto vai para o histórico do negócio.")}
                </p>
              )}
              {/*
                FORK MIA (.107): com funil configurado, a dica de onde se
                cadastra um motivo novo continua (para o motivo entrar na LISTA
                e no relatório com o próprio nome). O texto livre não é mais
                recusado: vira nota no histórico (ver `detalheVaiParaNota`).
              */}
              {funilConfigurado && (
                <p className="text-xs text-muted-foreground">
                  {/* FORK MIA: o caminho com os nomes do menu da MIA (lib/navigation/catalogo.ts). */}
                  {t("Para usar um motivo que não está aqui, cadastre em MIA CRM › Ver tudo no CRM › Etapas do funil.")}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={emVoo}
          >
            {t("Cancelar")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={disabled}
            // FORK MIA (.93): marcador do "Me mostra como" (lib/assistente/trilhas/catalogo.ts).
            data-testid="confirmar-perda"
          >
            {emVoo ? t("Salvando...") : t("Confirmar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

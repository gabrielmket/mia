"use client";
import { useT } from "@/hooks/i18n/useT";
import { usePodeVerEquipe } from "@/hooks/kanban/usePodeVerEquipe";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Lead } from "@/lib/types/leads";
import { LeadFieldsForm } from "./LeadFieldsForm";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: Lead;
  pipelineId: string;
}

/**
 * O diálogo do menu de ações do card.
 *
 * Os campos são os do `LeadFieldsForm` — os MESMOS do dossiê. Este arquivo já
 * teve a cópia deles, e a cópia divergiu exatamente como o comentário de lá
 * previa: tipo de receita e origem nasceram só no dossiê, e quem editasse pelo
 * menu não teria como classificar a venda que acabou de fechar. Um formulário
 * só: o diálogo cuida do enquadramento, não do conteúdo.
 */
export function EditLeadDialog({ open, onOpenChange, lead, pipelineId }: Props) {
  const t = useT();
  // FORK MIA: a permissão do seletor de "quem originou" é lida aqui e descida
  // ao formulário. Ver `podeVerEquipe` no LeadFieldsForm.
  const podeVerEquipe = usePodeVerEquipe();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Editar lead")}</DialogTitle>
          <DialogDescription>
            {t("Atualize os campos. Mover de etapa ou marcar ganho/perdido tem opções próprias.")}
          </DialogDescription>
        </DialogHeader>
        {/* Aqui o salvamento FECHA: diferente do dossiê, não há timeline atrás
            para a pessoa ver a atividade que acabou de gerar. */}
        <LeadFieldsForm
          lead={lead}
          pipelineId={pipelineId}
          podeVerEquipe={podeVerEquipe}
          onSaved={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

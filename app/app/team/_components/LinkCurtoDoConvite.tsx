"use client";
/**
 * FORK MIA (9023) — "Copiar link do convite", na lista de convites da aba Membros.
 *
 * Gera um link curto NOVO (`/c/<código>`) e o copia. O código cru não fica
 * guardado em lugar nenhum (só o hash, `lib/team/link-curto.ts`), então cada
 * cópia é um link novo, e o anterior deste convite, inclusive o do e-mail,
 * deixa de valer. O aviso diz isso na hora.
 *
 * A cópia acontece depois de uma ida ao servidor. Navegador que só deixa copiar
 * colado ao clique (Safari) recusa: aí o link aparece num diálogo, com o botão
 * de copiar, que é um clique novo.
 *
 * Mora num arquivo nosso para `TeamInvitesClient.tsx`, que é do upstream, mudar
 * o mínimo: ele chama o gancho e renderiza o `dialogo`.
 */
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { useLinkCurtoDoConvite } from "@/hooks/team/useLinkCurtoDoConvite";
import { copyToClipboard } from "@/lib/clipboard";
import { Copy } from "@/lib/ui/icons";

export function useCopiarLinkDoConvite(): {
  copiar: (conviteId: string) => Promise<void>;
  gerando: boolean;
  dialogo: ReactNode;
} {
  const t = useT();
  const gerar = useLinkCurtoDoConvite();
  const [paraMostrar, setParaMostrar] = useState<string | null>(null);

  async function copiar(conviteId: string) {
    let link: string;
    try {
      link = (await gerar.mutateAsync(conviteId)).data.link_curto;
    } catch {
      return; // showApiError já avisou
    }
    if (await copyToClipboard(link)) {
      toast.success(
        t("Link novo copiado. O link anterior deste convite, inclusive o do e-mail, deixou de valer."),
      );
    } else {
      setParaMostrar(link);
    }
  }

  return {
    copiar,
    gerando: gerar.isPending,
    dialogo: <DialogoDoLinkCurto link={paraMostrar} onFechar={() => setParaMostrar(null)} />,
  };
}

function DialogoDoLinkCurto({ link, onFechar }: { link: string | null; onFechar: () => void }) {
  const t = useT();
  return (
    <Dialog open={link !== null} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Link do convite")}</DialogTitle>
          <DialogDescription>
            {t(
              "O link novo foi gerado, mas não deu para copiar sozinho. Copie abaixo e mande para a pessoa. O link anterior deste convite, inclusive o do e-mail, deixou de valer.",
            )}
          </DialogDescription>
        </DialogHeader>
        <Input
          readOnly
          value={link ?? ""}
          aria-label={t("Link do convite")}
          onFocus={(e) => e.currentTarget.select()}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            {t("Fechar")}
          </Button>
          <Button
            className="gap-1"
            onClick={async () => {
              if (link && (await copyToClipboard(link))) {
                toast.success(t("Link do convite copiado."));
                onFechar();
              } else {
                toast.error(t("Não foi possível copiar. Selecione o link e copie à mão."));
              }
            }}
          >
            <Copy size={16} />
            {t("Copiar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

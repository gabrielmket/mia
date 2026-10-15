"use client";
/**
 * FORK MIA (9023) — o link curto de um convite recém-enviado, com o botão de
 * copiar, no resultado da tela Convidar membros.
 *
 * É o MESMO link do e-mail (`/c/<código>`): copiar daqui não troca nada, e o
 * e-mail continua valendo. Para mandar por WhatsApp além do e-mail, é aqui que
 * se copia. (Na lista de convites da aba Membros, "Copiar link do convite" gera
 * um link novo, porque o código cru não fica guardado.)
 */
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { copyToClipboard } from "@/lib/clipboard";
import { Copy } from "@/lib/ui/icons";

export function LinkCurtoDoEnvio({ link }: { link: string }) {
  const t = useT();
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <code className="text-xs break-all">{link}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={async () => {
          if (await copyToClipboard(link)) toast.success(t("Link do convite copiado."));
          else toast.error(t("Não foi possível copiar. Selecione o link e copie à mão."));
        }}
      >
        <Copy size={13} />
        {t("Copiar link do convite")}
      </Button>
    </div>
  );
}

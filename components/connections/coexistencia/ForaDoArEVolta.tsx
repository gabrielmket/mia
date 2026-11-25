"use client";
/**
 * FORK MIA · coexistência (S4; docs/fork/coexistencia.md): o número que saiu
 * da coexistência e o que voltou, no cartão do canal. É a tela 4 do protótipo
 * v3 aprovado pelo Gabriel em 17/11/2026.
 *
 *  - fora do ar: desde quando, o motivo que a Meta deu, o que para e como
 *    voltar, com o botão "Conectar de novo" (a mesma janela da S3);
 *  - de volta: quando voltou, e que contatos, conversas e cartões são os
 *    mesmos de antes.
 *
 * Só o número da EMPRESA e datas: nenhum nome nem trecho de conversa.
 */
import { Button } from "@/components/ui/button";
import type { NumeroPeloAppNaTela } from "@/hooks/channels/useCoexistencia";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { motivoDaSaidaEmPalavras } from "@/lib/channels/meta/coexistencia/motivo";

export function ForaDoArEVolta({
  numero,
  podeConectar,
  aoConectar,
}: {
  numero: Pick<NumeroPeloAppNaTela, "estado" | "foraDoArMotivo" | "foraDoArEm" | "voltouEm">;
  podeConectar: boolean;
  aoConectar: () => void;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const data = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(tag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

  if (numero.estado === "fora_do_ar") {
    return (
      <div className="mt-3 rounded-md border border-border p-3 text-sm" data-testid="coexistencia-fora-do-ar">
        <p>
          {t("O número saiu da API desde")} {data(numero.foraDoArEm)}.{" "}
          {t("Motivo informado pela Meta:")} {motivoDaSaidaEmPalavras(numero.foraDoArMotivo, t)}
        </p>
        <p className="mt-1 text-text-muted">
          {t("Enquanto isso, nada sai pela MIA por este número: IA, equipe, disparos e lembretes param. O app no celular continua funcionando.")}
        </p>
        <p className="mt-1 text-text-muted">
          {t("Para voltar: abra o app no celular e conecte de novo por \"Conectar pelo app WhatsApp Business\".")}
        </p>
        <Button className="mt-2" size="sm" disabled={!podeConectar} onClick={aoConectar} data-testid="coexistencia-conectar-de-novo">
          {t("Conectar de novo")}
        </Button>
      </div>
    );
  }

  if (numero.estado === "no_ar" && numero.voltouEm) {
    return (
      <p className="mt-3 text-sm text-text-muted" data-testid="coexistencia-de-volta">
        {t("O número voltou em")} {data(numero.voltouEm)}.{" "}
        {t("Contatos, conversas e cartões são os mesmos de antes: nada foi duplicado. A IA volta a responder as conversas novas.")}
      </p>
    );
  }
  return null;
}

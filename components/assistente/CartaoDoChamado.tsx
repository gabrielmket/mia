"use client";

/**
 * FORK MIA (.88) — o chamado que o assistente vai abrir para a Time Company,
 * para a pessoa conferir antes (regra "Erros e pedidos" do protótipo).
 *
 * Mostra o que ela disse e o que o assistente junta sozinho (a tela, a hora, a
 * versão e o navegador entram pelo servidor; a mensagem do sistema vem da
 * última recusa que a tela viu). O print é opcional. Quando a mensagem parece
 * só um campo faltando, o cartão diz isso e oferece "Resolvi, obrigado".
 */
import { useId, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAbrirChamado } from "@/hooks/assistente/useAssistente";
import { useT } from "@/hooks/i18n/useT";
import { destinoDaTela } from "@/lib/assistente/telas";
import { ROTULO_DO_TIPO_DE_CHAMADO, type TipoDeChamado } from "@/lib/assistente/tipos";

export function CartaoDoChamado({
  rascunho,
  caminho,
  conversaId,
}: {
  rascunho: { tipo: TipoDeChamado; texto: string; mensagem_do_sistema: string | null; parece_validacao: boolean };
  caminho: string;
  conversaId: string | null;
}) {
  const t = useT();
  const idDoPrint = useId();
  const abrir = useAbrirChamado();
  const [print, setPrint] = useState<File | null>(null);
  const [estado, setEstado] = useState<"conferindo" | "aberto" | "resolvido">("conferindo");
  const [numero, setNumero] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const destino = destinoDaTela(caminho);

  if (estado === "resolvido") {
    return <p className="text-sm">{t("Que bom. Se acontecer de novo, é só me chamar.")}</p>;
  }
  if (estado === "aberto") {
    return (
      <p className="text-sm" data-testid="chamado-aberto">
        {aviso ??
          `${t("Chamado")} #${numero ?? ""} ${t("aberto. A resposta da Time chega aqui no assistente e no seu e-mail.")}`}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background p-3" data-testid="cartao-do-chamado">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t("Chamado que vou abrir")}</span>
        <Badge variant={rascunho.tipo === "erro" ? "error" : rascunho.tipo === "pedido" ? "info" : "neutral"}>
          {t(ROTULO_DO_TIPO_DE_CHAMADO[rascunho.tipo])}
        </Badge>
      </div>
      {rascunho.parece_validacao ? (
        <p className="rounded-md bg-warning-bg px-2 py-1 text-xs text-warning-fg">
          {t("Parece só um campo faltando, e não um erro do sistema. Se quiser, abro o chamado mesmo assim.")}
        </p>
      ) : null}
      <p className="text-xs">
        <span className="font-medium">{t("O que você disse")}:</span> {rascunho.texto}
      </p>
      <p className="text-xs text-text-muted">
        <span className="font-medium">{t("O que eu junto")}:</span> {t("tela")} {destino ? t(destino.label) : caminho} · {t("a hora")} · {t("a versão do sistema")} ·{" "}
        {t("o navegador")}
        {rascunho.mensagem_do_sistema ? ` · ${t("mensagem do sistema")} "${rascunho.mensagem_do_sistema}"` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={idDoPrint}
          className="inline-flex h-11 cursor-pointer items-center rounded-md border px-3 text-xs hover:bg-muted lg:h-8"
        >
          {print ? t("Trocar o print") : t("Anexar print")}
        </label>
        <input
          id={idDoPrint}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(e) => setPrint(e.target.files?.[0] ?? null)}
        />
        {print ? <Badge variant="success">{print.name}</Badge> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="h-11 lg:h-8"
          disabled={abrir.isPending}
          onClick={() =>
            abrir.mutate(
              {
                tipo: rascunho.tipo,
                texto: rascunho.texto,
                mensagemDoSistema: rascunho.mensagem_do_sistema,
                caminho,
                conversaId,
                print,
              },
              {
                onSuccess: (r) => {
                  setNumero(r.chamado.numero);
                  setAviso(r.demonstracao ? r.aviso : null);
                  setEstado("aberto");
                },
                onError: (e) => toast.error(t(e instanceof Error ? e.message : "Não deu para abrir o chamado agora.")),
              },
            )
          }
        >
          {abrir.isPending ? t("Abrindo…") : t("Abrir o chamado")}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-11 lg:h-8" onClick={() => setEstado("resolvido")}>
          {t("Resolvi, obrigado")}
        </Button>
      </div>
    </div>
  );
}

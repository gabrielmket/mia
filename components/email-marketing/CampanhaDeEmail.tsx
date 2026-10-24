"use client";

/**
 * FORK MIA (.89) — UMA CAMPANHA DE E-MAIL, nas quatro telas do protótipo
 * aprovado: Público (tela 2), Mensagem (tela 3), Enviar (tela 4) e Resultados
 * (tela 5). A ordem é o produto: o envio só libera com o domínio verificado, o
 * rodapé completo e um teste da versão atual; o rascunho não dispara nada.
 */
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/hooks/i18n/useT";
import {
  useCampanhaDeEmail,
  useControleDaCampanha,
  useEditarCampanha,
  useRetratoDoEmail,
} from "@/hooks/useEmailMarketing";
import { ROTULO_DA_PAUSA, ROTULO_DO_STATUS_DA_CAMPANHA } from "@/lib/email-marketing/rotulos";
import { ArrowBendUpLeft } from "@/lib/ui/icons";

import { AbaEnviar } from "./campanha/AbaEnviar";
import { AbaMensagem } from "./campanha/AbaMensagem";
import { AbaPublico } from "./campanha/AbaPublico";
import { AbaResultados } from "./campanha/AbaResultados";

export type AbaDaCampanha = "publico" | "mensagem" | "enviar" | "resultados";

const VARIANTE: Record<string, "neutral" | "info" | "default" | "error" | "success" | "warning"> = {
  rascunho: "neutral",
  agendada: "info",
  enviando: "default",
  pausada: "error",
  concluida: "success",
  cancelada: "neutral",
};

/** A frase da pausa: o código conhecido vira frase; a trava de saúde já vem escrita. */
export function fraseDaPausa(motivo: string | null, t: (s: string) => string): string | null {
  if (!motivo) return null;
  if (ROTULO_DA_PAUSA[motivo]) return t(ROTULO_DA_PAUSA[motivo]);
  if (motivo.startsWith("trava_de_saude:")) return motivo.replace(/^trava_de_saude:\w+:\s*/, "");
  return motivo;
}

export function CampanhaDeEmail({ id }: { id: string }) {
  const t = useT();
  const q = useCampanhaDeEmail(id);
  const retrato = useRetratoDoEmail();
  const editar = useEditarCampanha(id);
  const controle = useControleDaCampanha(id);
  const [aba, setAba] = useState<AbaDaCampanha | null>(null);
  const [nome, setNome] = useState<string | null>(null);

  if (q.isLoading || retrato.isLoading)
    return <p className="p-6 text-sm text-muted-foreground">{t("Carregando…")}</p>;
  if (q.isError || !q.data || !retrato.data) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-error-fg">{t("Não consegui carregar a campanha.")}</p>
        <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
          {t("Tentar novamente")}
        </Button>
      </div>
    );
  }
  const c = q.data.campanha;
  const rascunho = c.status === "rascunho";
  const abaAtual: AbaDaCampanha = aba ?? (rascunho ? "publico" : "resultados");
  const pausa = fraseDaPausa(c.motivo_da_pausa, t);
  const travaDeSaude = (c.motivo_da_pausa ?? "").startsWith("trava_de_saude");

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6" data-campanha-de-email={c.status}>
      <Link
        href="/app/broadcast"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-text lg:min-h-0"
      >
        <ArrowBendUpLeft size={14} aria-hidden />
        {t("Broadcast")}
      </Link>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          {rascunho ? (
            <Input
              aria-label={t("Nome da campanha")}
              className="text-xl font-semibold"
              value={nome ?? c.nome}
              onChange={(e) => setNome(e.target.value)}
              onBlur={() => {
                if (nome && nome.trim() && nome !== c.nome) editar.mutate({ nome: nome.trim() });
              }}
            />
          ) : (
            <h1 className="truncate text-2xl font-semibold tracking-tight">{c.nome}</h1>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={VARIANTE[c.status] ?? "neutral"}>
              {t(ROTULO_DO_STATUS_DA_CAMPANHA[c.status] ?? c.status)}
            </Badge>
            <span>
              {c.base_legal === "legitimate_interest"
                ? t("Interesse legítimo")
                : t("Consentimento")}
            </span>
            {c.origem === "mcp" ? (
              <Badge variant="info">{t("Montada pela implantação")}</Badge>
            ) : null}
          </div>
          {pausa ? <p className="text-sm text-error-fg">{pausa}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {c.status === "enviando" || c.status === "agendada" ? (
            <Button
              variant="outline"
              disabled={controle.isPending}
              onClick={() =>
                controle.mutate(
                  { acao: "pausar" },
                  {
                    onSuccess: () =>
                      toast.success(t("Envio pausado. Quem ainda não recebeu fica na fila.")),
                  },
                )
              }
            >
              {t("Pausar")}
            </Button>
          ) : null}
          {c.status === "pausada" ? (
            <Button
              variant="outline"
              disabled={controle.isPending}
              onClick={() => {
                if (
                  travaDeSaude &&
                  !window.confirm(
                    t(
                      "A trava parou o envio. Retomar agora arrisca a conta da Amazon, que é uma só para todas as empresas. Retomar mesmo assim?",
                    ),
                  )
                )
                  return;
                controle.mutate(
                  { acao: "retomar", mesmo_assim: travaDeSaude },
                  { onSuccess: () => toast.success(t("Envio retomado.")) },
                );
              }}
            >
              {t("Retomar")}
            </Button>
          ) : null}
          {c.status === "agendada" || c.status === "pausada" ? (
            <Button
              variant="ghost"
              disabled={controle.isPending}
              onClick={() => {
                const frase =
                  c.status === "agendada"
                    ? t(
                        "Cancelar o agendamento? A campanha volta a rascunho. Nada saiu e nada foi cobrado.",
                      )
                    : t("Encerrar a campanha? Quem ainda não recebeu fica de fora.");
                if (window.confirm(frase)) controle.mutate({ acao: "cancelar" });
              }}
            >
              {c.status === "agendada" ? t("Cancelar agendamento") : t("Encerrar")}
            </Button>
          ) : null}
        </div>
      </header>

      <Tabs value={abaAtual} onValueChange={(v) => setAba(v as AbaDaCampanha)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="publico">{t("Público")}</TabsTrigger>
          <TabsTrigger value="mensagem">{t("Mensagem")}</TabsTrigger>
          <TabsTrigger value="enviar">{t("Enviar")}</TabsTrigger>
          <TabsTrigger value="resultados">{t("Resultados")}</TabsTrigger>
        </TabsList>
        <TabsContent value="publico" className="mt-4">
          <AbaPublico campanha={c} aoSeguir={() => setAba("mensagem")} />
        </TabsContent>
        <TabsContent value="mensagem" className="mt-4">
          <AbaMensagem campanha={c} retrato={retrato.data} testes={q.data.testes} />
        </TabsContent>
        <TabsContent value="enviar" className="mt-4">
          <AbaEnviar campanha={c} retrato={retrato.data} aoIr={(a) => setAba(a)} />
        </TabsContent>
        <TabsContent value="resultados" className="mt-4">
          <AbaResultados campanha={c} />
        </TabsContent>
      </Tabs>
      {!retrato.data.amazon.configurado ? (
        <Card className="p-4 text-sm text-warning-fg">
          {t(
            "O envio pela Amazon ainda não foi ligado no servidor: dá para montar a campanha, e nada sai até as chaves entrarem.",
          )}
        </Card>
      ) : null}
    </div>
  );
}

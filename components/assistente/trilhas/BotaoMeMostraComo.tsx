"use client";

/**
 * FORK MIA (.93) — o botão "Me mostra como" de uma trilha (ou do guia curto de
 * um manual). Aparece na resposta do assistente, no "O que falta", no Início e
 * na lista de trilhas, com a MESMA régua:
 *
 *   - "Me mostra como" liga a guia na tela; pausada, vira "Continuar de onde
 *     parei"; feita por você, "Fazer de novo"; feita na empresa, some;
 *   - de outro papel, vira "Ver os passos" (a lista, para ler e pedir a quem pode);
 *   - "Me mostra como" desligado na empresa, ou a trilha desligada: nada.
 */
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  comecarATrilha,
  comecarOGuiaDoManual,
  useTrilhas,
  type GuiaDeManual,
  type SituacaoDaTrilhaNaTela,
} from "@/hooks/assistente/useTrilhas";
import { useT } from "@/hooks/i18n/useT";
import { trilhaPorId, type IdDaTrilha } from "@/lib/assistente/trilhas/catalogo";

type Tamanho = "sm" | "default";

/** O rótulo e o que o clique faz, pela situação da trilha. */
export function acaoDaTrilha(s: SituacaoDaTrilhaNaTela): { rotulo: string; retomar: boolean; deNovo: boolean } | null {
  if (!s.do_papel) return null;
  if (s.estado === "pausada" || s.estado === "andando") return { rotulo: "Continuar de onde parei", retomar: true, deNovo: false };
  if (s.estado === "feita") return s.feita_na_empresa ? null : { rotulo: "Fazer de novo", retomar: false, deNovo: true };
  if (s.estado === "nova") return { rotulo: "Me mostra como", retomar: false, deNovo: false };
  return null;
}

export function BotaoMeMostraComo({
  trilha: id,
  rotulo,
  aoComecar,
  tamanho = "sm",
  variante = "outline",
}: {
  trilha: IdDaTrilha;
  /** Troca o rótulo do "Me mostra como" (ex.: "Me mostra como: criar um funil"). */
  rotulo?: string;
  /** Chamado depois de a guia começar (fechar a gaveta do assistente). */
  aoComecar?: () => void;
  tamanho?: Tamanho;
  variante?: "default" | "outline";
}) {
  const t = useT();
  const dados = useTrilhas();
  const [comecando, setComecando] = useState(false);
  const trilha = trilhaPorId(id);
  const s = dados.data?.trilhas.find((x) => x.id === id);
  if (!trilha || !dados.data?.disponivel || !dados.data.me_mostra_como || !s) return null;

  if (!s.do_papel) {
    return (
      <Button asChild size={tamanho} variant="outline" className="h-11 self-start lg:h-8">
        <Link href={`/app/assistente?aba=trilhas&trilha=${id}`} onClick={() => aoComecar?.()}>
          {t("Ver os passos")}
        </Link>
      </Button>
    );
  }
  const acao = acaoDaTrilha(s);
  if (!acao) return null;
  const texto = !rotulo ? t(acao.rotulo) : acao.retomar ? `${t("Continuar")}: ${rotulo}` : acao.deNovo ? `${t("Fazer de novo")}: ${rotulo}` : rotulo;

  return (
    <Button
      type="button"
      size={tamanho}
      variant={variante}
      className="h-11 self-start lg:h-8"
      disabled={comecando}
      data-testid={`me-mostra-como-${id}`}
      onClick={() => {
        setComecando(true);
        comecarATrilha(id, { retomar: acao.retomar, deNovo: acao.deNovo })
          .then(() => aoComecar?.())
          .catch((e: unknown) => toast.error(t(e instanceof Error && e.message ? e.message : "Não deu para começar a trilha agora.")))
          .finally(() => setComecando(false));
      }}
    >
      {texto}
    </Button>
  );
}

/** O "Me mostra como" do guia curto de um manual que tem tela (sem trilha no catálogo). */
export function BotaoDoGuiaDoManual({ manual, aoComecar }: { manual: GuiaDeManual; aoComecar?: () => void }) {
  const t = useT();
  const dados = useTrilhas();
  if (!dados.data?.disponivel || !dados.data.me_mostra_como) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-11 self-start lg:h-8"
      data-testid={`me-mostra-como-manual-${manual.id}`}
      onClick={() => {
        comecarOGuiaDoManual(manual);
        aoComecar?.();
      }}
    >
      {t("Me mostra como")}
    </Button>
  );
}

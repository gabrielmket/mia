"use client";

/**
 * FORK MIA (item 9) — "Adicionar a um painel": escolhe um painel que a pessoa
 * edita (o dela, ou o compartilhado quando é administradora) ou cria um novo
 * já com o relatório. O relatório ainda não salvo é salvo antes (como no
 * protótipo); o pronto entra pela chave, sem cópia.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";

import { adicionarAoPainel, mensagemDoErro, novoPainel, paineis as pedirPaineis, type PainelResumo } from "./api";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  /** Salva o relatório se preciso e diz o que vai para o painel. */
  garantirSalvo: () => Promise<{ relatorioId: string | null; pronto: string | null } | null>;
}

export function AdicionarAoPainel({ aberto, onFechar, garantirSalvo }: Props) {
  const t = useT();
  const router = useRouter();
  const [paineis, setPaineis] = useState<PainelResumo[] | null>(null);
  const [nome, setNome] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setPaineis(null);
    pedirPaineis()
      .then((p) => setPaineis(p.filter((x) => x.podeEditar)))
      .catch(() => setPaineis([]));
  }, [aberto]);

  async function escolher(painel: PainelResumo | null) {
    setOcupado(true);
    try {
      const alvo = await garantirSalvo();
      if (!alvo) return;
      let id: string;
      if (painel) {
        await adicionarAoPainel(painel.id, { relatorio_id: alvo.relatorioId, pronto: alvo.pronto });
        id = painel.id;
      } else {
        const criado = await novoPainel({ nome: nome.trim() || t("Meu painel"), relatorio_id: alvo.relatorioId, pronto: alvo.pronto });
        id = criado.id;
      }
      toast.success(t("Relatório adicionado ao painel."));
      onFechar();
      router.push(`/app/relatorios/paineis/${id}`);
    } catch (e) {
      toast.error(mensagemDoErro(e, t));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? onFechar() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Adicionar a um painel")}</DialogTitle>
          <DialogDescription>{t("Relatórios salvos lado a lado, com o período do painel.")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {paineis === null ? <p className="text-sm text-text-muted">{t("Carregando…")}</p> : null}
          {paineis?.map((p) => (
            <Button key={p.id} variant="outline" className="justify-between" disabled={ocupado} onClick={() => void escolher(p)}>
              <span className="truncate">{p.nome}</span>
              <span className="text-xs text-text-muted">
                {p.itens.length} {t(p.itens.length === 1 ? "relatório" : "relatórios")}
              </span>
            </Button>
          ))}
          <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("Novo painel")}</span>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} placeholder={t("Ex.: Painel comercial")} />
            </label>
            <Button disabled={ocupado} onClick={() => void escolher(null)}>
              {t("Criar painel com este relatório")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

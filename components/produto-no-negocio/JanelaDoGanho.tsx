"use client";
/**
 * FORK MIA (.109) · A JANELA "MARCAR COMO GANHO" (tela 3 do protótipo,
 * docs/fork/produto-no-negocio.md).
 *
 * O botão do menu fechava direto, sem janela; o arrasto até a etapa de ganho
 * também. Agora os dois abrem esta janela, com os itens do negócio já
 * preenchidos para conferir e ajustar antes de fechar, o valor e o motivo do
 * ganho. Com "Pedir o produto ao marcar como ganho" ligado no funil, ela só
 * confirma com pelo menos um item; desligado, mostra os itens e deixa fechar sem.
 *
 * O que se muda aqui vale para o negócio: Confirmar grava os itens e o valor
 * (`PUT /api/v1/leads/[id]/itens`) e só depois devolve o motivo a quem abriu a
 * janela, que faz o ganho pelo caminho de sempre (o `/win` do menu, o `/move` do
 * arrasto) com o carimbo novo do negócio.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { usePalavraDoProduto, useProdutoNoFunil } from "@/hooks/produto-no-negocio/useProdutoNoNegocio";
import { podeConfirmarGanho } from "@/lib/produto-no-negocio/regras";
import type { Lead } from "@/lib/types/leads";

import { BlocoDeItens } from "./BlocoDeItens";
import { CampoDoValor } from "./CampoDoValor";
import { useRascunhoDoNegocio } from "./useRascunhoDoNegocio";

export interface ConfirmacaoDoGanho {
  /** O motivo do ganho, quando a pessoa escolheu ou escreveu um. */
  wonReason?: string;
  /** O `updated_at` do negócio depois de gravar os itens (o move confere o carimbo). */
  updatedAt: string | null;
}

export function JanelaDoGanho({
  open,
  onOpenChange,
  lead,
  pipelineId,
  enviando = false,
  onConfirmar,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  lead: Pick<Lead, "id" | "title"> | null;
  pipelineId: string;
  enviando?: boolean;
  onConfirmar: (c: ConfirmacaoDoGanho) => void;
}) {
  const t = useT();
  const funil = useProdutoNoFunil(pipelineId).data;
  const palavra = usePalavraDoProduto(funil?.palavra);
  const itens = useRascunhoDoNegocio(lead?.id ?? "", pipelineId, open && !!lead);
  const [motivo, setMotivo] = useState("");

  const pedir = funil?.pedir_no_ganho ?? false;
  const nomeDoGanho = funil?.ganho ?? t("Ganho");
  const motivos = funil?.motivos_de_ganho ?? [];
  const motivoObrigatorio = funil?.motivo_de_ganho_obrigatorio ?? false;
  const lista = itens.rascunho?.itens ?? [];
  const falta = itens.pronto && !podeConfirmarGanho({ pedir, itens: lista });
  const valorRuim = itens.pronto && itens.valorAoSalvar === undefined;
  const semMotivo = motivoObrigatorio && !motivo.trim();
  const ocupado = enviando || itens.salvando;
  const bloqueado = ocupado || (!itens.pronto && !itens.falhou) || falta || valorRuim || semMotivo;

  async function confirmar() {
    if (bloqueado) return;
    let updatedAt: string | null = null;
    if (itens.pronto) {
      const r = await itens.salvar();
      if (!r.ok) return;
      updatedAt = r.updatedAt;
    }
    onConfirmar({ ...(motivo.trim() ? { wonReason: motivo.trim() } : {}), updatedAt });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" onClick={(e) => e.stopPropagation()} data-testid="janela-do-ganho">
        <DialogHeader>
          <DialogTitle>{t("Marcar como ganho")}</DialogTitle>
          <DialogDescription>
            <b>{lead?.title ?? ""}</b> {t("vai para")} <b>{nomeDoGanho}</b>.{" "}
            {t("Confira o que foi fechado: dá para mudar quantidade e desconto, tirar ou somar {produtos}.").replace(
              "{produtos}",
              palavra.p,
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          {itens.falhou ? (
            <p className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm">
              {t("Não consegui ler os {produtos} deste negócio agora. Dá para fechar sem eles.").replace("{produtos}", palavra.p)}
            </p>
          ) : !itens.pronto ? (
            <div className="h-24 animate-pulse rounded-lg border border-border" aria-hidden />
          ) : lista.length === 0 ? (
            pedir ? (
              <p className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm" data-testid="aviso-sem-produto">
                <b>{t("Este negócio ainda não tem {produto}.").replace("{produto}", palavra.s)}</b>{" "}
                {t("Escolha o que foi fechado para continuar.")}
              </p>
            ) : (
              <p className="rounded-md border border-info bg-info-bg px-3 py-2 text-sm" data-testid="aviso-sem-produto">
                {t(
                  'Este negócio não tem {produto}. Neste funil escolher é opcional, mas sem ele o fechamento entra como "Sem {produto}" no relatório.',
                ).replaceAll("{produto}", palavra.s)}
              </p>
            )
          ) : (
            <p className="text-xs text-text-muted">{t("Veio do negócio. O que mudar aqui vale para o negócio também.")}</p>
          )}

          {itens.pronto && itens.rascunho ? (
            <>
              <BlocoDeItens
                itens={itens.rascunho.itens}
                onItens={(novos) => itens.setRascunho({ ...itens.rascunho!, itens: novos })}
                palavra={palavra}
                moeda={itens.moeda}
                desabilitado={ocupado}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <CampoDoValor
                  rascunho={itens.rascunho}
                  onRascunho={itens.setRascunho}
                  palavra={palavra}
                  moeda={itens.moeda}
                  desabilitado={ocupado}
                />
                <MotivoDoGanho motivos={motivos} obrigatorio={motivoObrigatorio} valor={motivo} onValor={setMotivo} />
              </div>
            </>
          ) : itens.falhou ? (
            <MotivoDoGanho motivos={motivos} obrigatorio={motivoObrigatorio} valor={motivo} onValor={setMotivo} />
          ) : null}
        </div>

        <DialogFooter className="flex-wrap items-center gap-2 sm:justify-end">
          <span className="mr-auto text-xs text-text-muted" aria-live="polite">
            {falta ? t("Escolha pelo menos um {produto} para confirmar.").replace("{produto}", palavra.s) : ""}
          </span>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={ocupado}>
            {t("Cancelar")}
          </Button>
          <Button type="button" onClick={() => void confirmar()} disabled={bloqueado} data-testid="confirmar-ganho">
            {ocupado ? t("Salvando…") : t("Confirmar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * O motivo do ganho: a lista do funil quando há (só o que está nela é aceito),
 * texto livre quando não há. "(opcional)" sai quando o funil exige o motivo.
 */
function MotivoDoGanho({
  motivos,
  obrigatorio,
  valor,
  onValor,
}: {
  motivos: string[];
  obrigatorio: boolean;
  valor: string;
  onValor: (v: string) => void;
}) {
  const t = useT();
  const rotulo = obrigatorio ? t("Motivo do ganho") : t("Motivo do ganho (opcional)");
  return (
    <div className="space-y-2">
      <Label htmlFor="motivo-do-ganho">{rotulo}</Label>
      {motivos.length > 0 ? (
        <select
          id="motivo-do-ganho"
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          value={valor}
          onChange={(e) => onValor(e.target.value)}
        >
          <option value="">{t("Selecione…")}</option>
          {motivos.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      ) : (
        <Input id="motivo-do-ganho" value={valor} maxLength={80} onChange={(e) => onValor(e.target.value)} />
      )}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import {
  MODULOS_DO_PLANO,
  ROTULO_DO_MODULO_DO_PLANO,
  type ModuloDoPlano,
} from "@/lib/planos-mia/catalogo";

export interface PlanoComLado {
  id: string;
  nome: string;
  arquivado: boolean;
  assinantes: number;
  conversas: number | null;
  modulos: ModuloDoPlano[];
  preco_por_mensagem_cents: number | null;
  frase: string | null;
  destaque: boolean;
}

/**
 * FORK MIA (.90) — as colunas NOSSAS da aba Planos (protótipo, tela 4: "Painel ›
 * Cobrança › Planos"): os módulos que cada plano liga, o preço por mensagem do
 * Broadcast, a frase e o selo do cartão da página de preços. Mora numa tabela ao
 * lado (`mia_plano_modulos`); o plano em si continua no formulário do upstream,
 * logo acima. Ligar um módulo vale na hora para as empresas do plano; tirar de
 * um plano que alguém assina é recusado (arquive e crie outro, como o preço).
 */
export function ModulosDosPlanos({
  planos,
  crmB2bNaInstalacao,
}: {
  planos: readonly PlanoComLado[];
  crmB2bNaInstalacao: boolean;
}) {
  const t = useT();
  const idioma = useIdioma();
  const router = useRouter();
  const numero = new Intl.NumberFormat(idioma);
  const ativos = planos.filter((p) => !p.arquivado);
  const [rascunho, setRascunho] = useState<
    Record<string, { modulos: ModuloDoPlano[]; preco: string; frase: string; destaque: boolean }>
  >(
    Object.fromEntries(
      ativos.map((p) => [
        p.id,
        {
          modulos: p.modulos,
          preco:
            p.preco_por_mensagem_cents === null
              ? ""
              : (p.preco_por_mensagem_cents / 100).toFixed(2).replace(".", ","),
          frase: p.frase ?? "",
          destaque: p.destaque,
        },
      ]),
    ),
  );
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function salvar(id: string) {
    const r = rascunho[id];
    if (!r) return;
    const preco =
      r.preco.trim() === "" ? null : Math.round(Number(r.preco.replace(",", ".")) * 100);
    if (preco !== null && (!Number.isFinite(preco) || preco < 0)) {
      toast.error(t("Preço por mensagem inválido."));
      return;
    }
    setOcupado(id);
    try {
      await apiClient.put(`/api/v1/admin/planos-mia/${id}`, {
        modulos: r.modulos,
        preco_por_mensagem_cents: preco,
        frase: r.frase.trim() === "" ? null : r.frase.trim(),
        destaque: r.destaque,
      });
      toast.success(t("Módulos do plano salvos."));
      router.refresh();
    } catch (err) {
      showApiError(err);
    } finally {
      setOcupado(null);
    }
  }

  if (ativos.length === 0) return null;
  return (
    <Card className="space-y-4 p-6" data-planos-mia>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{t("Módulos e Broadcast de cada plano")}</h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "Ligar um módulo num plano liga para todas as empresas dele na hora. Tirar de um plano que alguém usa não vale: arquive e crie outro, como o preço.",
          )}
        </p>
        {!crmB2bNaInstalacao && (
          <p className="text-xs text-warning-fg">
            {t(
              "Vendas B2B está desligado em Recursos opcionais: o plano que o vende só o entrega com ele ligado.",
            )}
          </p>
        )}
      </div>
      <div className="space-y-4">
        {ativos.map((p) => {
          const r = rascunho[p.id]!;
          const muda = (m: Partial<typeof r>) =>
            setRascunho((x) => ({ ...x, [p.id]: { ...x[p.id]!, ...m } }));
          return (
            <section key={p.id} className="space-y-2 rounded-md border p-3" data-plano-mia={p.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-medium">{p.nome}</h3>
                <span className="text-xs text-muted-foreground">
                  {[
                    t("{n} empresa(s)").replace("{n}", String(p.assinantes)),
                    p.conversas === null
                      ? t("IA sem limite")
                      : t("cerca de {n} conversas").replace("{n}", numero.format(p.conversas)),
                  ].join(" · ")}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {MODULOS_DO_PLANO.map((m) => {
                  const ligado = r.modulos.includes(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={ligado}
                      onClick={() =>
                        muda({
                          modulos: ligado ? r.modulos.filter((x) => x !== m) : [...r.modulos, m],
                        })
                      }
                      className={`rounded-md border px-2 py-1 text-xs ${ligado ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                    >
                      {t(ROTULO_DO_MODULO_DO_PLANO[m].rotulo)}
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
                <label className="block space-y-1 text-xs">
                  <span className="block text-muted-foreground">
                    {t("Mensagem do Broadcast (R$)")}
                  </span>
                  <Input
                    inputMode="decimal"
                    value={r.preco}
                    placeholder="0,12"
                    onChange={(e) => muda({ preco: e.target.value })}
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="block text-muted-foreground">
                    {t("Frase do cartão na página de preços")}
                  </span>
                  <Input
                    maxLength={160}
                    value={r.frase}
                    onChange={(e) => muda({ frase: e.target.value })}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={r.destaque}
                    onChange={(e) => muda({ destaque: e.target.checked })}
                  />
                  {t('Selo "Mais escolhido"')}
                </label>
                <Button size="sm" disabled={ocupado === p.id} onClick={() => void salvar(p.id)}>
                  {t("Salvar")}
                </Button>
              </div>
            </section>
          );
        })}
      </div>
    </Card>
  );
}

"use client";

/**
 * FORK MIA — o diagnóstico da META, na aba "Diagnóstico" de Configurações ›
 * Conversões, ao lado do do Google (`_diagnostico.tsx`, do upstream) e com o
 * mesmo desenho: um cartão por conferência, cada um com o que fazer.
 *
 * A diferença é o botão. O diagnóstico do Google só lê o banco e abre pronto; o
 * da Meta pergunta à própria Meta se o token e o destino valem, e por isso só
 * roda quando alguém pede: "Testar conexão".
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { testarConexaoDaMeta } from "@/app/actions/settings/conversoesDaMeta";
import { Button } from "@/components/ui/button";
import type { DiagnosticoDaMeta, ItemDoDiagnosticoDaMeta } from "@/lib/conversoes-meta/diagnostico";
import {
  DETALHE_DO_CASO,
  TITULO_DO_CASO,
  VEREDITO_DO_DIAGNOSTICO,
  type SaudeDoItem,
} from "@/lib/conversoes-meta/diagnostico-frases";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

const ESTILO: Record<SaudeDoItem, string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10",
  atencao: "border-amber-500/40 bg-amber-500/10",
  problema: "border-destructive/40 bg-destructive/10",
};

const ROTULO: Record<SaudeDoItem, string> = { ok: "OK", atencao: "Atenção", problema: "Problema" };

const ERRO: Record<string, string> = {
  unauthenticated: "Sua sessão expirou. Entre de novo.",
  forbidden_tenant: "Você não está em nenhuma organização ativa.",
  forbidden_role: "Só um administrador da organização pode mudar esta conexão.",
  mfa_required: "Confirme o segundo fator para salvar esta mudança.",
  leitura_indisponivel: "Não consegui ler o diagnóstico agora. Atualize a página em instantes.",
};

export function DiagnosticoDaMetaNaTela({ idioma }: { idioma: Idioma }) {
  const t = (texto: string) => traduzir(texto, idioma);
  const [diagnostico, setDiagnostico] = useState<DiagnosticoDaMeta | null>(null);
  const [testando, iniciar] = useTransition();

  function testar() {
    iniciar(async () => {
      const r = await testarConexaoDaMeta();
      if (r.ok) {
        setDiagnostico(r.diagnostico);
        return;
      }
      toast.error(t(ERRO[r.error] ?? "Não consegui ler o diagnóstico agora. Atualize a página em instantes."));
    });
  }

  /** "há 2 horas", contado da hora do teste até o envio. */
  function haQuanto(iso: string, agora: string): string {
    const minutos = Math.max(0, Math.round((Date.parse(agora) - Date.parse(iso)) / 60_000));
    if (minutos < 5) return t("há instantes");
    if (minutos < 60) return t("há {tempo}").replace("{tempo}", `${minutos} ${t("minutos")}`);
    if (minutos < 1440) {
      const horas = Math.round(minutos / 60);
      return t("há {tempo}").replace("{tempo}", `${horas} ${t(horas === 1 ? "hora" : "horas")}`);
    }
    const dias = Math.round(minutos / 1440);
    return t("há {tempo}").replace("{tempo}", `${dias} ${t(dias === 1 ? "dia" : "dias")}`);
  }

  function titulo(item: ItemDoDiagnosticoDaMeta, agora: string): string {
    const base = t(TITULO_DO_CASO[item.caso]);
    if (item.caso === "ultimo_envio_aceito" && item.ultimo) return `${base} ${haQuanto(item.ultimo.em, agora)}`;
    if (item.recusados) return `${base}: ${item.recusados.total}`;
    return base;
  }

  return (
    <section className="flex flex-col gap-3" data-testid="diagnostico-meta">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold">{t("Saúde da integração com a Meta")}</h2>
          <p className="text-sm text-muted-foreground">
            {t(
              "O teste confere, na hora, se a Meta aceita o token, se o destino de conversões existe e o que foi aceito e recusado nos últimos dias. Nenhum evento é enviado pelo teste.",
            )}
          </p>
        </div>
        <Button type="button" onClick={testar} disabled={testando}>
          {testando ? t("Testando a conexão com a Meta...") : t("Testar conexão")}
        </Button>
      </div>

      {!diagnostico ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground" data-testid="diagnostico-meta-vazio">
          {testando ? t("Testando a conexão com a Meta...") : t("Ainda não testado nesta visita.")}
        </p>
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2">
            {diagnostico.itens.map((item) => (
              <li
                key={item.chave}
                data-saude={item.saude}
                data-caso={item.caso}
                className={`flex flex-col gap-1 rounded-md border p-4 ${ESTILO[item.saude]}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{titulo(item, diagnostico.testadoEm)}</p>
                  <span className="text-xs">{t(ROTULO[item.saude])}</span>
                </div>
                <p className="text-sm text-muted-foreground">{t(DETALHE_DO_CASO[item.caso])}</p>
                {item.dado && <p className="text-xs break-words text-muted-foreground">{item.dado}</p>}
                {item.ultimo && (
                  <p className="text-xs text-muted-foreground">
                    {t(item.ultimo.evento)}
                    {" · "}
                    {new Date(item.ultimo.em).toLocaleString(idioma)}
                    {item.ultimo.negocio ? ` · ${item.ultimo.negocio}` : ""}
                  </p>
                )}
                {item.recusados && (
                  <>
                    <ul className="list-disc pl-5 text-xs text-muted-foreground">
                      {item.recusados.motivos.map((m) => (
                        <li key={m.motivo}>
                          {m.quantos} · {m.motivo}
                        </li>
                      ))}
                    </ul>
                    <a
                      className="text-xs underline underline-offset-2"
                      href="?aba=historico&plataforma=meta_ads&situacao=falha&periodo=7d"
                    >
                      {t("Ver no histórico")}
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p
            data-testid="diagnostico-meta-veredito"
            data-veredito={diagnostico.veredito}
            className={
              diagnostico.veredito === "em_ordem"
                ? "rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm"
                : diagnostico.veredito === "com_problema"
                  ? "rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
                  : "rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
            }
          >
            {t(VEREDITO_DO_DIAGNOSTICO[diagnostico.veredito])}
          </p>
        </>
      )}
    </section>
  );
}

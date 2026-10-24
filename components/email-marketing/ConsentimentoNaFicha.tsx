"use client";

/**
 * FORK MIA (.89) — o CONSENTIMENTO DE E-MAIL MARKETING na ficha do contato
 * (protótipo, tela 7).
 *
 * Mostra o vigente (quando, de onde, versão do texto, evidência, quem
 * registrou), a situação na lista de supressão e a recusa de marketing pelo
 * WhatsApp. Atendente para cima registra o ACEITE (com evidência obrigatória:
 * sem ela não grava) ou a RECUSA (entra na supressão na hora; depois disso só a
 * própria pessoa volta, pelo link de um e-mail). Sem o módulo contratado, o
 * registro existe do mesmo jeito: ele vem antes da primeira campanha.
 */
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useConsentimentoDoContato, useRegistrarConsentimento } from "@/hooks/useEmailMarketing";
import { ROTULO_DA_SUPRESSAO } from "@/lib/email-marketing/rotulos";
import { EnvelopeSimple } from "@/lib/ui/icons";

const TOQUE = "min-h-11 lg:min-h-0";

/** Quem fez o registro, na voz da tela. */
const ROTULO_DO_REGISTRO: Record<string, string> = {
  ficha: "na ficha",
  importacao: "por importação",
  pagina_de_preferencias: "pela própria pessoa",
  plataforma: "pela implantação",
};

function hojeLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function ConsentimentoNaFicha({
  contactId,
  podeRegistrar,
}: {
  contactId: string;
  podeRegistrar: boolean;
}) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const q = useConsentimentoDoContato(contactId);
  const registrar = useRegistrarConsentimento(contactId);
  const [modo, setModo] = useState<"nada" | "aceite" | "recusa">("nada");
  const [origem, setOrigem] = useState("");
  const [quando, setQuando] = useState(hojeLocal);
  const [versao, setVersao] = useState("");
  const [evidencia, setEvidencia] = useState("");
  const [canal, setCanal] = useState("");
  const [verHistorico, setVerHistorico] = useState(false);

  if (q.isLoading) return null;
  if (q.isError || !q.data) return null;
  const f = q.data;
  const c = f.consentimento;
  const versoes = f.versoes;
  const versaoEscolhida = versao || versoes[0]?.versao || "";
  const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(idioma) : "—");

  function gravarAceite() {
    registrar.mutate(
      {
        tipo: "aceite",
        origem: origem.trim(),
        quando,
        versao: versaoEscolhida || null,
        evidencia: evidencia.trim(),
      },
      {
        onSuccess: () => {
          toast.success(t("Aceite registrado."));
          setModo("nada");
          setEvidencia("");
          setOrigem("");
        },
      },
    );
  }
  function gravarRecusa() {
    registrar.mutate(
      { tipo: "recusa", canal: canal.trim() || t("pedido à equipe") },
      {
        onSuccess: () => {
          toast.success(t("Recusa registrada. O endereço entrou na lista de supressão."));
          setModo("nada");
          setCanal("");
        },
      },
    );
  }

  return (
    <Card className="space-y-3 p-4" data-consentimento-de-email={f.vigente ? "vigente" : "sem"}>
      <div className="flex flex-wrap items-center gap-2">
        <EnvelopeSimple size={18} aria-hidden />
        <h3 className="text-sm font-semibold">{t("E-mail marketing")}</h3>
        {f.supressao ? (
          <Badge variant="error">{t("Na lista de supressão")}</Badge>
        ) : f.vigente ? (
          <Badge variant="success">{t("Aceite vigente")}</Badge>
        ) : (
          <Badge variant="neutral">{t("Sem aceite")}</Badge>
        )}
        {f.recusouMarketingNoWhatsapp ? (
          <Badge variant="warning">{t("Recusou marketing no WhatsApp")}</Badge>
        ) : null}
      </div>
      {!f.email ? (
        <p className="text-sm text-muted-foreground">{t("O contato não tem e-mail cadastrado.")}</p>
      ) : null}

      {f.supressao ? (
        <p className="text-sm">
          {t(
            ROTULO_DA_SUPRESSAO[f.supressao.motivo as keyof typeof ROTULO_DA_SUPRESSAO] ??
              "Descadastro",
          )}{" "}
          · {data(f.supressao.quando)}
          {f.supressao.deOnde ? ` · ${f.supressao.deOnde}` : ""}
          <small className="block text-xs text-muted-foreground">
            {t("Não recebe e-mail marketing. Só a própria pessoa volta, pelo link de um e-mail.")}
          </small>
        </p>
      ) : null}

      {c && f.vigente ? (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">{t("Aceite em")}</dt>
            <dd>{data(c.granted_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("Origem")}</dt>
            <dd>{c.source ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("Versão do texto")}</dt>
            <dd>{c.version ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("Medição de abertura")}</dt>
            <dd>{c.measurement ? t("aceita") : t("não aceita")}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t("Evidência")}</dt>
            <dd className="break-words">{c.evidence ?? "—"}</dd>
          </div>
        </dl>
      ) : null}

      {podeRegistrar && f.email && modo === "nada" ? (
        <div className="flex flex-wrap gap-2">
          {!f.supressao ? (
            <Button size="sm" variant="outline" onClick={() => setModo("aceite")}>
              {t("Registrar aceite")}
            </Button>
          ) : null}
          {!f.supressao ? (
            <Button size="sm" variant="ghost" onClick={() => setModo("recusa")}>
              {t("Registrar recusa")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {modo === "aceite" ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cf-origem">{t("De onde veio o aceite")}</Label>
              <Input
                id="cf-origem"
                value={origem}
                onChange={(e) => setOrigem(e.target.value)}
                placeholder={t("Formulário do site, balcão, ligação")}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cf-quando">{t("Data do aceite")}</Label>
              <Input
                id="cf-quando"
                type="date"
                value={quando}
                onChange={(e) => setQuando(e.target.value)}
                className={TOQUE}
              />
            </div>
          </div>
          {versoes.length > 0 ? (
            <div className="space-y-1">
              <Label htmlFor="cf-versao">{t("Texto que a pessoa aceitou")}</Label>
              <select
                id="cf-versao"
                className={`h-9 w-full rounded-md border border-border bg-surface px-2 text-sm ${TOQUE}`}
                value={versaoEscolhida}
                onChange={(e) => setVersao(e.target.value)}
              >
                {versoes.map((v) => (
                  <option key={v.versao} value={v.versao}>
                    {v.versao}
                    {v.incluiAvisoDeMedicao ? ` · ${t("com medição")}` : ` · ${t("sem medição")}`}
                    {v.rascunhoJuridico ? ` · ${t("rascunho")}` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {versoes.find((v) => v.versao === versaoEscolhida)?.texto}
              </p>
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="cf-evidencia">{t("Evidência (obrigatória)")}</Label>
            <Textarea
              id="cf-evidencia"
              rows={2}
              value={evidencia}
              onChange={(e) => setEvidencia(e.target.value)}
              placeholder={t(
                "Onde está a prova: o link do formulário, o protocolo da ligação, a foto da ficha assinada",
              )}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!origem.trim() || !evidencia.trim() || registrar.isPending}
              onClick={gravarAceite}
            >
              {t("Gravar o aceite")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setModo("nada")}>
              {t("Cancelar")}
            </Button>
          </div>
        </div>
      ) : null}

      {modo === "recusa" ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm">
            {t(
              "A pessoa pediu para não receber e-mail marketing. O endereço entra na lista de supressão agora, e só ela volta, pelo link de um e-mail.",
            )}
          </p>
          <div className="space-y-1">
            <Label htmlFor="cf-canal">{t("Por onde ela pediu")}</Label>
            <Input
              id="cf-canal"
              value={canal}
              onChange={(e) => setCanal(e.target.value)}
              placeholder={t("WhatsApp, ligação, balcão")}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={registrar.isPending}
              onClick={gravarRecusa}
            >
              {t("Gravar a recusa")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setModo("nada")}>
              {t("Cancelar")}
            </Button>
          </div>
        </div>
      ) : null}

      {f.registros.length > 0 ? (
        <div>
          <Button size="sm" variant="link" onClick={() => setVerHistorico((v) => !v)}>
            {verHistorico
              ? t("Esconder o histórico")
              : t("Ver o histórico ({n})").replace("{n}", String(f.registros.length))}
          </Button>
          {verHistorico ? (
            <ul className="mt-2 space-y-1 text-xs">
              {f.registros.map((r, i) => (
                <li key={i}>
                  <b>{r.tipo === "aceite" ? t("Aceite") : t("Recusa")}</b> · {data(r.ocorrido_em)} ·{" "}
                  {t(ROTULO_DO_REGISTRO[r.registrado_pelo] ?? "na ficha")}
                  {r.origem ? ` · ${r.origem}` : ""}
                  {r.versao_do_texto ? ` · ${r.versao_do_texto}` : ""}
                  {r.evidencia ? (
                    <span className="block text-muted-foreground">{r.evidencia}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

"use client";

/**
 * FORK MIA (.107) · "ENQUANTO ISSO: DUAS PERGUNTAS (OPCIONAL)" na página de
 * conexão do raio-X do cadastro (protótipo de 06/11/2026, tela 3): quem atende
 * hoje e o horário (segunda a sexta, sábado, domingo). O cadastro ficou mais
 * curto e não pergunta mais; aqui a pessoa responde enquanto o histórico chega.
 * Sem resposta, vale seg-sex 8h às 18h, sábado até 13h e domingo fechado.
 *
 * Salva em `POST /api/v1/publico/raio-x/<código>/horario`, que só aceita antes
 * do relatório; a análise lê o horário do banco na hora de analisar.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { FRASE_DO_CAMPO, type CampoDoHorario } from "@/lib/raio-x/cadastro";
import type { SituacaoPublica } from "@/lib/raio-x/publico";
import { QUEM_ATENDE } from "@/lib/raio-x/regras";

const SELECT = "h-10 rounded-md border border-border bg-background px-3 text-sm";
const ROTULO_DE_QUEM = { humano: "Pessoas", agente: "Robô", misto: "Os dois" } as const;

export function DuasPerguntas({ codigo, inicial }: { codigo: string; inicial: NonNullable<SituacaoPublica["horario"]> }) {
  const t = useT();
  const [quem, setQuem] = useState(inicial.quemAtende);
  const [abre, setAbre] = useState(inicial.abre);
  const [fecha, setFecha] = useState(inicial.fecha);
  const [sabado, setSabado] = useState<"fechado" | "aberto">(inicial.sabadoAte ? "aberto" : "fechado");
  const [sabadoAte, setSabadoAte] = useState(inicial.sabadoAte ?? "13:00");
  const [domingo, setDomingo] = useState<"fechado" | "aberto">(inicial.domingoAte ? "aberto" : "fechado");
  const [domingoAte, setDomingoAte] = useState(inicial.domingoAte ?? "12:00");
  const [erros, setErros] = useState<CampoDoHorario[]>([]);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setAviso(null);
    setErros([]);
    setSalvando(true);
    try {
      const r = await fetch(`/api/v1/publico/raio-x/${codigo}/horario`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quem_atende: quem,
          abre,
          fecha,
          sabado_ate: sabado === "aberto" ? sabadoAte : "",
          domingo_ate: domingo === "aberto" ? domingoAte : "",
        }),
      });
      const lido = ((await r.json().catch(() => ({}))) ?? {}) as { error?: { message?: string; details?: { campos?: CampoDoHorario[] } } };
      if (r.ok) setAviso({ tipo: "ok", texto: t("Salvo. O relatório vai usar este horário.") });
      else if (lido.error?.details?.campos) setErros(lido.error.details.campos);
      else setAviso({ tipo: "erro", texto: lido.error?.message ?? t("Não deu para salvar agora. Tente de novo.") });
    } catch {
      setAviso({ tipo: "erro", texto: t("Não deu para salvar agora. Tente de novo.") });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-6" data-raio-x="duas-perguntas">
      <h2 className="text-base font-semibold">{t("Enquanto isso: duas perguntas (opcional)")}</h2>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("Quem atende hoje")}</legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("Quem atende hoje")}>
          {QUEM_ATENDE.map((q) => (
            <Button key={q} type="button" size="sm" variant={quem === q ? "default" : "outline"} aria-pressed={quem === q} onClick={() => setQuem(q)} data-raio-x-quem={q}>
              {t(ROTULO_DE_QUEM[q])}
            </Button>
          ))}
        </div>
        {erros.includes("quem_atende") ? <p className="text-xs text-error-fg">{t(FRASE_DO_CAMPO.quem_atende)}</p> : null}
      </fieldset>
      <div className="space-y-2 text-sm">
        <p className="font-medium">{t("Horário de atendimento")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-28 text-text-muted">{t("Segunda a sexta")}</span>
          <Input type="time" className="w-28" aria-label={t("Abre às")} value={abre} onChange={(e) => setAbre(e.target.value)} data-raio-x="abre" />
          <span className="text-text-muted">{t("às")}</span>
          <Input type="time" className="w-28" aria-label={t("Fecha às")} value={fecha} onChange={(e) => setFecha(e.target.value)} data-raio-x="fecha" />
        </div>
        {erros.includes("abre") ? <p className="text-xs text-error-fg">{t(FRASE_DO_CAMPO.abre)}</p> : null}
        {erros.includes("fecha") ? <p className="text-xs text-error-fg">{t(FRASE_DO_CAMPO.fecha)}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-28 text-text-muted">{t("Sábado")}</span>
          <select className={SELECT} aria-label={t("Sábado")} value={sabado} onChange={(e) => setSabado(e.target.value as "fechado" | "aberto")} data-raio-x="sabado">
            <option value="fechado">{t("Fechado")}</option>
            <option value="aberto">{t("Aberto até")}</option>
          </select>
          {sabado === "aberto" ? <Input type="time" className="w-28" aria-label={t("Sábado até")} value={sabadoAte} onChange={(e) => setSabadoAte(e.target.value)} /> : null}
        </div>
        {erros.includes("sabado_ate") ? <p className="text-xs text-error-fg">{t(FRASE_DO_CAMPO.sabado_ate)}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-28 text-text-muted">{t("Domingo")}</span>
          <select className={SELECT} aria-label={t("Domingo")} value={domingo} onChange={(e) => setDomingo(e.target.value as "fechado" | "aberto")} data-raio-x="domingo">
            <option value="fechado">{t("Fechado")}</option>
            <option value="aberto">{t("Aberto até")}</option>
          </select>
          {domingo === "aberto" ? <Input type="time" className="w-28" aria-label={t("Domingo até")} value={domingoAte} onChange={(e) => setDomingoAte(e.target.value)} /> : null}
        </div>
        {erros.includes("domingo_ate") ? <p className="text-xs text-error-fg">{t(FRASE_DO_CAMPO.domingo_ate)}</p> : null}
      </div>
      <p className="text-xs text-text-muted">{t("Se não responder, o relatório usa segunda a sexta das 8h às 18h, sábado até 13h e domingo fechado.")}</p>
      {aviso ? <p className={`text-sm ${aviso.tipo === "ok" ? "text-success-fg" : "text-error-fg"}`} aria-live="polite">{aviso.texto}</p> : null}
      <Button type="button" onClick={salvar} disabled={salvando} data-raio-x="salvar-horario">
        {salvando ? t("Salvando…") : t("Salvar")}
      </Button>
    </section>
  );
}
